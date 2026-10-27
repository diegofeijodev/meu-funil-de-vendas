import { Injectable } from '@nestjs/common';
import { IgStore } from './ig-store.service';
import { igCampaignScope, IG_NOT_PENDING } from './ig-campaign-scope';

const posts = (n: number) => (n === 1 ? '1 post' : `${n} posts`);

export type CampaignIgCancel = { cancelledPosts: number; cancelledJobs: number; publishingNow: number };

/**
 * Instagram de uma campanha (ponto de entrada do módulo para o "Encerrar campanha" dos anúncios). O critério de quais posts são da
 * campanha é o de `igCampaignScope` (o mesmo da contagem no detalhe da campanha). Mesmo corte de `cancelAutoRun`, numa transação só.
 */
@Injectable()
export class IgCampaignService {
  constructor(private readonly store: IgStore) {}

  /** Posts desta campanha que ainda vão sair e os que estão saindo agora (mesmo critério do cancelamento). */
  async pendingForCampaign(workspaceId: string, campaignId: string): Promise<{ linked: boolean; pending: number; publishingNow: number }> {
    const prisma = this.store.prisma;
    const scope = await igCampaignScope(prisma, workspaceId, campaignId);
    if (!scope.posts) return { linked: false, pending: 0, publishingNow: 0 };
    const [pending, publishingNow] = await Promise.all([
      prisma.ig_posts.count({ where: { AND: [scope.posts, { status: { notIn: IG_NOT_PENDING } }] } }),
      prisma.ig_posts.count({ where: { AND: [scope.posts, { status: 'publishing' }] } }),
    ]);
    return { linked: true, pending, publishingNow };
  }

  async cancelForCampaign(workspaceId: string, campaignId: string): Promise<CampaignIgCancel> {
    const prisma = this.store.prisma;
    const out = await prisma.$transaction(async (tx) => {
      const scope = await igCampaignScope(tx, workspaceId, campaignId);
      const runIds = scope.runs.map((r) => r.id);
      if (!scope.posts) return { cancelledPosts: 0, cancelledJobs: 0, publishingNow: 0, byPlan: new Map<string | null, number>() };

      if (runIds.length) await tx.ig_auto_runs.updateMany({ where: { id: { in: runIds }, workspace_id: workspaceId }, data: { status: 'cancelled', recurring: false, locked_until: null } });
      // Plano ativo pararia de gerar/publicar posts novos pelo piloto automático; rascunho fica como está.
      if (scope.planIds.length) await tx.ig_content_plans.updateMany({ where: { id: { in: scope.planIds }, workspace_id: workspaceId, status: 'active' }, data: { status: 'paused' } });

      const pendingWhere = { AND: [scope.posts, { status: { notIn: IG_NOT_PENDING } }] };
      const found = await tx.ig_posts.findMany({ where: pendingWhere, select: { id: true, plan_id: true, run_id: true } });
      const publishingNow = await tx.ig_posts.count({ where: { AND: [scope.posts, { status: 'publishing' }] } });
      const ids = found.map((p) => p.id);
      let cancelledJobs = 0;
      let cancelledPosts = 0;
      if (ids.length) {
        cancelledJobs = (await tx.publishing_jobs.updateMany({ where: { ig_post_id: { in: ids }, workspace_id: workspaceId, status: 'pending' }, data: { status: 'cancelled', locked_at: null } })).count;
        // Condicional ao status (um post que virou `publishing` entre a leitura e aqui fica): conta o que de fato mudou.
        cancelledPosts = (await tx.ig_posts.updateMany({ where: { id: { in: ids }, workspace_id: workspaceId, status: { notIn: IG_NOT_PENDING } }, data: { status: 'cancelled' } })).count;
      }
      // Um evento por plano com posts retirados (como o cancelamento de uma programação), com o motivo.
      const planOfRun = new Map(scope.runs.map((r) => [r.id, r.plan_id]));
      const byPlan = new Map<string | null, number>();
      for (const p of found) {
        const plan = p.plan_id ?? (p.run_id ? (planOfRun.get(p.run_id) ?? null) : null);
        byPlan.set(plan, (byPlan.get(plan) ?? 0) + 1);
      }
      return { cancelledPosts, cancelledJobs, publishingNow, byPlan };
    });
    for (const [planId, n] of out.byPlan) {
      if (n > 0) await this.store.logEvent({ workspace_id: workspaceId, plan_id: planId, kind: 'guardrail', message: `Campanha encerrada: ${posts(n)} retirado${n === 1 ? '' : 's'} da fila.` });
    }
    return { cancelledPosts: out.cancelledPosts, cancelledJobs: out.cancelledJobs, publishingNow: out.publishingNow };
  }
}
