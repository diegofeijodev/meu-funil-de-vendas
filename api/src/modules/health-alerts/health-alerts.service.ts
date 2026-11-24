import { Inject, Injectable, Optional } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import type { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { PUBLISH_BLOCKED_MSG } from '../instagram/ig-types';
import { PUBLISH_BLOCKED_WAIT } from '../vacancy-stories/vacancy-reasons';
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
  /** Bloqueio de publicação aberto (24/11/2026, R10): a faixa vermelha "O Instagram parou de aceitar as publicações". */
  publishing: null | {
    reason: 'permission' | 'token';
    since: Date;
    last_at: Date;
    message: string | null;
    next_check_at: Date | null;
    waiting: { posts: number; vacancies: number };
    /** P5: `log_only` = a conferência não fecha o bloqueio (a tela pede a reconexão). */
    probe: 'active' | 'log_only';
    /** P6: "@usuario" da conta (null = sem nome). */
    username: string | null;
  };
};

/** Faixa de aviso do topo das telas (contrato §30): leitura composta, nada é gravado. */
@Injectable()
export class HealthAlertsService {
  private readonly probe: 'active' | 'log_only';

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiAlerts: AiCreditAlertsService,
    @Optional() @Inject(ENV) env?: Pick<Env, 'IG_PUBLISH_PROBE_CLOSES'>,
  ) {
    this.probe = env?.IG_PUBLISH_PROBE_CLOSES === true ? 'active' : 'log_only';
  }

  async get(workspaceId: string, now = new Date()): Promise<HealthAlerts> {
    const account = await this.prisma.instagram_accounts.findFirst({
      where: { workspace_id: workspaceId },
      select: {
        username: true, publish_block_reason: true, publish_block_message: true, publish_blocked_at: true, publish_block_last_at: true,
        publish_next_check_at: true, publish_unblocked_at: true,
      },
    });
    const [ai, instagram, publishing] = await Promise.all([
      this.ai(workspaceId),
      this.instagram(workspaceId, now, account?.publish_unblocked_at ?? null),
      this.publishing(workspaceId, account),
    ]);
    return { ai, instagram, publishing };
  }

  /** R10: o bloqueio aberto e o que espera por ele (posts com o aviso; linhas das vagas esperando para criar a arte). */
  private async publishing(
    workspaceId: string,
    a: { username: string | null; publish_block_reason: string | null; publish_block_message: string | null; publish_blocked_at: Date | null; publish_block_last_at: Date | null; publish_next_check_at: Date | null } | null,
  ): Promise<HealthAlerts['publishing']> {
    if (!a?.publish_block_reason) return null;
    const [posts, vacancies] = await Promise.all([
      this.prisma.ig_posts.count({ where: { workspace_id: workspaceId, status: { in: ['scheduled', 'ready', 'approved'] }, last_error: PUBLISH_BLOCKED_MSG } }),
      this.prisma.vacancy_stories.count({ where: { workspace_id: workspaceId, status: { in: ['new', 'waiting'] }, wait_reason: PUBLISH_BLOCKED_WAIT } }),
    ]);
    const since = a.publish_blocked_at ?? a.publish_block_last_at ?? new Date();
    return {
      reason: a.publish_block_reason === 'token' ? 'token' : 'permission',
      since,
      last_at: a.publish_block_last_at ?? since,
      message: a.publish_block_message ? a.publish_block_message.slice(0, MAX_ERROR) : null,
      next_check_at: a.publish_block_reason === 'permission' ? a.publish_next_check_at : null,
      waiting: { posts, vacancies },
      probe: this.probe,
      username: a.username ?? null,
    };
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

  /**
   * Posts com `status = 'failed'` AGORA (republicado/reagendado/cancelado já saiu desse status) que falharam nos últimos 7 dias — e depois
   * do último fechamento do bloqueio de publicação (R10: a faixa não fica velha depois do conserto).
   */
  private async instagram(workspaceId: string, now: Date, unblockedAt: Date | null): Promise<HealthAlerts['instagram']> {
    const from = Math.max(now.getTime() - INSTAGRAM_FAILED_WINDOW_MS, unblockedAt ? unblockedAt.getTime() + 1 : 0);
    const where = { workspace_id: workspaceId, status: 'failed', updated_at: { gte: new Date(from) } };
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
