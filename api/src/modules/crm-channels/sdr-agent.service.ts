import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { friendly, UserFacingError } from './channel-errors';
import { SDR_MODELS, SdrService } from './sdr.service';

export type SdrAgentInput = {
  isActive: boolean; name: string; persona: string; tone: string; goal: string; knowledgeText: string;
  questions: { key: string; question: string; weight: number }[]; minScore: number; schedulingLink: string | null; availableSlots: string[];
  businessHours: { timezone: string; days: number[]; start: string; end: string }; offhoursMessage: string; maxMessages: number; handoffTriggers: string[]; model?: string;
};

/** Configuração do agente SDR, base de conhecimento e teste (porte de `crm-sdr.functions.ts`). */
@Injectable()
export class SdrAgentService {
  private readonly logger = new Logger(SdrAgentService.name);

  constructor(private readonly prisma: PrismaService, private readonly sdr: SdrService) {}

  async get(ws: string) {
    const [agent, runs] = await Promise.all([
      this.prisma.crm_sdr_agents.findUnique({ where: { workspace_id: ws } }),
      this.prisma.crm_sdr_runs.findMany({
        where: { workspace_id: ws }, orderBy: { created_at: 'desc' }, take: 25,
        select: { id: true, mode: true, inbound_text: true, reply_text: true, score: true, handoff: true, status: true, error_message: true, model: true, input_tokens: true, output_tokens: true, duration_ms: true, created_at: true },
      }),
    ]);
    const documents = agent
      ? await this.prisma.crm_sdr_documents.findMany({ where: { agent_id: agent.id, workspace_id: ws }, orderBy: { created_at: 'desc' }, select: { id: true, file_name: true, size_bytes: true, created_at: true } })
      : [];
    return { agent, documents, runs };
  }

  async save(ws: string, d: SdrAgentInput) {
    const data = {
      is_active: d.isActive, name: d.name, persona: d.persona, tone: d.tone, goal: d.goal, knowledge_text: d.knowledgeText,
      questions: d.questions as unknown as Prisma.InputJsonArray, min_score: d.minScore, scheduling_link: d.schedulingLink,
      available_slots: d.availableSlots as unknown as Prisma.InputJsonArray, business_hours: d.businessHours as unknown as Prisma.InputJsonObject,
      offhours_message: d.offhoursMessage, max_messages: d.maxMessages, handoff_triggers: d.handoffTriggers as unknown as Prisma.InputJsonArray,
      ...(d.model && (SDR_MODELS as readonly string[]).includes(d.model) ? { model: d.model } : {}),
    };
    try {
      return await this.prisma.crm_sdr_agents.upsert({ where: { workspace_id: ws }, create: { workspace_id: ws, ...data }, update: data });
    } catch (e) {
      this.logger.error(`falha ao salvar agente: ${e instanceof Error ? e.message : e}`);
      throw new UserFacingError('Não foi possível salvar o agente. Tente novamente.');
    }
  }

  async uploadDocument(ws: string, d: { fileName: string; mimeType: string; contentBase64: string }) {
    const agent = await this.prisma.crm_sdr_agents.findUnique({ where: { workspace_id: ws }, select: { id: true } });
    if (!agent) throw new UserFacingError('Salve a configuração do agente antes de enviar arquivos.');
    const binary = Buffer.from(d.contentBase64, 'base64');
    if (binary.byteLength > 5 * 1024 * 1024) throw new UserFacingError('Arquivo muito grande (limite de 5 MB).');
    let text = '';
    try {
      if (d.mimeType === 'application/pdf' || d.fileName.toLowerCase().endsWith('.pdf')) {
        const { extractText, getDocumentProxy } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(binary));
        text = String((await extractText(pdf, { mergePages: true })).text ?? '');
      } else text = binary.toString('utf8');
    } catch (e) {
      this.logger.error(`falha ao ler arquivo: ${e instanceof Error ? e.message : e}`);
      throw new UserFacingError('Não foi possível ler este arquivo. Envie um PDF com texto ou um arquivo .txt.');
    }
    if (!text.trim()) throw new UserFacingError('O arquivo não contém texto legível.');
    try {
      await this.prisma.crm_sdr_documents.create({
        data: { workspace_id: ws, agent_id: agent.id, file_name: d.fileName.slice(0, 255), mime_type: d.mimeType || 'application/octet-stream', size_bytes: binary.byteLength, extracted_text: text.slice(0, 200000) },
      });
    } catch (e) {
      throw friendly(e, 'Não foi possível salvar o arquivo.', this.logger);
    }
    return { ok: true, characters: text.length };
  }

  async deleteDocument(ws: string, documentId: string) {
    await this.prisma.crm_sdr_documents.deleteMany({ where: { id: documentId, workspace_id: ws } });
    return { ok: true };
  }

  async test(ws: string, history: { role: 'user' | 'assistant'; content: string }[]) {
    try {
      const r = await this.sdr.simulate(ws, history);
      return { reply: r.decision.resposta, decision: r.decision, durationMs: r.durationMs, inputTokens: null, outputTokens: null };
    } catch (e) {
      this.logger.error(`teste falhou: ${e instanceof Error ? e.message : e}`);
      throw friendly(e, 'Não foi possível executar o agente agora. Tente novamente.');
    }
  }
}
