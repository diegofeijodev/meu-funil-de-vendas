/**
 * Qual empresa a tela usa: a primeira das preferidas (a escolhida nesta aba, a salva no navegador) que ainda está na lista de
 * empresas do usuário; senão a primeira da lista (mais antiga). Id de empresa apagada (em outra aba) ou de que a pessoa saiu nunca
 * é usado. `null` = o usuário não tem empresa.
 */
export function pickWorkspaceId(memberships: { workspace_id: string }[], ...preferred: (string | null | undefined)[]): string | null {
  for (const id of preferred) if (id && memberships.some((m) => m.workspace_id === id)) return id;
  return memberships[0]?.workspace_id ?? null;
}

/** Erro HTTP 403 de uma leitura: a empresa pode ter sido apagada ou o acesso tirado — vale reconferir a lista de empresas. */
export function isForbidden(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return status === 403;
}
