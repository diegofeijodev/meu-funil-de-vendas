import { serverFnPost } from "@/lib/server-fn";

export type GenerateCopyInput = {
  workspaceId: string;
  engine?: "auto" | "chatgpt" | "gemini";
  brand: Record<string, unknown>;
  brief: Record<string, unknown>;
  seed?: number;
  campaignId?: string | null;
  angle?: string | null;
};

/** `POST /v1/copy-ai/generate-copy-with-ai` — copy com IA real (chave própria OpenAI/Gemini ou créditos do app). */
export const generateCopyWithAI = serverFnPost<GenerateCopyInput, { content: Record<string, unknown>; engine: string }>(
  "/v1/copy-ai/generate-copy-with-ai",
);
