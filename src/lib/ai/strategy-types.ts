/** Tipos da estratégia gerada pelo estrategista (compartilhados entre servidor e telas). */
import type { StrategyContent } from "./agents";

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
  tipo: "frio" | "interesses" | "lookalike" | "remarketing" | "lista_clientes";
  interesses: string[];
  descricao: string;
};

export type FullStrategy = StrategyContent & {
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
