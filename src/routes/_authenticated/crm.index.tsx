import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { usePipelines, useStages, useLeads, useMembers } from "@/lib/crm-queries";
import { LEAD_SOURCES, humanDuration, hoursSince, slaBroken, type Lead } from "@/lib/crm";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/crm/")({
  head: () => ({
    meta: [
      { title: "CRM · Funil de vendas · AI Marketing OS" },
      { name: "description", content: "Kanban de leads com SLA, origem, score e responsável por etapa." },
      { property: "og:title", content: "CRM · Funil de vendas" },
      { property: "og:description", content: "Acompanhe leads por etapa, SLA e responsável." },
    ],
  }),
  component: KanbanPage,
});

function KanbanPage() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  const { data: pipelines = [] } = usePipelines(workspaceId);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const activePipeline = pipelineId ?? pipelines[0]?.id ?? null;
  const { data: stages = [] } = useStages(workspaceId, activePipeline);
  const { data: leads = [] } = useLeads(workspaceId, activePipeline);
  const { data: members = [] } = useMembers(workspaceId);

  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [tag, setTag] = useState("");
  const [days, setDays] = useState("0");

  const campaigns = useMemo(
    () => [...new Set(leads.map((l) => l.campaign_name).filter(Boolean))] as string[],
    [leads],
  );
  const tags = useMemo(() => [...new Set(leads.flatMap((l) => l.tags ?? []))], [leads]);

  const filtered = useMemo(
    () =>
      leads.filter((l) => {
        if (search && !`${l.name} ${l.phone ?? ""} ${l.email ?? ""}`.toLowerCase().includes(search.toLowerCase()))
          return false;
        if (owner && l.owner_id !== owner) return false;
        if (source && l.source !== source) return false;
        if (campaign && l.campaign_name !== campaign) return false;
        if (tag && !(l.tags ?? []).includes(tag)) return false;
        if (days !== "0" && hoursSince(l.created_at) > Number(days) * 24) return false;
        return true;
      }),
    [leads, search, owner, source, campaign, tag, days],
  );

  const move = async (leadId: string, stageId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage_id === stageId || !workspaceId) return;
    const { error } = await supabase
      .from("crm_leads")
      .update({ stage_id: stageId, stage_entered_at: new Date().toISOString() })
      .eq("id", leadId);
    if (error) {
      toast.error("Não foi possível mover o lead.");
      return;
    }
    await supabase.from("crm_stage_history").insert({
      workspace_id: workspaceId,
      lead_id: leadId,
      from_stage_id: lead.stage_id,
      to_stage_id: stageId,
    });
    await supabase.from("crm_interactions").insert({
      workspace_id: workspaceId,
      lead_id: leadId,
      kind: "stage_change",
      author_type: "user",
      content: `Movido para ${stages.find((s) => s.id === stageId)?.name ?? "outra etapa"}.`,
    });
    qc.invalidateQueries({ queryKey: ["crm-leads", workspaceId, activePipeline] });
    toast.success("Lead movido.");
  };

  return (
    <div>
      <PageHeader
        title="Funil de vendas"
        subtitle="Arraste os cards entre as etapas. Cards em vermelho estouraram o SLA da etapa."
      />

      <div className="mb-5 grid gap-2 md:grid-cols-3 lg:grid-cols-6">
        <Input placeholder="Buscar nome, telefone ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={activePipeline ?? ""} onChange={(v) => setPipelineId(v)}>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select value={owner} onChange={setOwner}>
          <option value="">Todos responsáveis</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.label}</option>
          ))}
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
        <div className="grid grid-cols-2 gap-2">
          <Select value={tag} onChange={setTag}>
            <option value="">Tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
          <Select value={days} onChange={setDays}>
            <option value="0">Período</option>
            <option value="7">7 dias</option>
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
          </Select>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const items = filtered.filter((l) => l.stage_id === stage.id);
          return (
            <div
              key={stage.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => move(e.dataTransfer.getData("text/plain"), stage.id)}
              className="flex w-[280px] shrink-0 flex-col rounded-xl border border-border bg-card/60 p-3"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: stage.color }} />
                  <p className="text-sm font-medium">{stage.name}</p>
                </div>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <p className="mb-3 text-[11px] text-muted-foreground">
                SLA {stage.sla_hours}h · {brl(items.reduce((a, l) => a + Number(l.estimated_value ?? 0), 0))}
              </p>
              <div className="flex flex-col gap-2">
                {items.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} broken={slaBroken(lead, stage)} members={members} />
                ))}
                {!items.length && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    Sem leads
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  broken,
  members,
}: {
  lead: Lead;
  broken: boolean;
  members: { user_id: string; label: string }[];
}) {
  const ownerLabel = members.find((m) => m.user_id === lead.owner_id)?.label ?? "Sem responsável";
  return (
    <Link
      to="/crm/leads/$id"
      params={{ id: lead.id }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
      className={cn(
        "block rounded-lg border bg-background p-3 transition-colors hover:border-primary/50",
        broken ? "border-destructive/60 bg-destructive/5" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight">{lead.name}</p>
        {broken && <AlertTriangle className="size-3.5 shrink-0 text-destructive" />}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {LEAD_SOURCES[lead.source] ?? lead.source} · score {lead.score}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{ownerLabel}</p>
      <p className={cn("mt-2 text-[11px]", broken ? "text-destructive" : "text-muted-foreground")}>
        Na etapa há {humanDuration(hoursSince(lead.stage_entered_at))}
      </p>
    </Link>
  );
}

export function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
    >
      {children}
    </select>
  );
}
