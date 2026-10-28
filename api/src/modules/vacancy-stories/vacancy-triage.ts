import type { FreelaVacancy } from './vacancy-types';
import { leadDeadline, tooCloseReason, VACANCY_STARTED_REASON } from './vacancy-reasons';
import { cityMatches, isTestText } from './vacancy-text';

export const SKIP = {
  test: 'Parece vaga de teste: o nome da empresa tem “teste”.',
  testTitle: 'Parece vaga de teste: o título tem “teste”.',
  noValue: 'A vaga não tem valor informado.',
  noCity: 'A vaga não tem cidade informada.',
};

export type TriageSettings = { cities: string[]; min_lead_minutes: number };
export type TriageResult = { status: 'new' } | { status: 'skipped'; reason: string };

const skip = (reason: string): TriageResult => ({ status: 'skipped', reason });

export function triage(v: FreelaVacancy, s: TriageSettings, now: Date): TriageResult {
  if (isTestText(v.contractorName)) return skip(SKIP.test);
  if (isTestText(v.title)) return skip(SKIP.testTitle);
  if (!v.amountInCents) return skip(SKIP.noValue);
  const city = (v.city ?? '').trim();
  if (!city) return skip(SKIP.noCity);
  if (!cityMatches(city, s.cities)) return skip(`Cidade fora da sua lista: ${city}.`);
  const startsAt = new Date(v.startTime);
  if (startsAt.getTime() - now.getTime() < s.min_lead_minutes * 60_000) {
    return skip(tooCloseReason(startsAt, leadDeadline(startsAt, s.min_lead_minutes)));
  }
  return { status: 'new' };
}

/**
 * R30 — "Criar story mesmo assim" (linha `forced`): a vaga de teste ou de fora da lista de cidades passa, mas sem valor, sem cidade,
 * já começada ou dentro da antecedência + 15 min de folga da fila não tem como virar story. O botão e a geração usam esta regra.
 */
export function forcedTriage(v: FreelaVacancy, s: Pick<TriageSettings, 'min_lead_minutes'>, now: Date): TriageResult {
  if (!v.amountInCents) return skip(SKIP.noValue);
  if (!(v.city ?? '').trim()) return skip(SKIP.noCity);
  const startsAt = new Date(v.startTime);
  if (startsAt.getTime() <= now.getTime()) return skip(VACANCY_STARTED_REASON);
  const deadline = leadDeadline(startsAt, s.min_lead_minutes, true);
  if (deadline.getTime() < now.getTime()) return skip(tooCloseReason(startsAt, deadline));
  return { status: 'new' };
}

export function isAfterWatermark(v: FreelaVacancy, enabledAt: Date): boolean {
  return new Date(v.publishedAt).getTime() > enabledAt.getTime();
}
