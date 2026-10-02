"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCadenceMetrics } from "@/modules/crm/infrastructure/crm.api";
import { Section } from "@/components/ui-bits";
import { CHANNEL_LABELS, type CadenceChannel, type CadenceStep } from "@/lib/crm/cadence-types";

type Props = { workspaceId: string | null };

/** Sent / delivered / read / replied / qualified / meetings / opt-outs per cadence and step. */
export function CadenceMetrics({ workspaceId }: Props) {
  const { data } = useQuery({
    queryKey: ["crm-cadence-metrics", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => getCadenceMetrics(workspaceId!),
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const statusById = new Map(data.messages.map((m) => [m.id, m.status]));
    const qualifiedStages = new Set(
      data.stages.filter((s) => (s.name as string).toLowerCase().startsWith("qualificado")).map((s) => s.id as string),
    );
    const meetingStages = new Set(
      data.stages.filter((s) => (s.name as string).toLowerCase().includes("agendada")).map((s) => s.id as string),
    );

    return data.cadences.map((cadence) => {
      const steps = (Array.isArray(cadence.steps) ? cadence.steps : []) as CadenceStep[];
      const cadenceEvents = data.events.filter((e) => e.cadence_id === cadence.id);
      const cadenceRuns = data.runs.filter((r) => r.cadence_id === cadence.id);
      const entryByLead = new Map(cadenceRuns.map((r) => [r.lead_id as string, r.entered_at as string]));

      const countStage = (set: Set<string>) =>
        new Set(
          data.history
            .filter((h) => {
              const entered = entryByLead.get(h.lead_id as string);
              return (
                entered &&
                set.has(h.to_stage_id as string) &&
                new Date(h.created_at as string).getTime() >= new Date(entered).getTime()
              );
            })
            .map((h) => h.lead_id as string),
        ).size;

      const stepRows = steps.map((step, index) => {
        const stepEvents = cadenceEvents.filter((e) => e.step_index === index);
        const sentEvents = stepEvents.filter((e) => e.event === "sent");
        const statuses = sentEvents.map((e) => statusById.get(e.message_id as string) ?? "sent");
        const sent = sentEvents.length + stepEvents.filter((e) => e.event === "task").length;
        const delivered = statuses.filter((s) => s === "delivered" || s === "read").length;
        const read = statuses.filter((s) => s === "read").length;
        const replied = stepEvents.filter((e) => e.event === "replied").length;
        return {
          index,
          channel: (step.channel ?? "wa_text") as CadenceChannel,
          sent,
          delivered,
          read,
          replied,
          optOut: stepEvents.filter((e) => e.event === "opt_out").length,
        };
      });

      const totals = stepRows.reduce(
        (acc, s) => ({
          sent: acc.sent + s.sent,
          delivered: acc.delivered + s.delivered,
          read: acc.read + s.read,
          replied: acc.replied + s.replied,
          optOut: acc.optOut + s.optOut,
        }),
        { sent: 0, delivered: 0, read: 0, replied: 0, optOut: 0 },
      );

      return {
        id: cadence.id as string,
        name: cadence.name as string,
        steps: stepRows,
        totals,
        qualified: countStage(qualifiedStages),
        meetings: countStage(meetingStages),
        active: cadenceRuns.filter((r) => r.status === "running").length,
      };
    });
  }, [data]);

  return (
    <Section
      title="Cadências"
      description="Envios, entregas, leituras e respostas por cadência e por passo."
    >
      {!rows.length && <p className="text-sm text-muted-foreground">Nenhuma cadência criada ainda.</p>}
      <div className="space-y-5">
        {rows.map((row) => {
          const rate = row.totals.sent ? Math.round((row.totals.replied / row.totals.sent) * 100) : 0;
          return (
            <div key={row.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{row.name}</h3>
                <span className="text-xs text-muted-foreground">{row.active} lead(s) em andamento</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
                <Cell label="Enviados" value={row.totals.sent} />
                <Cell label="Entregues" value={row.totals.delivered} />
                <Cell label="Lidos" value={row.totals.read} />
                <Cell label="Respondidos" value={row.totals.replied} />
                <Cell label="Taxa de resposta" value={`${rate}%`} />
                <Cell label="Qualificados" value={row.qualified} />
                <Cell label="Reuniões" value={row.meetings} />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="py-2">Passo</th>
                      <th className="py-2">Canal</th>
                      <th className="py-2">Enviados</th>
                      <th className="py-2">Entregues</th>
                      <th className="py-2">Lidos</th>
                      <th className="py-2">Respondidos</th>
                      <th className="py-2">Opt-outs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.steps.map((s) => (
                      <tr key={s.index} className="border-b border-border/50">
                        <td className="py-2">#{s.index + 1}</td>
                        <td className="py-2">{CHANNEL_LABELS[s.channel]}</td>
                        <td className="py-2 tabular-nums">{s.sent}</td>
                        <td className="py-2 tabular-nums">{s.delivered}</td>
                        <td className="py-2 tabular-nums">{s.read}</td>
                        <td className="py-2 tabular-nums">{s.replied}</td>
                        <td className="py-2 tabular-nums">{s.optOut}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Cell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
  );
}
