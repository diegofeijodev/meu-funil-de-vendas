import { AiImageInput } from '../ai/ai.types';

export type CreativeKind = 'image' | 'video';
export type ProviderChoice = 'auto' | 'higgsfield' | 'chatgpt' | 'gemini';
export const PROVIDER_CHOICES: ProviderChoice[] = ['auto', 'higgsfield', 'chatgpt', 'gemini'];
export const VIDEO_TYPES = new Set(['video', 'ugc', 'reels', 'story']);

export type GenerationRequest = {
  finalPrompt: string;
  aspectRatio: string;
  kind: CreativeKind;
  brandContext?: Record<string, unknown>;
  /** Fotos reais da marca (produto/ambiente) para o modelo seguir. */
  referenceImages?: AiImageInput[];
  /** Mesmas referências como links (provedores que só aceitam URL). */
  referenceUrls?: string[];
  /** Quanto esperar na própria requisição; depois disso devolve "generating" e o poller conclui. */
  maxWaitMs?: number;
};

export type GenerationResult = {
  status: 'ready' | 'generating' | 'failed';
  /** URL remota do arquivo (Higgsfield). Provedores de IA devolvem `bytes`. */
  assetUrl: string | null;
  bytes?: Buffer | null;
  mime?: string | null;
  thumbnailUrl: string | null;
  externalJobId: string | null;
  raw?: string | null;
  cost: number;
  /** Caminho usado (vai para o log do job). */
  note?: string | null;
};

/** Contrato dos provedores. O Studio nunca fala com um provedor direto — sempre por aqui. */
export interface ServerCreativeProvider {
  id: string;
  label: string;
  sandbox: boolean;
  generateImage(req: GenerationRequest): Promise<GenerationResult>;
  generateVideo(req: GenerationRequest): Promise<GenerationResult>;
  getGenerationStatus(externalJobId: string): Promise<GenerationResult>;
  getAsset(externalJobId: string): Promise<string | null>;
}

/** Custos internos (unidades do protótipo): Higgsfield imagem 1.2 / vídeo 4.5. */
export const CREATIVE_COSTS: Record<CreativeKind, number> = { image: 1.2, video: 4.5 };

export const choiceForProvider = (id: string | null | undefined): ProviderChoice =>
  id === 'higgsfield' || id === 'chatgpt' || id === 'gemini' ? id : 'auto';
