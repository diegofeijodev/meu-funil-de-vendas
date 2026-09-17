import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/routes/_authenticated/crm.index";
import { usePipelines, useStages, useMembers } from "@/lib/crm-queries";
import { ROLE_LABELS } from "@/lib/labels";
import { SdrAgentPanel } from "@/components/crm/sdr-agent-panel";

export const Route = createFileRoute("/_authenticated/crm/settings")({
  head: () => ({
    meta: [
      { title: "CRM · Configurações · AI Marketing OS" },
      { name: "description", content: "Funis, etapas, SLA, distribuição de leads, motivos de perda e tags." },
      { property: "og:title", content: "CRM · Configurações" },
      { property: "og:description", content: "Configure o funil e as regras do time comercial." },
    ],
  }),
  component: CrmSettings,
});

function CrmSettings() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  const { data: pipelines = [] } = usePipelines(workspaceId);
  const pipelineId = pipelines[0]?.id ?? null;
  const { data: stages = [] } = useStages(workspaceId, pipelineId);
  const { data: members = [] } = useMembers(workspaceId);
  const [newStage, setNewStage] = useState("");
  const [newReason, setNewReason] = useState("");
  const [newTag, setNewTag] = useState("");

  const { data: extras } = useQuery({
    queryKey: ["crm-settings", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [reasons, tags, settings] = await Promise.all([
        supabase.from("crm_loss_reasons").select("id, name").eq("workspace_id", workspaceId!).order("name"),
        supabase.from("crm_tags").select("id, name, color").eq("workspace_id", workspaceId!).order("name"),
        supabase.from("crm_settings").select("*").eq("workspace_id", workspaceId!).maybeSingle(),
      ]);
      return { reasons: reasons.data ?? [], tags: tags.data ?? [], settings: settings.data };
    },
  });

  const refreshStages = () => qc.invalidateQueries({ queryKey: ["crm-stages", workspaceId, pipelineId] });
  const refreshExtras = () => qc.invalidateQueries({ queryKey: ["crm-settings", workspaceId] });

  const updateStage = async (id: string, values: { name?: string; color?: string; sla_hours?: number; position?: number }) => {
    await supabase.from("crm_stages").update(values).eq("id", id);
    refreshStages();
  };

  const addStage = async () => {
    if (!workspaceId || !pipelineId || !newStage.trim()) return;
    await supabase.from("crm_stages").insert({
      workspace_id: workspaceId,
      pipeline_id: pipelineId,
      name: newStage.trim(),
      position: (stages.at(-1)?.position ?? 0) + 1,
    });
    setNewStage("");
    refreshStages();
    toast.success("Etapa criada.");
  };

  const removeStage = async (id: string) => {
    await supabase.from("crm_stages").delete().eq("id", id);
    refreshStages();
  };

  const saveDistribution = async (distribution: string, defaultOwner: string) => {
    if (!workspaceId) return;
    await supabase.from("crm_settings").upsert(
      { workspace_id: workspaceId, distribution, default_owner_id: defaultOwner || null },
      { onConflict: "workspace_id" },
    );
    refreshExtras();
    toast.success("Regra de distribuição salva.");
  };

  return (
    <div>
      <PageHeader title="Configurações do CRM" subtitle="Funil, etapas, usuários, distribuição, motivos de perda e tags." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Funil e etapas" description="Nome, cor, ordem e SLA em horas são editáveis.">
          <div className="space-y-2">
            {stages.map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 rounded-lg border border-border p-2">
                <Input defaultValue={s.name} onBlur={(e) => updateStage(s.id, { name: e.target.value })} />
                <input
                  type="color"
                  defaultValue={s.color}
                  onChange={(e) => updateStage(s.id, { color: e.target.value })}
                  className="size-9 rounded border border-border bg-transparent"
                />
                <Input
                  type="number"
                  className="w-20"
                  defaultValue={s.position}
                  onBlur={(e) => updateStage(s.id, { position: Number(e.target.value) })}
                />
                <Input
                  type="number"
                  className="w-24"
                  defaultValue={s.sla_hours}
                  onBlur={(e) => updateStage(s.id, { sla_hours: Number(e.target.value) })}
                />
                <Button size="icon" variant="ghost" onClick={() => removeStage(s.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Colunas: nome · cor · ordem · SLA (horas)</p>
            <div className="flex gap-2">
              <Input placeholder="Nova etapa" value={newStage} onChange={(e) => setNewStage(e.target.value)} />
              <Button onClick={addStage}>
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Usuários do workspace">
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                <span>{m.label}</span>
                <span className="text-xs text-muted-foreground">{ROLE_LABELS[m.role] ?? m.role}</span>
              </div>
            ))}
            {!members.length && <p className="text-sm text-muted-foreground">Sem usuários.</p>}
          </div>
        </Section>

        <Section title="Distribuição de leads">
          <DistributionForm
            distribution={(extras?.settings?.distribution as string) ?? "round_robin"}
            defaultOwner={(extras?.settings?.default_owner_id as string) ?? ""}
            members={members}
            onSave={saveDistribution}
          />
        </Section>

        <Section title="Motivos de perda e tags">
          <div className="space-y-2">
            {extras?.reasons.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
                {r.name}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={async () => {
                    await supabase.from("crm_loss_reasons").delete().eq("id", r.id);
                    refreshExtras();
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input placeholder="Novo motivo de perda" value={newReason} onChange={(e) => setNewReason(e.target.value)} />
              <Button
                onClick={async () => {
                  if (!workspaceId || !newReason.trim()) return;
                  await supabase.from("crm_loss_reasons").insert({ workspace_id: workspaceId, name: newReason.trim() });
                  setNewReason("");
                  refreshExtras();
                }}
              >
                Adicionar
              </Button>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {extras?.tags.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs">
                  <span className="size-2 rounded-full" style={{ background: t.color }} />
                  {t.name}
                  <button
                    onClick={async () => {
                      await supabase.from("crm_tags").delete().eq("id", t.id);
                      refreshExtras();
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input placeholder="Nova tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
              <Button
                onClick={async () => {
                  if (!workspaceId || !newTag.trim()) return;
                  await supabase.from("crm_tags").insert({ workspace_id: workspaceId, name: newTag.trim() });
                  setNewTag("");
                  refreshExtras();
                }}
              >
                Adicionar
              </Button>
            </div>
          </div>
        </Section>
      </div>

      <div className="mt-6">
        <SdrAgentPanel workspaceId={workspaceId} />
      </div>
    </div>
  );
}

function DistributionForm({
  distribution,
  defaultOwner,
  members,
  onSave,
}: {
  distribution: string;
  defaultOwner: string;
  members: { user_id: string; label: string }[];
  onSave: (distribution: string, owner: string) => void;
}) {
  const [mode, setMode] = useState(distribution);
  const [owner, setOwner] = useState(defaultOwner);
  return (
    <div className="space-y-3">
      <Select value={mode} onChange={setMode}>
        <option value="round_robin">Rodízio (round-robin)</option>
        <option value="fixed">Responsável fixo</option>
      </Select>
      {mode === "fixed" && (
        <Select value={owner} onChange={setOwner}>
          <option value="">Escolha o responsável</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.label}</option>
          ))}
        </Select>
      )}
      <Button onClick={() => onSave(mode, owner)}>Salvar regra</Button>
    </div>
  );
}
