import { Injectable } from '@nestjs/common';
import { IgStore } from './ig-store.service';

/** Posts que ficam ao encerrar: publicados, cancelados e o que está saindo agora (cancelar no meio deixaria a Meta e o banco divergentes). */
const KEEP = ['published', 'publishing', 'cancelled'];
const posts = (n: number) => (n === 1 ? '1 post' : `${n} posts`);

export type CampaignIgCancel = { cancelledPosts: number; cancelledJobs: number; publishingNow: number };

/**
 * Instagram de uma campanha (ponto de entrada do módulo para o "Encerrar campanha" dos anúncios). De onde vêm os posts:
 * programações automáticas com `ig_auto_runs.campaign_id` (e as semanas recorrentes delas) e planos com `ig_content_plans.campaign_id`
 * ("Criar plano no Instagram"). Mesmo corte de `cancelAutoRun`, numa transação só.
 */
@Injectable()
export class IgCampaignService {
  constructor(private readonly store: IgStore) {}

  async cancelForCampaign(workspaceId: string, campaignId: string): Promise<CampaignIgCancel> {
    const prisma = this.store.prisma;
    const out = await prisma.$transaction(async (tx) => {
      const roots = await tx.ig_auto_runs.findMany({ where: { campaign_id: campaignId, workspace_id: workspaceId }, select: { id: true, plan_id: true } });
      const rootIds = roots.map((r) => r.id);
      const kids = rootIds.length
        ? await tx.ig_auto_runs.findMany({ where: { parent_id: { in: rootIds }, workspace_id: workspaceId }, select: { id: true, plan_id: true } })
        : [];
      const runs = [...roots, ...kids];
      const runIds = [...new Set(runs.map((r) => r.id))];
      const plans = await tx.ig_content_plans.findMany({ where: { campaign_id: campaignId, workspace_id: workspaceId }, select: { id: true } });
      const planIds = plans.map((p) => p.id);
      if (!runIds.length && !planIds.length) return { cancelledPosts: 0, cancelledJobs: 0, publishingNow: 0, byPlan: new Map<string | null, number>() };

      if (runIds.length) await tx.ig_auto_runs.updateMany({ where: { id: { in: runIds }, workspace_id: workspaceId }, data: { status: 'cancelled', recurring: false, locked_until: null } });
      // Plano ativo pararia de gerar/publicar posts novos pelo piloto automático; rascunho fica como está.
      if (planIds.length) await tx.ig_content_plans.updateMany({ where: { id: { in: planIds }, workspace_id: workspaceId, status: 'active' }, data: { status: 'paused' } });

      // Do plano ligado só saem os posts do próprio plano ou das programações DESTA campanha (outra programação no mesmo plano fica).
      const origin = [
        ...(runIds.length ? [{ run_id: { in: runIds } }] : []),
        ...(planIds.length ? [{ plan_id: { in: planIds }, OR: [{ run_id: null }, ...(runIds.length ? [{ run_id: { in: runIds } }] : [])] }] : []),
      ];
      const found = await tx.ig_posts.findMany({ where: { workspace_id: workspaceId, OR: origin, status: { notIn: KEEP } }, select: { id: true, plan_id: true, run_id: true } });
      const publishingNow = await tx.ig_posts.count({ where: { workspace_id: workspaceId, OR: origin, status: 'publishing' } });
      const ids = found.map((p) => p.id);
      let cancelledJobs = 0;
      if (ids.length) {
        cancelledJobs = (await tx.publishing_jobs.updateMany({ where: { ig_post_id: { in: ids }, workspace_id: workspaceId, status: 'pending' }, data: { status: 'cancelled', locked_at: null } })).count;
        await tx.ig_posts.updateMany({ where: { id: { in: ids }, workspace_id: workspaceId, status: { notIn: KEEP } }, data: { status: 'cancelled' } });
      }
      // Um evento por plano envolvido (como o cancelamento de uma programação), com o motivo.
      const planOfRun = new Map(runs.map((r) => [r.id, r.plan_id]));
      const byPlan = new Map<string | null, number>();
      for (const r of runs) if (!byPlan.has(r.plan_id)) byPlan.set(r.plan_id, 0);
      for (const id of planIds) if (!byPlan.has(id)) byPlan.set(id, 0);
      for (const p of found) {
        const plan = p.plan_id ?? (p.run_id ? (planOfRun.get(p.run_id) ?? null) : null);
        byPlan.set(plan, (byPlan.get(plan) ?? 0) + 1);
      }
      return { cancelledPosts: ids.length, cancelledJobs, publishingNow, byPlan };
    });
    for (const [planId, n] of out.byPlan) {
      await this.store.logEvent({ workspace_id: workspaceId, plan_id: planId, kind: 'guardrail', message: `Campanha encerrada: ${posts(n)} retirado${n === 1 ? '' : 's'} da fila.` });
    }
    return { cancelledPosts: out.cancelledPosts, cancelledJobs: out.cancelledJobs, publishingNow: out.publishingNow };
  }
}
