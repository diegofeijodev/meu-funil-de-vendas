import { addDays, todaySp } from '../../common/time/dates';

const MIN = 60_000;

/**
 * R26: folga além da antecedência ao escolher o horário. A guarda mede a antecedência no instante REAL da publicação, e a fila roda a
 * cada 5 min (até 4 jobs por rodada): um story marcado exatamente em início − antecedência seria cancelado ao publicar.
 */
export const PUBLISH_SLACK_MS = 15 * MIN;

/** Dia `YYYY-MM-DD` de Brasília do instante `d` (nunca o dia UTC: entre 21h e 0h BRT ele já virou). */
export function spDay(d: Date): string {
  return todaySp(d);
}

/** Instante do horário `hh:mm` de Brasília no dia `day` (UTC−3 fixo, sem horário de verão desde 2019 — como `vacancy-usage`). */
export function windowStartOn(day: string, hhmm: string): Date {
  return new Date(`${day}T${hhmm}:00-03:00`);
}

/**
 * Próximo horário livre na janela do dia (Brasília): o 1º instante ≥ max(agora + 1 min, `after` + espaçamento) dentro de
 * [início, fim) da janela; antes dela → o início dela no mesmo dia; no fim ou depois → o início da janela do dia seguinte.
 * A janela não cruza a meia-noite (os ajustes exigem início < fim).
 */
export function nextWindowSlot(o: { now: Date; windowStart: string; windowEnd: string; after: Date | null; spacingMin: number }): Date {
  const lower = Math.max(o.now.getTime() + MIN, o.after ? o.after.getTime() + o.spacingMin * MIN : -Infinity);
  const t = new Date(lower);
  const day = spDay(t);
  const start = windowStartOn(day, o.windowStart);
  if (lower < start.getTime()) return start;
  if (lower < windowStartOn(day, o.windowEnd).getTime()) return t;
  return windowStartOn(addDays(day, 1), o.windowStart);
}
