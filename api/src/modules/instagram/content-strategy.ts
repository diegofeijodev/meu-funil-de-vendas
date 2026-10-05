/**
 * Estratégia do período e regras de data (puro, sem banco nem IA): tipos, esquemas, regras de coerência com a data checadas por
 * código e os textos dos prompts. O serviço que fala com a IA é o `ContentStrategyService`.
 * Fuso de São Paulo = UTC-3 fixo (sem horário de verão desde 2019), como `slots.ts` e o protótipo.
 */
import { asText } from './normalize';

const SP = 'America/Sao_Paulo';
const str = { type: 'string' };
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const arr = (items: unknown) => ({ type: 'array', items });

export type RunStrategy = {
  objetivo_resumido: string;
  kpi_principal: string;
  publico_foco: string;
  mensagem_central: string;
  pilares: { nome: string; peso_percentual: number; por_que_serve_ao_objetivo: string }[];
  distribuicao_por_dia: { data: string; dia_da_semana: string; tema_do_dia: string; momento_do_funil: string }[];
  ctas: string[];
  proibicoes: string[];
  texto_editado?: string | null;
};

export const STRATEGY_SCHEMA = obj({
  objetivo_resumido: str,
  kpi_principal: str,
  publico_foco: str,
  mensagem_central: str,
  pilares: arr(obj({ nome: str, peso_percentual: { type: 'number' }, por_que_serve_ao_objetivo: str })),
  distribuicao_por_dia: arr(obj({ data: str, dia_da_semana: str, tema_do_dia: str, momento_do_funil: str })),
  ctas: arr(str),
  proibicoes: arr(str),
});

export const VERDICT_SCHEMA = obj({
  results: arr(obj({ index: { type: 'integer' }, aprovado: { type: 'boolean' }, nota_0_10: { type: 'number' }, motivo: str })),
});

export type Verdict = { aprovado: boolean; nota: number; motivo: string };

/** "quinta-feira, 01/10/2026, 20:10" no fuso de São Paulo. */
export function fullDate(iso: string) {
  const d = new Date(iso);
  const wd = d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: SP });
  const dt = d.toLocaleDateString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', year: 'numeric' });
  const tm = d.toLocaleTimeString('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit' });
  return `${wd}, ${dt}, ${tm}`;
}

/** Dia da semana (0 = domingo) e hora (0–23) em São Paulo. */
export const spParts = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 3 * 3600e3);
  return { wd: d.getUTCDay(), hour: d.getUTCHours() };
};

export const DATE_RULES =
  'Coerência com a data: "sextou"/"sexta chegou" só na sexta; "bom dia" só antes das 12h, "boa tarde" das 12h às 18h, "boa noite" depois das 18h; "fim de semana chegou"/"sabadou" só de sexta a domingo; "segunda"/"começo de semana" só na segunda; nunca cite dia da semana diferente do dia do post.';

/** Regras de data checadas por código (não dependem da IA): devolve os problemas encontrados no texto para aquele horário. */
export function dateIssues(text: string, iso: string): string[] {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const { wd, hour } = spParts(iso);
  const out: string[] = [];
  if (/\bsextou|sexta chegou|hoje e sexta\b/.test(t) && wd !== 5) out.push('"sextou" fora de sexta-feira');
  if (/\bsabadou\b/.test(t) && wd !== 6) out.push('"sabadou" fora de sábado');
  if (/\bbom dia\b/.test(t) && hour >= 12) out.push('"bom dia" depois das 12h');
  if (/\bboa noite\b/.test(t) && hour < 17) out.push('"boa noite" antes das 17h');
  if (/fim de semana (chegou|comecou)|bom fim de semana/.test(t) && wd >= 1 && wd <= 3) out.push('"fim de semana" de segunda a quarta');
  if (/\bsegundou\b/.test(t) && wd !== 1) out.push('"segundou" fora de segunda');
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function brandContext(brand: any) {
  return {
    nome: brand.name,
    segmento: brand.segment,
    descricao: brand.description,
    diferenciais: brand.differentials,
    publico: brand.target_audience,
    tom: brand.tone_of_voice,
    palavras_usar: brand.preferred_words,
    palavras_proibidas: brand.banned_words,
    regiao: brand.region,
  };
}

export const isCreditFailure = (msg: string) => /cr[eé]dito|402|quota|insufficient|esgotad|billing/i.test(msg);

/** Dias distintos do período ("quinta-feira, 01/10/2026"), na ordem dos horários. */
export function periodDays(slots: { at: string }[]): string[] {
  return [...new Set(slots.map((s) => fullDate(s.at).split(',').slice(0, 2).join(',')))];
}

/** Normaliza a estratégia devolvida pela IA (listas ausentes viram vazias; sem pilares = erro). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeStrategy(json: any, objective: string): RunStrategy {
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const strings = (v: unknown) => list<unknown>(v).map((c) => asText(c)).filter((c): c is string => !!c);
  return {
    objetivo_resumido: asText(json?.objetivo_resumido) ?? objective,
    kpi_principal: asText(json?.kpi_principal) ?? '',
    publico_foco: asText(json?.publico_foco) ?? '',
    mensagem_central: asText(json?.mensagem_central) ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pilares: list<any>(json?.pilares)
      .map((p) => ({ nome: asText(p?.nome) ?? '', peso_percentual: Number(p?.peso_percentual) || 0, por_que_serve_ao_objetivo: asText(p?.por_que_serve_ao_objetivo) ?? '' }))
      .filter((p) => p.nome),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    distribuicao_por_dia: list<any>(json?.distribuicao_por_dia).map((d) => ({
      data: asText(d?.data) ?? '',
      dia_da_semana: asText(d?.dia_da_semana) ?? '',
      tema_do_dia: asText(d?.tema_do_dia) ?? '',
      momento_do_funil: asText(d?.momento_do_funil) ?? '',
    })),
    ctas: strings(json?.ctas),
    proibicoes: strings(json?.proibicoes),
  };
}
