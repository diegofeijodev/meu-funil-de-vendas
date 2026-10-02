import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";
import type { PerformanceRow } from "@/lib/metrics";

const num = z.coerce.number();
const str = z.string().nullish();

const perfRow = z
  .object({
    date: z.string(),
    spend: num,
    impressions: num,
    reach: num,
    clicks: num,
    leads: num,
    conversions: num,
    revenue: num,
    creative_id: str,
    adset_name: str,
    campaign_id: z.string(),
  })
  .passthrough();

const campaign = z.object({ id: z.string(), name: z.string(), max_cac: num.nullish() }).passthrough();
const creative = z.object({ id: z.string(), title: z.string(), type: z.string() }).passthrough();
const cost = z.object({ id: z.string(), campaign_id: z.string(), kind: z.string(), description: str, amount: num }).passthrough();
const recommendation = z
  .object({
    id: z.string(),
    campaign_id: str,
    action: z.string(),
    title: z.string(),
    reason: z.string(),
    estimated_impact: str,
    severity: z.string(),
    status: z.string(),
    source: z.string(),
    result: str,
    payload: z.unknown(),
    created_at: z.string(),
    // `campaigns(name)` do PostgREST: objeto (ou null) com o nome da campanha.
    campaigns: z.object({ name: z.string() }).passthrough().nullish(),
  })
  .passthrough();

export type PerformanceCampaign = z.infer<typeof campaign>;
export type PerformanceCreative = z.infer<typeof creative>;
export type CampaignCost = z.infer<typeof cost>;
export type AiRecommendation = z.infer<typeof recommendation>;

/** `performance_daily select *` eq workspace_id neq source 'demo' order date. */
export async function listPerformanceDaily(ws: string): Promise<PerformanceRow[]> {
  const { data } = await api.get(`/v1/workspaces/${ws}/performance-daily`);
  return z.array(perfRow).parse(data) as unknown as PerformanceRow[];
}

/** As quatro leituras de `["performance", ws]`: performance_daily, campaigns(id,name,max_cac), creatives(id,title,type), campaign_costs. */
export async function fetchPerformancePage(ws: string) {
  const [perf, campaigns, creatives, costs] = await Promise.all([
    listPerformanceDaily(ws),
    api.get(`/v1/workspaces/${ws}/campaigns`).then((r) => z.array(campaign).parse(r.data)),
    api.get(`/v1/workspaces/${ws}/creatives`).then((r) => z.array(creative).parse(r.data)),
    api.get(`/v1/workspaces/${ws}/campaign-costs`).then((r) => z.array(cost).parse(r.data)),
  ]);
  return { perf, campaigns, creatives, costs };
}

/** `ai_recommendations select *, campaigns(name)` eq workspace_id order created_at desc limit 200. */
export async function listAiRecommendations(ws: string): Promise<AiRecommendation[]> {
  const { data } = await api.get(`/v1/workspaces/${ws}/ai-recommendations`);
  return z.array(recommendation).parse(data);
}

/** As duas leituras de `["insights", ws]`. */
export async function fetchInsightsPage(ws: string) {
  const [recos, perf] = await Promise.all([listAiRecommendations(ws), listPerformanceDaily(ws)]);
  return { recos, perf };
}
