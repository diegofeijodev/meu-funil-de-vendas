/**
 * Normalização da estratégia e das copies geradas pela IA.
 * A IA às vezes omite campos de lista (públicos, ângulos, formatos, interesses, cenas...) ou devolve
 * string/null no lugar do array. Este schema (zod) garante o formato completo: todo campo de lista
 * vira array, todo texto vira string. Nunca lança — campo inválido cai no default.
 * Usado no servidor (antes de gravar e ao ler) e na tela de detalhe da campanha (antes de renderizar).
 */
import { z } from "zod";
import type { CopyContent } from "./agents";
import type { FullStrategy } from "./strategy-types";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Aceita JSON gravado como string (versões antigas / respostas cruas da IA). */
const parseMaybeJson = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

const toText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isObj(v)) {
    const first = Object.values(v).find((x) => typeof x === "string");
    return typeof first === "string" ? first : "";
  }
  return "";
};

/** Valor ausente/null vira [], string vira [string] (ou [] se vazia), array fica como está. */
export const toList = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === "string") return v.trim() ? [v] : [];
  return [v];
};

/** `.join` seguro para qualquer valor (não-array vira lista vazia). */
export const joinList = (v: unknown, sep = ", "): string => (Array.isArray(v) ? v : []).join(sep);

const text = z.unknown().transform(toText);
const num = (fallback: number) =>
  z
    .unknown()
    .transform((v) =>
      Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : fallback,
    );
const textList = z.unknown().transform((v) => toList(v).map(toText).filter(Boolean));

/** Lista de objetos: itens string viram `{ [stringKey]: item }`, itens inválidos são descartados. */
function objList<T extends z.ZodTypeAny>(item: T, stringKey: string) {
  return z.unknown().transform((v) =>
    toList(v)
      .map((x) => (typeof x === "string" && x.trim() ? { [stringKey]: x } : x))
      .filter(isObj)
      .map((x) => item.parse(x) as z.output<T>),
  );
}

/** Objeto (pode vir ausente): entrada que não é objeto vira {}. */
function obj<S extends z.ZodRawShape>(shape: S) {
  return z.preprocess(
    (v) => (isObj(parseMaybeJson(v)) ? parseMaybeJson(v) : {}),
    z.object(shape).passthrough(),
  );
}

/** Bloco opcional: ausente continua ausente (a tela esconde a seção); presente é normalizado. */
function optionalObj<S extends z.ZodRawShape>(shape: S) {
  const inner = obj(shape);
  return z.unknown().transform((v) => (isObj(parseMaybeJson(v)) ? inner.parse(v) : undefined));
}

/** Mapa nome→valor; aceita também a forma em lista que a IA devolve ([{destino, percentual}]). */
function record<V>(keyFields: string[], valueFields: string[], map: (v: unknown) => V) {
  return z.unknown().transform((v): Record<string, V> => {
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x)]));
    const out: Record<string, V> = {};
    for (const x of toList(v)) {
      if (!isObj(x)) continue;
      const key = toText(keyFields.map((f) => x[f]).find((y) => y != null));
      if (key) out[key] = map(valueFields.map((f) => x[f]).find((y) => y != null));
    }
    return out;
  });
}

const angleSchema = obj({
  nome: text,
  dor_ou_desejo: text,
  mensagem: text,
  gancho: text,
  formato_sugerido: text,
  etapa_funil: text,
});

const AUDIENCE_TYPES = [
  "frio",
  "interesses",
  "lookalike",
  "remarketing",
  "lista_clientes",
] as const;
const audienceSchema = obj({
  nome: text,
  tipo: z
    .unknown()
    .transform((v) =>
      AUDIENCE_TYPES.includes(v as never) ? (v as (typeof AUDIENCE_TYPES)[number]) : "interesses",
    ),
  interesses: textList,
  descricao: text,
});

export const strategySchema = obj({
  resumo_executivo: text,
  problema: text,
  objetivo_smart: text,
  icp: text,
  oferta: text,
  big_idea: text,
  angulos: textList,
  funil: text,
  mensagem_principal: text,
  objecoes: objList(obj({ objecao: text, resposta: text }), "objecao"),
  canais: text,
  distribuicao_verba: record(
    ["destino", "nome", "canal"],
    ["percentual", "valor"],
    (x) => Number(x) || 0,
  ),
  kpis: record(["nome", "kpi"], ["meta", "valor"], toText),
  hipoteses: textList,
  plano_testes: text,
  cronograma: text,
  recomendacoes: textList,
  angulos_detalhados: objList(angleSchema, "nome"),
  publicos_meta: objList(audienceSchema, "nome"),
  briefing_criativo: optionalObj({
    direcao_visual: text,
    formatos: textList,
    quantidade_por_angulo: num(1),
    cta: text,
  }),
  briefing_video: optionalObj({
    duracao_segundos: num(15),
    roteiro: text,
    cenas: textList,
  }),
  plano_instagram: optionalObj({
    pilares: objList(obj({ nome: text, peso: num(0) }), "nome"),
    temas: textList,
    frequencia: obj({ feed: num(3), reels: num(2), stories: num(7) }),
  }),
  gerado_por: z.unknown().transform((v) => (v == null ? undefined : toText(v))),
  gerado_em: z.unknown().transform((v) => (v == null ? undefined : toText(v))),
});

export const copySchema = obj({
  headline: text,
  headline_variacoes: textList,
  texto_curto: text,
  texto_longo: text,
  cta: text,
  meta_ad: text,
  instagram_feed: text,
  reels: text,
  stories: text,
  script_ugc: text,
  script_institucional: text,
  carrossel: textList,
  quiz: objList(obj({ pergunta: text, opcoes: textList }), "pergunta"),
});

/** Estratégia com todos os campos de lista garantidos como array. `null` quando não há estratégia. */
export function normalizeStrategy(strategy: unknown): FullStrategy | null {
  if (strategy == null || strategy === "") return null;
  return strategySchema.parse(strategy) as FullStrategy;
}

/** Copy com todos os campos de lista garantidos como array. `null` quando não há copy. */
export function normalizeCopy(copy: unknown): CopyContent | null {
  if (copy == null || copy === "") return null;
  return copySchema.parse(copy) as CopyContent;
}
