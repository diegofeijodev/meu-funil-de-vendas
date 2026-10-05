import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { CrmCoreService } from '../crm/crm-core.service';
import { InboundService } from '../instagram/inbound.service';
import { notFound } from '../crm/crm-errors';
import { CADENCE_TEMPLATES, DEFAULT_EXIT_RULES } from './cadence-templates';
import { CadenceChannel, CadenceStep, errText, ExitRules, inWindow, nextWindowSlot, renderVariables } from './channel-common';
import { EmailService } from './email.service';
import { WhatsAppService } from './whatsapp.service';

const LEASE_MS = 10 * 60_000;
const SELECT_LEAD = { id: true, name: true, city: true, phone: true, email: true, instagram_id: true, stage_id: true, owner_id: true, unsubscribed: true, ai_active: true } as const;

type Claimed = Prisma.crm_cadence_runsGetPayload<{ include: { cadence: { select: { steps: true; is_active: true; exit_rules: true } } } }>;

/**
 * Motor de cadências (porte de `crm/cadence.server.ts`). Diferença central: o protótipo selecionava os runs vencidos SEM trava
 * (duas execuções sobrepostas enviavam o mesmo passo duas vezes). Aqui cada run é reservado com um lease atômico
 * (`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`: `lease_token` + `lease_until`), toda escrita seguinte
 * exige o token, e o passo é AVANÇADO antes de enviar (queda no meio perde um passo em vez de duplicá-lo).
 */
@Injectable()
export class CadenceService {
  private readonly logger = new Logger(CadenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CrmCoreService,
    private readonly whatsapp: WhatsAppService,
    private readonly email: EmailService,
    private readonly instagram: InboundService,
  ) {}

  // ------------------------------------------------------------------ CRUD

  private async cadenceOr404(ws: string, id: string) {
    const c = await this.prisma.crm_cadences.findFirst({ where: { id, workspace_id: ws }, select: { id: true } });
    if (!c) throw notFound('Cadência não encontrada.');
    return c;
  }

  async save(ws: string, d: { id?: string | null; name: string; description?: string; triggerType: string; triggerValue?: string | null; isActive: boolean; steps: CadenceStep[]; exitRules: ExitRules; templateKey?: string | null }): Promise<{ id: string }> {
    const row = {
      name: d.name.trim(),
      description: d.description ?? '',
      source: d.triggerType === 'source' ? (d.triggerValue ?? 'manual') : 'manual',
      trigger_type: d.triggerType,
      trigger_value: d.triggerValue ?? null,
      is_active: d.isActive,
      steps: d.steps as unknown as Prisma.InputJsonArray,
      exit_rules: d.exitRules as unknown as Prisma.InputJsonObject,
      template_key: d.templateKey ?? null,
    };
    if (d.id) {
      await this.cadenceOr404(ws, d.id);
      await this.prisma.crm_cadences.update({ where: { id: d.id }, data: row });
      return { id: d.id };
    }
    const created = await this.prisma.crm_cadences.create({ data: { workspace_id: ws, ...row }, select: { id: true } });
    return { id: created.id };
  }

  async remove(ws: string, id: string): Promise<{ ok: true }> {
    await this.prisma.crm_cadences.deleteMany({ where: { id, workspace_id: ws } });
    return { ok: true };
  }

  /** Instala os modelos prontos que ainda faltam no workspace (inativos). */
  async installTemplates(ws: string): Promise<{ created: number }> {
    const existing = await this.prisma.crm_cadences.findMany({ where: { workspace_id: ws }, select: { template_key: true } });
    const installed = new Set(existing.map((c) => c.template_key));
    const rows = CADENCE_TEMPLATES.filter((t) => !installed.has(t.key)).map((t) => ({
      workspace_id: ws, name: t.name, description: t.description, source: t.trigger_type === 'source' ? (t.trigger_value ?? 'manual') : 'manual',
      trigger_type: t.trigger_type, trigger_value: t.trigger_value, is_active: false, steps: t.steps as unknown as Prisma.InputJsonArray,
      exit_rules: DEFAULT_EXIT_RULES as unknown as Prisma.InputJsonObject, template_key: t.key,
    }));
    if (!rows.length) return { created: 0 };
    await this.prisma.crm_cadences.createMany({ data: rows });
    return { created: rows.length };
  }

