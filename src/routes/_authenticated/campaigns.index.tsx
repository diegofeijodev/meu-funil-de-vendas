import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, EmptyState, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { CAMPAIGN_STATUS, OBJECTIVES } from "@/lib/labels";
import { brl, fullDate, num } from "@/lib/format";
import { computeKpis, type PerformanceRow } from "@/lib/metrics";

export const Route = createFileRoute("/_authenticated/campaigns/")({
  head: () => ({
    meta: [
      { title: "Campanhas · Meu Funil" },
      { name: "description", content: "Todas as campanhas do workspace, com verba, status e retorno." },
      { property: "og:title", content: "Campanhas · Meu Funil" },
      { property: "og:description", content: "Do briefing à publicação, com aprovação humana." },
    ],
  }),
  component: CampaignsList,
});

function CampaignsList() {
  const { workspaceId, canEdit } = useWorkspace();

  const { data, isLoading } = useQuery({
    queryKey: ["campaigns-list", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [campaigns, perf] = await Promise.all([
        supabase.from("campaigns").select("*, brands(name)").eq("workspace_id", workspaceId!).order("created_at", { ascending: false }),
        supabase.from("performance_daily").select("*").eq("workspace_id", workspaceId!),
      ]);
      return {
        campaigns: campaigns.data ?? [],
        perf: (perf.data ?? []) as unknown as PerformanceRow[],
      };
    },
  });

  if (isLoading || !data) return <div className="panel h-64 animate-pulse" />;

  return (
    <>
      <PageHeader
        title="Campanhas"
        subtitle="Briefing, estratégia, copies, criativos e publicação — tudo em um fluxo com aprovação humana."
        actions={canEdit && <Button asChild><Link to="/campaigns/new">Nova campanha</Link></Button>}
      />

      {data.campaigns.length === 0 ? (
        <EmptyState
          title="Nenhuma campanha ainda"
          description="Rode o wizard em 5 etapas e deixe o Agente Estrategista montar o plano completo."
          action={<Button asChild><Link to="/campaigns/new">Criar campanha</Link></Button>}
        />
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Campanha</th>
                  <th className="px-4 py-3">Objetivo</th>
                  <th className="px-4 py-3">Período</th>
                  <th className="px-4 py-3 text-right">Verba</th>
                  <th className="px-4 py-3 text-right">Investido</th>
                  <th className="px-4 py-3 text-right">Leads</th>
                  <th className="px-4 py-3 text-right">ROAS</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c) => {
                  const k = computeKpis(data.perf.filter((p) => p.campaign_id === c.id));
                  return (
                    <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-surface/50">
                      <td className="px-4 py-3">
                        <Link to="/campaigns/$id" params={{ id: c.id }} className="font-medium hover:text-primary">
                          {c.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{c.brands?.name}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{OBJECTIVES[c.objective] ?? c.objective}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {fullDate(c.start_date)} → {fullDate(c.end_date)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{brl(c.budget_total)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{brl(k.spend)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(k.leads)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(k.roas, 2)}x</td>
                      <td className="px-4 py-3">
                        <StatusPill status={c.status} label={CAMPAIGN_STATUS[c.status] ?? c.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
