import { serverFnPost } from "@/lib/server-fn";

/** `POST /v1/ads/<nome-em-kebab>` — Google Ads / TikTok Ads (as 7 de `ads/channels.functions.ts`). */
export type AdsChannel = "google" | "tiktok";
export type ChannelStep = { label: string; status: string; detail: string };

/** O que falta em cada canal (nomes dos itens ainda não configurados). Qualquer membro. */
export const adsChannelsStatus = serverFnPost<{ workspaceId: string }, { google: string[]; tiktok: string[] }>("/v1/ads/ads-channels-status");

/** Salva as credenciais do app do canal no cofre. Só dono/admin. */
export const saveAdsChannelApp = serverFnPost<{ workspaceId: string; channel: AdsChannel; values: Record<string, string> }, { ok: true }>(
  "/v1/ads/save-ads-channel-app",
);

/** `origin` é aceito mas o servidor ignora (o retorno do login é a API e depois `/integrations`). */
export const adsChannelLoginUrl = serverFnPost<{ workspaceId: string; channel: AdsChannel; origin: string }, { url: string }>("/v1/ads/ads-channel-login-url");

export const listAdsChannelAccounts = serverFnPost<{ workspaceId: string; channel: AdsChannel }, { id: string; name: string }[]>(
  "/v1/ads/list-ads-channel-accounts",
);

export const linkExternalCampaign = serverFnPost<{ campaignId: string; channel: AdsChannel; externalId: string }, { ok: true }>(
  "/v1/ads/link-external-campaign",
);

export const createExternalCampaign = serverFnPost<{ campaignId: string; channel: AdsChannel }, { campaignId: string; steps: ChannelStep[] } & Record<string, unknown>>(
  "/v1/ads/create-external-campaign",
);

export const setExternalCampaignStatus = serverFnPost<{ campaignId: string; channel: AdsChannel; active: boolean }, { ok: true }>(
  "/v1/ads/set-external-campaign-status",
);
