export type AiVendor = 'openai' | 'gemini';

export interface AiImageInput {
  bytes: Uint8Array;
  mime: string;
}

export type JsonSchema = Record<string, unknown>;

export interface AiJsonRequest {
  prompt: string;
  schema: JsonSchema;
  /** Nome do schema (json_schema.name). */
  name: string;
  /** Imagens anexadas (visão). */
  images?: AiImageInput[];
  /** Id de modelo do protótipo (ex.: `openai/gpt-6-astra`); passa pelo mapa AI_MODEL_*. */
  model?: string;
}

export interface AiTextRequest {
  prompt: string;
  system?: string;
  model?: string;
}

export interface AiImageRequest {
  prompt: string;
  /** 1:1 | 4:5 | 9:16 | 16:9 */
  aspectRatio: string;
  referenceImages?: AiImageInput[];
  /** Qual provedor gera: ChatGPT (OpenAI) ou Gemini. */
  vendor: AiVendor;
  /** `strict` = não cai para o gateway do app quando a chave própria falha. */
  strict?: boolean;
  /** Ignora a chave própria do workspace e usa direto o gateway do app ("Créditos de IA do app"). */
  appOnly?: boolean;
}

export interface AiImageResult {
  bytes: Buffer;
  mime: string;
  ext: string;
  /** Custo estimado para o app (0 quando é a chave do cliente). */
  cost: number;
  note: string | null;
}

export interface AiVideoRequest {
  prompt: string;
  aspectRatio: string;
  referenceImages?: AiImageInput[];
  maxWaitMs?: number;
  strict?: boolean;
  /** Ignora a chave própria do workspace e usa direto o gateway do app. */
  appOnly?: boolean;
}

export type AiVideoResult =
  | { status: 'ready'; bytes: Buffer; mime: string; jobId: string | null; cost: number; note: string | null }
  | { status: 'pending'; jobId: string; cost: number; note: string | null };

/** Porta HTTP: no teste entra um fake (nenhuma chamada de rede). */
export type AiFetch = (url: string, init?: RequestInit) => Promise<Response>;
export const AI_FETCH = Symbol('AI_FETCH');

/** Fetch com DNS verificado/fixado (anti-SSRF) para baixar URLs devolvidas por provedores. */
export const AI_GUARDED_FETCH = Symbol('AI_GUARDED_FETCH');
