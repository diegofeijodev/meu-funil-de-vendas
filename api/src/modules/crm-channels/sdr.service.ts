import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { AiError } from '../ai/ai-error';
import { AiService } from '../ai/ai.service';
import { CrmCoreService } from '../crm/crm-core.service';
import { CalendarService } from './calendar.service';
import { BusinessHours, errText, TZ, withinBusinessHours } from './channel-common';

export type SdrQuestion = { key: string; question: string; weight: number };
export type SdrDecision = {
  resposta: string;
  campos_extraidos: Record<string, string | null>;
  score: number;
  temperatura: 'frio' | 'morno' | 'quente';
  proxima_etapa: 'contato_iniciado' | 'qualificado' | 'reuniao_agendada' | 'perdido' | 'manter';
  transferir_humano: boolean;
  motivo: string;
  horario_escolhido?: string | null;
};
export type SdrTurn = { role: 'user' | 'assistant'; content: string };
export type SdrAgentRow = Prisma.crm_sdr_agentsGetPayload<object>;
export type FreeSlot = { iso: string; label: string };
export type SdrRunResult =
  | { skipped: string }
  | { handoff: true; reason: string }
  | { offHours: true; reply: string | null }
  | { reply: string; decision: SdrDecision }
  | { error: string };

export const SDR_MODELS = ['openai/gpt-6-astra', 'google/gemini-3.1-flash', 'google/gemini-3.1-pro'] as const;
export const DEFAULT_SDR_MODEL = 'openai/gpt-6-astra';

export const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resposta', 'campos_extraidos', 'score', 'temperatura', 'proxima_etapa', 'transferir_humano', 'motivo', 'horario_escolhido'],
  properties: {
    resposta: { type: 'string', description: 'Mensagem curta para o lead, uma pergunta por vez.' },
    campos_extraidos: {
      type: 'object',
      additionalProperties: false,
      required: ['cidade', 'capital', 'prazo', 'decisor', 'email', 'observacoes'],
      properties: {
        cidade: { type: ['string', 'null'] },
        capital: { type: ['string', 'null'] },
        prazo: { type: ['string', 'null'] },
        decisor: { type: ['string', 'null'] },
        email: { type: ['string', 'null'] },
        observacoes: { type: ['string', 'null'] },
      },
    },
    score: { type: 'integer' },
    temperatura: { type: 'string', enum: ['frio', 'morno', 'quente'] },
    proxima_etapa: { type: 'string', enum: ['contato_iniciado', 'qualificado', 'reuniao_agendada', 'perdido', 'manter'] },
    transferir_humano: { type: 'boolean' },
    motivo: { type: 'string' },
    horario_escolhido: { type: ['string', 'null'], description: 'ISO exato de um dos HORARIOS LIVRES quando o lead confirmar.' },
  },
} as const;

