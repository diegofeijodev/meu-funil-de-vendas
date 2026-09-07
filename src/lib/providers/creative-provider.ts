/**
 * Camada de abstração de fornecedores de criativos.
 * A UI nunca fala com Higgsfield/OpenAI diretamente — sempre com esta interface.
 * Trocar de fornecedor = registrar outro provider aqui.
 */
export type CreativeType = "static_image" | "video" | "carousel" | "ugc" | "story" | "quiz";

export type CreativeRequest = {
  prompt: string;
  type: CreativeType;
  aspectRatio: string;
  brandContext?: string;
};

export type CreativeResult = {
  previewUrl: string;
  provider: string;
  estimatedCost: number;
  realCost: number;
  status: "ready" | "generating" | "failed";
};

export interface CreativeProvider {
  id: string;
  label: string;
  /** true quando o provider é simulado (sandbox/mock) */
  sandbox: boolean;
  isConnected(): boolean;
  generate(req: CreativeRequest): Promise<CreativeResult>;
}

const COST_TABLE: Record<CreativeType, number> = {
  static_image: 1.2,
  video: 4.5,
  carousel: 2.0,
  ugc: 4.5,
  story: 0.9,
  quiz: 1.5,
};

function placeholder(req: CreativeRequest) {
  const seed = encodeURIComponent(req.prompt.slice(0, 40) || req.type);
  const [w, h] = req.aspectRatio === "9:16" ? [720, 1280] : req.aspectRatio === "4:5" ? [1080, 1350] : [1080, 1080];
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

export const mockCreativeProvider: CreativeProvider = {
  id: "mock",
  label: "Gerador simulado (sandbox)",
  sandbox: true,
  isConnected: () => true,
  async generate(req) {
    await new Promise((r) => setTimeout(r, 900));
    const cost = COST_TABLE[req.type] ?? 1;
    return {
      previewUrl: placeholder(req),
      provider: "mock",
      estimatedCost: cost,
      realCost: cost,
      status: "ready",
    };
  },
};

/**
 * Higgsfield: contrato pronto. A chamada real acontece no backend
 * (nunca no frontend, para não expor credenciais). Enquanto a integração
 * estiver desconectada, o app cai automaticamente no provider simulado.
 */
export const higgsfieldProvider: CreativeProvider = {
  id: "higgsfield",
  label: "Higgsfield",
  sandbox: false,
  isConnected: () => false,
  async generate() {
    throw new Error(
      "Higgsfield não está conectado. Conecte em Integrações para gerar criativos reais.",
    );
  },
};

export const creativeProviders: CreativeProvider[] = [mockCreativeProvider, higgsfieldProvider];

export function resolveCreativeProvider(preferredId?: string | null): CreativeProvider {
  const found = creativeProviders.find((p) => p.id === preferredId);
  if (found && found.isConnected()) return found;
  return mockCreativeProvider;
}
