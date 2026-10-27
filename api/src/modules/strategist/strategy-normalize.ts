/**
 * Normalização da estratégia e das copies geradas pela IA.
 * A IA às vezes omite campos de lista (públicos, ângulos, formatos, interesses, cenas...) ou devolve
 * string/null no lugar do array. Este schema (zod) garante o formato completo: todo campo de lista
 * vira array, todo texto vira string. Nunca lança — campo inválido cai no default.
 * Usado na tela de detalhe da campanha e no Studio (antes de renderizar); o servidor tem o gêmeo em `api/.../strategist/strategy-normalize.ts`.
 */
import { z } from 'zod';
import type { FullStrategy, StrategyAngle } from './strategy-types';

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Aceita JSON gravado como string (versões antigas / respostas cruas da IA). */
const parseMaybeJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

/** Texto gravado por versões antigas quando a IA devolvia objeto no lugar de texto (`String({})`). */
const OBJECT_JUNK = '[object Object]';

/** Chave da IA em texto legível: `dor_principal` → "Dor principal". */
const readableKey = (k: string): string => {
  const t = k.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : '';
};

/**
 * Valor da IA → texto para a tela. Com chave própria (modo JSON sem schema estrito) a IA às vezes devolve objeto/lista no lugar
 * de texto (ex.: `objetivo_smart: { especifico, mensuravel, ... }`). Texto → sem espaços nas pontas; número/bool → String;
 * lista → um item por linha; objeto → linhas "Chave legível: valor". Dentro de objeto/lista, os valores aninhados ficam numa linha
 * só ("a, b" / "Chave: valor; Outra: valor"). Nunca devolve "[object Object]" (nem o texto gravado assim por versões antigas).
 */
export function aiText(v: unknown, nested = false): string {
  if (v == null) return '';
  if (typeof v === 'string') {
    const t = v.trim();
    return t === OBJECT_JUNK ? '' : t;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const items = v.map((x) => aiText(x, true)).filter(Boolean);
    return items.join(nested ? ', ' : '\n');
  }
  if (isObj(v)) {
    const lines = Object.entries(v)
      .map(([k, x]) => [readableKey(k), aiText(x, true)] as const)
      .filter(([k, x]) => k && x)
      .map(([k, x]) => `${k}: ${x}`);
    return lines.join(nested ? '; ' : '\n');
  }
  return '';
}

const toText = (v: unknown): string => aiText(v);

/** Valor ausente/null vira [], string vira [string] (ou [] se vazia), array fica como está. */
export const toList = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === 'string') return v.trim() ? [v] : [];
  return [v];
};

/** `.join` seguro para qualquer valor (não-array vira lista vazia). */
export const joinList = (v: unknown, sep = ', '): string => (Array.isArray(v) ? v : []).join(sep);

const text = z.unknown().transform(toText);
/** Número válido ou `undefined` (a tela mostra "—"; nada de valor inventado). */
const optNum = z.unknown().transform((v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined));
const num = (fallback: number) =>
  z
    .unknown()
    .transform((v) =>
      Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback,
    );
/** Lista de textos: cada item numa linha só (objeto/lista dentro do item vira "Chave: valor; ..."). */
const textList = z.unknown().transform((v) => toList(v).map((x) => aiText(x, true)).filter(Boolean));

/** Lista de objetos: itens string viram `{ [stringKey]: item }`, itens inválidos são descartados. */
function objList<T extends z.ZodTypeAny>(item: T, stringKey: string) {
  return z.unknown().transform((v) =>
    toList(v)
      .map((x) => (typeof x === 'string' && x.trim() ? { [stringKey]: x } : x))
      .filter(isObj)
      .map((x) => item.parse(x) as z.output<T>),
  );
}

