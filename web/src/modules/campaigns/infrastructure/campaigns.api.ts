import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";
import type { PerformanceRow } from "@/lib/metrics";

const num = z.coerce.number();
const str = z.string().nullish();

const brandInfo = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    description: str,
    segment: str,
    differentials: str,
    target_audience: str,
    competitors: str,
    tone_of_voice: str,
    preferred_words: z.array(z.string()).nullish(),
    banned_words: z.array(z.string()).nullish(),
    region: str,
  })
  .passthrough();
export type CampaignBrand = z.infer<typeof brandInfo>;

const campaign = z
  .object({
    id: z.string(),
    workspace_id: z.string(),
    brand_id: z.string(),
    name: z.string(),
    objective: z.string(),
    status: z.string(),
    start_date: str,
    end_date: str,
    budget_total: num.nullish(),
    budget_daily: num.nullish(),
    offer_product: str,
    offer_price: num.nullish(),
    offer_promise: str,
    landing_url: str,
    goal_leads: num.nullish(),
    goal_sales: num.nullish(),
    avg_ticket: num.nullish(),
    margin_percent: num.nullish(),
    max_cac: num.nullish(),
    formats: z.array(z.string()),
    audience: z.record(z.string(), z.unknown()).nullish(),
    meta_campaign_id: str,
    meta_delivery_status: str,
    last_insights_sync_at: str,
  })
  .passthrough();
export type Campaign = z.infer<typeof campaign>;

const campaignWithBrandName = campaign.extend({ brands: z.object({ name: z.string() }).passthrough().nullish() });
const campaignWithBrand = campaign.extend({ brands: brandInfo.nullish() });
export type CampaignListItem = z.infer<typeof campaignWithBrandName>;
export type CampaignWithBrand = z.infer<typeof campaignWithBrand>;

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
    meta_ad_id: str,
    ad_name: str,
  })
  .passthrough();

/** Linha de `campaign_strategies`/`copies`: o `content` jsonb é tipado pela tela (FullStrategy / CopyContent). */
const versioned = z
  .object({ id: z.string(), version: z.number(), status: z.string(), content: z.unknown() })
  .passthrough();
export type VersionedRow = z.infer<typeof versioned>;

const creative = z
  .object({
    id: z.string(),
    title: z.string(),
    type: z.string(),
    aspect_ratio: str,
    status: z.string(),
    preview_url: str,
    angle: str,
  })
  .passthrough();
export type CampaignCreative = z.infer<typeof creative>;

const detailSchema = z.object({
  campaign: campaignWithBrand,
  strategy: versioned.nullable(),
  copy: versioned.nullable(),
  creatives: z.array(creative),
  perf: z.array(perfRow),
  costs: z.array(z.object({ amount: num }).passthrough()),
});
export type CampaignDetailData = Omit<z.infer<typeof detailSchema>, "perf"> & { perf: PerformanceRow[] };

const base = (ws: string) => `/v1/workspaces/${ws}/campaigns`;

/** `campaigns select *, brands(name)` eq workspace_id order created_at desc. */
export async function listCampaigns(ws: string): Promise<CampaignListItem[]> {
  const { data } = await api.get(base(ws));
  return z.array(campaignWithBrandName).parse(data);
}

/** `performance_daily select *` eq workspace_id neq source 'demo'. */
export async function listCampaignPerformance(ws: string): Promise<PerformanceRow[]> {
  const { data } = await api.get(`${base(ws)}/performance`);
  return z.array(perfRow).parse(data) as unknown as PerformanceRow[];
}

/** As seis leituras de `["campaign", id]` (campanha+marca, estratégia, copy, criativos, performance, custos). */
export async function getCampaignDetail(ws: string, id: string): Promise<CampaignDetailData> {
  const { data } = await api.get(`${base(ws)}/${id}/detail`);
  return detailSchema.parse(data) as unknown as CampaignDetailData;
}

export type NewCampaignInput = {
  brand_id: string;
  name: string;
  objective: string;
  offer_product: string;
  offer_price: number | null;
  offer_promise: string;
  landing_url: string;
  start_date: string | null;
  end_date: string | null;
  audience: Record<string, string>;
  budget_total: number | null;
  budget_daily: number | null;
  goal_leads: number | null;
  goal_sales: number | null;
  avg_ticket: number | null;
  margin_percent: number | null;
  max_cac: number | null;
  formats: string[];
};

/** INSERT em `campaigns` (sempre rascunho; atividade `campaign.created` gravada pela API). */
export async function createCampaign(ws: string, input: NewCampaignInput): Promise<Campaign> {
  const { data } = await api.post(base(ws), input);
  return campaign.parse(data);
}

/** INSERT em `copies` (versão = anterior + 1; atividade `campaign.copy_generated` gravada pela API). */
export async function createCopy(ws: string, campaignId: string, content: unknown): Promise<void> {
  await api.post(`${base(ws)}/${campaignId}/copies`, { content });
}

/** "Solicitar aprovação": pedido pendente + campanha em `pending_approval` + atividade (tudo na API). */
export async function requestCampaignApproval(ws: string, campaignId: string): Promise<void> {
  await api.post(`${base(ws)}/${campaignId}/request-approval`, {});
}
