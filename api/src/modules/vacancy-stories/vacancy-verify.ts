import { hourLabel, norm } from './vacancy-text';
import type { ArtCheck, ArtRead, FieldCheck, FieldKey, VacancyFields } from './vacancy-types';

const nullableString = { type: ['string', 'null'] };

export const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['textos', 'funcao', 'estabelecimento', 'data', 'inicio', 'fim', 'valor', 'cidade'],
  properties: {
    textos: { type: 'array', items: { type: 'string' } },
    funcao: nullableString,
    estabelecimento: nullableString,
    data: nullableString,
    inicio: nullableString,
    fim: nullableString,
    valor: nullableString,
    cidade: nullableString,
  },
};

export const TEMPLATE_TEXTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['textos'],
  properties: { textos: { type: 'array', items: { type: 'string' } } },
};

/** D2: rótulos que podem aparecer na arte mesmo vindo do modelo (já em `norm`). */
export const GENERIC_LABELS = [
  'vaga', 'vaga freela', 'freela', 'freelancer', 'freela servicos', 'servicos', 'estabelecimento', 'funcao', 'data', 'horario',
  'quando', 'onde', 'cidade', 'valor', 'valor para o freela', 'baixe nosso app', 'e confira esta e outras oportunidades',
];

/** D2: proibidos sempre. Rótulos e lojas buscam-se em `norm`; links no texto cru (norm('.com') = 'com' casaria 'comida'). */
export const ALWAYS_FORBIDDEN = {
  labels: ['endereco', 'regiao', 'descricao', 'bairro'],
  stores: ['google play', 'app store'],
  links: /https?:|www\.|\.com\b/,
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `needle` (já em norm) dentro de `hay` (já em norm), em fronteira de palavra. */
function hasPhrase(hay: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`(^| )${esc(needle)}( |$)`).test(hay);
}

const GENERIC_BY_LENGTH = [...GENERIC_LABELS].sort((a, b) => b.length - a.length);

function stripGeneric(s: string): string {
  let out = norm(s);
  for (const g of GENERIC_BY_LENGTH) out = out.replace(new RegExp(`(^| )${esc(g)}(?= |$)`, 'g'), ' ');
  return out.replace(/\s+/g, ' ').trim();
}

export function parseCents(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(t)) return null;
  let intPart: string;
  let dec = '';
  const comma = t.lastIndexOf(',');
  if (comma >= 0) {
    intPart = t.slice(0, comma).replace(/[.,]/g, '');
    dec = t.slice(comma + 1).replace(/\D/g, '');
  } else if (/\.\d{1,2}$/.test(t)) {
    const dot = t.lastIndexOf('.');
    intPart = t.slice(0, dot).replace(/[.,]/g, '');
    dec = t.slice(dot + 1);
  } else {
    intPart = t.replace(/[.,]/g, '');
  }
  if (!/^\d+$/.test(intPart || '0') || dec.length > 2) return null;
  return Number(intPart || '0') * 100 + Number((dec + '00').slice(0, 2));
}

export function parseDayMonth(s: string | null | undefined): { day: number; month: number } | null {
  const m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(s ?? '');
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12 ? { day, month } : null;
}

/** `which`: 'first' (início) ou 'last' (fim: "18h às 23h" lido em fim vale 23h). 24h = meia-noite (0). */
export function parseMinutes(s: string | null | undefined, which: 'first' | 'last' = 'first'): number | null {
  const all = [...(s ?? '').matchAll(/(\d{1,2})\s*(?::|h(?:s|oras?)?)\s*(\d{2})?/gi)];
  const m = which === 'last' ? all[all.length - 1] : all[0];
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  return h <= 24 && min < 60 ? (h * 60 + min) % 1440 : null;
}

function check(key: FieldKey, label: string, ok: boolean, read: string | null, expected: string | null): FieldCheck {
  return { key, label, ok, read, expected };
}