  // ------------------------------------------------------------------ matrícula

  /** Matricula um lead (pula quem já está em andamento ou descadastrado). Ids já conferidos contra o workspace. */
  async enrollLead(ws: string, cadenceId: string, leadId: string): Promise<{ enrolled: true } | { skipped: true }> {
    const existing = await this.prisma.crm_cadence_runs.findUnique({ where: { cadence_id_lead_id: { cadence_id: cadenceId, lead_id: leadId } }, select: { id: true, status: true } });
    if (existing?.status === 'running') return { skipped: true };
    const lead = await this.prisma.crm_leads.findFirst({ where: { id: leadId, workspace_id: ws }, select: { stage_id: true, unsubscribed: true } });
    if (!lead || lead.unsubscribed) return { skipped: true };
    const row = { step_index: 0, status: 'running', stop_reason: null, last_error: null, entered_at: new Date(), entry_stage_id: lead.stage_id, next_run_at: new Date(), lease_until: null, lease_token: null };
    try {
      if (existing) await this.prisma.crm_cadence_runs.update({ where: { id: existing.id }, data: row });
      else await this.prisma.crm_cadence_runs.create({ data: { ...row, workspace_id: ws, cadence_id: cadenceId, lead_id: leadId } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { skipped: true };
      throw e;
    }
    return { enrolled: true };
  }

  async enrollLeads(ws: string, cadenceId: string, leadIds: string[]): Promise<{ enrolled: number }> {
    await this.cadenceOr404(ws, cadenceId);
    const ids = [...new Set(leadIds.slice(0, 500))];
    const found = await this.prisma.crm_leads.findMany({ where: { id: { in: ids }, workspace_id: ws }, select: { id: true } });
    if (found.length !== ids.length) throw notFound('Lead não encontrado.');
    let enrolled = 0;
    for (const id of ids) if ('enrolled' in (await this.enrollLead(ws, cadenceId, id))) enrolled += 1;
    return { enrolled };
  }

  async stopLeadCadences(ws: string, leadId: string): Promise<{ stopped: number }> {
    const lead = await this.prisma.crm_leads.findFirst({ where: { id: leadId, workspace_id: ws }, select: { id: true } });
    if (!lead) throw notFound('Lead não encontrado.');
    return { stopped: await this.core.stopCadences(ws, leadId, 'manual') };
  }

  /** Matricula (idempotente) os leads que combinam com cadências de entrada em etapa, tag ou campanha. */
  async applyStageAndTagTriggers(): Promise<number> {
    const cadences = await this.prisma.crm_cadences.findMany({ where: { is_active: true, trigger_type: { in: ['stage', 'tag', 'campaign'] } }, select: { id: true, workspace_id: true, trigger_type: true, trigger_value: true } });
    let enrolled = 0;
    for (const c of cadences) {
      const value = c.trigger_value;
      if (!value) continue;
      const where: Prisma.crm_leadsWhereInput = { workspace_id: c.workspace_id, unsubscribed: false };
      if (c.trigger_type === 'stage') where.stage_id = value;
      else if (c.trigger_type === 'tag') where.tags = { has: value };
      else where.campaign_name = value;
      if (c.trigger_type === 'stage' && !/^[0-9a-f-]{36}$/i.test(value)) continue;
      // Só quem ainda não foi matriculado nesta cadência, do mais antigo ao mais novo: com mais de 200 combinando, a fila anda a cada rodada.
      where.crm_cadence_runs = { none: { cadence_id: c.id } };
      const leads = await this.prisma.crm_leads.findMany({ where, select: { id: true }, orderBy: { created_at: 'asc' }, take: 200 });
      for (const lead of leads) {
        const run = await this.prisma.crm_cadence_runs.findUnique({ where: { cadence_id_lead_id: { cadence_id: c.id, lead_id: lead.id } }, select: { id: true } });
        if (run) continue;
        if ('enrolled' in (await this.enrollLead(c.workspace_id, c.id, lead.id))) enrolled += 1;
      }
    }
    return enrolled;
  }

  // ------------------------------------------------------------------ execução

  /** Reserva até `limit` runs vencidos (um worker nunca pega o que outro está processando). */
  async claim(limit: number, workspaceId?: string): Promise<{ id: string; token: string }[]> {
    const wsFilter = workspaceId ? Prisma.sql`AND workspace_id = ${workspaceId}::uuid` : Prisma.empty;
    return this.prisma.$queryRaw<{ id: string; token: string }[]>`
      UPDATE crm_cadence_runs r
         SET lease_until = now() + ${LEASE_MS / 1000} * interval '1 second', lease_token = gen_random_uuid()
       WHERE r.id IN (
         SELECT id FROM crm_cadence_runs
          WHERE status = 'running' AND next_run_at <= now() AND (lease_until IS NULL OR lease_until < now()) ${wsFilter}
          ORDER BY next_run_at LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING r.id, r.lease_token AS token`;
  }

  /** Escrita condicionada ao token do lease; false = o lease foi perdido (outro worker assumiu). */
  private async guarded(runId: string, token: string, data: Prisma.crm_cadence_runsUncheckedUpdateManyInput, release = true): Promise<boolean> {
    const r = await this.prisma.crm_cadence_runs.updateMany({ where: { id: runId, lease_token: token, status: 'running' }, data: { ...data, ...(release ? { lease_until: null, lease_token: null } : {}) } });
    return r.count > 0;
  }

  private logEvent(run: { workspace_id: string; cadence_id: string; id: string; lead_id: string }, stepIndex: number, event: string, extra: { channel?: CadenceChannel; messageId?: string | null; detail?: string | null } = {}) {
    return this.prisma.crm_cadence_events.create({
      data: { workspace_id: run.workspace_id, cadence_id: run.cadence_id, run_id: run.id, lead_id: run.lead_id, step_index: stepIndex, channel: extra.channel ?? 'wa_text', event, message_id: extra.messageId ?? null, detail: extra.detail ?? null },
    });
  }

  /** Motivo de saída pelas regras da cadência (ou null se o lead segue). */
  private async exitReason(run: Claimed, rules: ExitRules) {
    const lead = await this.prisma.crm_leads.findFirst({ where: { id: run.lead_id, workspace_id: run.workspace_id }, select: SELECT_LEAD });
    if (!lead) return { reason: 'lead_removido', lead: null };
    if (lead.unsubscribed && rules.on_opt_out !== false) return { reason: 'opt_out', lead };
    if (!lead.ai_active && rules.on_human_takeover !== false) return { reason: 'human_takeover', lead };
    if (lead.stage_id) {
      if (rules.on_stage_change !== false && run.entry_stage_id && lead.stage_id !== run.entry_stage_id) return { reason: 'stage_change', lead };
      if (rules.on_won_lost !== false) {
        const stage = await this.prisma.crm_stages.findFirst({ where: { id: lead.stage_id, workspace_id: run.workspace_id }, select: { is_won: true, is_lost: true } });
        if (stage?.is_won || stage?.is_lost) return { reason: 'won_lost', lead };
      }
    }
    if (rules.on_reply !== false) {
      const replies = await this.prisma.crm_messages.count({ where: { lead_id: run.lead_id, workspace_id: run.workspace_id, direction: 'in', created_at: { gt: run.entered_at ?? new Date(0) } } });
      if (replies > 0) return { reason: 'replied', lead };
    }
    return { reason: null as string | null, lead };
  }

  private async hourlyBudget(ws: string): Promise<number> {
    const [settings, sent] = await Promise.all([
      this.prisma.crm_settings.findUnique({ where: { workspace_id: ws }, select: { wa_hourly_limit: true } }),
      this.prisma.crm_messages.count({ where: { workspace_id: ws, direction: 'out', created_at: { gte: new Date(Date.now() - 3_600_000) } } }),
    ]);
    return Math.max(0, (settings?.wa_hourly_limit ?? 30) - sent);
  }

  /** Executa os passos vencidos. Chamada pelo cron de 5 min e pelo "Executar agora" (`workspaceId` limita a uma empresa). */
  async runDue(limit = 25, workspaceId?: string): Promise<{ executed: number; skipped: number }> {
    const claimed = await this.claim(limit, workspaceId);
    if (!claimed.length) return { executed: 0, skipped: 0 };
    const tokenOf = new Map(claimed.map((c) => [c.id, c.token]));
    const runs = await this.prisma.crm_cadence_runs.findMany({
      where: { id: { in: claimed.map((c) => c.id) } },
      orderBy: { next_run_at: 'asc' },
      include: { cadence: { select: { steps: true, is_active: true, exit_rules: true } } },
    });
    const budgets = new Map<string, number>();
    let executed = 0;
    let skipped = 0;
    const now = new Date();

    for (const run of runs) {
      const token = tokenOf.get(run.id)!;
      try {
        const out = await this.processRun(run, token, now, budgets);
        if (out === 'executed') executed += 1;
        else if (out === 'skipped') skipped += 1;
      } catch (err) {
        // Falha inesperada fora do passo: solta o lease (o run volta na próxima rodada).
        this.logger.error(`run ${run.id}: ${errText(err)}`);
        await this.guarded(run.id, token, {});
      }
    }
    return { executed, skipped };
  }

  private async processRun(run: Claimed, token: string, now: Date, budgets: Map<string, number>): Promise<'executed' | 'skipped' | 'other'> {
    const ws = run.workspace_id;
    const cadence = run.cadence;
    if (!cadence?.is_active) {
      await this.guarded(run.id, token, { status: 'stopped', stop_reason: 'cadencia_inativa' });
      return 'other';
    }
    const steps = (Array.isArray(cadence.steps) ? cadence.steps : []) as unknown as CadenceStep[];
    const { reason, lead } = await this.exitReason(run, (cadence.exit_rules ?? {}) as ExitRules);
    if (reason) {
      if (await this.guarded(run.id, token, { status: 'stopped', stop_reason: reason })) {
        await this.logEvent(run, run.step_index, reason === 'opt_out' ? 'opt_out' : reason === 'replied' ? 'replied' : 'exited', { detail: reason });
        if (reason === 'replied') await this.handOverToOwner(ws, run.lead_id);
      }
      return 'other';
    }

    const index = run.step_index;
    const step = steps[index];
    if (!step) {
      await this.guarded(run.id, token, { status: 'done' });
      return 'other';
    }
    if (!inWindow(step, now)) {
      await this.guarded(run.id, token, { next_run_at: nextWindowSlot(step, now) });
      return 'skipped';
    }
    if (!budgets.has(ws)) budgets.set(ws, await this.hourlyBudget(ws));
    const needsSend = step.channel === 'wa_text' || step.channel === 'wa_template';
    if (needsSend && (budgets.get(ws) ?? 0) <= 0) {
      await this.guarded(run.id, token, { next_run_at: new Date(now.getTime() + 20 * 60_000) });
      return 'skipped';
    }

    // Avança ANTES de enviar (mantendo o lease): se o processo cair no meio do envio o passo não é repetido.
    const nextIndex = index + 1;
    const nextStep = steps[nextIndex];
    const advanced = await this.guarded(
      run.id, token,
      { step_index: nextIndex, status: nextStep ? 'running' : 'done', last_step_at: now, last_error: null, next_run_at: nextStep ? new Date(now.getTime() + (nextStep.delay_minutes ?? 0) * 60_000) : now },
      false,
    );
    if (!advanced) return 'other';
    try {
      await this.executeStep(run, step, index, lead as NonNullable<typeof lead>);
      if (needsSend) budgets.set(ws, (budgets.get(ws) ?? 1) - 1);
      await this.guarded(run.id, token, {});
      return 'executed';
    } catch (err) {
      const detail = errText(err);
      this.logger.error(`passo falhou: ${detail}`);
      await this.guarded(run.id, token, { status: 'failed', step_index: index, last_error: detail.slice(0, 500) });
      await this.logEvent(run, index, 'failed', { channel: step.channel, detail: detail.slice(0, 500) });
      return 'other';
    }
  }

  private async executeStep(run: Claimed, step: CadenceStep, index: number, lead: Prisma.crm_leadsGetPayload<{ select: typeof SELECT_LEAD }>) {
    const ws = run.workspace_id;
    let ownerName: string | null = null;
    if (lead.owner_id) {
      const profile = await this.prisma.profiles.findUnique({ where: { id: lead.owner_id }, select: { full_name: true } });
      ownerName = profile?.full_name ?? null;
    }
    // O banco não tem coluna de empresa no lead: `{{empresa}}` renderiza vazio, como no protótipo.
    const vars = { nome: lead.name ?? '', cidade: lead.city ?? '', empresa: '', responsavel: ownerName ?? '' };
    const body = renderVariables(step.message ?? '', vars);
    const log = (event: string, extra: { messageId?: string | null; detail?: string | null } = {}) => this.logEvent(run, index, event, { channel: step.channel, ...extra });
    // Escritas DEPOIS do envio: se falharem a mensagem já saiu, então o run segue (só registra o erro no log) em vez de virar "failed".
    const afterSend = async (fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { this.logger.error(`run ${run.id}: registro pós-envio falhou: ${errText(e)}`); }
    };

    if (step.channel === 'email' && lead.email && !lead.unsubscribed) {
      // E-mail de verdade quando o Resend está configurado; senão vira tarefa.
      const integ = await this.email.integration(ws);
      if (integ?.status === 'connected') {
        const subject = renderVariables(step.subject || 'Seguimos à disposição', vars);
        await this.email.sendLeadEmail({ workspaceId: ws, leadId: lead.id, subject, body, authorType: 'ai' });
        await afterSend(() => log('sent', { detail: `e-mail: ${subject}` }));
        return;
      }
    }

    if (step.channel === 'call_task' || step.channel === 'email') {
      await this.prisma.crm_tasks.create({
        data: {
          workspace_id: ws, lead_id: lead.id,
          title: step.channel === 'call_task' ? `Ligar para ${vars.nome || 'o lead'}` : `Enviar e-mail: ${step.subject || 'follow-up'} — ${vars.nome || 'lead'}`,
          assignee_id: lead.owner_id ?? null, due_at: new Date(), status: 'open',
        },
      });
      await this.core.addInteraction({ workspaceId: ws, leadId: lead.id, kind: 'ai_action', authorType: 'system', content: body || 'Tarefa da cadência criada.' });
      await log('task');
      return;
    }

    // Lead que só chegou pelo Instagram (sem telefone): o passo de texto vai pelo Direct, dentro da janela de 24 h.
    if (!lead.phone && lead.instagram_id && step.channel === 'wa_text') {
      try {
        const sent = await this.instagram.sendInstagramAndStore({ workspaceId: ws, leadId: lead.id, text: body, authorType: 'ai' });
        await afterSend(() => log('sent', { messageId: sent.id, detail: 'instagram' }));
      } catch (e) {
        await log('skipped', { detail: errText(e) || 'instagram indisponível' });
      }
      return;
    }

    const integration = await this.prisma.crm_integrations.findFirst({ where: { workspace_id: ws, kind: 'whatsapp', status: 'connected' } });
    if (!integration) throw new Error('WhatsApp não conectado neste workspace.');
    if (!lead.phone) throw new Error('Lead sem telefone.');
    const conversation = await this.whatsapp.ensureConversation({ integration, phone: lead.phone, leadId: lead.id });
    const official = integration.provider === 'whatsapp_cloud';

    let message: { to: string; kind: 'text' | 'template'; body?: string; templateName?: string; templateLanguage?: string; templateParams?: string[] };
    if (!official) {
      // Z-API/Evolution não têm janela de 24 h nem templates oficiais: o passo vai como texto.
      message = { to: lead.phone, kind: 'text', body };
    } else if (step.channel === 'wa_template' || !this.whatsapp.windowOpen(conversation)) {
      const templateName = step.channel === 'wa_template' ? step.template_name : step.fallback_template;
      if (!templateName) {
        await log('skipped', { detail: 'fora da janela de 24h e sem template' });
        return;
      }
      message = { to: lead.phone, kind: 'template', templateName, templateLanguage: step.template_language ?? 'pt_BR', templateParams: (step.template_params ?? []).map((p) => renderVariables(p, vars)) };
    } else {
      message = { to: lead.phone, kind: 'text', body };
    }
    const sent = await this.whatsapp.sendAndStore({ integration, conversationId: conversation.id, leadId: lead.id, message, authorType: 'ai' });
    await afterSend(() => this.core.addInteraction({
      workspaceId: ws, leadId: lead.id, kind: 'message_out', authorType: 'ai', content: body || message.templateName || 'Passo da cadência',
      metadata: { cadence_id: run.cadence_id, step_index: index },
    }));
    await afterSend(() => log('sent', { messageId: sent.id }));
  }

  /** Lead respondeu: se o SDR não atende a conversa, cria a tarefa para o responsável. */
  private async handOverToOwner(ws: string, leadId: string) {
    const lead = await this.prisma.crm_leads.findFirst({ where: { id: leadId, workspace_id: ws }, select: { owner_id: true, ai_active: true, name: true } });
    if (!lead) return;
    const agent = await this.prisma.crm_sdr_agents.findUnique({ where: { workspace_id: ws }, select: { is_active: true } });
    if (agent?.is_active && lead.ai_active) return; // o agente SDR já responde as mensagens recebidas
    await this.prisma.crm_tasks.create({ data: { workspace_id: ws, lead_id: leadId, title: `Responder ${lead.name ?? 'lead'} — respondeu à cadência`, assignee_id: lead.owner_id ?? null, due_at: new Date(), status: 'open' } });
  }

  // ------------------------------------------------------------------ SLA

  /** Tarefa para os leads parados além do SLA da etapa (dedupe pelo título). */
  async createSlaAlerts(limit = 500, workspaceId?: string): Promise<number> {
    const leads = await this.prisma.crm_leads.findMany({
      where: { stage_id: { not: null }, ...(workspaceId ? { workspace_id: workspaceId } : {}) },
      select: { id: true, name: true, owner_id: true, workspace_id: true, stage_entered_at: true, stage: { select: { name: true, sla_hours: true, is_won: true, is_lost: true } } },
      take: limit,
    });
    let created = 0;
    for (const lead of leads) {
      const stage = lead.stage;
      if (!stage || stage.is_won || stage.is_lost || !stage.sla_hours) continue;
      if (Date.now() - lead.stage_entered_at.getTime() < stage.sla_hours * 3_600_000) continue;
      const title = `SLA estourado em ${stage.name} — ${lead.name}`;
      const existing = await this.prisma.crm_tasks.findFirst({ where: { lead_id: lead.id, title }, select: { id: true } });
      if (existing) continue;
      await this.prisma.crm_tasks.create({ data: { workspace_id: lead.workspace_id, lead_id: lead.id, title, assignee_id: lead.owner_id ?? null, due_at: new Date(), status: 'open' } });
      await this.core.addInteraction({ workspaceId: lead.workspace_id, leadId: lead.id, kind: 'ai_action', authorType: 'system', content: `Lead parado além do SLA da etapa ${stage.name}. Tarefa criada para o responsável.` });
      created += 1;
    }
    return created;
  }
}