const STAGE_TERMS: Record<string, string[]> = {
  contato_iniciado: ['contato'],
  qualificado: ['qualificado'],
  reuniao_agendada: ['reuniao agendada', 'agendada'],
  perdido: ['perdido'],
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Etapa que combina com a decisão do agente (por nome, sem acento; "perdido" prefere a etapa marcada como perdida). */
export function pickStage<T extends { name: string; is_lost?: boolean }>(stages: T[], key: string): T | null {
  const terms = STAGE_TERMS[key];
  if (!terms) return null;
  if (key === 'perdido') {
    const lost = stages.find((s) => s.is_lost);
    if (lost) return lost;
  }
  return stages.find((s) => terms.some((t) => norm(s.name).includes(t))) ?? null;
}

/** Aceita só o que o schema promete; o resto cai em padrões seguros (a IA pode devolver lixo mesmo com schema estrito). */
export function sanitizeDecision(raw: unknown): SdrDecision {
  const r = (raw ?? {}) as Record<string, unknown>;
  const resposta = typeof r['resposta'] === 'string' ? r['resposta'].trim() : '';
  if (!resposta) throw new AiError('A IA retornou uma resposta vazia.');
  const campos = (r['campos_extraidos'] ?? {}) as Record<string, unknown>;
  const fields: Record<string, string | null> = {};
  for (const k of ['cidade', 'capital', 'prazo', 'decisor', 'email', 'observacoes']) fields[k] = typeof campos[k] === 'string' && campos[k] ? String(campos[k]) : null;
  const temp = r['temperatura'];
  const step = r['proxima_etapa'];
  return {
    resposta,
    campos_extraidos: fields,
    score: Math.max(0, Math.min(100, Math.round(Number(r['score']) || 0))),
    temperatura: temp === 'quente' || temp === 'morno' || temp === 'frio' ? temp : 'frio',
    proxima_etapa: typeof step === 'string' && ['contato_iniciado', 'qualificado', 'reuniao_agendada', 'perdido', 'manter'].includes(step) ? (step as SdrDecision['proxima_etapa']) : 'manter',
    transferir_humano: r['transferir_humano'] === true,
    motivo: typeof r['motivo'] === 'string' ? r['motivo'] : '',
    horario_escolhido: typeof r['horario_escolhido'] === 'string' ? r['horario_escolhido'] : null,
  };
}

export function buildSystemPrompt(agent: SdrAgentRow, knowledge: string, lead: { name?: string | null; phone?: string | null; email?: string | null; city?: string | null; source?: string | null; campaign_name?: string | null; score?: number | null } | null, freeSlots: FreeSlot[] = []): string {
  const questions = ((agent.questions as unknown as SdrQuestion[]) ?? []).map((q) => `- ${q.question} (chave: ${q.key}, peso ${q.weight})`).join('\n');
  const slots = ((agent.available_slots as unknown as string[]) ?? []).join(', ');
  const triggers = ((agent.handoff_triggers as unknown as string[]) ?? []).join(', ');
  return [
    `Voce e ${agent.name}, um SDR virtual. Persona: ${agent.persona || 'consultor comercial experiente'}.`,
    `Tom de voz: ${agent.tone}.`,
    `Objetivo: ${agent.goal}`,
    '',
    'REGRAS OBRIGATORIAS:',
    '- Responda em portugues do Brasil, com mensagens curtas (ate 2 frases).',
    '- Faca no maximo UMA pergunta por mensagem.',
    '- Nunca invente informacao. Se nao souber ou nao estiver na base de conhecimento, defina transferir_humano = true.',
    `- Transfira para humano quando o assunto envolver: ${triggers || 'negociacao de preco, reclamacao, assunto juridico, pedido de atendente'}.`,
    `- Calcule o score de 0 a 100 somando os pesos das perguntas ja respondidas de forma positiva. Nota minima para qualificar: ${agent.min_score}.`,
    freeSlots.length
      ? '- Ao atingir a nota minima, defina proxima_etapa = "qualificado" e ofereca 2 ou 3 dos HORARIOS LIVRES abaixo (agenda real).'
      : `- Ao atingir a nota minima, defina proxima_etapa = "qualificado" e ofereca horario${agent.scheduling_link ? ` usando o link ${agent.scheduling_link}` : slots ? ` entre as opcoes: ${slots}` : ''}.`,
    freeSlots.length
      ? '- Para reservar voce precisa do e-mail do lead: peca antes de confirmar. Quando o lead confirmar um dos horarios E o e-mail estiver disponivel, preencha horario_escolhido com o ISO exato e defina proxima_etapa = "reuniao_agendada". Caso contrario horario_escolhido = null.'
      : '- Quando o lead confirmar um horario, defina proxima_etapa = "reuniao_agendada". horario_escolhido = null.',
    '- Se o lead nao tiver perfil (sem interesse, fora do publico), defina proxima_etapa = "perdido" e explique em motivo.',
    '- Use proxima_etapa = "manter" quando ainda estiver qualificando.',
    '',
    freeSlots.length ? `HORARIOS LIVRES (${TZ}):\n${freeSlots.map((f) => `- ${f.label} = ${f.iso}`).join('\n')}\n` : '',
    'PERGUNTAS DE QUALIFICACAO:',
    questions || '- Entenda a necessidade do lead.',
    '',
    'BASE DE CONHECIMENTO:',
    knowledge || '(sem base cadastrada — nao invente nada)',
    '',
    'DADOS DO LEAD:',
    JSON.stringify({ nome: lead?.name ?? null, telefone: lead?.phone ?? null, email: lead?.email ?? null, cidade: lead?.city ?? null, origem: lead?.source ?? null, campanha: lead?.campaign_name ?? null, score_atual: lead?.score ?? 0 }),
  ].join('\n');
}

/** O gateway recebe um único prompt: instruções + a conversa como transcrição (a IA responde ao último turno do lead). */
export function buildPrompt(system: string, history: SdrTurn[]): string {
  const convo = history.map((t) => `${t.role === 'user' ? 'LEAD' : 'AGENTE'}: ${t.content}`).join('\n');
  return `${system}\n\nCONVERSA ATE AGORA:\n${convo}\n\nResponda como o agente a ultima mensagem do LEAD, seguindo as regras e devolvendo a decisao no formato JSON pedido.`;
}

/**
 * Agente SDR (porte de `crm/sdr.server.ts`): monta o prompt da configuração do workspace, chama a IA do app com JSON estrito
 * (`AiService.json`: chave própria OpenAI/Gemini ou gateway) e aplica a decisão no lead. Respeita opt-out, `ai_active`,
 * `max_messages` e o horário de atendimento.
 */
@Injectable()
export class SdrService {
  private readonly logger = new Logger(SdrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly calendar: CalendarService,
    private readonly core: CrmCoreService,
  ) {}

  loadAgent(workspaceId: string) {
    return this.prisma.crm_sdr_agents.findUnique({ where: { workspace_id: workspaceId } });
  }

  private async knowledgeFor(agent: SdrAgentRow): Promise<string> {
    const docs = await this.prisma.crm_sdr_documents.findMany({ where: { agent_id: agent.id, workspace_id: agent.workspace_id }, select: { file_name: true, extracted_text: true }, take: 10 });
    const text = docs.map((d) => `# ${d.file_name}\n${String(d.extracted_text ?? '').slice(0, 8000)}`).join('\n\n');
    return [agent.knowledge_text, text].filter(Boolean).join('\n\n');
  }

  private async slotsFor(workspaceId: string): Promise<FreeSlot[]> {
    try {
      return (await this.calendar.availableSlots(workspaceId)).map((iso) => ({ iso, label: this.calendar.formatSlot(iso) }));
    } catch (e) {
      this.logger.warn(`agenda indisponível: ${errText(e)}`);
      return [];
    }
  }

  /** Chama a IA; modelo escolhido recusado (400/404) cai para o padrão para o lead não ficar sem resposta. */
  private async askModel(agent: SdrAgentRow, prompt: string) {
    const started = Date.now();
    const call = (model: string) => this.ai.json(agent.workspace_id, { prompt, schema: DECISION_SCHEMA as unknown as Record<string, unknown>, name: 'sdr_decision', model });
    let raw: unknown;
    try {
      raw = await call(agent.model || DEFAULT_SDR_MODEL);
    } catch (e) {
      if (e instanceof AiError && /respondeu (400|404)/.test(e.message) && agent.model && agent.model !== DEFAULT_SDR_MODEL) {
        this.logger.warn(`modelo ${agent.model} recusado; usando ${DEFAULT_SDR_MODEL}`);
        raw = await call(DEFAULT_SDR_MODEL);
      } else throw e;
    }
    return { decision: sanitizeDecision(raw), durationMs: Date.now() - started };
  }

  /** Roda o agente para uma mensagem recebida e aplica a decisão no lead. */
  async run(args: { workspaceId: string; leadId: string; conversationId?: string | null; inboundText: string }): Promise<SdrRunResult> {
    const ws = args.workspaceId;
    const agent = await this.loadAgent(ws);
    if (!agent || !agent.is_active) return { skipped: 'agente inativo' };
    const lead = await this.prisma.crm_leads.findFirst({ where: { id: args.leadId, workspace_id: ws } });
    if (!lead) return { skipped: 'lead nao encontrado' };
    if (lead.unsubscribed || !lead.ai_active) return { skipped: 'IA pausada para este lead' };

    const count = await this.prisma.crm_messages.count({ where: { lead_id: lead.id, workspace_id: ws } });
    if (count > agent.max_messages) {
      await this.prisma.crm_leads.update({ where: { id: lead.id }, data: { ai_active: false } });
      await this.core.addInteraction({ workspaceId: ws, leadId: lead.id, kind: 'ai_action', authorType: 'ai', content: 'Limite de mensagens da conversa atingido. Transferido para atendimento humano.' });
      return { handoff: true, reason: 'limite de mensagens' };
    }

    if (!withinBusinessHours(agent.business_hours as BusinessHours)) {
      // Mensagem de ausência só uma vez por período fora do horário (não a cada mensagem do lead).
      const recentAway = await this.prisma.crm_messages.count({
        where: { lead_id: lead.id, workspace_id: ws, direction: 'out', body: agent.offhours_message, created_at: { gte: new Date(Date.now() - 12 * 3600e3) } },
      });
      return { offHours: true, reply: recentAway > 0 ? null : agent.offhours_message };
    }

    const history = await this.prisma.crm_messages.findMany({ where: { lead_id: lead.id, workspace_id: ws }, orderBy: { created_at: 'desc' }, take: 20, select: { direction: true, body: true } });
    const turns: SdrTurn[] = history.reverse().filter((m) => !!m.body).map((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: String(m.body) }));
    if (!turns.length || turns[turns.length - 1]!.content !== args.inboundText) turns.push({ role: 'user', content: args.inboundText });

    const [knowledge, freeSlots] = await Promise.all([this.knowledgeFor(agent), this.slotsFor(ws)]);
    const prompt = buildPrompt(buildSystemPrompt(agent, knowledge, lead, freeSlots), turns);
    try {
      const result = await this.askModel(agent, prompt);
      const applied = await this.applyDecision({ agent, lead, decision: result.decision, freeSlots });
      if (applied.confirmation) result.decision.resposta = `${result.decision.resposta}\n\n${applied.confirmation}`.trim();
      await this.prisma.crm_sdr_runs.create({
        data: {
          workspace_id: ws, agent_id: agent.id, lead_id: lead.id, conversation_id: args.conversationId ?? null, mode: 'live',
          inbound_text: args.inboundText, reply_text: result.decision.resposta, decision: result.decision as unknown as Prisma.InputJsonObject,
          score: result.decision.score, handoff: result.decision.transferir_humano, status: 'ok', model: agent.model, duration_ms: result.durationMs,
        },
      });
      return { reply: result.decision.resposta, decision: result.decision };
    } catch (e) {
      const detail = errText(e);
      this.logger.error(`execução falhou: ${detail}`);
      await this.prisma.crm_sdr_runs.create({
        data: { workspace_id: ws, agent_id: agent.id, lead_id: lead.id, conversation_id: args.conversationId ?? null, mode: 'live', inbound_text: args.inboundText, status: 'error', error_message: detail.slice(0, 500), model: agent.model },
      });
      return { error: 'falha na execucao do agente' };
    }
  }

  /** Persiste o que a decisão implica: campos, score, etapa (por nome), tarefas, reserva na agenda e linha do tempo. */
  async applyDecision(args: { agent: SdrAgentRow; lead: Prisma.crm_leadsGetPayload<object>; decision: SdrDecision; freeSlots?: FreeSlot[] }): Promise<{ confirmation: string | null }> {
    const { agent, lead, decision } = args;
    const ws = agent.workspace_id;
    const fields = decision.campos_extraidos ?? {};
    let confirmation: string | null = null;

    const patch: Prisma.crm_leadsUncheckedUpdateInput = { score: decision.score, temperature: decision.temperatura, last_interaction_at: new Date() };
    if (fields['cidade'] && !lead.city) patch.city = fields['cidade'];
    if (fields['email'] && !lead.email) patch.email = fields['email'];

    let target: { id: string; name: string } | null = null;
    const stageKey = decision.transferir_humano ? 'manter' : decision.proxima_etapa;
    if (stageKey && stageKey !== 'manter' && lead.pipeline_id) {
      const stages = await this.prisma.crm_stages.findMany({ where: { workspace_id: ws, pipeline_id: lead.pipeline_id }, select: { id: true, name: true, is_lost: true } });
      target = pickStage(stages, stageKey);
    }
    const moved = !!target && target.id !== lead.stage_id;
    if (moved) {
      patch.stage_id = target!.id;
      patch.stage_entered_at = new Date();
    }
    if (decision.proxima_etapa === 'perdido') {
      patch.loss_reason = decision.motivo || 'Desqualificado pelo agente SDR';
      patch.ai_active = false;
    }
    if (decision.transferir_humano) patch.ai_active = false;

    await this.prisma.$transaction(async (tx) => {
      await tx.crm_leads.update({ where: { id: lead.id }, data: patch });
      if (moved) await tx.crm_stage_history.create({ data: { workspace_id: ws, lead_id: lead.id, from_stage_id: lead.stage_id ?? null, to_stage_id: target!.id } });
    });

    await this.core.addInteraction({
      workspaceId: ws, leadId: lead.id, kind: 'ai_action', authorType: 'ai', content: decision.resposta,
      metadata: { score: decision.score, temperatura: decision.temperatura, proxima_etapa: decision.proxima_etapa, transferir_humano: decision.transferir_humano, motivo: decision.motivo, campos_extraidos: fields },
    });

    if (decision.proxima_etapa === 'perdido' || decision.transferir_humano) await this.core.stopCadences(ws, lead.id, 'human_takeover');

    if (decision.transferir_humano) {
      await this.prisma.crm_tasks.create({
        data: { workspace_id: ws, lead_id: lead.id, assignee_id: lead.owner_id ?? null, title: `Assumir conversa: ${decision.motivo || 'transferencia solicitada pelo agente'}`, due_at: new Date(Date.now() + 60 * 60 * 1000), status: 'open' },
      });
      await this.core.addInteraction({ workspaceId: ws, leadId: lead.id, kind: 'ai_action', authorType: 'system', content: `IA pausada e conversa transferida para humano. Motivo: ${decision.motivo || 'nao informado'}.` });
    }

    if (decision.proxima_etapa === 'reuniao_agendada') {
      let booked: { start: string; url: string | null } | null = null;
      const chosen = decision.horario_escolhido;
      const email = fields['email'] || lead.email;
      if (chosen && email && (args.freeSlots ?? []).some((f) => f.iso === chosen)) {
        try {
          booked = await this.calendar.bookSlot(ws, { start: chosen, name: lead.name || 'Lead', email, phone: lead.phone ?? null });
          confirmation = `Reuniao confirmada para ${this.calendar.formatSlot(booked.start)}. O convite chega no seu e-mail${booked.url ? ` (link: ${booked.url})` : ''}.`;
        } catch (e) {
          this.logger.error(`reserva falhou: ${errText(e)}`);
        }
      }
      await this.prisma.crm_tasks.create({
        data: {
          workspace_id: ws, lead_id: lead.id, assignee_id: lead.owner_id ?? null,
          title: booked ? `Reuniao com ${lead.name ?? 'lead'} em ${new Date(booked.start).toLocaleString('pt-BR', { timeZone: TZ })}` : `Confirmar reuniao com ${lead.name ?? 'lead'}`,
          due_at: booked ? new Date(booked.start) : new Date(Date.now() + 2 * 60 * 60 * 1000), status: 'open',
        },
      });
      await this.core.addInteraction({
        workspaceId: ws, leadId: lead.id, kind: 'note', authorType: 'system',
        content: booked ? `Reuniao reservada na agenda pelo agente SDR${booked.url ? ` (${booked.url})` : ''}.` : 'Lead aceitou reuniao: confirme o horario (agenda nao conectada ou horario fora da lista).',
      });
    }
    return { confirmation };
  }

  /** Execução simulada da tela "Testar agente": mesma chamada, nada muda em leads. */
  async simulate(workspaceId: string, history: SdrTurn[]) {
    const agent = await this.loadAgent(workspaceId);
    if (!agent) throw new AiError('Configure o agente antes de testar.', 'AGENT_NOT_CONFIGURED');
    const [knowledge, freeSlots] = await Promise.all([this.knowledgeFor(agent), this.slotsFor(workspaceId)]);
    const prompt = buildPrompt(buildSystemPrompt(agent, knowledge, { name: 'Lead de teste' }, freeSlots), history);
    const result = await this.askModel(agent, prompt);
    await this.prisma.crm_sdr_runs.create({
      data: {
        workspace_id: workspaceId, agent_id: agent.id, mode: 'test', inbound_text: history[history.length - 1]?.content ?? null, reply_text: result.decision.resposta,
        decision: result.decision as unknown as Prisma.InputJsonObject, score: result.decision.score, handoff: result.decision.transferir_humano, status: 'ok', model: agent.model, duration_ms: result.durationMs,
      },
    });
    return result;
  }
}
