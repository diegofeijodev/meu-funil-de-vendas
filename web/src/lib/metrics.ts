import { safeDiv } from "./format";

export type PerformanceRow = {
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  conversions: number;
  revenue: number;
  creative_id?: string | null;
  adset_name?: string | null;
  campaign_id?: string;
};

export type Kpis = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  conversions: number;
  revenue: number;
  cpm: number;
  ctr: number;
  cpc: number;
  cpl: number;
  cpa: number;
  roas: number;
  roi: number;
  totalCost: number;
};

/**
 * ROAS = receita atribuída / investimento em mídia
 * ROI  = (receita - custo total) / custo total * 100
 * Custo total = mídia + custos de IA/criativos + outros custos registrados
 */
export function computeKpis(rows: PerformanceRow[], extraCosts = 0): Kpis {
  const acc = rows.reduce(
    (a, r) => ({
      spend: a.spend + Number(r.spend ?? 0),
      impressions: a.impressions + Number(r.impressions ?? 0),
      reach: a.reach + Number(r.reach ?? 0),
      clicks: a.clicks + Number(r.clicks ?? 0),
      leads: a.leads + Number(r.leads ?? 0),
      conversions: a.conversions + Number(r.conversions ?? 0),
      revenue: a.revenue + Number(r.revenue ?? 0),
    }),
    { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, conversions: 0, revenue: 0 },
  );

  const totalCost = acc.spend + extraCosts;

  return {
    ...acc,
    cpm: safeDiv(acc.spend, acc.impressions) * 1000,
    ctr: safeDiv(acc.clicks, acc.impressions) * 100,
    cpc: safeDiv(acc.spend, acc.clicks),
    cpl: safeDiv(acc.spend, acc.leads),
    cpa: safeDiv(acc.spend, acc.conversions),
    roas: safeDiv(acc.revenue, acc.spend),
    roi: totalCost === 0 ? 0 : ((acc.revenue - totalCost) / totalCost) * 100,
    totalCost,
  };
}

export function groupByDay(rows: PerformanceRow[]) {
  const map = new Map<string, PerformanceRow>();
  for (const r of rows) {
    const cur = map.get(r.date);
    if (!cur) {
      map.set(r.date, { ...r });
    } else {
      cur.spend += Number(r.spend);
      cur.impressions += Number(r.impressions);
      cur.reach += Number(r.reach);
      cur.clicks += Number(r.clicks);
      cur.leads += Number(r.leads);
      cur.conversions += Number(r.conversions);
      cur.revenue += Number(r.revenue);
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function groupBy<T extends PerformanceRow>(rows: T[], key: (r: T) => string) {
  const map = new Map<string, PerformanceRow & { key: string }>();
  for (const r of rows) {
    const k = key(r);
    const cur = map.get(k);
    if (!cur) {
      map.set(k, { ...r, key: k });
    } else {
      cur.spend += Number(r.spend);
      cur.impressions += Number(r.impressions);
      cur.reach += Number(r.reach);
      cur.clicks += Number(r.clicks);
      cur.leads += Number(r.leads);
      cur.conversions += Number(r.conversions);
      cur.revenue += Number(r.revenue);
    }
  }
  return [...map.values()];
}
