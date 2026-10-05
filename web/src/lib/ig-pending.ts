import { countIgPending } from "@/modules/instagram/infrastructure/instagram.api";

/**
 * Contagem de posts do Instagram em `pending_approval` ou `needs_review` (selo do menu lateral).
 * O protótipo contava `ig_posts` direto no Supabase; aqui é `GET /v1/workspaces/:id/ig-posts/pending-count`
 * (mesma chave de query `["ig-pending-badge", workspaceId]` e intervalo de 120 s do shell).
 */
export async function fetchIgPendingCount(workspaceId: string): Promise<number> {
  return countIgPending(workspaceId);
}
