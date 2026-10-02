import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';

/** `normalizePhone` do protótipo: só dígitos; prefixo 55 mantido; até 11 dígitos vira `+55…`; senão `+` + dígitos. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (digits.startsWith('55')) return `+${digits}`;
  if (digits.length <= 11) return `+55${digits}`;
  return `+${digits}`;
}

/**
 * Peças do CRM compartilhadas entre o formulário público, o descadastro e as telas (porte de `crm/integrations.server.ts`
 * e das duas funções de `crm/cadence.server.ts` que o núcleo precisa). Tudo escopado pelo workspace.
 *
 * Cadências: aqui só o mínimo de banco (matrícula por origem e parada por descadastro/resposta). O motor de cadências
 * (passos, janelas, envio) é da Task 8 e pode trocar estas duas funções.
 */
@Injectable()
export class CrmCoreService {
  constructor(private readonly prisma: PrismaService) {}

  /** Primeiro funil do workspace e a primeira etapa dele (`firstStage`). */
  async firstStage(workspaceId: string) {
    const pipeline = await this.prisma.crm_pipelines.findFirst({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'asc' }, select: { id: true } });
    if (!pipeline) return { pipelineId: null as string | null, stageId: null as string | null };
    const stage = await this.prisma.crm_stages.findFirst({ where: { pipeline_id: pipeline.id, workspace_id: workspaceId }, orderBy: { position: 'asc' }, select: { id: true } });
    return { pipelineId: pipeline.id, stageId: stage?.id ?? null };
  }

  /** Distribuição: responsável fixo ou rodízio pelos membros (mesma regra do Instagram, Task 5). */
  async pickOwner(workspaceId: string): Promise<string | null> {
    const [settings, members] = await Promise.all([
      this.prisma.crm_settings.findUnique({ where: { workspace_id: workspaceId }, select: { distribution: true, default_owner_id: true } }),
      this.prisma.workspace_members.findMany({ where: { workspace_id: workspaceId }, select: { user_id: true }, orderBy: { user_id: 'asc' } }),
    ]);
    if (settings?.distribution === 'fixed') return settings.default_owner_id ?? null;
    if (!members.length) return null;
    const count = await this.prisma.crm_leads.count({ where: { workspace_id: workspaceId } });
    return members[count % members.length]!.user_id;
  }

  /** Deduplicação por telefone/e-mail dentro do workspace. */
  async findLead(workspaceId: string, phone: string | null, email: string | null) {
    const or: Prisma.crm_leadsWhereInput[] = [];
    if (phone) or.push({ phone });
    if (email) or.push({ email });
    if (!or.length) return null;
    return this.prisma.crm_leads.findFirst({ where: { workspace_id: workspaceId, OR: or } });
  }

  /** Interação + `last_interaction_at` (o `contact` vira `system`, como no protótipo). */
  async addInteraction(args: {
    workspaceId: string;
    leadId: string;
    kind: string;
    authorType: 'user' | 'ai' | 'system' | 'contact';
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.prisma.crm_interactions.create({
      data: {
        workspace_id: args.workspaceId,
        lead_id: args.leadId,
        kind: args.kind,
        author_type: args.authorType === 'contact' ? 'system' : args.authorType,
        content: args.content,
        metadata: (args.metadata ?? {}) as Prisma.InputJsonObject,
      },
    });
    await this.prisma.crm_leads.update({ where: { id: args.leadId }, data: { last_interaction_at: new Date() } });
  }

  /** Matricula o lead na cadência ativa de gatilho "origem" que combina com a origem dele (`startCadence`). */
  async startCadence(workspaceId: string, leadId: string, source: string): Promise<void> {
    const cadences = await this.prisma.crm_cadences.findMany({
      where: { workspace_id: workspaceId, is_active: true },
      select: { id: true, trigger_type: true, trigger_value: true, source: true },
    });
    const match = cadences.find((c) => (c.trigger_type ?? 'source') === 'source' && (c.trigger_value ?? c.source) === source);
    if (!match) return;
    const lead = await this.prisma.crm_leads.findFirst({ where: { id: leadId, workspace_id: workspaceId }, select: { stage_id: true, unsubscribed: true } });
    if (!lead || lead.unsubscribed) return;
    const existing = await this.prisma.crm_cadence_runs.findFirst({ where: { cadence_id: match.id, lead_id: leadId }, select: { id: true, status: true } });
    if (existing?.status === 'running') return;
    const row = { step_index: 0, status: 'running', stop_reason: null, entered_at: new Date(), entry_stage_id: lead.stage_id, next_run_at: new Date() };
    if (existing) await this.prisma.crm_cadence_runs.update({ where: { id: existing.id }, data: row });
    else await this.prisma.crm_cadence_runs.create({ data: { ...row, workspace_id: workspaceId, cadence_id: match.id, lead_id: leadId } });
  }

  /** Para as cadências em andamento do lead e registra o evento (`stopCadences`). Devolve quantas parou. */
  async stopCadences(workspaceId: string, leadId: string, reason: string): Promise<number> {
    const runs = await this.prisma.crm_cadence_runs.findMany({
      where: { workspace_id: workspaceId, lead_id: leadId, status: 'running' },
      select: { id: true, cadence_id: true, step_index: true },
    });
    if (!runs.length) return 0;
    await this.prisma.crm_cadence_runs.updateMany({ where: { id: { in: runs.map((r) => r.id) } }, data: { status: 'stopped', stop_reason: reason } });
    await this.prisma.crm_cadence_events.createMany({
      data: runs.map((r) => ({
        workspace_id: workspaceId,
        cadence_id: r.cadence_id,
        run_id: r.id,
        lead_id: leadId,
        step_index: r.step_index,
        event: reason === 'opt_out' ? 'opt_out' : reason === 'replied' ? 'replied' : 'exited',
        detail: reason,
      })),
    });
    return runs.length;
  }
}
