/**
 * Regras do "Conte o que você quer" (Fatia 1, spec §2.1): a IA lê o pedido; datas, verba e link são decididos AQUI.
 * - Datas: a IA diz "hoje/amanhã/data" e quantos dias; o calendário sai de `todaySp()` (30 dias = hoje..hoje+29, no máximo 180).
 * - Anti-invenção: verba só se o valor em reais está escrito; link só se há URL no texto. O resto vira pergunta (`missing`, ≤ 3).
 */
import { addDays, isDateString } from '../../common/time/dates';
import { OBJECTIVES } from './campaign-labels';

const FORMAT_KEYS = ['static_image', 'video', 'carousel', 'story', 'quiz', 'ugc'] as const;
const MAX_DAYS = 180;
const DEFAULT_DAYS = 30;

export const INTAKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nome', 'objetivo', 'produto', 'promessa', 'resumo_objetivo', 'periodo', 'publico', 'verba_dia', 'verba_total', 'meta_leads', 'formatos', 'suposicoes'],
  properties: {
    nome: { type: 'string' },
    objetivo: { type: 'string', enum: Object.keys(OBJECTIVES) },
    produto: { type: 'string' },
    promessa: { type: 'string' },
    resumo_objetivo: { type: 'string' },
    periodo: {
      type: 'object',
      additionalProperties: false,
      required: ['inicio', 'inicio_data', 'duracao_dias', 'fim_data'],
      properties: {
        inicio: { type: 'string', enum: ['hoje', 'amanha', 'data'] },
        inicio_data: { type: 'string' },
        duracao_dias: { type: 'integer' },
        fim_data: { type: 'string' },
      },
    },
    publico: {
      type: 'object',
      additionalProperties: false,
      required: ['persona', 'idade', 'localizacao', 'interesses', 'tipo'],
      properties: {
        persona: { type: 'string' },
        idade: { type: 'string' },
        localizacao: { type: 'string' },
        interesses: { type: 'string' },
        tipo: { type: 'string', enum: ['B2B', 'B2C'] },
      },
    },
    verba_dia: { type: 'number' },
    verba_total: { type: 'number' },
    meta_leads: { type: 'integer' },
    formatos: { type: 'array', items: { type: 'string', enum: [...FORMAT_KEYS] } },
    suposicoes: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['campo', 'texto'], properties: { campo: { type: 'string' }, texto: { type: 'string' } } },
    },
  },
} as const;

export type IntakeAi = {
  nome?: string; objetivo?: string; produto?: string; promessa?: string; resumo_objetivo?: string;
  periodo?: { inicio?: string; inicio_data?: string; duracao_dias?: number; fim_data?: string };
  publico?: { persona?: string; idade?: string; localizacao?: string; interesses?: string; tipo?: string };
  verba_dia?: number; verba_total?: number; meta_leads?: number; formatos?: string[];
  suposicoes?: { campo?: string; texto?: string }[];
};

export type IntakeMissing = { field: 'budget_daily' | 'landing_url' | 'offer_terms'; question: string; suggestion: string | null };
export type IntakeAssumption = { field: string; text: string };
export type IntakeResult = {
  summary: string;
  days: number;
  draft: {
    name: string; objective: string; offer_product: string; offer_promise: string; landing_url: string | null;
    start_date: string; end_date: string;
    audience: { persona: string; idade: string; localizacao: string; interesses: string; tipo: string };
    budget_daily: number | null; budget_total: number | null; goal_leads: number | null; formats: string[]; intake_text: string;
  };
  missing: IntakeMissing[];
  assumptions: IntakeAssumption[];
};

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ddmm = (ymd: string) => ymd.split('-').reverse().slice(0, 2).join('/');
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n).replace(/ /g, ' ');
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;

/** "1.500,50" → 1500.5; "29.90" → 29.9; "1.500" → 1500. */
function toNumber(raw: string): number {
  if (raw.includes(',')) return Number(raw.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ''));
  return Number(raw);
}

/** Valores em reais escritos no texto: "R$ 30", "30 reais". "30 dias" não conta. */
export function moneyIn(text: string): number[] {
  const num = '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)';
  const re = new RegExp(`R\\$\\s*${num}|${num}\\s*(?:reais|real)\\b`, 'gi');
  const out: number[] = [];
  for (const m of text.matchAll(re)) {
    const n = toNumber(m[1] ?? m[2] ?? '');
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** Números soltos (metas: "100 cadastros"). */
const numbersIn = (text: string) => [...text.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g)].map((m) => toNumber(m[0])).filter((n) => Number.isFinite(n));

/** Links http(s) do texto, sem a pontuação colada no fim. */
export function urlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => m[0].replace(/[.,;:!?)\]]+$/, ''));
}

const has = (list: number[], v: number) => list.some((n) => Math.abs(n - v) < 0.005);

