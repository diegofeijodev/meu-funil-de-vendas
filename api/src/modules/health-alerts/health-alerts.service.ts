import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { AiAlertReason, AiCreditAlertsService } from '../ai/ai-credit-alerts.service';
import { AiVendor } from '../ai/ai.types';

/** Janela dos posts do Instagram que falharam e ainda estão como falha. */
export const INSTAGRAM_FAILED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ERROR = 300;
/** Erro de permissão da Meta (frase de `translateMetaError` e os códigos crus #10/#200). */
const META_PERMISSION = /Permissão insuficiente na Meta|\(#(?:10|200)\)|does not have permission/i;

export type HealthAlerts = {
  ai: null | {
    level: 'stopped' | 'partial';
    vendors: { vendor: AiVendor; label: string; reason: AiAlertReason; since: Date; last_at: Date }[];
    fallback: AiVendor | 'app' | null;
    inherited_from: { id: string; name: string } | null;
  };
  instagram: null | { failed_count: number; last_error: string | null; last_at: Date; permission: boolean };
};

/** Faixa de aviso do topo das telas (contrato §30): leitura composta, nada é gravado. */
@Injectable()
export class HealthAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiAlerts: AiCreditAlertsService,
  ) {}

  async get(workspaceId: string, now = new Date()): Promise<HealthAlerts> {
    const [ai, instagram] = await Promise.all([this.ai(workspaceId), this.instagram(workspaceId, now)]);
    return { ai, instagram };
  }

  private async ai(workspaceId: string): Promise<HealthAlerts['ai']> {
    const st = await this.aiAlerts.status(workspaceId);
    if (!st) return null;
    return {
      level: st.level,
      vendors: st.vendors.map(({ vendor, label, reason, since, last_at }) => ({ vendor, label, reason, since, last_at })),
      fallback: st.fallback,
      inherited_from: st.inherited_from,
    };
  }

  /** Posts com `status = 'failed'` AGORA (republicado/reagendado/cancelado já saiu desse status) que falharam nos últimos 7 dias. */
  private async instagram(workspaceId: string, now: Date): Promise<HealthAlerts['instagram']> {
    const where = { workspace_id: workspaceId, status: 'failed', updated_at: { gte: new Date(now.getTime() - INSTAGRAM_FAILED_WINDOW_MS) } };
    const [count, recent] = await Promise.all([
      this.prisma.ig_posts.count({ where }),
      this.prisma.ig_posts.findMany({ where, select: { last_error: true, updated_at: true }, orderBy: { updated_at: 'desc' }, take: 50 }),
    ]);
    const last = recent[0];
    if (!count || !last) return null;
    return {
      failed_count: count,
      last_error: last.last_error ? last.last_error.slice(0, MAX_ERROR) : null,
      last_at: last.updated_at,
      permission: recent.some((p) => META_PERMISSION.test(p.last_error ?? '')),
    };
  }
}
