import { Prisma } from '@prisma/client';

/** Posts que já não "estão para sair": publicados, cancelados e o que está saindo agora. */
export const IG_NOT_PENDING = ['published', 'publishing', 'cancelled'];

/** O mínimo do Prisma (ou de uma transação) que o critério usa. */
export type IgScopeDb = {
  ig_auto_runs: { findMany(args: Prisma.ig_auto_runsFindManyArgs): Promise<{ id: string; plan_id: string }[]> };
  ig_content_plans: { findMany(args: Prisma.ig_content_plansFindManyArgs): Promise<{ id: string }[]> };
};

export type IgCampaignScope = {
  /** Programações da campanha + as semanas recorrentes filhas (por `parent_id`). */
  runs: { id: string; plan_id: string }[];
  /** Planos ligados à campanha ("Criar plano no Instagram"). */
  planIds: string[];
  /** Filtro dos posts que vieram da campanha (`null` = nada ligado). */
  posts: Prisma.ig_postsWhereInput | null;
};

/**
 * O critério ÚNICO de "posts do Instagram desta campanha", usado pela contagem do detalhe da campanha e pelo cancelamento ao encerrar
 * (função pura, sem Nest: o módulo de campanhas não pode importar o do Instagram — Instagram → Estrategista → Campanhas).
 * Entram os posts das programações da campanha (e das semanas recorrentes delas) e os dos planos ligados; de um plano ligado, só os
 * sem programação ou das programações DESTA campanha (outra programação que use o mesmo plano fica de fora).
 */
export async function igCampaignScope(db: IgScopeDb, workspaceId: string, campaignId: string): Promise<IgCampaignScope> {
  const roots = await db.ig_auto_runs.findMany({ where: { campaign_id: campaignId, workspace_id: workspaceId }, select: { id: true, plan_id: true } });
  const rootIds = roots.map((r) => r.id);
  const kids = rootIds.length ? await db.ig_auto_runs.findMany({ where: { parent_id: { in: rootIds }, workspace_id: workspaceId }, select: { id: true, plan_id: true } }) : [];
  const seen = new Set<string>();
  const runs = [...roots, ...kids].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const runIds = runs.map((r) => r.id);
  const planIds = (await db.ig_content_plans.findMany({ where: { campaign_id: campaignId, workspace_id: workspaceId }, select: { id: true } })).map((p) => p.id);
  if (!runIds.length && !planIds.length) return { runs, planIds, posts: null };
  const origin: Prisma.ig_postsWhereInput[] = [
    ...(runIds.length ? [{ run_id: { in: runIds } }] : []),
    ...(planIds.length ? [{ plan_id: { in: planIds }, OR: [{ run_id: null }, ...(runIds.length ? [{ run_id: { in: runIds } }] : [])] }] : []),
  ];
  return { runs, planIds, posts: { workspace_id: workspaceId, OR: origin } };
}
