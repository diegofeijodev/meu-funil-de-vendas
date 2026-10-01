import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { MetaSyncButton } from "@/components/meta-sync-button";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section, StatCard } from "@/components/ui-bits";
import { brl, num, shortDate } from "@/lib/format";
import { computeKpis, groupByDay, type PerformanceRow } from "@/lib/metrics";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({
    meta: [
      { title: "Performance e ROI · Meu Funil" },
      { name: "description", content: "CPM, CTR, CPC, CPL, CAC, ROAS e ROI real por campanha, criativo e público." },
      { property: "og:title", content: "Performance e ROI · Meu Funil" },
      { property: "og:description", content: "Do gasto em mídia ao lucro, com custos extras incluídos." },
    ],
  }),
  component: Performance,
});

function Performance() {
  const { workspaceId } = useWorkspace();
  const [campaignId, setCampaignId] = useState("all");
  const [days, setDays] = useState(30);

  const { data } = useQuery({
    queryKey: ["performance", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [perf, campaigns, creatives, costs] = await Promise.all([
        supabase.from("performance_daily").select("*").eq("workspace_id", workspaceId!).neq("source", "demo").order("date"),
        supabase.from("campaigns").select("id, name, max_cac").eq("workspace_id", workspaceId!),
        supabase.from("creatives").select("id, title, type").eq("workspace_id", workspaceId!),
        supabase.from("campaign_costs").select("*").eq("workspace_id", workspaceId!),
      ]);
      return {
        perf: (perf.data ?? []) as unknown as PerformanceRow[],
        campaigns: campaigns.data ?? [],
        creatives: creatives.data ?? [],
        costs: costs.data ?? [],
      };
    },
  });

  if (!data) return <div className="panel h-64 animate-pulse" />;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows = data.perf.filter(
    (r) => (campaignId === "all" || r.campaign_id === campaignId) && new Date(r.date) >= cutoff,
  );
  const extra = data.costs
    .filter((c) => campaignId === "all" || c.campaign_id === campaignId)
    .reduce((s, c) => s + Number(c.amount), 0);
  const k = computeKpis(rows, extra);
  const daily = groupByDay(rows);

  const byCampaign = data.campaigns.map((c) => {
    const kk = computeKpis(data.perf.filter((r) => r.campaign_id === c.id));
    return { name: c.name, spend: kk.spend, revenue: kk.revenue, roas: kk.roas, leads: kk.leads, cpl: kk.cpl };
  });

  const byCreative = data.creatives
    .map((cr) => {
      const kk = computeKpis(rows.filter((r) => r.creative_id === cr.id));
      return { ...cr, ...kk };
    })
    .filter((x) => x.spend > 0)
    .sort((a, b) => a.cpl - b.cpl);

  const byAdset = Object.entries(
    rows.reduce<Record<string, PerformanceRow[]>>((acc, r) => {
      const key = r.adset_name ?? "Sem conjunto";
      (acc[key] ??= []).push(r);
      return acc;
    }, {}),
  ).map(([name, rs]) => ({ name, ...computeKpis(rs) }));

  return (
    <>
      <PageHeader
        title="Performance e ROI"
        subtitle="Números reais do banco, com custos extras somados ao investimento em mídia."
        actions={
          <>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            >
              <option value="all">Todas as campanhas</option>
              {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[7, 14, 30, 90].map((d) => <option key={d} value={d}>Últimos {d} dias</option>)}
            </select>
            <MetaSyncButton invalidate={["performance", workspaceId]} />
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Investimento" value={brl(k.spend)} hint={`+ ${brl(extra)} extras`} />
        <StatCard label="Receita" value={brl(k.revenue)} tone="positive" />
        <StatCard label="ROAS" value={`${num(k.roas, 2)}x`} tone={k.roas >= 3 ? "positive" : "negative"} />
        <StatCard label="ROI" value={`${num(k.roi, 1)}%`} tone={k.roi >= 0 ? "positive" : "negative"} />
        <StatCard label="CPL" value={brl(k.cpl)} hint={`${num(k.leads)} leads`} tone="accent" />
        <StatCard label="CAC" value={brl(k.cpa)} hint={`${num(k.conversions)} vendas`} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="CPM" value={brl(k.cpm)} />
        <StatCard label="CTR" value={`${num(k.ctr, 2)}%`} />
        <StatCard label="CPC" value={brl(k.cpc)} />
        <StatCard label="Alcance" value={num(k.reach)} hint={`${num(k.impressions)} impressões`} />
      </div>

      <div className="space-y-6">
        <Section title="Evolução diária">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="r" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tickFormatter={(v: string) => shortDate(v)} stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }}
                  formatter={(v: number) => brl(v)}
                  labelFormatter={(v: string) => shortDate(v)}
                />
                <Legend />
                <Area type="monotone" dataKey="spend" name="Investimento" stroke="var(--color-primary)" fill="url(#s)" />
                <Area type="monotone" dataKey="revenue" name="Receita" stroke="var(--color-accent)" fill="url(#r)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="ROAS por campanha">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCampaign}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={10} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                  <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                  <Bar dataKey="roas" name="ROAS" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <Section title="Ranking de criativos (menor CPL primeiro)">
            <div className="space-y-2">
              {byCreative.slice(0, 8).map((c, i) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
                  <span className="text-xs text-muted-foreground">#{i + 1}</span>
                  <span className="flex-1 truncate">{c.title}</span>
                  <span className="tabular-nums">{brl(c.cpl)}</span>
                  <span className="text-xs text-muted-foreground">{num(c.leads)} leads</span>
                </div>
              ))}
              {byCreative.length === 0 && <p className="text-sm text-muted-foreground">Sem dados no período.</p>}
            </div>
          </Section>
        </div>

        <Section title="Por conjunto de anúncios / público">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2">Conjunto</th>
                  <th className="py-2 text-right">Investido</th>
                  <th className="py-2 text-right">Leads</th>
                  <th className="py-2 text-right">CPL</th>
                  <th className="py-2 text-right">CTR</th>
                  <th className="py-2 text-right">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {byAdset.map((a) => (
                  <tr key={a.name} className="border-b border-border/50 last:border-0">
                    <td className="py-2">{a.name}</td>
                    <td className="py-2 text-right tabular-nums">{brl(a.spend)}</td>
                    <td className="py-2 text-right tabular-nums">{num(a.leads)}</td>
                    <td className="py-2 text-right tabular-nums">{brl(a.cpl)}</td>
                    <td className="py-2 text-right tabular-nums">{num(a.ctr, 2)}%</td>
                    <td className="py-2 text-right tabular-nums">{num(a.roas, 2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Custos extras considerados no ROI">
          <div className="space-y-2 text-sm">
            {data.costs.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                <span>{c.description ?? c.kind}</span>
                <span className="tabular-nums">{brl(c.amount)}</span>
              </div>
            ))}
            {data.costs.length === 0 && <p className="text-muted-foreground">Nenhum custo extra registrado.</p>}
          </div>
        </Section>
      </div>
    </>
  );
}
