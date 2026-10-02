import { serverFnPost } from "@/lib/server-fn";

/**
 * `POST /v1/meta/sync-ads-insights-now` — puxa os resultados da Meta na hora.
 * A rota nasce na tarefa de Meta Ads (até lá o botão "Atualizar da Meta" mostra o erro da API).
 */
export const syncAdsInsightsNow = serverFnPost<{ workspaceId: string }, { rows: number; campaigns: number }>("/v1/meta/sync-ads-insights-now");

/** `POST /v1/meta/generate-ads-recommendations` — a IA analisa os resultados e cria recomendações. A rota nasce na tarefa de Meta. */
export const generateAdsRecommendations = serverFnPost<{ workspaceId: string; campaignId?: string }, { created: number; errors: string[] }>(
  "/v1/meta/generate-ads-recommendations",
);
