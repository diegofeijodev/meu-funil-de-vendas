import { createHash } from 'crypto';
import { cltDeadlineReason } from './vacancy-reasons';
import { clipText, cleanEstablishment, cityMatches, formatMoney, hourLabel, isTestText, norm } from './vacancy-text';
import { SKIP, type TriageResult, type TriageSettings } from './vacancy-triage';
import type { CltFields, FreelaFixedJob } from './vacancy-types';

/**
 * Vagas fixas (CLT) — regras puras da 2ª fonte (desenho 2026-11-24 §2.4.3; UI §3.4–§3.5; decisões do dono de 24/11): triagem, campos da
 * arte, assinatura e o "divulgar até". Sem rede, sem banco, sem arte: a guarda (núcleo) também usa.
 */

const DAY_MS = 86_400_000;
/** Prazo para divulgar uma vaga fixa: no máximo 30 dias depois de publicada (vaga esquecida aberta não vai ao ar meses depois). */
export const CLT_PROMO_DAYS = 30;

export const CLT_SKIP = {
  testRole: 'Parece vaga de teste: o cargo tem “teste”.',
  noSalary: 'A vaga fixa não tem salário informado.',
  /** Decisão de 25/11: sem cidade a arte sai sem o cartão; mas com a lista de cidades preenchida não há como conferir. */
  noCityForList: 'A vaga fixa não tem cidade para conferir com a sua lista.',
};

/** "Divulgar até" = mín(expiresAt, publishedAt + 30 dias). É o `starts_at` da linha CLT. */
export function cltDeadline(v: Pick<FreelaFixedJob, 'publishedAt' | 'expiresAt'>): Date {
  const promo = Date.parse(v.publishedAt) + CLT_PROMO_DAYS * DAY_MS;
  const exp = v.expiresAt ? Date.parse(v.expiresAt) : Number.POSITIVE_INFINITY;
  return new Date(Math.min(promo, Number.isNaN(exp) ? Number.POSITIVE_INFINITY : exp));
}

const skip = (reason: string): TriageResult => ({ status: 'skipped', reason });
const cityOf = (v: FreelaFixedJob) => (v.city ?? '').trim();

/** Triagem da consulta e da geração: teste, sem salário, cidade (lista) e prazo passado. Sem cidade e lista vazia = sai sem o cartão. */
export function cltTriage(v: FreelaFixedJob, s: Pick<TriageSettings, 'cities'>, now: Date): TriageResult {
  if (isTestText(v.companyName)) return skip(SKIP.test);
  if (isTestText(v.title)) return skip(SKIP.testTitle);
  if (isTestText(v.role)) return skip(CLT_SKIP.testRole);
  if (!v.salary) return skip(CLT_SKIP.noSalary);
  const city = cityOf(v);
  if (!city && s.cities.length) return skip(CLT_SKIP.noCityForList);
  if (city && !cityMatches(city, s.cities)) return skip(`Cidade fora da sua lista: ${city}.`);
  const deadline = cltDeadline(v);
  if (deadline.getTime() <= now.getTime()) return skip(cltDeadlineReason(deadline));
  return { status: 'new' };
}

/** "Criar story mesmo assim" (R30) na CLT: passa teste e cidade fora da lista, mas não sem salário nem com o prazo passado. */
export function cltForcedTriage(v: FreelaFixedJob, now: Date): TriageResult {
  if (!v.salary) return skip(CLT_SKIP.noSalary);
  const deadline = cltDeadline(v);
  if (deadline.getTime() <= now.getTime()) return skip(cltDeadlineReason(deadline));
  return { status: 'new' };
}

const CONTACT_BITS = [/\(?\d{2}\)?\s?\d{4,5}-?\d{4}/g, /[^\s@]+@[^\s@]+\.[^\s@]+/g, /(https?:\/\/|www\.)\S+/gi];
const scrub = (s: string | null | undefined) => CONTACT_BITS.reduce((t, re) => t.replace(re, ' '), s ?? '').replace(/\s+/g, ' ').trim();
/** P13: "Atendente CLT", "Atendente (CLT)", "Atendente - CLT" → "Atendente" (a pílula já diz CARTEIRA ASSINADA). */
export const stripClt = (s: string) => s.replace(/\s*[-–—]?\s*[([]?\s*\bclt\b\s*[)\]]?\s*$/i, '').trim();
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Cargo da arte e da lista: o título limpo (até 40 caracteres), senão o cargo do Freela. */
export function cltRole(v: Pick<FreelaFixedJob, 'title' | 'role'>): string {
  const t = stripClt(scrub(v.title));
  if (t && t.length <= 40) return t;
  const r = stripClt(scrub(v.role));
  return capFirst((r || t).slice(0, 40).trim());
}

