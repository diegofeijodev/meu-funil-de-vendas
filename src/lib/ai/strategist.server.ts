/**
 * Estrategista digital (somente servidor).
 * Gera a estratégia da campanha com IA real a partir do DNA da marca, produtos, personas,
 * aprendizados e resultados anteriores. A saída é o briefing que comanda copy, criativos,
 * vídeos, públicos da Meta e o plano do Instagram.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonLLM } from "@/lib/creative/llm.server";
import { OBJECTIVES } from "@/lib/labels";

type DB = SupabaseClient<any, any, any>;

const str = { type: "string" };
const arr = (items: Record<string, unknown>) => ({ type: "array", items });
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const SCHEMA = obj({
  resumo_executivo: str,
  problema: str,
  objetivo_smart: str,
  icp: str,
  oferta: str,
  big_idea: str,
  mensagem_principal: str,
  funil: str,
  canais: str,
  plano_testes: str,
  cronograma: str,
  hipoteses: arr(str),
  recomendacoes: arr(str),
  objecoes: arr(obj({ objecao: str, resposta: str })),
  distribuicao_verba: arr(obj({ destino: str, percentual: { type: "number" } })),
  kpis: arr(obj({ nome: str, meta: str })),
  angulos_detalhados: arr(
    obj({
      nome: str,
      dor_ou_desejo: str,
      mensagem: str,
      gancho: str,
      formato_sugerido: str,
      etapa_funil: str,
    }),
  ),
  publicos_meta: arr(
    obj({
      nome: str,
      tipo: { type: "string", enum: ["frio", "interesses", "lookalike", "remarketing", "lista_clientes"] },
      interesses: arr(str),
      descricao: str,
    }),
  ),
  briefing_criativo: obj({
    direcao_visual: str,
    formatos: arr(str),
    quantidade_por_angulo: { type: "number" },
    cta: str,
  }),
  briefing_video: obj({
    duracao_segundos: { type: "number" },
    roteiro: str,
    cenas: arr(str),
  }),
  plano_instagram: obj({
    pilares: arr(obj({ nome: str, peso: { type: "number" } })),
    temas: arr(str),
    frequencia: obj({ feed: { type: "number" }, reels: { type: "number" }, stories: { type: "number" } }),
  }),
});

import type { FullStrategy, StrategyAngle, StrategyAudience } from "./strategy-types";
export type { FullStrategy, StrategyAngle, StrategyAudience };

/** Resultados anteriores da marca (campanhas já veiculadas) para a IA aprender com eles. */
async function pastResults(db: DB, brandId: string, excludeCampaignId: string) {
  const { data: camps } = await db
    .from("campaigns")
    .select("id, name, objective")
    .eq("brand_id", brandId)
    .neq("id", excludeCampaignId)
    .limit(20);
  const ids = (camps ?? []).map((c: any) => c.id);
  if (!ids.length) return [];
  const { data: perf } = await db
    .from("performance_daily")
    .select("campaign_id, spend, impressions, clicks, leads, conversions, revenue")
    .eq("source", "meta")
    .in("campaign_id", ids);
  const agg = new Map<string, { spend: number; impressions: number; clicks: number; leads: number; sales: number; revenue: number }>();
  for (const r of (perf ?? []) as any[]) {
    const a = agg.get(r.campaign_id) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, sales: 0, revenue: 0 };
    a.spend += Number(r.spend ?? 0);
    a.impressions += Number(r.impressions ?? 0);
    a.clicks += Number(r.clicks ?? 0);
    a.leads += Number(r.leads ?? 0);
    a.sales += Number(r.conversions ?? 0);
    a.revenue += Number(r.revenue ?? 0);
    agg.set(r.campaign_id, a);
  }
  return (camps ?? [])
    .filter((c: any) => agg.has(c.id))
    .map((c: any) => {
      const a = agg.get(c.id)!;
      return {
        campanha: c.name,
        objetivo: OBJECTIVES[c.objective] ?? c.objective,
        gasto: Math.round(a.spend),
        ctr: a.impressions ? Number(((a.clicks / a.impressions) * 100).toFixed(2)) : null,
        cpl: a.leads ? Number((a.spend / a.leads).toFixed(2)) : null,
        roas: a.spend ? Number((a.revenue / a.spend).toFixed(2)) : null,
      };
    });
}

