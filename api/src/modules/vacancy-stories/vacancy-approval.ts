import type { Prisma } from '@prisma/client';

type Tx = Pick<Prisma.TransactionClient, 'ig_posts' | 'publishing_jobs'>;

/**
 * "Eu aprovo" segura o story de vaga que ninguém aprovou (C2 e R39): o post volta para `pending_approval` com
 * `creative_brief.vacancy.requires_approval: true`, sem horário, e os jobs pendentes dele são cancelados. Condicional ao status lido e a
 * `approved_at` nulo (um post que virou `publishing` ou foi aprovado no meio segue). Rode dentro de uma transação. Devolve se mudou.
 */
export async function holdForApproval(tx: Tx, ws: string, post: { id: string; status: string; creative_brief: unknown }): Promise<boolean> {
  const brief = (post.creative_brief ?? {}) as Record<string, unknown>;
  const vacancy = { ...((brief['vacancy'] ?? {}) as Record<string, unknown>), requires_approval: true };
  const got = await tx.ig_posts.updateMany({
    where: { id: post.id, workspace_id: ws, status: post.status, approved_at: null },
    data: { status: 'pending_approval', scheduled_at: null, creative_brief: { ...brief, vacancy } as Prisma.InputJsonObject },
  });
  if (!got.count) return false;
  await tx.publishing_jobs.updateMany({ where: { ig_post_id: post.id, workspace_id: ws, status: 'pending' }, data: { status: 'cancelled', locked_at: null } });
  return true;
}
