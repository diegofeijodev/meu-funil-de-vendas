import { serverFnPost } from "@/lib/server-fn";
import type { PublishStep } from "@/lib/providers/meta-provider";

/** `POST /v1/meta/meta-ads-*`, `meta-save-app`, `meta-login-url`, `meta-list-assets`, `meta-save-assets` (as 11 do protótipo). */

export const metaAdsSaveCredentials = serverFnPost<
  { workspaceId: string; appId: string; appSecret: string; systemUserToken: string; adAccountId: string; pageId: string; instagramId?: string | null },
  { ok: true; configured: boolean; missing: string[] }
>("/v1/meta/meta-ads-save-credentials");

/** Status leve: só diz se os segredos existem (sem chamar a Meta). */
export const metaAdsStatus = serverFnPost<
  { workspaceId: string },
  { configured: boolean; missing?: string[]; tokenExpiresAt?: string | null; tokenSource?: string }
>("/v1/meta/meta-ads-status");

export type MetaTestResult = {
  ok: boolean;
  missing: string[];
  user?: string;
  account?: { id: string; name: string; status: string; currency: string; timezone: string };
  page?: { id: string | null; name: string | null; error?: string };
  instagram?: { username: string | null; error?: string } | null;
  error: string | null;
};
export const metaAdsTest = serverFnPost<{ workspaceId: string }, MetaTestResult>("/v1/meta/meta-ads-test");

type MetaNode = { id: string; name: string; status: string; effective_status: string } & Record<string, unknown>;
export const metaAdsList = serverFnPost<{ workspaceId: string }, { campaigns: MetaNode[]; adsets: MetaNode[]; ads: MetaNode[] }>("/v1/meta/meta-ads-list");

export type MetaInsights = { spend: number; impressions: number; clicks: number; ctr: number; cpc: number; leads: number; cpl: number };
export const metaAdsInsights = serverFnPost<{ workspaceId: string; since: string; until: string; campaignId?: string | null }, MetaInsights>(
  "/v1/meta/meta-ads-insights",
);

export const metaAdsPublish = serverFnPost<{ workspaceId: string; campaignId: string }, { steps: PublishStep[] } & Record<string, unknown>>(
  "/v1/meta/meta-ads-publish",
);
export const metaAdsSetStatus = serverFnPost<{ workspaceId: string; campaignId: string; status: "ACTIVE" | "PAUSED" }, { ok: true }>(
  "/v1/meta/meta-ads-set-status",
);

export const metaSaveApp = serverFnPost<{ workspaceId: string; appId: string; appSecret: string }, { ok: true }>("/v1/meta/meta-save-app");
/** `origin` é aceito mas o servidor ignora: o retorno do login é a API (PUBLIC_URL) e depois `/integrations` (APP_URL). */
export const metaLoginUrl = serverFnPost<{ workspaceId: string; origin: string }, { url: string }>("/v1/meta/meta-login-url");
export const metaListAssets = serverFnPost<
  { workspaceId: string },
  { adAccounts: { id: string; name: string; active: boolean; currency: string | null }[]; pages: { id: string; name: string; instagramId: string | null; instagramUsername: string | null }[] }
>("/v1/meta/meta-list-assets");
export const metaSaveAssets = serverFnPost<{ workspaceId: string; adAccountId: string; pageId: string; instagramId?: string | null }, { ok: true }>(
  "/v1/meta/meta-save-assets",
);
