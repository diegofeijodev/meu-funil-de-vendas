/**
 * Bloqueio de publicação (desenho de 24/11, §2.1): regras puras. A classificação é só pelo CÓDIGO da Meta (nunca pela mensagem) e vale
 * só no caminho de publicação (criar o container e `media_publish`); `content_publishing_limit` e `permalink` continuam engolindo os erros.
 */
import { MetaError, PublishPermissionError } from './meta-graph';

export type PublishErrorKind = 'permission' | 'token';
export type PublishBlockReason = PublishErrorKind;

const H = 3600e3;
/** Esperas entre as conferências do bloqueio, pela quantidade de falhas: 1 h, 3 h, 6 h, 12 h e teto de 24 h. */
const CHECK_DELAYS_H = [1, 3, 6, 12, 24];

/** 10 ou 200–299 = falta de permissão; 190 = token vencido/trocado; o resto (rede, dado recusado, limite) não classifica. */
export function classifyPublishError(e: unknown): PublishErrorKind | null {
  if (!(e instanceof MetaError) || typeof e.code !== 'number') return null;
  if (e.code === 10 || (e.code >= 200 && e.code <= 299)) return 'permission';
  if (e.code === 190) return 'token';
  return null;
}

/** No caminho de publicação: a recusa por permissão vira `PublishPermissionError` (mesma mensagem e códigos); o resto passa igual. */
export function toPublishError(e: unknown): unknown {
  if (e instanceof PublishPermissionError || classifyPublishError(e) !== 'permission') return e;
  const m = e as MetaError;
  return new PublishPermissionError(m.message, m.code, m.subcode);
}

/** Espera até a próxima conferência depois de `failures` recusas seguidas (≤ 1 vale como a 1ª). */
export function nextCheckDelay(failures: number): number {
  const i = Math.min(Math.max(failures, 1), CHECK_DELAYS_H.length) - 1;
  return CHECK_DELAYS_H[i]! * H;
}
