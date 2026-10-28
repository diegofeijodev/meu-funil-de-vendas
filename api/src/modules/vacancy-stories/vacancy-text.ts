import { createHash } from 'crypto';
import type { ExpectedValues, FreelaVacancy, VacancyFields } from './vacancy-types';

const TZ = 'America/Sao_Paulo';
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SERVICE_NAMES: Record<string, string> = {
  garcom: 'Garçom',
  'lavagem-de-loucas': 'Lavagem de louças',
  'auxiliar-de-cozinha': 'Auxiliar de cozinha',
  'auxiliar-de-limpeza': 'Auxiliar de limpeza',
  'monitor-infantil': 'Monitor infantil',
  hostess: 'Hostess',
  cozinheiro: 'Cozinheiro',
  barman: 'Barman',
  copeiro: 'Copeiro',
  maitre: 'Maître',
  seguranca: 'Segurança',
};

/** minúsculo, sem acento, pontuação vira espaço, espaços colapsados. */
export function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isTestText(s: string | null | undefined): boolean {
  return norm(s).split(' ').some((w) => w === 'teste' || w === 'testes');
}

function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function cleanFunction(title: string | null, serviceType: string | null): string {
  const t = (title ?? '')
    .replace(/\(?\d{2}\)?\s?\d{4,5}-?\d{4}/g, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, ' ')
    .replace(/(https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t && t.length <= 40) return t;
  const st = (serviceType ?? '').trim();
  // `Object.hasOwn`: "constructor"/"__proto__" vindos da vitrine não podem devolver o que está no protótipo do objeto.
  if (Object.hasOwn(SERVICE_NAMES, st)) return SERVICE_NAMES[st]!;
  if (st) return capFirst(st.replace(/-/g, ' '));
  return t.slice(0, 40).trim();
}

const PREPOSITIONS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

export function cleanEstablishment(name: string | null): string | null {
  const s = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/\d{11}|\d{14}/.test(s.replace(/[.\-/\s]/g, ''))) return null;
  if (/(^|\s)(LTDA|ME|EPP|EIRELI|S\.?A\.?|S\/A)\.?\s*$/i.test(s)) return null;
  if (isTestText(s)) return null;
  if (s !== s.toUpperCase()) return s;
  return s
    .split(' ')
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && PREPOSITIONS.has(lower)) return lower;
      const letters = lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (/^[a-z]{1,3}$/.test(letters) && !/[aeiou]/.test(letters)) return w;
      return capFirst(lower);
    })
    .join(' ');
}

export function spParts(iso: string): { weekday: number; day: number; month: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    weekday: EN_DAYS.indexOf(get('weekday')),
    day: Number(get('day')),
    month: Number(get('month')),
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

export function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

const two = (n: number) => String(n).padStart(2, '0');

export function formatWhen(startIso: string, endIso: string): { data: string; horario: string } {
  const s = spParts(startIso);
  const e = spParts(endIso);
  return {
    data: `${DAYS[s.weekday]}, ${two(s.day)}/${two(s.month)}`,
    horario: `${hourLabel(s.minutes)} às ${hourLabel(e.minutes)}`,
  };
}

/** "Qua, 29/10" (dia da semana com vírgula, como na arte) — os motivos gravados usam este formato com a hora. */
export function dayLabel(iso: string): string {
  const p = spParts(iso);
  return `${DAYS[p.weekday]}, ${two(p.day)}/${two(p.month)}`;
}

export function shortDay(iso: string): string {
  const p = spParts(iso);
  return `${DAYS[p.weekday]} ${two(p.day)}/${two(p.month)}`;
}

export function formatMoney(cents: number): string {
  const reais = Math.floor(cents / 100);
  const rest = cents % 100;
  const int = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return rest === 0 ? `R$ ${int}` : `R$ ${int},${two(rest)}`;
}

export function fingerprint(v: FreelaVacancy): string {
  return createHash('sha1')
    .update(JSON.stringify([v.title ?? v.serviceType, v.startTime, v.endTime, v.amountInCents, v.contractorName, v.city]))
    .digest('hex');
}

export function cityMatches(city: string | null, cities: string[]): boolean {
  if (cities.length === 0) return true;
  const c = norm(city);
  return cities.some((x) => norm(x) === c);
}

export function leadLabel(minutes: number): string {
  return `${Math.round(minutes / 60)} h`;
}

export function vacancyFields(v: FreelaVacancy): VacancyFields {
  const when = formatWhen(v.startTime, v.endTime);
  const s = spParts(v.startTime);
  const e = spParts(v.endTime);
  const cents = v.amountInCents ?? 0;
  const expected: ExpectedValues = { cents, day: s.day, month: s.month, startMin: s.minutes, endMin: e.minutes };
  return {
    funcao: cleanFunction(v.title, v.serviceType),
    estabelecimento: cleanEstablishment(v.contractorName),
    data: when.data,
    horario: when.horario,
    valor: formatMoney(cents),
    cidade: (v.city ?? '').trim(),
    expected,
  };
}
