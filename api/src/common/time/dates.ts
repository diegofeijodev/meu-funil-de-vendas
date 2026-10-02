// Datas "só dia" no fuso de Brasília — convenção do workspace Freela.
// NUNCA use new Date().toISOString() para "hoje": entre 21h e 00h BRT a data
// UTC já virou o dia seguinte.
const SP_TZ = 'America/Sao_Paulo';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Hoje em Brasília como "YYYY-MM-DD". */
export function todaySp(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Data "só dia" válida: formato "YYYY-MM-DD" E dia que existe no calendário.
 * O ida-e-volta por `dateFromString`/`dateToString` derruba "2026-02-31" e
 * "2026-13-45", que a regex sozinha deixaria passar (e que viram
 * `Invalid Date` — e 500 — na primeira conta de data).
 */
export const isDateString = (value: unknown): value is string => {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = dateFromString(value);
  return !Number.isNaN(d.getTime()) && dateToString(d) === value;
};

/** Converte "YYYY-MM-DD" em Date ao MEIO-DIA UTC — imune a virada de fuso. */
export function dateFromString(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

/** "YYYY-MM-DD" a partir de um Date tratado como dia civil (usa UTC). */
export function dateToString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = dateFromString(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToString(d);
}

/** Dias entre duas date-strings (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateFromString(b).getTime() - dateFromString(a).getTime()) / 86_400_000);
}

/** Todas as date-strings de `from` até `to`, inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Primeiro e último dia do mês de `dateStr`. */
export function monthRange(dateStr: string): { from: string; to: string } {
  const [y, m] = dateStr.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y as number, m as number, 0)).getUTCDate();
  return {
    from: `${dateStr.slice(0, 7)}-01`,
    to: `${dateStr.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Dia da semana (0 = domingo … 6 = sábado) de uma date-string, imune a fuso. */
export const weekdayOf = (dateStr: string): number => dateFromString(dateStr).getUTCDay();

export const monthDayOf = (dateStr: string): number => Number(dateStr.slice(8, 10));

/** ISO UTC de agora. */
export const nowIso = (): string => new Date().toISOString();

/** Hora local de Brasília (0..23) de um instante. */
export function hourSp(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: SP_TZ, hour: 'numeric', hour12: false })
      .format(date)
      .replace('24', '0'),
  );
}

/** Dia da semana em Brasília (0..6) de um instante. */
export function weekdaySp(date: Date = new Date()): number {
  return weekdayOf(todaySp(date));
}