export async function generateStrategyAI(db: DB, campaignId: string): Promise<FullStrategy> {
  const { data: c, error } = await db.from("campaigns").select("*, brands(*)").eq("id", campaignId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) throw new Error("Campanha não encontrada.");
  const brand = c.brands as any;
  if (!brand) throw new Error("A campanha precisa de uma marca com o DNA preenchido.");

  const [personas, products, learnings, history] = await Promise.all([
    db.from("personas").select("name, age_range, location, pains, desires, interests, segment_type").eq("brand_id", brand.id).limit(4),
    db.from("products").select("name, description, price").eq("brand_id", brand.id).limit(6),
    db.from("brand_learnings").select("category, value, metric").eq("brand_id", brand.id).order("score", { ascending: false }).limit(10),
    pastResults(db, brand.id, campaignId),
  ]);

  const prompt = [
    "Você é o estrategista-chefe de uma agência de marketing digital de performance no Brasil.",
    "Monte a estratégia completa desta campanha em português do Brasil, específica para esta marca (nada genérico).",
    "REGRAS:",
    "- Use o tom de voz e as palavras preferidas; NUNCA use as palavras proibidas.",
    "- KPIs com metas numéricas realistas para o segmento e a verba informada (CPL, CTR, CPC, CPA/CAC, ROAS quando houver venda).",
    "- distribuicao_verba soma 100.",
    "- angulos_detalhados: 3 a 5 ângulos testáveis, cada um com gancho de até 12 palavras e formato sugerido (imagem, carrossel, reels, story, ugc).",
    "- publicos_meta: 2 a 4 públicos para a Meta (inclua remarketing quando fizer sentido); interesses reais que existem no gerenciador de anúncios.",
    "- briefing_criativo e briefing_video orientam o designer: o que se vê, sem texto dentro da imagem (o texto é aplicado depois).",
    "- plano_instagram: 3 a 5 pilares com peso (soma 1) e 8 temas de conteúdo orgânico alinhados à campanha.",
    "- Aprenda com os resultados anteriores e aprendizados da marca quando existirem.",
    "",
    `MARCA: ${JSON.stringify({
      nome: brand.name,
      descricao: brand.description,
      segmento: brand.segment,
      site: brand.website,
      diferenciais: brand.differentials,
      publico: brand.target_audience,
      concorrentes: brand.competitors,
      tom_de_voz: brand.tone_of_voice,
      palavras_preferidas: brand.preferred_words,
      palavras_proibidas: brand.banned_words,
      regiao: brand.region,
    })}`,
    `PERSONAS: ${JSON.stringify(personas.data ?? [])}`,
    `PRODUTOS: ${JSON.stringify(products.data ?? [])}`,
    `CAMPANHA: ${JSON.stringify({
      nome: c.name,
      objetivo: OBJECTIVES[c.objective] ?? c.objective,
      produto: c.offer_product,
      preco: c.offer_price,
      promessa: c.offer_promise,
      destino: c.landing_url,
      inicio: c.start_date,
      fim: c.end_date,
      publico: c.audience,
      verba_total: c.budget_total,
      verba_diaria: c.budget_daily,
      meta_leads: c.goal_leads,
      meta_vendas: c.goal_sales,
      ticket_medio: c.avg_ticket,
      margem: c.margin_percent,
      cac_maximo: c.max_cac,
      formatos: c.formats,
    })}`,
    `APRENDIZADOS DA MARCA: ${JSON.stringify(learnings.data ?? [])}`,
    `RESULTADOS ANTERIORES: ${JSON.stringify(history)}`,
  ].join("\n");

  const raw = (await jsonLLM(c.workspace_id, prompt, SCHEMA, "campaign_strategy")) as any;
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const angles = list<StrategyAngle>(raw.angulos_detalhados);
  if (!raw.big_idea || !angles.length) throw new Error("A IA não devolveu uma estratégia completa. Tente de novo.");

  return {
    resumo_executivo: String(raw.resumo_executivo ?? ""),
    problema: String(raw.problema ?? ""),
    objetivo_smart: String(raw.objetivo_smart ?? ""),
    icp: String(raw.icp ?? ""),
    oferta: String(raw.oferta ?? ""),
    big_idea: String(raw.big_idea ?? ""),
    angulos: angles.map((a) => `${a.nome}: ${a.mensagem}`),
    funil: String(raw.funil ?? ""),
    mensagem_principal: String(raw.mensagem_principal ?? ""),
    objecoes: list<{ objecao: string; resposta: string }>(raw.objecoes),
    canais: String(raw.canais ?? ""),
    distribuicao_verba: Object.fromEntries(
      list<{ destino: string; percentual: number }>(raw.distribuicao_verba).map((d) => [d.destino, Number(d.percentual) || 0]),
    ),
    kpis: Object.fromEntries(list<{ nome: string; meta: string }>(raw.kpis).map((k) => [k.nome, k.meta])),
    hipoteses: list<string>(raw.hipoteses),
    plano_testes: String(raw.plano_testes ?? ""),
    cronograma: String(raw.cronograma ?? ""),
    recomendacoes: list<string>(raw.recomendacoes),
    angulos_detalhados: angles,
    publicos_meta: list<StrategyAudience>(raw.publicos_meta),
    briefing_criativo: raw.briefing_criativo,
    briefing_video: raw.briefing_video,
    plano_instagram: raw.plano_instagram,
    gerado_por: "IA",
    gerado_em: new Date().toISOString(),
  };
}

/** Estratégia em vigor da campanha: a aprovada mais recente, senão a última versão. */
export async function currentStrategy(db: DB, campaignId: string | null | undefined): Promise<FullStrategy | null> {
  if (!campaignId) return null;
  const { data } = await db
    .from("campaign_strategies")
    .select("content, status, version")
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false })
    .limit(10);
  const rows = (data ?? []) as { content: FullStrategy; status: string }[];
  return (rows.find((r) => r.status === "approved") ?? rows[0])?.content ?? null;
}

/** Resumo curto da estratégia para orientar copy, diretor de arte e vídeo. */
export function strategyBrief(s: FullStrategy | null, angleName?: string | null) {
  if (!s) return null;
  const angle = angleName ? (s.angulos_detalhados ?? []).find((a) => a.nome === angleName) ?? null : null;
  return {
    big_idea: s.big_idea,
    mensagem_principal: s.mensagem_principal,
    angulo: angle,
    angulos: angle ? undefined : (s.angulos_detalhados ?? []).map((a) => ({ nome: a.nome, gancho: a.gancho, mensagem: a.mensagem })),
    objecoes: (s.objecoes ?? []).slice(0, 4),
    direcao_visual: s.briefing_criativo?.direcao_visual ?? null,
    cta: s.briefing_criativo?.cta ?? null,
    video: s.briefing_video ?? null,
  };
}
