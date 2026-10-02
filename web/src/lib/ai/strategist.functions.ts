import { serverFnPost } from "@/lib/server-fn";
import type { FullStrategy } from "./strategy-types";

/** `POST /v1/ai/generate-campaign-strategy` — gera (ou regera) a estratégia com IA e salva uma nova versão em rascunho. */
export const generateCampaignStrategy = serverFnPost<{ campaignId: string }, { version: number; content: FullStrategy }>(
  "/v1/ai/generate-campaign-strategy",
);

/** `POST /v1/ai/approve-campaign-strategy` — aprova a versão: ela passa a orientar copy, criativos, vídeos e públicos. */
export const approveCampaignStrategy = serverFnPost<{ strategyId: string }, { ok: true }>("/v1/ai/approve-campaign-strategy");

/** `POST /v1/ai/create-ig-plan-from-strategy` — cria o plano de conteúdo do Instagram a partir da estratégia. */
export const createIgPlanFromStrategy = serverFnPost<{ campaignId: string }, { planId: string }>("/v1/ai/create-ig-plan-from-strategy");
