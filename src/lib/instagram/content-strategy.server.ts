/**
 * Estratégia do período e validação dos posts (somente servidor).
 * A estratégia parte do objetivo digitado; o validador confere cada post contra marca, objetivo,
 * produtos e data real (dia da semana em São Paulo) antes de o post entrar na programação.
 */
import { aiJson } from "./instagram.server";
import { asText } from "./normalize";

const SP = "America/Sao_Paulo";
const str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const arr = (items: unknown) => ({ type: "array", items });

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

const STRATEGY_SCHEMA = obj({
  objetivo_resumido: str,
  kpi_principal: str,
  publico_foco: str,
  mensagem_central: str,
  pilares: arr(obj({ nome: str, peso_percentual: { type: "number" }, por_que_serve_ao_objetivo: str })),
  distribuicao_por_dia: arr(obj({ data: str, dia_da_semana: str, tema_do_dia: str, momento_do_funil: str })),
  ctas: arr(str),
  proibicoes: arr(str),
});

/** "quinta-feira, 01/10/2026, 20:10" no fuso de São Paulo. */
export function fullDate(iso: string) {
  const d = new Date(iso);
  const wd = d.toLocaleDateString("pt-BR", { weekday: "long", timeZone: SP });
  const dt = d.toLocaleDateString("pt-BR", { timeZone: SP, day: "2-digit", month: "2-digit", year: "numeric" });
  const tm = d.toLocaleTimeString("pt-BR", { timeZone: SP, hour: "2-digit", minute: "2-digit" });
  return `${wd}, ${dt}, ${tm}`;
}
const spParts = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 3 * 3600e3);
  return { wd: d.getUTCDay(), hour: d.getUTCHours() };
};

export const DATE_RULES =
  'Coerência com a data: "sextou"/"sexta chegou" só na sexta; "bom dia" só antes das 12h, "boa tarde" das 12h às 18h, "boa noite" depois das 18h; "fim de semana chegou"/"sabadou" só de sexta a domingo; "segunda"/"começo de semana" só na segunda; nunca cite dia da semana diferente do dia do post.';

