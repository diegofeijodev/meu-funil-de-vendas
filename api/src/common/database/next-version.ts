/** Conflito de unicidade do Prisma (P2002). */
export const isUniqueViolation = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'P2002';

/**
 * Cria uma linha "versionada" (versão = máxima atual + 1). Gerações concorrentes podem calcular a mesma versão;
 * o índice único `(pai, version)` barra a segunda e aqui se recalcula e tenta de novo (até `attempts` vezes).
 *
 * Sem transação interativa: cada `create` é uma escrita isolada (uma violação dentro de uma transação interativa do Postgres
 * abortaria a transação inteira). O conflito é reconhecido só pelo código `P2002` (`isUniqueViolation`), nunca pela mensagem.
 */
export async function createWithNextVersion<T>(
  currentMax: () => Promise<number | null | undefined>,
  create: (version: number) => Promise<T>,
  attempts = 3,
): Promise<{ row: T; version: number }> {
  for (let i = 1; ; i++) {
    const version = ((await currentMax()) ?? 0) + 1;
    try {
      return { row: await create(version), version };
    } catch (e) {
      if (!isUniqueViolation(e) || i >= attempts) throw e;
    }
  }
}