/** "R$ 1.874,32" · "R$ 2.000 a R$ 2.500". */
export function cltSalary(salary: FreelaFixedJob['salary']): string | null {
  if (!salary) return null;
  const { minInCents: min, maxInCents: max } = salary;
  return max > min ? `${formatMoney(min)} a ${formatMoney(max)}` : formatMoney(min);
}

const ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAY_IDX: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Segunda primeiro (Seg a Dom). */
const weekOrder = (d: number) => (d + 6) % 7;

/** "Seg a Sex" (seguidos, 3+), "Seg e Qua", "Seg, Qua e Sex", "Sáb". */
function daysLabel(days: number[]): string {
  const list = [...new Set(days)].sort((a, b) => weekOrder(a) - weekOrder(b));
  const run = list.every((d, i) => i === 0 || weekOrder(d) === weekOrder(list[i - 1]!) + 1);
  if (run && list.length >= 3) return `${ABBR[list[0]!]} a ${ABBR[list[list.length - 1]!]}`;
  const names = list.map((d) => ABBR[d]!);
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/**
 * Escala (P13 b): dos horários quando há (mesmo horário todo dia → "Seg a Sex, 8h às 17h"; horários diferentes → "6 dias por semana"),
 * senão o texto escrito cortado. O formulário do Freela grava o texto a partir dos horários ("Segunda 08:00-17:00 • …"), por isso os
 * horários vêm antes. Nada → null (o cartão sai).
 */
export function cltSchedule(v: Pick<FreelaFixedJob, 'workSchedule' | 'workScheduleSlots'>): string | null {
  const slots = v.workScheduleSlots ?? [];
  const days = slots.map((x) => DAY_IDX[norm(x.day).slice(0, 3)]);
  if (slots.length && days.every((d) => d !== undefined)) {
    const times = new Set(slots.map((x) => `${x.start}-${x.end}`));
    const first = slots[0]!;
    if (times.size === 1) return `${daysLabel(days as number[])}, ${hourLabel(minutesOf(first.start))} às ${hourLabel(minutesOf(first.end))}`;
    return `${new Set(days).size} dias por semana`;
  }
  const text = (v.workSchedule ?? '').replace(/\s+/g, ' ').trim();
  return text ? clipText(text, 44) : null;
}

/** Benefícios: até 4 itens unidos por " · ", no máximo 80 caracteres; nenhum → null. */
export function cltBenefits(list: string[] | null | undefined): string | null {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const b = raw.replace(/\s+/g, ' ').trim();
    if (!b || out.length >= 4) continue;
    if ([...out, b].join(' · ').length > 80) break;
    out.push(b);
  }
  return out.length ? out.join(' · ') : null;
}

/** "Jundiaí – SP"; sem UF, só a cidade; sem cidade, null. */
export function cltCityLabel(v: Pick<FreelaFixedJob, 'city' | 'uf'>): string | null {
  const city = (v.city ?? '').trim();
  if (!city) return null;
  const uf = (v.uf ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(uf) ? `${city} – ${uf}` : city;
}

/** Campos da arte "Vaga fixa CLT" (UI §3.4), todos escritos pelo sistema a partir da vitrine. */
export function cltFields(v: FreelaFixedJob): CltFields {
  return {
    cargo: cltRole(v),
    empresa: cleanEstablishment(v.companyName),
    salario: cltSalary(v.salary) ?? '',
    escala: cltSchedule(v),
    cidade: cltCityLabel(v),
    beneficios: cltBenefits(v.benefits),
  };
}

/** Assinatura do que vai na arte: mudou algum desses campos entre a consulta e a publicação → a guarda refaz o story. */
export function cltFingerprint(v: FreelaFixedJob): string {
  return createHash('sha1')
    .update(JSON.stringify(['clt', v.title, v.role, v.companyName, v.city, v.uf, v.salary?.minInCents ?? null, v.salary?.maxInCents ?? null, v.workSchedule, v.workScheduleSlots, v.benefits]))
    .digest('hex');
}
