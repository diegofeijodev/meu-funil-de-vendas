import { serverFnPost } from "@/lib/server-fn";

/** `status`: `optional` = não conectado; `skip` = não usado nesta instalação (ex.: servidor sem IA própria). `ok` fica por compatibilidade. */
export type DiagnosticCheck = { name: string; ok: boolean | null; status?: "ok" | "fail" | "optional" | "skip"; detail: string };

/** `POST /v1/ai-diagnostics/diagnose-ai` — testa de verdade o gateway do app, as chaves próprias, o Canva e o Higgsfield. */
export const diagnoseAi = serverFnPost<
  { workspaceId: string; withImage?: boolean },
  { checks: DiagnosticCheck[]; at: string }
>("/v1/ai-diagnostics/diagnose-ai");
