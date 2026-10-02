/** Guia visual da marca e tipos da direção de arte (seguro para cliente e servidor). */
export type VisualStyle = {
  estilo_fotografico?: string;
  iluminacao?: string;
  paleta_hex?: string[];
  ambientes?: string[];
  elementos_obrigatorios?: string[];
  elementos_proibidos?: string[];
  referencias?: string[];
  fonte_titulo?: string;
  fonte_corpo?: string;
  posicao_logo?: LogoPosition;
  exemplos_prompt?: string[];
};

export type LogoPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right" | "none";
export const LOGO_POSITIONS: Record<LogoPosition, string> = {
  top_left: "Canto superior esquerdo",
  top_right: "Canto superior direito",
  bottom_left: "Canto inferior esquerdo",
  bottom_right: "Canto inferior direito",
  none: "Sem logo",
};

export type TextLayout = "limpo" | "titulo_topo" | "preco_destaque" | "cta_rodape";
export const TEXT_LAYOUTS: Record<TextLayout, string> = {
  limpo: "Limpo (sem texto)",
  titulo_topo: "Título no topo",
  preco_destaque: "Preço em destaque",
  cta_rodape: "Chamada no rodapé",
};

export type ArtDirection = {
  subject: string;
  scene: string;
  composition: string;
  lighting: string;
  camera: string;
  style: string;
  color_palette: string[];
  mood: string;
  text_in_image: string;
  negative: string;
  aspect_ratio: string;
  prompt_final: string;
  video_shots: { duracao: string; descricao: string; movimento_camera: string }[];
};

export type AiScore = {
  produto: number;
  fidelidade: number;
  composicao: number;
  defeitos: number;
  paleta: number;
  total: number;
  motivo: string;
};

export type Variation = {
  assetId: string;
  url: string;
  cleanAssetId?: string | null;
  score: AiScore | null;
  winner: boolean;
};

export const REFERENCE_TAGS: Record<string, string> = {
  produto: "Produto",
  ambiente: "Ambiente",
  equipe: "Equipe",
};

export const listField = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : [];
