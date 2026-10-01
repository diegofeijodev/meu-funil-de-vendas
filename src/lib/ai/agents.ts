/**
 * Agentes de IA — tipos compartilhados e chamadas do navegador.
 * Estratégia: src/lib/ai/strategist.server.ts · Copy: src/lib/copy-ai.server.ts.
 */

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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type OptimizerInput = {
  campaignId: string;
  cpl: number;
  targetCpl: number;
  ctr: number;
  roas: number;
  spend: number;
  worstCreative?: { id: string; title: string; cpl: number } | null;
  bestCreative?: { id: string; title: string; cpl: number } | null;
};

export type Recommendation = {
  action: string;
  title: string;
  reason: string;
  estimated_impact: string;
  severity: "low" | "medium" | "high";
};

export async function generateRecommendations(input: OptimizerInput): Promise<Recommendation[]> {
  await wait(900);
  const out: Recommendation[] = [];
  if (input.cpl > 0 && input.cpl < input.targetCpl * 0.85) {
    out.push({
      action: "increase_budget",
      title: "Aumentar orçamento diário em 30%",
      reason: `O CPL atual é R$ ${input.cpl.toFixed(2)}, ${Math.round((1 - input.cpl / input.targetCpl) * 100)}% abaixo da meta de R$ ${input.targetCpl.toFixed(2)}, com ROAS de ${input.roas.toFixed(2)}.`,
      estimated_impact: `Projeção de +${Math.round(input.spend * 0.3 / Math.max(input.cpl, 1))} leads no período mantendo o CPL abaixo da meta.`,
      severity: "high",
    });
  }
  if (input.cpl > input.targetCpl * 1.15) {
    out.push({
      action: "decrease_budget",
      title: "Reduzir orçamento e reestruturar o conjunto",
      reason: `CPL de R$ ${input.cpl.toFixed(2)} está ${Math.round((input.cpl / input.targetCpl - 1) * 100)}% acima da meta.`,
      estimated_impact: "Evita desperdício estimado de 20% da verba restante.",
      severity: "high",
    });
  }
  if (input.ctr < 1.2) {
    out.push({
      action: "test_headline",
      title: "Testar nova headline com ângulo de prova",
      reason: `CTR de ${input.ctr.toFixed(2)}% está abaixo do saudável (1,8%) para o volume de impressões já entregue.`,
      estimated_impact: "Potencial de +0,4pp de CTR e queda de 12% no CPC.",
      severity: "medium",
    });
  }
  if (input.worstCreative) {
    out.push({
      action: "pause_creative",
      title: `Pausar o criativo "${input.worstCreative.title}"`,
      reason: `Esse criativo entrega CPL de R$ ${input.worstCreative.cpl.toFixed(2)}, o pior da campanha.`,
      estimated_impact: "Realoca verba para o criativo vencedor e reduz o CPL médio.",
      severity: "high",
    });
  }
  if (input.bestCreative) {
    out.push({
      action: "create_variation",
      title: `Criar 2 variações de "${input.bestCreative.title}"`,
      reason: `É o criativo com melhor CPL (R$ ${input.bestCreative.cpl.toFixed(2)}) e ainda tem espaço de frequência.`,
      estimated_impact: "Prolonga a vida útil do ângulo vencedor por ~3 semanas.",
      severity: "medium",
    });
  }
  out.push({
    action: "create_remarketing",
    title: "Ativar remarketing de 14 dias",
    reason: "Há volume suficiente de cliques para formar público quente com custo menor.",
    estimated_impact: "CAC do remarketing costuma ficar 35% abaixo do frio.",
    severity: "medium",
  });
  return out;
}

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
  const { generateCopyWithAI } = await import("@/lib/copy-ai.functions");
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
