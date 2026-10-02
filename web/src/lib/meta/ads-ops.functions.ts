import { serverFnPost } from "@/lib/server-fn";

/** `POST /v1/meta/sync-ads-insights-now` — puxa os resultados da Meta (e do Google/TikTok) na hora. Qualquer membro. */
export const syncAdsInsightsNow = serverFnPost<{ workspaceId: string }, { rows: number; campaigns: number; message?: string }>("/v1/meta/sync-ads-insights-now");

/** `POST /v1/meta/generate-ads-recommendations` — a IA analisa os resultados e cria recomendações. Editores. */
export const generateAdsRecommendations = serverFnPost<{ workspaceId: string; campaignId?: string | null }, { created: number; errors: string[] }>(
  "/v1/meta/generate-ads-recommendations",
);

/** `POST /v1/meta/decide-ads-recommendation` — aplica (executa na Meta) ou descarta. Só dono/admin. */
export const decideAdsRecommendation = serverFnPost<{ id: string; decision: "apply" | "dismiss" }, { result: string }>(
  "/v1/meta/decide-ads-recommendation",
);

/** `POST /v1/meta/save-campaign-ads-settings` — configuração de anúncios (2.4–2.6) e regras automáticas (2.3). Editores. */
export const saveCampaignAdsSettings = serverFnPost<
  { campaignId: string; adsConfig: Record<string, unknown>; rules: Record<string, unknown>; privacyUrl?: string | null },
  { ok: true }
>("/v1/meta/save-campaign-ads-settings");

/** `POST /v1/meta/list-meta-audiences` — públicos personalizados da conta de anúncios. Qualquer membro. */
export const listMetaAudiences = serverFnPost<{ workspaceId: string }, { id: string; name: string; subtype: string; size: number | null }[]>(
  "/v1/meta/list-meta-audiences",
);

/** `POST /v1/meta/sync-crm-customer-audience` — cria/atualiza o público "Leads do CRM" (hash SHA-256) na Meta. Só dono/admin. */
export const syncCrmCustomerAudience = serverFnPost<{ workspaceId: string; onlyWon?: boolean }, { id: string; uploaded: number }>(
  "/v1/meta/sync-crm-customer-audience",
);
