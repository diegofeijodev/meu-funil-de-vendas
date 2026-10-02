"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { Link } from "@/lib/router";
import { CheckCircle2, Circle, AlertTriangle, MinusCircle, ChevronDown } from "lucide-react";
import { Section } from "@/components/ui-bits";
import { Progress } from "@/components/ui/progress";
import { useWorkspace } from "@/lib/workspace";
import { setupStatus, type SetupItem } from "@/lib/setup.functions";

const ICON = {
  ok: <CheckCircle2 className="size-4 text-success" />,
  pending: <Circle className="size-4 text-muted-foreground" />,
  error: <AlertTriangle className="size-4 text-destructive" />,
  optional: <MinusCircle className="size-4 text-muted-foreground/60" />,
};

/** 8.3 Onboarding e 8.4 "o que falta configurar": cada item com o motivo e o botão para resolver. */
export function SetupChecklist({ compact = false }: { compact?: boolean }) {
  const { workspaceId } = useWorkspace();
  const run = useServerFn(setupStatus);
  const { data } = useQuery({
    queryKey: ["setup-status", workspaceId],
    enabled: !!workspaceId,
    staleTime: 60_000,
    queryFn: () => run({ data: { workspaceId: workspaceId! } }),
  });
  const items = data?.items ?? [];
  const required = items.filter((i) => i.required);
  const done = required.filter((i) => i.status === "ok").length;
  const problems = items.filter((i) => i.status === "error").length;
  const complete = required.length > 0 && done === required.length && !problems;
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? !complete;
  if (!data) return null;
  if (compact && complete) return null;
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <Section
      title={complete ? "Empresa configurada" : "Configure sua agência"}
      description={`${done} de ${required.length} passos essenciais concluídos${problems ? ` · ${problems} item(ns) com erro` : ""}.`}
      actions={
        <button type="button" className="flex items-center gap-1 text-sm text-primary" onClick={() => setOpen(!expanded)}>
          {expanded ? "Recolher" : "Ver tudo"}
          <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      }
    >
      <Progress value={required.length ? (done / required.length) * 100 : 0} className="mb-4 h-2" />
      {expanded && (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">{g}</p>
              <div className="space-y-1.5">
                {items
                  .filter((i) => i.group === g)
                  .map((i: SetupItem) => (
                    <div key={i.key} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5">{ICON[i.status]}</span>
                        <div>
                          <p className="font-medium">
                            {i.label} {!i.required && <span className="text-xs font-normal text-muted-foreground">(opcional)</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">{i.detail}</p>
                        </div>
                      </div>
                      {i.status !== "ok" && (
                        <Link to={i.link as never} className="text-xs font-medium text-primary underline">
                          Resolver
                        </Link>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
