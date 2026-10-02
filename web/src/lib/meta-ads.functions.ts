import { serverFnPost } from "@/lib/server-fn";
import type { PublishStep } from "@/lib/providers/meta-provider";

/**
 * Rotas `POST /v1/meta/meta-ads-*` nascem na tarefa de Meta Ads; até lá a tela mostra o erro da API.
 */
export const metaAdsStatus = serverFnPost<{ workspaceId: string }, { configured: boolean; missing?: string[] }>("/v1/meta/meta-ads-status");
export const metaAdsPublish = serverFnPost<{ workspaceId: string; campaignId: string }, { steps: PublishStep[] }>("/v1/meta/meta-ads-publish");
export const metaAdsSetStatus = serverFnPost<{ workspaceId: string; campaignId: string; status: "ACTIVE" | "PAUSED" }, unknown>(
  "/v1/meta/meta-ads-set-status",
);
