import { serverFnPost } from "@/lib/server-fn";

type Vendor = "openai" | "gemini";

/** `POST /v1/ai-keys/ai-keys-status` — quais chaves próprias existem (só `••••` + 4 últimos caracteres; qualquer membro). */
export const aiKeysStatus = serverFnPost<
  { workspaceId: string },
  { openai: { connected: boolean; hint: string | null }; gemini: { connected: boolean; hint: string | null } }
>("/v1/ai-keys/ai-keys-status");

/** `POST /v1/ai-keys/ai-keys-save` — testa no provedor e só então guarda no cofre (dono/admin). Recusa volta como `{ ok:false, error }`. */
export const aiKeysSave = serverFnPost<{ workspaceId: string; vendor: Vendor; apiKey: string }, { ok: boolean; error?: string | null }>(
  "/v1/ai-keys/ai-keys-save",
);

/** `POST /v1/ai-keys/ai-keys-test` */
export const aiKeysTest = serverFnPost<{ workspaceId: string; vendor: Vendor }, { ok: boolean; error?: string }>("/v1/ai-keys/ai-keys-test");

/** `POST /v1/ai-keys/ai-keys-remove` (dono/admin) */
export const aiKeysRemove = serverFnPost<{ workspaceId: string; vendor: Vendor }, { ok: true }>("/v1/ai-keys/ai-keys-remove");

/** `POST /v1/ai-keys/ai-keys-health` — quais chaves próprias estão sem crédito (aviso no Studio). */
export const aiKeysHealth = serverFnPost<{ workspaceId: string }, { outOfCredit: { vendor: Vendor; error: string }[] }>(
  "/v1/ai-keys/ai-keys-health",
);
