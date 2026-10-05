import { serverFnPost } from "@/lib/server-fn";

/** `POST /v1/ai-diagnostics/diagnose-ai` — testa de verdade o gateway do app, as chaves próprias, o Canva e o Higgsfield. */
export const diagnoseAi = serverFnPost<
  { workspaceId: string; withImage?: boolean },
  { checks: { name: string; ok: boolean | null; detail: string }[]; at: string }
>("/v1/ai-diagnostics/diagnose-ai");
