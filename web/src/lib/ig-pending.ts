/**
 * Contagem de posts do Instagram em `pending_approval` (selo do menu lateral).
 * O protótipo contava `ig_posts` direto no Supabase. A rota da API nasce na
 * tarefa do Instagram; até lá devolve 0 (sem chamada de rede) — a tarefa troca
 * ESTE corpo por `GET /v1/workspaces/:id/...` mantendo a chave de query
 * `["ig-pending-badge", workspaceId]` e o intervalo de 120 s do shell.
 */
export async function fetchIgPendingCount(workspaceId: string): Promise<number> {
  void workspaceId;
  return 0;
}