const UFS = new Set('ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' '));

/** R11: "Campinas/SP", "Campinas - SP", "CAMPINAS (SP)" valem "Campinas". */
function stripUf(s: string): string {
  const t = s.split(' ');
  return t.length > 1 && UFS.has(t[t.length - 1]) ? t.slice(0, -1).join(' ') : s;
}

function textField(key: FieldKey, label: string, read: string | null, expected: string | null, uf = false): FieldCheck {
  const prep = (x: string) => (uf ? stripUf(stripGeneric(x)) : stripGeneric(x));
  const r = read && read.trim() ? read : null;
  if (expected == null) return check(key, label, r == null || !prep(r), r, null);
  return check(key, label, r != null && prep(r) === prep(expected), r, expected);
}

function checkFields(read: ArtRead, f: VacancyFields): FieldCheck[] {
  const e = f.expected;
  const dm = parseDayMonth(read.data);
  return [
    textField('funcao', 'função', read.funcao, f.funcao),
    textField('estabelecimento', 'estabelecimento', read.estabelecimento, f.estabelecimento),
    textField('cidade', 'cidade', read.cidade, f.cidade, true),
    check('valor', 'valor', parseCents(read.valor) === e.cents, read.valor, f.valor),
    check('data', 'data', !!dm && dm.day === e.day && dm.month === e.month, read.data, f.data),
    check('inicio', 'horário de início', parseMinutes(read.inicio) === e.startMin, read.inicio, hourLabel(e.startMin)),
    check('fim', 'horário de fim', parseMinutes(read.fim, 'last') === e.endMin, read.fim, hourLabel(e.endMin)),
  ];
}

const DAYS_MONTHS = new Set(
  ('segunda terca quarta quinta sexta sabado domingo seg ter qua qui sex sab dom janeiro fevereiro marco abril maio junho julho ' +
    'agosto setembro outubro novembro dezembro').split(' '),
);
const GENERIC_WORDS = new Set(GENERIC_LABELS.flatMap((g) => g.split(' ')));

function removePhrases(n: string, phrases: string[]): string {
  let out = n;
  for (const p of [...phrases].filter(Boolean).sort((a, b) => b.length - a.length))
    out = out.replace(new RegExp(`(^| )${esc(p)}(?= |$)`, 'g'), ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/** Item do modelo que é horário, faixa, data ou valor: só é cópia errada se o valor interpretado for DIFERENTE do esperado. */
function isValueLike(n: string): boolean {
  return n.length > 0 && n.split(' ').every((t) => /^\d+h?\d*$/.test(t) || ['r', 'as', 'a', 'ate', 'hs'].includes(t));
}

function valueMatchesExpected(raw: string, f: VacancyFields): boolean {
  const e = f.expected;
  if (/:|\dh/i.test(raw)) {
    const times = [...raw.matchAll(/(\d{1,2})\s*(?::|h)\s*(\d{2})?/gi)].map((m) => parseMinutes(m[0]));
    return times.length > 0 && times.every((t) => t === e.startMin || t === e.endMin);
  }
  if (raw.includes('/')) {
    const dm = parseDayMonth(raw);
    return !!dm && dm.day === e.day && dm.month === e.month;
  }
  return parseCents(raw) === e.cents;
}

function distinctive(n: string, expectedTokens: Set<string>): Set<string> {
  return new Set(
    n.split(' ').filter((w) => {
      if (!w || GENERIC_WORDS.has(w) || DAYS_MONTHS.has(w) || expectedTokens.has(w)) return false;
      return w.length >= 4 || /^\d{3,}$/.test(w);
    }),
  );
}

function findForbidden(read: ArtRead, f: VacancyFields, templateTexts: string[]): string[] {
  const found = new Set<string>();
  const nameValues = [f.funcao, f.estabelecimento, f.cidade].filter((x): x is string => !!x).map(norm);
  const allowed = [...nameValues, f.valor, f.data, f.horario].map(norm);
  const expectedTokens = new Set(allowed.flatMap((a) => a.split(' ')));
  const generic = new Set(GENERIC_LABELS);
  const exempt = (n: string) => n.length < 4 || generic.has(n) || allowed.some((a) => a === n || hasPhrase(a, n));
  const items = templateTexts
    .filter((t) => !ALWAYS_FORBIDDEN.links.test(String(t).toLowerCase()))
    .map((t) => ({ raw: t, n: norm(t) }))
    .filter(({ n }) => !exempt(n));
  const banned = items.filter(({ raw, n }) => !(isValueLike(n) && valueMatchesExpected(raw, f)));
  const wordSets = items.filter(({ n }) => !isValueLike(n)).map(({ n }) => distinctive(n, expectedTokens));
  for (const raw of read.textos ?? []) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const n = norm(text);
    // R9: "Bar do Bairro" (estabelecimento da vaga) não é o rótulo "bairro"
    const nLabels = removePhrases(n, nameValues);
    const bad =
      ALWAYS_FORBIDDEN.links.test(text.toLowerCase()) ||
      [...ALWAYS_FORBIDDEN.labels, ...ALWAYS_FORBIDDEN.stores].some((p) => hasPhrase(nLabels, p)) ||
      banned.some((b) => hasPhrase(n, b.n)) ||
      // cópia editada do modelo: ≥ 2 palavras distintivas em comum com um mesmo item
      (() => {
        const mine = distinctive(n, expectedTokens);
        return mine.size >= 2 && wordSets.some((ws) => [...mine].filter((w) => ws.has(w)).length >= 2);
      })();
    if (bad) found.add(text);
  }
  return [...found];
}

function buildHint(wrong: FieldCheck[], forbidden: string[]): string {
  const parts: string[] = [];
  if (wrong.length) {
    const list = wrong.map((w) => `${w.label} (a arte diz ${w.read ?? 'nada'}, o certo é ${w.expected ?? 'não aparecer'})`).join('; ');
    parts.push(`Na tentativa anterior a arte errou: ${list}.`);
  } else {
    parts.push('Na tentativa anterior a arte trouxe texto proibido.');
  }
  if (forbidden.length) parts.push(`Tire da arte: ${forbidden.map((x) => `“${x}”`).join(', ')}.`);
  return parts.join(' ');
}

export function compareArt(
  read: ArtRead,
  f: VacancyFields,
  templateTexts: string[],
  opts: { fieldsOnly?: false; forbiddenOnly?: boolean } = {},
): ArtCheck {
  const fields = opts.forbiddenOnly ? [] : checkFields(read, f);
  const forbidden = findForbidden(read, f, templateTexts);
  const wrong = fields.filter((x) => !x.ok);
  const ok = wrong.length === 0 && forbidden.length === 0;
  return { ok, fields, forbidden, hint: ok ? null : buildHint(wrong, forbidden) };
}
