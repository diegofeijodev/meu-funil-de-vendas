"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listActivityLogs, listApprovals } from "@/modules/approvals/infrastructure/approvals.api";
import { useWorkspace } from "@/lib/workspace";
import { useServerFn } from "@/lib/server-fn";
import { decideApproval } from "@/lib/approvals.functions";
import { PageHeader, Section, EmptyState, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { shortDate } from "@/lib/format";
import { IgApprovalList } from "@/components/instagram/approvals";

const ENTITY: Record<string, string> = {
  campaign: "Campanha",
  creative: "Criativo",
  recommendation: "Recomendação",
  post: "Post",
};

export function Approvals() {
  const { workspaceId, role } = useWorkspace();
  const canDecide = role === "owner" || role === "admin";
  const runDecide = useServerFn(decideApproval);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["approvals", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [requests, logs] = await Promise.all([listApprovals(workspaceId!), listActivityLogs(workspaceId!, 30)]);
      return { requests, logs };
    },
  });

  const decide = async (id: string, status: "approved" | "rejected") => {
    try {
      await runDecide({ data: { approvalId: id, decision: status } });
      qc.invalidateQueries({ queryKey: ["approvals", workspaceId] });
      toast.success(status === "approved" ? "Aprovado. A ação foi liberada." : "Rejeitado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar a decisão.");
    }
  };

  if (!data) return <div className="panel h-64 animate-pulse" />;

  const pending = data.requests.filter((r) => r.status === "pending");
  const decided = data.requests.filter((r) => r.status !== "pending");

  return (
    <>
      <PageHeader
        title="Aprovações"
        subtitle="Toda publicação, criativo e recomendação passa por aqui antes de ir ao ar. Só o dono ou um administrador decide."
      />

      <div className="space-y-6">
        <Section title={`Pendentes (${pending.length})`}>
          {pending.length === 0 ? (
            <EmptyState title="Nada pendente" description="Assim que a IA ou o time solicitarem algo, aparece aqui." />
          ) : (
            <div className="space-y-3">
              {pending.map((r) => (
                <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface/50 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status="pending" label={ENTITY[r.entity_type] ?? r.entity_type} />
                      <span className="text-xs text-muted-foreground">{r.campaigns?.name}</span>
                      <span className="text-xs text-muted-foreground">{shortDate(r.created_at)}</span>
                    </div>
                    <p className="mt-2 font-medium">{r.title}</p>
                    {r.summary && <p className="mt-1 text-sm text-muted-foreground">{r.summary}</p>}
                  </div>
                  {canDecide && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => decide(r.id, "rejected")}>
                        Rejeitar
                      </Button>
                      <Button size="sm" onClick={() => decide(r.id, "approved")}>
                        Aprovar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {workspaceId && (
          <Section title="Instagram" description="Posts orgânicos aguardando aprovação.">
            <IgApprovalList workspaceId={workspaceId} canEdit={role !== "viewer"} />
          </Section>
        )}

        <Section title="Decisões recentes">
          {decided.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma decisão registrada.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {decided.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-4 py-2.5">
                  <span>{r.title}</span>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{shortDate(r.decided_at ?? r.created_at)}</span>
                    <StatusPill status={r.status} label={r.status === "approved" ? "Aprovado" : "Rejeitado"} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Audit log" description="Registro de tudo que aconteceu no workspace.">
          <div className="space-y-1.5 text-sm">
            {data.logs.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 border-b border-border/40 py-1.5 last:border-0">
                <span className="font-mono text-xs text-primary">{l.action}</span>
                <span className="flex-1 truncate text-xs text-muted-foreground">
                  {JSON.stringify(l.metadata)}
                </span>
                <span className="text-xs text-muted-foreground">{shortDate(l.created_at)}</span>
              </div>
            ))}
            {data.logs.length === 0 && <p className="text-muted-foreground">Sem registros ainda.</p>}
          </div>
        </Section>
      </div>
    </>
  );
}
