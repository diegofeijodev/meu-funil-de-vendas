"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/crm/select";
import * as crm from "@/modules/crm/infrastructure/crm.api";
import { usePipelines, useStages, useMembers } from "@/lib/crm-queries";
import { ROLE_LABELS } from "@/lib/labels";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

export function CrmSettings() {
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
    queryFn: () => crm.getCrmExtras(workspaceId!),
  });

  const refreshStages = () => qc.invalidateQueries({ queryKey: ["crm-stages", workspaceId, pipelineId] });
  const refreshExtras = () => qc.invalidateQueries({ queryKey: ["crm-settings", workspaceId] });

  const updateStage = async (id: string, values: { name?: string; color?: string; sla_hours?: number; position?: number }) => {
    await crm.updateStage(workspaceId!, id, values).catch(() => undefined);
    refreshStages();
  };

  const addStage = async () => {
    if (!workspaceId || !pipelineId || !newStage.trim()) return;
    try {
      await crm.createStage(workspaceId, { pipeline_id: pipelineId, name: newStage.trim(), position: (stages.at(-1)?.position ?? 0) + 1 });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível criar a etapa."));
      return;
    }
    setNewStage("");
    refreshStages();
    toast.success("Etapa criada.");
  };

  const removeStage = async (id: string) => {
    await crm.deleteStage(workspaceId!, id).catch(() => undefined);
    refreshStages();
  };

  const saveDistribution = async (distribution: string, defaultOwner: string) => {
    if (!workspaceId) return;
    try {
      await crm.saveDistribution(workspaceId, distribution, defaultOwner || null);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível salvar a regra de distribuição."));
      refreshExtras();
      return;
    }
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
            distribution={extras?.settings?.distribution ?? "round_robin"}
            defaultOwner={extras?.settings?.default_owner_id ?? ""}
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
                    await crm.deleteLossReason(workspaceId!, r.id).catch(() => undefined);
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
                  await crm.createLossReason(workspaceId, newReason.trim()).catch(() => undefined);
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
                      await crm.deleteTag(workspaceId!, t.id).catch(() => undefined);
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
                  await crm.createTag(workspaceId, newTag.trim()).catch(() => undefined);
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

      {/* Task 8: HowTo GUIDES.sdr + <SdrAgentPanel workspaceId={workspaceId} /> entram aqui. */}
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
