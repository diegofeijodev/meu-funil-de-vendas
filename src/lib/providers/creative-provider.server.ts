/**
 * Contrato de provedores de criativos no servidor.
 * O Creative Studio (UI) nunca fala com um provedor direto — sempre por aqui.
 * Adicionar um novo provedor = implementar esta interface e registrá-lo.
 */
export type CreativeKind = "image" | "video";

export type GenerationRequest = {
  finalPrompt: string;
  aspectRatio: string;
  kind: CreativeKind;
  brandContext?: Record<string, unknown>;
  /** Fotos reais da marca (produto/ambiente) para o modelo seguir. */
  referenceImages?: { bytes: Uint8Array; mime: string }[];
  /** Mesmas referências como links (provedores que só aceitam URL). */
  referenceUrls?: string[];
};

export type GenerationResult = {
  status: "ready" | "generating" | "failed";
  assetUrl: string | null;
  thumbnailUrl: string | null;
  externalJobId: string | null;
  raw?: string | null;
  cost: number;
};

export interface ServerCreativeProvider {
  id: string;
  label: string;
  sandbox: boolean;
  generateImage(req: GenerationRequest): Promise<GenerationResult>;
  generateVideo(req: GenerationRequest): Promise<GenerationResult>;
  getGenerationStatus(externalJobId: string): Promise<GenerationResult>;
  getAsset(externalJobId: string): Promise<string | null>;
}

const COSTS: Record<CreativeKind, number> = { image: 1.2, video: 4.5 };

/** Provedor simulado — usado enquanto nenhum provedor real estiver conectado. */
export const mockServerProvider: ServerCreativeProvider = {
  id: "mock",
  label: "Gerador simulado (sandbox)",
  sandbox: true,
  async generateImage(req) {
    return mockResult(req);
  },
  async generateVideo(req) {
    return mockResult(req);
  },
  async getGenerationStatus() {
    return { status: "ready", assetUrl: null, thumbnailUrl: null, externalJobId: null, cost: 0 };
  },
  async getAsset() {
    return null;
  },
};

function mockResult(req: GenerationRequest): GenerationResult {
  const seed = encodeURIComponent(req.finalPrompt.slice(0, 40) || "criativo");
  const [w, h] =
    req.aspectRatio === "9:16" ? [720, 1280] : req.aspectRatio === "4:5" ? [1080, 1350] : [1080, 1080];
  const url = `https://picsum.photos/seed/${seed}/${w}/${h}`;
  return {
    status: "ready",
    assetUrl: url,
    thumbnailUrl: url,
    externalJobId: null,
    cost: COSTS[req.kind],
  };
}

export const CREATIVE_COSTS = COSTS;
