import { serverFnPost } from "@/lib/server-fn";
import type { ArtDirection, TextLayout, Variation, VisualStyle } from "@/lib/creative/visual-style";

export type GenerateInput = {
  workspaceId: string;
  campaignId?: string | null;
  brandId?: string | null;
  title?: string;
  type?: string;
  aspectRatio?: string;
  targetFormat?: string | null;
  prompt?: string;
  copyText?: string;
  provider?: "auto" | "higgsfield" | "chatgpt" | "gemini";
  visualPrompt?: string | null;
  artDirection?: Record<string, unknown> | null;
  adjust?: string | null;
  layout?: TextLayout;
  variations?: number;
  headline?: string | null;
  price?: string | null;
  cta?: string | null;
  angle?: string | null;
  useBrandImage?: boolean;
  coverWithLogo?: boolean;
};

export type GenerationResult = {
  jobId: string;
  creativeId: string | null;
  status: "ready" | "generating" | "failed";
  assetUrl: string | null;
  provider: string;
  sandbox: boolean;
  error: string | null;
};

/** `POST /v1/creative/generate-creative` — erros do provedor voltam em `error` (status `failed`), não são lançados. */
export const generateCreative = serverFnPost<GenerateInput, GenerationResult & { artDirection: ArtDirection; variations: Variation[] }>("/v1/creative/generate-creative");

/** `POST /v1/creative/preview-visual-prompt` — o prompt visual do diretor de arte antes de gerar (editável na tela). */
export const previewVisualPrompt = serverFnPost<GenerateInput, { artDirection: ArtDirection }>("/v1/creative/preview-visual-prompt");

/** `POST /v1/creative/generate-brand-guide` — a IA analisa as fotos de referência e sugere o guia visual. */
export const generateBrandGuide = serverFnPost<{ brandId: string }, { guide: VisualStyle; referencias: string[] }>("/v1/creative/generate-brand-guide");

/** `POST /v1/creative/retry-creative-job` — reprocessa um job que falhou, mantendo o mesmo prompt final. */
export const retryCreativeJob = serverFnPost<{ jobId: string }, GenerationResult>("/v1/creative/retry-creative-job");

/** `POST /v1/creative/new-creative-version` — nova versão de um criativo existente. */
export const newCreativeVersion = serverFnPost<{ creativeId: string }, GenerationResult>("/v1/creative/new-creative-version");

/** `POST /v1/creative/capcut-package` — vídeo, legendas, capa e roteiro num .zip (link de 10 min). */
export const capcutPackage = serverFnPost<{ creativeId: string }, { url: string }>("/v1/creative/capcut-package");
