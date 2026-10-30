import type { Prisma } from '@prisma/client';

type Campaign = Prisma.campaignsGetPayload<object>;
type Brand = Prisma.brandsGetPayload<object>;

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const day = (v: Date | string | null | undefined): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/**
 * Marca e briefing da copy no MESMO formato que o web manda no `finish()` da campanha nova (`BrandContext`/`CampaignBrief` de
 * `web/src/lib/ai/agents.ts`): o piloto gera a copy no servidor e precisa do mesmo contexto. Sem `brand_id` e sem o texto bruto do pedido.
 */
export function buildCopyBrief(campaign: Campaign, brand: Brand | null): { brand: Record<string, unknown>; brief: Record<string, unknown> } {
  return {
    brand: brand
      ? {
          name: brand.name, description: brand.description, segment: brand.segment, differentials: brand.differentials, target_audience: brand.target_audience,
          competitors: brand.competitors, tone_of_voice: brand.tone_of_voice, preferred_words: brand.preferred_words, banned_words: brand.banned_words, region: brand.region,
        }
      : {},
    brief: {
      name: campaign.name, objective: campaign.objective, offer_product: campaign.offer_product, offer_price: num(campaign.offer_price),
      offer_promise: campaign.offer_promise, landing_url: campaign.landing_url, start_date: day(campaign.start_date), end_date: day(campaign.end_date),
      audience: campaign.audience ?? {}, budget_total: num(campaign.budget_total), budget_daily: num(campaign.budget_daily), goal_leads: num(campaign.goal_leads),
      goal_sales: num(campaign.goal_sales), avg_ticket: num(campaign.avg_ticket),
    },
  };
}
