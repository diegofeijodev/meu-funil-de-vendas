"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section, StatCard } from "@/components/ui-bits";
import { Select } from "@/components/crm/select";
import { listAllInteractions, listStageHistory } from "@/modules/crm/infrastructure/crm.api";
import { usePipelines, useStages, useLeads, useMembers } from "@/lib/crm-queries";
import { LEAD_SOURCES, humanDuration, hoursSince, slaBroken } from "@/lib/crm";
import { brl, num, pct, shortDate } from "@/lib/format";
import { CadenceMetrics } from "@/components/crm/cadence-metrics";

export function CrmDashboard() {
  const { workspaceId } = useWorkspace();
  const { data: pipelines = [] } = usePipelines(workspaceId);
  const pipelineId = pipelines[0]?.id ?? null;
  const { data: stages = [] } = useStages(workspaceId, pipelineId);
  const { data: leads = [] } = useLeads(workspaceId, pipelineId);
  const { data: members = [] } = useMembers(workspaceId);

  const [days, setDays] = useState("90");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");

  const { data: history = [] } = useQuery({
    queryKey: ["crm-history", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listStageHistory(workspaceId!),
  });

  const { data: interactions = [] } = useQuery({
    queryKey: ["crm-interactions-all", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listAllInteractions(workspaceId!),
  });

  const campaigns = useMemo(
    () => [...new Set(leads.map((l) => l.campaign_name).filter(Boolean))] as string[],
    [leads],
  );

  const scoped = useMemo(
    () =>
      leads.filter((l) => {
        if (days !== "0" && hoursSince(l.created_at) > Number(days) * 24) return false;
        if (source && l.source !== source) return false;
        if (campaign && l.campaign_name !== campaign) return false;
        return true;
      }),
    [leads, days, source, campaign],
  );

  const ids = useMemo(() => new Set(scoped.map((l) => l.id)), [scoped]);
  const scopedHistory = useMemo(() => history.filter((h) => ids.has(h.lead_id)), [history, ids]);
  const scopedInteractions = useMemo(() => interactions.filter((i) => ids.has(i.lead_id)), [interactions, ids]);

  const reached = (stageId: string) =>
    new Set(scopedHistory.filter((h) => h.to_stage_id === stageId).map((h) => h.lead_id)).size;

  const avgTimeInStage = (stageId: string) => {
    const durations: number[] = [];
    const byLead = new Map<string, typeof scopedHistory>();
    scopedHistory.forEach((h) => {
      const arr = byLead.get(h.lead_id) ?? [];
      arr.push(h);
      byLead.set(h.lead_id, arr);
    });
    byLead.forEach((rows) => {
      rows.forEach((row, i) => {
        if (row.to_stage_id !== stageId) return;
        const next = rows[i + 1];
        const end = next ? new Date(next.created_at).getTime() : Date.now();
        durations.push((end - new Date(row.created_at).getTime()) / 3_600_000);
      });
    });
    return durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  };

  const wonStage = stages.find((s) => s.is_won);
  const lostStage = stages.find((s) => s.is_lost);
  const won = scoped.filter((l) => l.stage_id === wonStage?.id);
  const lost = scoped.filter((l) => l.stage_id === lostStage?.id);
  const wonValue = won.reduce((a, l) => a + Number(l.estimated_value ?? 0), 0);

  const firstResponses = scoped
    .filter((l) => l.first_response_at)
    .map((l) => (new Date(l.first_response_at!).getTime() - new Date(l.created_at).getTime()) / 3_600_000);
  const avgFirstResponse = firstResponses.length
    ? firstResponses.reduce((a, b) => a + b, 0) / firstResponses.length
    : 0;

  const aiContacted = new Set(scopedInteractions.filter((i) => i.author_type === "ai").map((i) => i.lead_id));
  const replied = new Set(scopedInteractions.filter((i) => i.kind === "message_in").map((i) => i.lead_id));
  const aiResponseRate = aiContacted.size ? (replied.size / aiContacted.size) * 100 : 0;

  const qualifiedStage = stages.find((s) => s.name.toLowerCase().startsWith("qualificado"));
  const meetingStage = stages.find((s) => s.name.toLowerCase().includes("agendada"));
  const heldStage = stages.find((s) => s.name.toLowerCase().includes("realizada"));
  const qualified = qualifiedStage ? reached(qualifiedStage.id) : 0;
  const meetings = meetingStage ? reached(meetingStage.id) : 0;
  const held = heldStage ? reached(heldStage.id) : 0;
  const noShow = Math.max(meetings - held, 0);

  const overdue = scoped.filter((l) => slaBroken(l, stages.find((s) => s.id === l.stage_id)));

  const bySource = group(scoped, (l) => LEAD_SOURCES[l.source] ?? l.source);
  const byCampaign = group(scoped, (l) => l.campaign_name ?? "Sem campanha");
  const byAd = group(scoped, (l) => l.ad_name ?? "Sem anúncio");
  const byLossReason = group(lost, (l) => l.loss_reason ?? "Sem motivo");

  const ranking = members
    .map((m) => {
      const mine = scoped.filter((l) => l.owner_id === m.user_id);
      return {
        label: m.label,
        total: mine.length,
        won: mine.filter((l) => l.stage_id === wonStage?.id).length,
        value: mine.filter((l) => l.stage_id === wonStage?.id).reduce((a, l) => a + Number(l.estimated_value ?? 0), 0),
      };
    })
    .sort((a, b) => b.value - a.value);

  const daily = useMemo(() => {
    const map = new Map<string, number>();
    scoped.forEach((l) => {
      const key = new Date(l.created_at).toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return [...map.entries()].sort().slice(-14);
  }, [scoped]);
  const maxDaily = Math.max(1, ...daily.map(([, v]) => v));

  return (
    <div>
      <PageHeader title="Indicadores do CRM" subtitle="Calculados a partir do histórico de etapas e das interações." />

      <div className="mb-5 grid gap-2 md:grid-cols-3">
        <Select value={days} onChange={setDays}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="0">Todo o período</option>
        </Select>
        <Select value={source} onChange={setSource}>
          <option value="">Todas as origens</option>
          {Object.entries(LEAD_SOURCES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Select value={campaign} onChange={setCampaign}>
          <option value="">Todas as campanhas</option>
          {campaigns.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Leads no período" value={num(scoped.length)} />
        <StatCard label="Tempo médio 1ª resposta" value={humanDuration(avgFirstResponse)} />
        <StatCard label="Ganhos" value={num(won.length)} hint={brl(wonValue)} tone="positive" />
        <StatCard label="Ticket médio" value={brl(won.length ? wonValue / won.length : 0)} />
        <StatCard label="Taxa de resposta ao SDR IA" value={pct(aiResponseRate)} />
        <StatCard label="Qualificados pela IA" value={pct(scoped.length ? (qualified / scoped.length) * 100 : 0)} hint={`${qualified} leads`} />
        <StatCard label="Reuniões agendadas" value={num(meetings)} hint={`${noShow} no-show`} />
        <StatCard label="SLA estourado" value={num(overdue.length)} tone={overdue.length ? "negative" : "default"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Funil visual" description="Quantidade por etapa e conversão entre etapas.">
          <div className="space-y-2">
            {stages.map((s, i) => {
              const count = reached(s.id);
              const prev = i > 0 ? reached(stages[i - 1]!.id) : count;
              const conv = prev ? (count / prev) * 100 : 0;
              return (
                <div key={s.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                    <span className="tabular-nums">{num(count)}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-secondary">
                    <div className="h-full rounded" style={{ width: `${Math.min(100, conv)}%`, background: s.color }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {i === 0 ? "Entrada do funil" : `Conversão da etapa anterior: ${pct(conv)}`} · tempo médio{" "}
                    {humanDuration(avgTimeInStage(s.id))}
                  </p>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Leads com SLA estourado">
          <div className="space-y-2">
            {overdue.slice(0, 12).map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <span>{l.name}</span>
                <span className="text-xs text-destructive">
                  {stages.find((s) => s.id === l.stage_id)?.name} · {humanDuration(hoursSince(l.stage_entered_at))}
                </span>
              </div>
            ))}
            {!overdue.length && <p className="text-sm text-muted-foreground">Nenhum lead fora do SLA.</p>}
          </div>
        </Section>

        <Section title="Origem, campanha e anúncio" description="CPL e custo por qualificado aparecem quando houver custo importado.">
          <Breakdown title="Origem" rows={bySource} />
          <Breakdown title="Campanha" rows={byCampaign} />
          <Breakdown title="Anúncio" rows={byAd} />
          <p className="mt-3 text-xs text-muted-foreground">CPL: — · Custo por qualificado: — (sem custos importados)</p>
        </Section>

        <Section title="Ganhos e perdas">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Ganhos</p>
              <p className="text-lg font-semibold text-success">{num(won.length)}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Perdidos</p>
              <p className="text-lg font-semibold text-destructive">{num(lost.length)}</p>
            </div>
          </div>
          <div className="mt-4">
            <Breakdown title="Motivos de perda" rows={byLossReason} />
          </div>
        </Section>

        <Section title="Ranking por vendedor">
          <div className="space-y-2">
            {ranking.map((r) => (
              <div key={r.label} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                <span>{r.label}</span>
                <span className="text-xs text-muted-foreground">
                  {r.total} leads · {r.won} ganhos · {brl(r.value)}
                </span>
              </div>
            ))}
            {!ranking.length && <p className="text-sm text-muted-foreground">Sem vendedores cadastrados.</p>}
          </div>
        </Section>

        <Section title="Evolução diária" description="Novos leads por dia (últimos 14 dias com registro).">
          <div className="flex h-40 items-end gap-1.5">
            {daily.map(([day, value]) => (
              <div key={day} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t bg-primary" style={{ height: `${(value / maxDaily) * 100}%` }} />
                <span className="text-[10px] text-muted-foreground">{shortDate(day)}</span>
              </div>
            ))}
            {!daily.length && <p className="text-sm text-muted-foreground">Sem dados no período.</p>}
          </div>
        </Section>
      </div>

      <div className="mt-6">
        <CadenceMetrics workspaceId={workspaceId} />
      </div>
    </div>
  );
}

function group<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, number>();
  items.forEach((i) => map.set(key(i), (map.get(key(i)) ?? 0) + 1));
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span className="truncate">{label}</span>
            <span className="tabular-nums text-muted-foreground">{num(value)}</span>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-muted-foreground">Sem dados.</p>}
      </div>
    </div>
  );
}
