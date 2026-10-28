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

export function parseMinutes(s: string | null | undefined): number | null {
  const m = /(\d{1,2})\s*(?::|h(?:s|oras?)?)\s*(\d{2})?/i.exec(s ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  return h <= 24 && min < 60 ? h * 60 + min : null;
}

function check(key: FieldKey, label: string, ok: boolean, read: string | null, expected: string | null): FieldCheck {
  return { key, label, ok, read, expected };
}

function textField(key: FieldKey, label: string, read: string | null, expected: string | null): FieldCheck {
  const r = read && read.trim() ? read : null;
  if (expected == null) return check(key, label, r == null || !stripGeneric(r), r, null);
  return check(key, label, r != null && stripGeneric(r) === stripGeneric(expected), r, expected);
}

function checkFields(read: ArtRead, f: VacancyFields): FieldCheck[] {
  const e = f.expected;
  const dm = parseDayMonth(read.data);
  return [
    textField('funcao', 'função', read.funcao, f.funcao),
    textField('estabelecimento', 'estabelecimento', read.estabelecimento, f.estabelecimento),
    textField('cidade', 'cidade', read.cidade, f.cidade),
    check('valor', 'valor', parseCents(read.valor) === e.cents, read.valor, f.valor),
    check('data', 'data', !!dm && dm.day === e.day && dm.month === e.month, read.data, f.data),
    check('inicio', 'horário de início', parseMinutes(read.inicio) === e.startMin, read.inicio, hourLabel(e.startMin)),
    check('fim', 'horário de fim', parseMinutes(read.fim) === e.endMin, read.fim, hourLabel(e.endMin)),
  ];
}

function findForbidden(read: ArtRead, f: VacancyFields, templateTexts: string[]): string[] {
  const found = new Set<string>();
  const allowed = [f.funcao, f.estabelecimento, f.cidade, f.valor, f.data, f.horario].filter((x): x is string => !!x).map(norm);
  const generic = new Set(GENERIC_LABELS);
  // item do modelo só é proibido se não for (nem estiver dentro de) um valor da vaga (R7)
  const exempt = (n: string) => n.length < 4 || generic.has(n) || allowed.some((a) => a === n || hasPhrase(a, n));
  const banned = templateTexts.map((t) => norm(t)).filter((n) => !exempt(n));
  for (const raw of read.textos ?? []) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const n = norm(text);
    const bad =
      ALWAYS_FORBIDDEN.links.test(text.toLowerCase()) ||
      [...ALWAYS_FORBIDDEN.labels, ...ALWAYS_FORBIDDEN.stores].some((p) => hasPhrase(n, p)) ||
      // copiado do modelo: o item está no texto gerado, ou o texto gerado é um trecho do item
      (!exempt(n) && banned.some((b) => hasPhrase(n, b) || hasPhrase(b, n)));
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
