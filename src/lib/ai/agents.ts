import { OBJECTIVES } from "@/lib/labels";

/**
 * Agentes de IA — camada de serviço.
 * Hoje roda em modo simulado (determinístico, sem custo). A assinatura das
 * funções já é a definitiva: para plugar um modelo real, basta trocar a
 * implementação por uma chamada a um server function no backend.
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

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length] as T;
}

export async function generateStrategy(
  brand: BrandContext,
  brief: CampaignBrief,
  learnings: Learning[] = [],
): Promise<StrategyContent> {
  await wait(1400);
  const objective = OBJECTIVES[brief.objective] ?? brief.objective;
  const produto = brief.offer_product || "a oferta principal";
  const cac = brief.max_cac ? `R$ ${brief.max_cac}` : "não definido";
  const meta = brief.goal_leads ? `${brief.goal_leads} leads` : `${brief.goal_sales ?? 0} vendas`;
  const aprendizados = learnings.map((l) => `${l.category}: ${l.value}${l.metric ? ` (${l.metric})` : ""}`);
  const persona = brief.audience["persona"] || brand.target_audience || "público principal da marca";
  const local = brief.audience["localizacao"] || brand.region || "Brasil";
  const idade = brief.audience["idade"] || "25-45";

  return {
    resumo_executivo: `Campanha de ${objective.toLowerCase()} para ${brand.name}, promovendo ${produto}. Verba total de R$ ${brief.budget_total ?? 0} (R$ ${brief.budget_daily ?? 0}/dia) com meta de ${meta} e CAC máximo de ${cac}. A estratégia parte dos diferenciais da marca (${brand.differentials || "posicionamento próprio"}) e dos aprendizados acumulados no histórico.`,
    problema: `${persona} já foi exposto a ofertas parecidas de ${brand.competitors || "concorrentes diretos"} e desenvolveu ceticismo. A oportunidade está em ancorar a comunicação em prova concreta em vez de promessa genérica.`,
    objetivo_smart: `Atingir ${meta} em ${brief.start_date && brief.end_date ? "todo o período da campanha" : "30 dias"}, com CAC máximo de ${cac} e ticket médio de R$ ${brief.avg_ticket ?? 0}, mantendo margem em ${brief.margin_percent ?? 0}%.`,
    icp: `${persona} · ${idade} anos · ${local} · interesses: ${brief.audience["interesses"] || "não informado"} · ${brief.audience["tipo"] || "B2C"}.`,
    oferta: `${produto}${brief.offer_price ? ` por R$ ${brief.offer_price}` : ""}. Promessa: ${brief.offer_promise || "benefício central da oferta"}. Destino: ${brief.landing_url || "landing page a definir"}.`,
    big_idea: `${brand.name}: ${brand.differentials?.split(",")[0]?.trim() || "o diferencial que ninguém mostra"} — provado, não prometido.`,
    angulos: [
      `Prova concreta: ${brand.differentials || "o diferencial da marca"}`,
      `Dor imediata do ${persona}`,
      `Comparativo honesto com ${brand.competitors || "as alternativas do mercado"}`,
      "Depoimento real em formato UGC",
      `Autoridade e bastidor de ${brand.name}`,
    ],
    funil: `Topo: conteúdo educativo sobre o problema. Meio: ${brief.formats.includes("quiz") ? "quiz de diagnóstico" : "prova social e comparativo"}. Fundo: oferta direta com ${CTA_BY_OBJECTIVE[brief.objective] ?? "CTA principal"}.`,
    mensagem_principal: `${brief.offer_promise || produto} com ${brand.differentials?.split(",")[0]?.trim() || "o padrão de qualidade da marca"}.`,
    objecoes: [
      { objecao: "É caro demais", resposta: `Quebra do custo por uso e comparativo com ${brand.competitors || "as alternativas"}.` },
      { objecao: "Já tentei algo parecido e não funcionou", resposta: `${brand.differentials || "O diferencial da marca"} muda o resultado — mostramos a prova.` },
      { objecao: "Não confio na marca", resposta: `Prova social, bastidores e garantia clara de ${brand.name}.` },
    ],
    canais: `Meta Ads (Instagram + Facebook) como canal principal${brief.objective === "whatsapp" ? " com destino em WhatsApp" : ""}, apoiado por conteúdo orgânico no Instagram.`,
    distribuicao_verba: { prospeccao: 60, remarketing: 25, teste_criativos: 15 },
    kpis: {
      CPL: brief.max_cac ? `<= R$ ${Math.round(Number(brief.max_cac) * 0.55)}` : "<= R$ 40",
      CTR: ">= 1,8%",
      CAC: `<= ${cac}`,
      ROAS: ">= 3,0",
    },
    hipoteses: [
      "Criativo UGC supera o institucional em CTR",
      `Ângulo de ${brand.differentials?.split(",")[0]?.trim() || "diferencial"} reduz o CPL em pelo menos 15%`,
      "Público de remarketing tem CAC no mínimo 35% menor",
    ],
    plano_testes: `Teste A/B de headline (dor vs. prova) por 7 dias, 2 criativos por conjunto e corte automático de qualquer criativo com CPL 30% acima da meta. Formatos em teste: ${brief.formats.join(", ") || "a definir"}.`,
    cronograma: `Semana 1: aquecimento e leitura de sinais. Semana 2: escala do criativo vencedor. Semana 3: ativação do remarketing. Semana 4: oferta de fechamento.`,
    recomendacoes: [
      "Validar pixel e eventos de conversão antes do go-live",
      `Produzir ao menos 3 variações do formato ${pick(brief.formats.length ? brief.formats : ["video"], 0)}`,
      aprendizados.length
        ? `Reaproveitar aprendizados da marca: ${aprendizados.slice(0, 3).join(" · ")}`
        : "Registrar aprendizados desde o primeiro dia para alimentar as próximas campanhas",
    ],
  };
}

export async function generateCopy(
  brand: BrandContext,
  brief: CampaignBrief,
  seed = 0,
): Promise<CopyContent> {
  await wait(1100);
  const produto = brief.offer_product || "nossa solução";
  const promessa = brief.offer_promise || "o resultado que você procura";
  const dif = brand.differentials?.split(",")[0]?.trim() || "um padrão diferente de qualidade";
  const cta = CTA_BY_OBJECTIVE[brief.objective] ?? "Saiba mais";
  const persona = brief.audience["persona"] || brand.target_audience || "você";

  const headlines = [
    `${promessa}. Sem promessa vazia.`,
    `${produto}: ${dif}`,
    `O que ninguém te conta sobre ${produto.toLowerCase()}`,
    `${persona.split(",")[0]}, isso muda o seu resultado`,
    `${dif} — e nós mostramos a prova`,
    `Pare de tentar. Comece a medir com ${brand.name}.`,
  ];

  return {
    headline: pick(headlines, seed),
    headline_variacoes: headlines.filter((_, i) => i % headlines.length !== seed % headlines.length).slice(0, 5),
    texto_curto: `${brand.name} apresenta ${produto}: ${promessa}. ${cta}.`,
    texto_longo: `Se você já testou outras opções e não viu resultado, o problema provavelmente não é você. ${produto} foi construído em cima de ${dif}, e é isso que muda o jogo para ${persona}. ${promessa}${brief.offer_price ? `, a partir de R$ ${brief.offer_price}` : ""}. Tom de voz: ${brand.tone_of_voice || "direto e confiável"}. ${cta}.`,
    cta,
    meta_ad: `${promessa} com ${dif}. ${cta}.`,
    instagram_feed: `${pick(headlines, seed + 1)}\n\n${produto} existe por um motivo simples: ${dif}. ${promessa}.\n\n${cta} — link na bio.`,
    reels: `[0-3s] Gancho: "${pick(headlines, seed + 2)}"\n[3-8s] Contexto da dor de ${persona}\n[8-15s] Prova: ${dif}\n[15-22s] Demonstração de ${produto}\n[22-28s] CTA: ${cta}`,
    stories: `Story 1: enquete sobre a dor principal\nStory 2: dado ou prova de ${dif}\nStory 3: bastidor de ${brand.name}\nStory 4: CTA "${cta}" com link`,
    script_ugc: `Câmera na mão, luz natural. "Eu testei várias opções antes de conhecer ${brand.name}." Corte para uso real de ${produto}. "A diferença é ${dif}." Corte para resultado. "${cta}, link na bio."`,
    script_institucional: `Plano aberto da operação de ${brand.name}. Narração: "Cada entrega passa por ${dif}." Cortes de bastidor, cliente real, assinatura da marca e ${cta}.`,
    carrossel: [
      `Slide 1: ${pick(headlines, seed)}`,
      `Slide 2: o erro mais comum de ${persona}`,
      `Slide 3: por que as alternativas falham`,
      `Slide 4: ${dif}`,
      `Slide 5: ${promessa}`,
      `Slide 6: prova social e resultados`,
      `Slide 7: ${cta}`,
    ],
    quiz: [
      { pergunta: `Qual é hoje o seu maior desafio com ${produto.toLowerCase()}?`, opcoes: ["Preço", "Confiança", "Resultado"] },
      { pergunta: "Há quanto tempo você busca uma solução?", opcoes: ["Menos de 1 mês", "1 a 6 meses", "Mais de 6 meses"] },
      { pergunta: "O que faria você decidir hoje?", opcoes: ["Prova concreta", "Condição especial", "Indicação de alguém"] },
    ],
  };
}

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
