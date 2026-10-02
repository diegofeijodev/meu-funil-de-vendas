import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { CrmDefaultsService } from '../crm-defaults/crm-defaults.service';

/** Leituras que alimentam os Indicadores (`/crm/dashboard`) e as métricas de cadência — o navegador agrega tudo, como no protótipo. */
@Injectable()
export class CrmReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaults: CrmDefaultsService,
  ) {}

  /** `crm_stage_history select lead_id, from_stage_id, to_stage_id, created_at order created_at` (todas as linhas). */
  async stageHistory(ws: string) {
    await this.defaults.ensure(ws);
    return this.prisma.crm_stage_history.findMany({
      where: { workspace_id: ws },
      orderBy: { created_at: 'asc' },
      select: { lead_id: true, from_stage_id: true, to_stage_id: true, created_at: true },
    });
  }

  /** `crm_interactions select lead_id, kind, author_type, created_at` (todas as linhas). */
  async interactions(ws: string) {
    await this.defaults.ensure(ws);
    return this.prisma.crm_interactions.findMany({ where: { workspace_id: ws }, select: { lead_id: true, kind: true, author_type: true, created_at: true } });
  }

  /** `crm_cadences select id, name order name` (o seletor "Incluir em cadência…"). */
  cadenceOptions(ws: string) {
    return this.prisma.crm_cadences.findMany({ where: { workspace_id: ws }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  }

  /** As 6 leituras do `CadenceMetrics`; `messages` só dos primeiros 1000 ids de mensagem dos eventos (e só deste workspace). */
  async cadenceMetrics(ws: string) {
    const [cadences, events, runs, stages, history] = await Promise.all([
      this.prisma.crm_cadences.findMany({ where: { workspace_id: ws }, select: { id: true, name: true, steps: true } }),
      this.prisma.crm_cadence_events.findMany({ where: { workspace_id: ws }, select: { cadence_id: true, step_index: true, channel: true, event: true, message_id: true, lead_id: true } }),
      this.prisma.crm_cadence_runs.findMany({ where: { workspace_id: ws }, select: { cadence_id: true, lead_id: true, entered_at: true, status: true, stop_reason: true } }),
      this.prisma.crm_stages.findMany({ where: { workspace_id: ws }, select: { id: true, name: true } }),
      this.prisma.crm_stage_history.findMany({ where: { workspace_id: ws }, select: { lead_id: true, to_stage_id: true, created_at: true } }),
    ]);
    const messageIds = events.map((e) => e.message_id).filter((m): m is string => !!m).slice(0, 1000);
    const messages = messageIds.length
      ? await this.prisma.crm_messages.findMany({ where: { id: { in: messageIds }, workspace_id: ws }, select: { id: true, status: true } })
      : [];
    return { cadences, events, runs, stages, history, messages };
  }
}
