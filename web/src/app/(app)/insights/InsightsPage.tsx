"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { fetchInsightsPage } from "@/modules/ads/infrastructure/ads.api";
import { useWorkspace } from "@/lib/workspace";
import { useServerFn } from "@/lib/server-fn";
import { decideAdsRecommendation, generateAdsRecommendations } from "@/lib/meta/ads-ops.functions";
import { PageHeader, Section, EmptyState, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { RECO_ACTIONS } from "@/lib/labels";
import { computeKpis } from "@/lib/metrics";
import { brl } from "@/lib/format";
import { HowTo } from "@/components/how-to";
import { GUIDES } from "@/lib/guides";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

export function InsightsPage() {
  const { workspaceId, canEdit, role } = useWorkspace();
  const canManage = role === "owner" || role === "admin";
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const runRecos = useServerFn(generateAdsRecommendations);
  const runDecide = useServerFn(decideAdsRecommendation);

  const { data } = useQuery({
    queryKey: ["insights", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => fetchInsightsPage(workspaceId!),
  });

  const runOptimizer = async () => {
    if (!workspaceId) return;
    setRunning(true);
    try {
      const r = await runRecos({ data: { workspaceId } });
      qc.invalidateQueries({ queryKey: ["insights", workspaceId] });
      if (r.errors.length) toast.warning(r.errors.join(" · "));
      if (r.created) toast.success(`${r.created} recomendações geradas com os resultados reais da Meta.`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível rodar o otimizador."));
    } finally {
      setRunning(false);
    }
  };

  const decide = async (id: string, decision: "apply" | "dismiss") => {
    setDeciding(id);
    try {
      const r = await runDecide({ data: { id, decision } });
      qc.invalidateQueries({ queryKey: ["insights", workspaceId] });
      toast.success(r.result);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível aplicar."));
    } finally {
      setDeciding(null);
    }
  };

  if (!data) return <div className="panel h-64 animate-pulse" />;

  const pending = data.recos.filter((r) => r.status === "pending");
  const history = data.recos.filter((r) => r.status !== "pending");

  return (
    <>
      <PageHeader
        title="AI Insights"
        subtitle="A IA lê os resultados reais da Meta e propõe ajustes. Pausar anúncio e mudar verba são executados na Meta quando o dono ou um admin clica em Aplicar."
        actions={
          canEdit && (
            <Button onClick={runOptimizer} disabled={running}>
              <Sparkles className="mr-2 size-4" />
              {running ? "Analisando..." : "Rodar AI Optimizer"}
            </Button>
          )
        }
      />
      <div className="mb-6">
        <HowTo title={GUIDES.insights.title} steps={GUIDES.insights.steps} references={GUIDES.insights.references ?? []} />
      </div>

      <div className="space-y-6">
        <Section title={`Recomendações pendentes (${pending.length})`}>
          {pending.length === 0 ? (
            <EmptyState title="Nenhuma recomendação pendente" description="Rode o AI Optimizer depois que as campanhas veicularem: ele usa os resultados reais sincronizados da Meta." />
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
                      <p className="mt-1 text-xs text-muted-foreground">
                        {(r.payload as { executable?: boolean } | null)?.executable
                          ? "Aplicar executa esta ação direto na Meta."
                          : "Ação manual: aplicar só registra a decisão."}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" disabled={deciding === r.id} onClick={() => decide(r.id, "dismiss")}>Descartar</Button>
                        <Button size="sm" disabled={deciding === r.id} onClick={() => decide(r.id, "apply")}>
                          {deciding === r.id ? "Aplicando..." : "Aplicar"}
                        </Button>
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
                  <div>
                    <span>{r.title}</span>
                    {r.result && <p className="text-xs text-muted-foreground">{r.result}</p>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{r.campaigns?.name}</span>
                    {r.source === "rule" && <span>Regra automática</span>}
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