const obj = <T extends object>(v: unknown): Partial<T> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<T>) : {});
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function buildIntake(raw: IntakeAi, text: string, today: string, lastLanding: string | null): IntakeResult {
  // Chave própria da empresa responde em modo JSON sem schema estrito: confere a forma de tudo antes de usar.
  const ai = obj<IntakeAi>(raw);
  const assumptions: IntakeAssumption[] = [];

  // Período: o calendário é do servidor.
  const p = obj<NonNullable<IntakeAi['periodo']>>(ai.periodo);
  let start = today;
  if (p.inicio === 'amanha') start = addDays(today, 1);
  else if (p.inicio === 'data' && isDateString(p.inicio_data)) {
    if (p.inicio_data >= today) start = p.inicio_data;
    else assumptions.push({ field: 'start_date', text: `A data de início já passou: considerei hoje, ${ddmm(today)}.` });
  }
  const dur = Number(p.duracao_dias ?? 0);
  let end: string;
  if (Number.isInteger(dur) && dur > 0) end = addDays(start, dur - 1);
  else if (isDateString(p.fim_data) && p.fim_data >= start) end = p.fim_data;
  else {
    end = addDays(start, DEFAULT_DAYS - 1);
    assumptions.push({ field: 'end_date', text: `Considerei ${DEFAULT_DAYS} dias, de ${ddmm(start)} a ${ddmm(end)}.` });
  }
  if (daysBetween(start, end) > MAX_DAYS) {
    end = addDays(start, MAX_DAYS - 1);
    assumptions.push({ field: 'end_date', text: `O plano vai até ${MAX_DAYS} dias: considerei até ${ddmm(end)}.` });
  }
  const days = daysBetween(start, end);

  // Verba e metas: só o que está escrito.
  const reais = moneyIn(text);
  const okMoney = (v: unknown) => typeof v === 'number' && v > 0 && has(reais, v);
  let daily = okMoney(ai.verba_dia) ? round2(ai.verba_dia!) : null;
  let total = okMoney(ai.verba_total) ? round2(ai.verba_total!) : null;
  if (daily && !total) total = round2(daily * days);
  else if (!daily && total) {
    daily = round2(total / days);
    assumptions.push({ field: 'budget_daily', text: `${money(total)} ÷ ${days} dias = ${money(daily)} por dia.` });
  }
  // Verba lida do texto sempre aparece no "Entendi" (que é a revisão) com a conta — "ingresso a R$ 30" não pode virar verba calado.
  if (daily && total && !assumptions.some((a) => a.field === 'budget_daily')) {
    assumptions.push({ field: 'budget_daily', text: `${money(daily)} por dia × ${days} dias = ${money(total)} no período.` });
  }
  const leads = typeof ai.meta_leads === 'number' && ai.meta_leads > 0 && has(numbersIn(text), ai.meta_leads) ? ai.meta_leads : null;

  const landing = urlsIn(text)[0] ?? null;
  const promise = str(ai.promessa, 500);

  const missing: IntakeMissing[] = [];
  if (!daily) missing.push({ field: 'budget_daily', question: 'Quanto gastar por dia no anúncio?', suggestion: null });
  if (!landing) missing.push({ field: 'landing_url', question: 'Para onde vai quem se interessar?', suggestion: lastLanding });
  if (promise) missing.push({ field: 'offer_terms', question: 'O que exatamente é grátis ou oferecido, e até quando?', suggestion: null });

  for (const s of arr<{ campo?: string; texto?: string }>(ai.suposicoes).slice(0, 4)) {
    const t = str(s?.texto, 200);
    if (t) assumptions.push({ field: str(s?.campo, 40) || 'geral', text: t });
  }

  const objective = ai.objetivo && ai.objetivo in OBJECTIVES ? ai.objetivo : 'leads';
  const formats = arr<string>(ai.formatos).filter((f): f is (typeof FORMAT_KEYS)[number] => (FORMAT_KEYS as readonly string[]).includes(f));
  const goal = str(ai.resumo_objetivo, 200).replace(/[.\s]+$/, '') || 'trazer resultados';
  const offering = promise ? `, oferecendo ${promise.charAt(0).toLowerCase()}${promise.slice(1).replace(/[.\s]+$/, '')}` : '';
  const pub = obj<NonNullable<IntakeAi['publico']>>(ai.publico);

  return {
    summary: `Uma campanha para ${goal}, de ${ddmm(start)} a ${ddmm(end)} (${days} dias)${offering}.`,
    days,
    draft: {
      name: str(ai.nome, 120) || `Campanha ${ddmm(start)}`,
      objective,
      offer_product: str(ai.produto, 500),
      offer_promise: promise,
      landing_url: landing,
      start_date: start,
      end_date: end,
      audience: {
        persona: str(pub.persona),
        idade: str(pub.idade, 20) || '25-45',
        localizacao: str(pub.localizacao, 200),
        interesses: str(pub.interesses),
        tipo: pub.tipo === 'B2B' ? 'B2B' : 'B2C',
      },
      budget_daily: daily,
      budget_total: total,
      goal_leads: leads,
      formats: formats.length ? formats : ['static_image', 'video'],
      intake_text: text,
    },
    missing,
    assumptions,
  };
}
