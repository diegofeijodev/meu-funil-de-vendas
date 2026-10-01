import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MetaSyncButton } from "@/components/meta-sync-button";
import { SetupChecklist } from "@/components/setup-checklist";
import { useWorkspace } from "@/lib/workspace";
import { computeKpis, groupBy, groupByDay, type PerformanceRow } from "@/lib/metrics";
import { brl, num, pct, shortDate } from "@/lib/format";
import { PageHeader, StatCard, Section, StatusPill } from "@/components/ui-bits";
import { RECO_ACTIONS, CAMPAIGN_STATUS } from "@/lib/labels";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview · Meu Funil" },
      { name: "description", content: "Investimento, receita atribuída, ROAS, ROI e recomendações prioritárias do mês." },
      { property: "og:title", content: "Overview · Meu Funil" },
      { property: "og:description", content: "Painel geral de performance e insights de IA." },
    ],
  }),
  component: Overview,
});

function Overview() {
  const { workspaceId } = useWorkspace();

  const { data, isLoading } = useQuery({
    queryKey: ["overview", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [perf, campaigns, costs, recos, creatives] = await Promise.all([
        supabase.from("performance_daily").select("*").eq("workspace_id", workspaceId!).eq("source", "meta"),
        supabase.from("campaigns").select("*").eq("workspace_id", workspaceId!),
        supabase.from("campaign_costs").select("amount").eq("workspace_id", workspaceId!),
        supabase
          .from("ai_recommendations")
          .select("*")
          .eq("workspace_id", workspaceId!)
          .eq("status", "pending")
          .order("severity"),
        supabase.from("creatives").select("id, title").eq("workspace_id", workspaceId!),
      ]);
      return {
        perf: (perf.data ?? []) as unknown as PerformanceRow[],
        campaigns: campaigns.data ?? [],
        extraCosts: (costs.data ?? []).reduce((a, c) => a + Number(c.amount), 0),
        recos: recos.data ?? [],
        creatives: creatives.data ?? [],
      };
    },
  });

  if (isLoading || !data) return <LoadingBlock />;

  const kpis = computeKpis(data.perf, data.extraCosts);
  const daily = groupByDay(data.perf).map((d) => ({
    date: shortDate(d.date),
    Investimento: Number(d.spend.toFixed(2)),
    Receita: Number(d.revenue.toFixed(2)),
  }));

  const byCampaign = groupBy(data.perf, (r) => String(r.campaign_id));
  const bestCampaign = [...byCampaign].sort((a, b) => b.revenue / (b.spend || 1) - a.revenue / (a.spend || 1))[0];
  const bestCampaignName =
    data.campaigns.find((c) => c.id === bestCampaign?.key)?.name ?? "—";

  const byCreative = groupBy(
    data.perf.filter((r) => r.creative_id),
    (r) => String(r.creative_id),
  );
  const bestCreative = [...byCreative].sort((a, b) => a.spend / (a.leads || 1) - b.spend / (b.leads || 1))[0];
  const bestCreativeName = data.creatives.find((c) => c.id === bestCreative?.key)?.title ?? "—";

  const activeCampaigns = data.campaigns.filter((c) => c.status === "active").length;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Visão consolidada do workspace: investimento, retorno e as próximas decisões recomendadas pela IA."
        actions={
          <>
            <MetaSyncButton invalidate={["overview", workspaceId]} />
            <Button asChild>
              <Link to="/campaigns/new">Nova campanha</Link>
            </Button>
          </>
        }
      />

      <div className="mb-6">
        <SetupChecklist compact />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Investimento (período)" value={brl(kpis.spend)} hint={`Custo total ${brl(kpis.totalCost)} com IA e produção`} />
        <StatCard label="Receita atribuída" value={brl(kpis.revenue)} tone="positive" />
        <StatCard label="ROAS" value={`${num(kpis.roas, 2)}x`} tone={kpis.roas >= 3 ? "positive" : "negative"} hint="Receita / investimento em mídia" />
        <StatCard label="ROI" value={pct(kpis.roi)} tone={kpis.roi > 0 ? "positive" : "negative"} hint="(Receita - custo total) / custo total" />
        <StatCard label="Leads" value={num(kpis.leads)} hint={`CPL ${brl(kpis.cpl)}`} />
        <StatCard label="CAC médio" value={brl(kpis.cpa)} tone="accent" />
        <StatCard label="Campanhas ativas" value={num(activeCampaigns)} hint={`${data.campaigns.length} no total`} />
        <StatCard label="Melhor campanha" value={bestCampaignName} hint={bestCampaign ? `ROAS ${num(bestCampaign.revenue / (bestCampaign.spend || 1), 2)}x` : ""} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section title="Evolução diária" description="Investimento em mídia versus receita atribuída.">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Area type="monotone" dataKey="Receita" stroke="var(--color-chart-2)" fill="url(#g2)" strokeWidth={2} />
                  <Area type="monotone" dataKey="Investimento" stroke="var(--color-chart-1)" fill="url(#g1)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </div>

        <Section
          title="AI Insights"
          description="Recomendações prioritárias geradas a partir das métricas."
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/insights">
                Ver todas <ArrowUpRight className="ml-1 size-3.5" />
              </Link>
            </Button>
          }
        >
          <div className="space-y-3">
            {data.recos.slice(0, 5).map((r) => (
              <div key={r.id} className="rounded-lg border border-border bg-surface/60 p-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                    <p className="mt-1 text-xs text-accent">{r.estimated_impact}</p>
                    <span className="mt-2 inline-block text-[11px] uppercase tracking-wider text-muted-foreground">
                      {RECO_ACTIONS[r.action] ?? r.action}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {!data.recos.length && (
              <p className="text-sm text-muted-foreground">Nenhuma recomendação pendente.</p>
            )}
          </div>
        </Section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Section title="Melhor criativo" description="Menor custo por lead no período.">
          <p className="text-lg font-semibold">{bestCreativeName}</p>
          {bestCreative && (
            <p className="mt-1 text-sm text-muted-foreground">
              CPL {brl(bestCreative.spend / (bestCreative.leads || 1))} · {num(bestCreative.leads)} leads ·{" "}
              {num(bestCreative.clicks)} cliques
            </p>
          )}
        </Section>

        <Section title="Campanhas" description="Status atual do portfólio.">
          <div className="space-y-2">
            {data.campaigns.map((c) => (
              <Link
                key={c.id}
                to="/campaigns/$id"
                params={{ id: c.id }}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-surface"
              >
                <span className="truncate">{c.name}</span>
                <StatusPill status={c.status} label={CAMPAIGN_STATUS[c.status] ?? c.status} />
              </Link>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}

function LoadingBlock() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="panel h-28 animate-pulse" />
      ))}
    </div>
  );
}
