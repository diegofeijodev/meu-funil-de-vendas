import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

const num = z.coerce.number();
const rec = z.object({ id: z.string() }).passthrough();

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
    creative_id: z.string().nullish(),
    adset_name: z.string().nullish(),
    campaign_id: z.string(),
  })
  .passthrough();

const campaign = z.object({ id: z.string(), name: z.string(), status: z.string() }).passthrough();
const reco = z
  .object({
    id: z.string(),
    title: z.string(),
    reason: z.string(),
    estimated_impact: z.string().nullish(),
    action: z.string(),
  })
  .passthrough();

const overviewSchema = z.object({
  performance_daily: z.array(perfRow),
  campaigns: z.array(campaign),
  campaign_costs: z.array(z.object({ amount: num })),
  ai_recommendations: z.array(reco),
  creatives: z.array(rec.extend({ title: z.string() })),
});

export type OverviewData = z.infer<typeof overviewSchema>;

/**
 * `GET /v1/workspaces/:ws/overview`: as cinco leituras da tela (performance_daily sem `demo`,
 * campaigns, campaign_costs(amount), recomendações pendentes por severidade, creatives(id,title)).
 */
export async function fetchOverview(workspaceId: string): Promise<OverviewData> {
  const { data } = await api.get(`/v1/workspaces/${workspaceId}/overview`);
  return overviewSchema.parse(data);
}
