import { Prisma } from '@prisma/client';

/**
 * Colunas `date` (só-dia) do banco. O Prisma devolve `Date` à meia-noite UTC; o
 * Supabase devolvia "YYYY-MM-DD". Estes nomes só existem como `date` no schema.
 */
export const DATE_ONLY_KEYS = new Set(['date', 'start_date', 'end_date', 'week_start']);

/**
 * Converte o resultado do Prisma para o formato de fio do protótipo (PostgREST):
 * `numeric` e `bigint` viram number, `date` vira "YYYY-MM-DD", timestamps viram ISO.
 */
export function toWire(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) {
    const iso = value.toISOString();
    return key && DATE_ONLY_KEYS.has(key) ? iso.slice(0, 10) : iso;
  }
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  if (Array.isArray(value)) return value.map((v) => toWire(v, key));
  if (typeof value === 'object') {
    // Buffers/streams passam intactos.
    if (Buffer.isBuffer(value) || typeof (value as { pipe?: unknown }).pipe === 'function') return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toWire(v, k);
    return out;
  }
  return value;
}
