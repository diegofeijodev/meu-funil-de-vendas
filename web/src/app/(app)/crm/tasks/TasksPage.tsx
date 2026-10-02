"use client";

import { Link } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listTasks, setTaskStatus } from "@/modules/crm/infrastructure/crm.api";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { fullDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function TasksPage() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();

  const { data: tasks = [] } = useQuery({
    queryKey: ["crm-tasks", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listTasks(workspaceId!),
  });

  const setStatus = async (id: string, status: string) => {
    await setTaskStatus(workspaceId!, id, status);
    qc.invalidateQueries({ queryKey: ["crm-tasks", workspaceId] });
  };

  const today = new Date().toDateString();
  const groups = [
    { key: "atrasadas", label: "Atrasadas", items: tasks.filter((t) => t.status === "open" && t.due_at && new Date(t.due_at) < new Date() && new Date(t.due_at).toDateString() !== today) },
    { key: "hoje", label: "Hoje", items: tasks.filter((t) => t.status === "open" && t.due_at && new Date(t.due_at).toDateString() === today) },
    { key: "proximas", label: "Próximas", items: tasks.filter((t) => t.status === "open" && (!t.due_at || new Date(t.due_at) > new Date()) && (!t.due_at || new Date(t.due_at).toDateString() !== today)) },
    { key: "concluidas", label: "Concluídas", items: tasks.filter((t) => t.status !== "open") },
  ];

  return (
    <div>
      <PageHeader title="Minhas tarefas" subtitle="Follow-ups e compromissos do dia." />
      <div className="grid gap-5 md:grid-cols-2">
        {groups.map((g) => (
          <Section key={g.key} title={`${g.label} (${g.items.length})`}>
            <div className="space-y-2">
              {g.items.map((t) => {
                const leadName = t.crm_leads?.name;
                return (
                  <div key={t.id} className={cn("flex items-center justify-between gap-3 rounded-lg border p-3 text-sm", g.key === "atrasadas" ? "border-destructive/50 bg-destructive/5" : "border-border")}>
                    <div>
                      <p>{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {leadName && t.lead_id ? (
                          <Link to="/crm/leads/$id" params={{ id: t.lead_id }} className="hover:text-primary">
                            {leadName}
                          </Link>
                        ) : (
                          "Sem lead"
                        )}{" "}
                        · {fullDate(t.due_at)}
                      </p>
                    </div>
                    {t.status === "open" ? (
                      <Button size="sm" variant="outline" onClick={() => setStatus(t.id, "done")}>
                        Concluir
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(t.id, "open")}>
                        Reabrir
                      </Button>
                    )}
                  </div>
                );
              })}
              {!g.items.length && <p className="text-sm text-muted-foreground">Nada por aqui.</p>}
            </div>
          </Section>
        ))}
      </div>
    </div>
  );
}
