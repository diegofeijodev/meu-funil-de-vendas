import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { PageHeader, Section, EmptyState, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { RECO_ACTIONS } from "@/lib/labels";
import { computeKpis, type PerformanceRow } from "@/lib/metrics";
import { generateRecommendations } from "@/lib/ai/agents";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/insights")({
  head: () => ({
    meta: [
      { title: "AI Insights · AI Marketing OS" },
      { name: "description", content: "Recomendações do AI Optimizer com justificativa e impacto estimado." },
      { property: "og:title", content: "AI Insights · AI Marketing OS" },
      { property: "og:description", content: "Otimização contínua com aprovação humana." },
    ],
  }),
  component: Insights,
});

function Insights() {
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data } = useQuery({
    queryKey: ["insights", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [recos, campaigns, perf] = await Promise.all([
        supabase.from("ai_recommendations").select("*, campaigns(name)").eq("workspace_id", workspaceId!).order("created_at", { ascending: false }),
        supabase.from("campaigns").select("*").eq("workspace_id", workspaceId!),
        supabase.from("performance_daily").select("*").eq("workspace_id", workspaceId!),
      ]);
      return {
        recos: recos.data ?? [],
        campaigns: campaigns.data ?? [],
        perf: (perf.data ?? []) as unknown as PerformanceRow[],
      };
    },
  });

  const runOptimizer = async () => {
    if (!workspaceId || !data) return;
    setRunning(true);
    try {
      let created = 0;
      for (const c of data.campaigns) {
        const rows = data.perf.filter((p) => p.campaign_id === c.id);
        if (!rows.length) continue;
        const k = computeKpis(rows);
        const byCreative = new Map<string, { spend: number; leads: number }>();
        for (const r of rows) {
          if (!r.creative_id) continue;
          const cur = byCreative.get(r.creative_id) ?? { spend: 0, leads: 0 };
          cur.spend += Number(r.spend);
          cur.leads += Number(r.leads);
          byCreative.set(r.creative_id, cur);
        }
        const scored = [...byCreative.entries()].map(([id, v]) => ({ id, cpl: v.leads ? v.spend / v.leads : 9999 }));
        scored.sort((a, b) => a.cpl - b.cpl);
        const best = scored[0];
        const worst = scored[scored.length - 1];
        const recos = await generateRecommendations({
          campaignId: c.id,
          cpl: k.cpl,
          targetCpl: Number(c.max_cac ?? 60) * 0.55,
          ctr: k.ctr,
          roas: k.roas,
          spend: k.spend,
          bestCreative: best ? { id: best.id, title: "Criativo top", cpl: best.cpl } : null,
          worstCreative: worst && worst.id !== best?.id ? { id: worst.id, title: "Criativo mais caro", cpl: worst.cpl } : null,
        });
        for (const r of recos) {
          await supabase.from("ai_recommendations").insert({
            workspace_id: workspaceId,
            campaign_id: c.id,
            action: r.action,
            title: r.title,
            reason: r.reason,
            estimated_impact: r.estimated_impact,
            severity: r.severity,
            status: "pending",
            requires_approval: true,
          });
          created += 1;
        }
      }
      await logActivity(workspaceId, "optimizer.run", "recommendation", { created });
      qc.invalidateQueries({ queryKey: ["insights", workspaceId] });
      toast.success(`${created} recomendações geradas pelo AI Optimizer.`);
    } finally {
      setRunning(false);
    }
  };

  const decide = async (id: string, status: "applied" | "dismissed") => {
    await supabase.from("ai_recommendations").update({ status }).eq("id", id);
    if (workspaceId) await logActivity(workspaceId, `recommendation.${status}`, "recommendation", { id });
    qc.invalidateQueries({ queryKey: ["insights", workspaceId] });
    toast.success(status === "applied" ? "Recomendação aplicada (modo sandbox)." : "Recomendação descartada.");
  };

  if (!data) return <div className="panel h-64 animate-pulse" />;

  const pending = data.recos.filter((r) => r.status === "pending");
  const history = data.recos.filter((r) => r.status !== "pending");

  return (
    <>
      <PageHeader
        title="AI Insights"
        subtitle="O AI Optimizer lê a performance diária e propõe ajustes. Nenhuma mudança é aplicada sem aprovação humana."
        actions={
          canEdit && (
            <Button onClick={runOptimizer} disabled={running}>
              <Sparkles className="mr-2 size-4" />
              {running ? "Analisando..." : "Rodar AI Optimizer"}
            </Button>
          )
        }
      />

      <div className="space-y-6">
        <Section title={`Recomendações pendentes (${pending.length})`}>
          {pending.length === 0 ? (
            <EmptyState title="Tudo otimizado por enquanto" description="Rode o AI Optimizer para reavaliar as campanhas com os dados mais recentes." />
          ) : (
            <div className="space-y-3">
              {pending.map((r) => (
                <div key={r.id} className="rounded-lg border border-border bg-surface/50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={r.severity === "high" ? "pending" : "ready"} label={RECO_ACTIONS[r.action] ?? r.action} />
                        <span className="text-xs text-muted-foreground">{r.campaigns?.name}</span>
                      </div>
                      <p className="mt-2 font-medium">{r.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{r.reason}</p>
                      {r.estimated_impact && (
                        <p className="mt-1 text-sm text-success">Impacto estimado: {r.estimated_impact}</p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => decide(r.id, "dismissed")}>Descartar</Button>
                        <Button size="sm" onClick={() => decide(r.id, "applied")}>Aplicar</Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Histórico de decisões" description="Cada decisão vira aprendizado da marca no learning loop.">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma decisão registrada ainda.</p>
          ) : (
            <div className="space-y-2">
              {history.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-4 py-2.5 text-sm">
                  <span>{r.title}</span>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{r.campaigns?.name}</span>
                    <StatusPill status={r.status === "applied" ? "approved" : "paused"} label={r.status === "applied" ? "Aplicada" : "Descartada"} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Como o ROI é calculado">
          <p className="text-sm text-muted-foreground">
            ROAS = receita atribuída ÷ investimento em mídia. ROI = (receita − custo total) ÷ custo total, onde o custo total soma
            mídia + custos extras da campanha (produção, ferramentas, taxas). Total investido em mídia no workspace:{" "}
            <span className="text-foreground">{brl(computeKpis(data.perf).spend)}</span>.
          </p>
        </Section>
      </div>
    </>
  );
}