/** Objeto (pode vir ausente): entrada que não é objeto vira {}. */
function obj<S extends z.ZodRawShape>(shape: S) {
  return z.preprocess((v) => {
    const parsed = parseMaybeJson(v);
    return isObj(parsed) ? parsed : {};
  }, z.object(shape).passthrough());
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

/** Sinônimos que a IA usa nos ângulos (sem schema estrito): o primeiro com texto preenche a chave oficial. */
const ANGLE_SYNONYMS: Record<string, string[]> = {
  nome: ['nome', 'name', 'nome_angulo', 'nome_do_angulo', 'titulo', 'título', 'title', 'angulo', 'ângulo'],
  gancho: ['gancho', 'hook', 'headline'],
  mensagem: ['mensagem', 'message', 'descricao', 'descrição', 'texto'],
};

/** Ângulo com as chaves oficiais (nome/gancho/mensagem) preenchidas pelos sinônimos; chave comparada sem maiúsculas. */
const withAngleSynonyms = (v: unknown): unknown => {
  const parsed = parseMaybeJson(v);
  if (!isObj(parsed)) return parsed;
  const lower = new Map(Object.entries(parsed).map(([k, x]) => [k.toLowerCase(), x]));
  const out: Record<string, unknown> = { ...parsed };
  for (const [canon, keys] of Object.entries(ANGLE_SYNONYMS)) {
    if (aiText(out[canon])) continue;
    const hit = keys.map((k) => lower.get(k)).find((x) => aiText(x));
    if (hit !== undefined) out[canon] = hit;
  }
  return out;
};

const angleSchema = z.preprocess(
  withAngleSynonyms,
  obj({
    nome: text,
    dor_ou_desejo: text,
    mensagem: text,
    gancho: text,
    formato_sugerido: text,
    etapa_funil: text,
  }),
);

/** Um ângulo da IA no formato oficial (sinônimos aceitos, todo campo vira texto). */
export const normalizeAngle = (v: unknown): StrategyAngle => angleSchema.parse(isObj(parseMaybeJson(v)) ? v : { nome: v }) as StrategyAngle;

const audienceSchema = obj({
  nome: text,
  // Tipo desconhecido fica como veio (só exibição); quem filtra (Meta) compara com remarketing/lista_clientes.
  tipo: text,
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
  objecoes: objList(obj({ objecao: text, resposta: text }), 'objecao'),
  canais: text,
  distribuicao_verba: record(
    ['destino', 'nome', 'canal'],
    ['percentual', 'valor'],
    (x) => Number(x) || 0,
  ),
  kpis: record(['nome', 'kpi'], ['meta', 'valor'], toText),
  hipoteses: textList,
  plano_testes: text,
  cronograma: text,
  recomendacoes: textList,
  angulos_detalhados: objList(angleSchema, 'nome'),
  publicos_meta: objList(audienceSchema, 'nome'),
  briefing_criativo: optionalObj({
    direcao_visual: text,
    formatos: textList,
    quantidade_por_angulo: optNum,
    cta: text,
  }),
  briefing_video: optionalObj({
    duracao_segundos: optNum,
    roteiro: text,
    cenas: textList,
  }),
  plano_instagram: optionalObj({
    pilares: objList(obj({ nome: text, peso: num(0) }), 'nome'),
    temas: textList,
    frequencia: obj({ feed: num(3), reels: num(2), stories: num(7) }),
  }),
  gerado_por: z.unknown().transform((v) => (v == null ? undefined : toText(v))),
  gerado_em: z.unknown().transform((v) => (v == null ? undefined : toText(v))),
});

/** Estratégia com todos os campos de lista garantidos como array. `null` quando não há estratégia. */
export function normalizeStoredStrategy(strategy: unknown): FullStrategy | null {
  if (strategy == null || strategy === '') return null;
  const s = strategySchema.parse(strategy) as FullStrategy;
  // Lixo (texto que não é JSON, array, objeto sem big_idea nem ângulos): "sem estratégia".
  if (!s.big_idea.trim() && !(s.angulos_detalhados ?? []).length) return null;
  return s;
}

/** Array seguro para render: qualquer não-array (undefined, null, string, objeto) vira []. */
export const asList = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