/** Regras de data checadas por código (não dependem da IA). */
export function dateIssues(text: string, iso: string): string[] {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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

export async function buildRunStrategy(args: {
  workspaceId: string;
  objective: string;
  brand: any;
  products: any[];
  personas: any[];
  plan: any;
  slots: { at: string; format: string }[];
}): Promise<{ strategy: RunStrategy; provider: string }> {
  const days = [...new Map(args.slots.map((s) => [fullDate(s.at).split(",").slice(0, 2).join(","), s.at])).keys()];
  const prompt = [
    "Você é a estrategista-chefe de conteúdo de Instagram de uma agência no Brasil. Escreva em português do Brasil.",
    "Monte a estratégia do período. ORDEM DE PRIORIDADE (nunca inverta):",
    `1. OBJETIVO DIGITADO PELO CLIENTE (fonte principal, nunca ignore): ${args.objective}`,
    `2. DNA DA MARCA: ${JSON.stringify(brandContext(args.brand))}`,
    `3. PRODUTOS: ${JSON.stringify(args.products.map((p) => ({ nome: p.name, descricao: p.description, preco: p.price })))}`,
    `   PERSONAS: ${JSON.stringify(args.personas.map((p) => ({ nome: p.name, dores: p.pains, desejos: p.desires })))}`,
    `4. PLANO: pilares ${JSON.stringify(args.plan?.content_pillars ?? [])}; CTA padrão ${args.plan?.cta_default ?? "-"}.`,
    "REGRAS: tudo precisa ser do segmento da marca (nunca fale de outro negócio, marketing de agência, Q4, construção de lista etc. se não for o negócio dela).",
    "Não invente preço, promoção ou número que não esteja nos produtos/DNA. Pilares: 3 a 5, pesos somam 100.",
    "distribuicao_por_dia: um item para CADA dia abaixo (data dd/mm/aaaa e dia da semana exatamente como informado), com o tema do dia e o momento do funil (atração, consideração ou conversão).",
    "ctas: 3 a 6 CTAs aceitos no período. proibicoes: o que NÃO pode aparecer (palavras proibidas da marca, temas fora do segmento, promessas não cadastradas, expressões fora de data).",
    DATE_RULES,
    "DIAS DO PERÍODO:",
    ...days.map((d) => `- ${d}`),
  ].join("\n");
  const { json, provider } = await aiJson(args.workspaceId, "auto", prompt, STRATEGY_SCHEMA, "ig_run_strategy");
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const strategy: RunStrategy = {
    objetivo_resumido: asText(json?.objetivo_resumido) ?? args.objective,
    kpi_principal: asText(json?.kpi_principal) ?? "",
    publico_foco: asText(json?.publico_foco) ?? "",
    mensagem_central: asText(json?.mensagem_central) ?? "",
    pilares: list<any>(json?.pilares).map((p) => ({
      nome: asText(p?.nome) ?? "",
      peso_percentual: Number(p?.peso_percentual) || 0,
      por_que_serve_ao_objetivo: asText(p?.por_que_serve_ao_objetivo) ?? "",
    })).filter((p) => p.nome),
    distribuicao_por_dia: list<any>(json?.distribuicao_por_dia).map((d) => ({
      data: asText(d?.data) ?? "",
      dia_da_semana: asText(d?.dia_da_semana) ?? "",
      tema_do_dia: asText(d?.tema_do_dia) ?? "",
      momento_do_funil: asText(d?.momento_do_funil) ?? "",
    })),
    ctas: list<unknown>(json?.ctas).map((c) => asText(c)).filter((c): c is string => !!c),
    proibicoes: list<unknown>(json?.proibicoes).map((c) => asText(c)).filter((c): c is string => !!c),
  };
  if (!strategy.pilares.length) throw new Error("A IA não devolveu a estratégia completa. Tentando de novo no próximo ciclo.");
  return { strategy, provider };
}

const VERDICT_SCHEMA = obj({
  results: arr(obj({ index: { type: "integer" }, aprovado: { type: "boolean" }, nota_0_10: { type: "number" }, motivo: str })),
});

export type Verdict = { aprovado: boolean; nota: number; motivo: string };

/** Segundo olhar da IA sobre cada post + regras de data por código. */
export async function validatePosts(args: {
  workspaceId: string;
  brand: any;
  objective: string;
  strategy: RunStrategy | null;
  products: any[];
  posts: { index: number; at: string; theme: string | null; hook: string | null; caption: string | null; headline: string | null; cta: string | null }[];
}): Promise<Map<number, Verdict>> {
  const out = new Map<number, Verdict>();
  for (const p of args.posts) {
    const issues = dateIssues([p.theme, p.hook, p.caption, p.headline, p.cta].filter(Boolean).join(" \n "), p.at);
    if (issues.length) out.set(p.index, { aprovado: false, nota: 0, motivo: `Incoerência de data: ${issues.join("; ")}.` });
  }
  const rest = args.posts.filter((p) => !out.has(p.index));
  if (!rest.length) return out;
  const prompt = [
    "Você é o revisor de qualidade de uma agência. Confira cada post de Instagram abaixo e reprove se:",
    "- fala de outro negócio ou de tema genérico fora do segmento da marca;",
    "- não tem relação com o objetivo do período;",
    "- inventa preço, promoção ou número que não esteja nos produtos/DNA;",
    "- usa palavra proibida da marca;",
    "- tem incoerência com a data ou o dia da semana informados.",
    `MARCA: ${JSON.stringify(brandContext(args.brand))}`,
    `OBJETIVO: ${args.objective}`,
    args.strategy ? `ESTRATÉGIA: ${JSON.stringify({ mensagem: args.strategy.mensagem_central, ctas: args.strategy.ctas, proibicoes: args.strategy.proibicoes })}` : "",
    `PRODUTOS (únicos preços válidos): ${JSON.stringify(args.products.map((p) => ({ nome: p.name, preco: p.price })))}`,
    DATE_RULES,
    "POSTS:",
    ...rest.map((p) => `- index ${p.index} · ${fullDate(p.at)}: ${JSON.stringify({ tema: p.theme, gancho: p.hook, headline: p.headline, legenda: p.caption, cta: p.cta })}`),
    'Devolva SOMENTE JSON {"results":[{"index":0,"aprovado":true,"nota_0_10":8,"motivo":"..."}]} com um item por post; motivo curto em português.',
  ].filter(Boolean).join("\n");
  try {
    const { json } = await aiJson(args.workspaceId, "auto", prompt, VERDICT_SCHEMA, "ig_post_review");
    for (const r of Array.isArray(json?.results) ? json.results : []) {
      const i = Number(r?.index);
      if (!rest.some((p) => p.index === i)) continue;
      const nota = Math.max(0, Math.min(10, Number(r?.nota_0_10) || 0));
      out.set(i, { aprovado: r?.aprovado === true && nota >= 6, nota, motivo: asText(r?.motivo) ?? "" });
    }
  } catch (e) {
    // Revisor indisponível: não bloqueia a programação; os posts seguem para a aprovação normal.
    console.warn("[ig-review] revisor falhou:", e instanceof Error ? e.message : e);
  }
  return out;
}

export const isCreditFailure = (msg: string) => /cr[eé]dito|402|quota|insufficient|esgotad|billing/i.test(msg);
