/**
 * Agentes de IA — tipos compartilhados e chamadas do navegador.
 * Estratégia: API `ai/strategist` · Copy: API `copy-ai`.
 */
import { generateCopyWithAI } from "@/lib/copy-ai.functions";

export type BrandContext = {
  name: string;
  description?: string | null;
  segment?: string | null;
  differentials?: string | null;
  target_audience?: string | null;
  competitors?: string | null;
  tone_of_voice?: string | null;
  preferred_words?: string[] | null;
  banned_words?: string[] | null;
  region?: string | null;
};

export type CampaignBrief = {
  name: string;
  objective: string;
  offer_product?: string | null;
  offer_price?: number | null;
  offer_promise?: string | null;
  landing_url?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  audience: Record<string, string>;
  budget_total?: number | null;
  budget_daily?: number | null;
  goal_leads?: number | null;
  goal_sales?: number | null;
  avg_ticket?: number | null;
  margin_percent?: number | null;
  max_cac?: number | null;
  formats: string[];
};

export type Learning = { category: string; value: string; metric: string | null };

export type StrategyContent = {
  resumo_executivo: string;
  problema: string;
  objetivo_smart: string;
  icp: string;
  oferta: string;
  big_idea: string;
  angulos: string[];
  funil: string;
  mensagem_principal: string;
  objecoes: { objecao: string; resposta: string }[];
  canais: string;
  distribuicao_verba: Record<string, number>;
  kpis: Record<string, string>;
  hipoteses: string[];
  plano_testes: string;
  cronograma: string;
  recomendacoes: string[];
};

export type CopyContent = {
  headline: string;
  headline_variacoes: string[];
  texto_curto: string;
  texto_longo: string;
  cta: string;
  meta_ad: string;
  instagram_feed: string;
  reels: string;
  stories: string;
  script_ugc: string;
  script_institucional: string;
  carrossel: string[];
  quiz: { pergunta: string; opcoes: string[] }[];
};

const CTA_BY_OBJECTIVE: Record<string, string> = {
  awareness: "Conheça a marca",
  engagement: "Participe agora",
  traffic: "Ver detalhes",
  leads: "Quero receber o material",
  whatsapp: "Chamar no WhatsApp",
  sales: "Comprar agora",
  remarketing: "Voltar e finalizar",
};

/**
 * Copy com IA real (sua conta OpenAI/Gemini ou créditos do app), orientada pela estratégia da campanha.
 * Se a IA falhar, o erro sobe para a tela — nunca salvamos copy de modelo como se fosse da IA.
 */
export async function generateCopySmart(
  workspaceId: string,
  brand: BrandContext,
  brief: CampaignBrief,
  seed = 0,
  opts: { campaignId?: string | null; angle?: string | null } = {},
): Promise<{ content: CopyContent; engine: string }> {
  const r = await generateCopyWithAI({
    data: {
      workspaceId,
      engine: "auto",
      brand: brand as unknown as Record<string, unknown>,
      brief: brief as unknown as Record<string, unknown>,
      seed,
      campaignId: opts.campaignId ?? null,
      angle: opts.angle ?? null,
    },
  });
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const c = r.content as Partial<CopyContent>;
  return {
    content: {
      headline: String(c.headline ?? ""),
      headline_variacoes: list(c.headline_variacoes),
      texto_curto: String(c.texto_curto ?? ""),
      texto_longo: String(c.texto_longo ?? ""),
      cta: String(c.cta ?? CTA_BY_OBJECTIVE[brief.objective] ?? "Saiba mais"),
      meta_ad: String(c.meta_ad ?? ""),
      instagram_feed: String(c.instagram_feed ?? ""),
      reels: String(c.reels ?? ""),
      stories: String(c.stories ?? ""),
      script_ugc: String(c.script_ugc ?? ""),
      script_institucional: String(c.script_institucional ?? ""),
      carrossel: list(c.carrossel),
      quiz: list(c.quiz),
    },
    engine: r.engine,
  };
}
