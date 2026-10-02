import { serverFnPost } from "@/lib/server-fn";

/** `POST /v1/ai-keys/ai-keys-health` — quais chaves próprias estão sem crédito (aviso no Studio). As demais ações de chaves ficam em Integrações. */
export const aiKeysHealth = serverFnPost<{ workspaceId: string }, { outOfCredit: { vendor: "openai" | "gemini"; error: string }[] }>(
  "/v1/ai-keys/ai-keys-health",
);
