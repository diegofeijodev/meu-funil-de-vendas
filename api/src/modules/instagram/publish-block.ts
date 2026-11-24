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

/** Maior limite de publicações em 24 h que aceitamos da Meta (a doc dela já citou 50 e 100; acima disso é dado estranho e fica o 25). */
export const MAX_TRUSTED_QUOTA = 100;

/**
 * P1/V4 — limite de publicações em 24 h que a Meta informou em `content_publishing_limit?fields=config,quota_usage`: só vale inteiro entre
 * 1 e 100 e janela de 86400 s; senão `null` (fica o 25).
 */
export function quotaFrom(resp: unknown): number | null {
  const row = (resp as { data?: { config?: { quota_total?: unknown; quota_duration?: unknown } }[] } | null)?.data?.[0];
  const total = row?.config?.quota_total;
  if (Number(row?.config?.quota_duration) !== 86400) return null;
  return typeof total === 'number' && Number.isInteger(total) && total >= 1 && total <= MAX_TRUSTED_QUOTA ? total : null;
}

/** "20/11 às 8h30" / "20/11 às 8h" no horário de Brasília (textos gravados: sempre dia e hora absolutos). */
export function dayHourSp(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hourCycle: 'h23', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p['day']}/${p['month']} às ${Number(p['hour'])}h${p['minute'] === '00' ? '' : p['minute']}`;
}

/** R4/V3 — post adiado pelo bloqueio que passou do horário em mais de 12 h. */
export const blockedOverdueMessage = (since: Date, now: Date) =>
  `Não foi publicado: a Meta recusou as publicações desta empresa entre ${dayHourSp(since)} e ${dayHourSp(now)}.`;

/**
 * Até quando um job adiado pelo bloqueio espera: a próxima conferência, entre 5 e 60 min a partir de agora (a fila volta a olhar no máximo
 * a cada hora; conferência já vencida não faz o job girar a cada rodada).
 */
export function blockedRunAt(nextCheckAt: Date | null, now: Date): Date {
  const min = now.getTime() + 5 * 60e3;
  const cap = now.getTime() + 60 * 60e3;
  return new Date(nextCheckAt ? Math.min(Math.max(nextCheckAt.getTime(), min), cap) : cap);
}
