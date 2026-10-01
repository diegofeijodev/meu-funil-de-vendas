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
  /** Caminho usado (vai para o log do job). */
  note?: string | null;
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

export const CREATIVE_COSTS = COSTS;
