/** Tipos da estratégia gerada (espelham `lib/ai/strategy-types.ts` + `StrategyContent` de `lib/ai/agents.ts`). */
export type StrategyAngle = {
  nome: string;
  dor_ou_desejo: string;
  mensagem: string;
  gancho: string;
  formato_sugerido: string;
  etapa_funil: string;
};

export type StrategyAudience = {
  nome: string;
  tipo: 'frio' | 'interesses' | 'lookalike' | 'remarketing' | 'lista_clientes';
  interesses: string[];
  descricao: string;
};

export type FullStrategy = {
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
  angulos_detalhados?: StrategyAngle[];
  publicos_meta?: StrategyAudience[];
  briefing_criativo?: { direcao_visual: string; formatos: string[]; quantidade_por_angulo: number; cta: string };
  briefing_video?: { duracao_segundos: number; roteiro: string; cenas: string[] };
  plano_instagram?: {
    pilares: { nome: string; peso: number }[];
    temas: string[];
    frequencia: { feed: number; reels: number; stories: number };
  };
  gerado_por?: string;
  gerado_em?: string;
};
