import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Play, Trash2, Sparkles, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/routes/_authenticated/crm.index";
import { useStages } from "@/lib/crm-queries";
import { usePipelines } from "@/lib/crm-queries";
import { LEAD_SOURCES } from "@/lib/crm";
import {
  CHANNEL_LABELS,
  TRIGGER_LABELS,
  WEEKDAYS,
  type CadenceChannel,
  type CadenceStep,
  type ExitRules,
} from "@/lib/crm/cadence-types";
import {
  saveCadence,
  deleteCadence,
  installCadenceTemplates,
  runCadencesNow,
} from "@/lib/crm-cadences.functions";
import { HowTo } from "@/components/how-to";
import { GUIDES } from "@/lib/guides";

export const Route = createFileRoute("/_authenticated/crm/cadences")({
  head: () => ({
    meta: [
      { title: "CRM · Cadências · Meu Funil" },
      { name: "description", content: "Construtor de cadências de follow-up por WhatsApp, e-mail e ligação." },
      { property: "og:title", content: "CRM · Cadências" },
      { property: "og:description", content: "Sequências automáticas de contato com indicadores por passo." },
    ],
  }),
  component: CadencesPage,
});

type CadenceRow = {
  id: string;
  name: string;
  description: string;
  trigger_type: string;
  trigger_value: string | null;
  is_active: boolean;
  steps: CadenceStep[];
  exit_rules: ExitRules;
};

const EMPTY_STEP: CadenceStep = {
  channel: "wa_text",
  delay_minutes: 60,
  window: { days: [1, 2, 3, 4, 5], start: "08:00", end: "20:00" },
  message: "Oi {{nome}}, tudo bem?",
};

function delayLabel(minutes: number) {
  if (minutes <= 0) return "imediato";
  if (minutes % 1440 === 0) return `+${minutes / 1440} dia(s)`;
  if (minutes % 60 === 0) return `+${minutes / 60} h`;
  return `+${minutes} min`;
}

function CadencesPage() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  const { data: pipelines = [] } = usePipelines(workspaceId);
  const { data: stages = [] } = useStages(workspaceId, pipelines[0]?.id ?? null);
  const [editing, setEditing] = useState<CadenceRow | null>(null);

  const save = useServerFn(saveCadence);
  const remove = useServerFn(deleteCadence);
  const install = useServerFn(installCadenceTemplates);
  const runNow = useServerFn(runCadencesNow);

  const { data: cadences = [] } = useQuery({
    queryKey: ["crm-cadences", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_cadences")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at");
      return (data ?? []) as unknown as CadenceRow[];
    },
  });

  const { data: events = [] } = useQuery({
    queryKey: ["crm-cadence-events", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_cadence_events")
        .select("cadence_id, step_index, event, message_id")
        .eq("workspace_id", workspaceId!);
      return data ?? [];
    },
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["crm-cadence-runs", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_cadence_runs")
        .select("cadence_id, status, stop_reason, step_index, next_run_at")
        .eq("workspace_id", workspaceId!);
      return data ?? [];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["crm-cadences", workspaceId] });
    qc.invalidateQueries({ queryKey: ["crm-cadence-events", workspaceId] });
    qc.invalidateQueries({ queryKey: ["crm-cadence-runs", workspaceId] });
  };

  const metrics = useMemo(() => {
    const map = new Map<string, { sent: number; replied: number; optOut: number; tasks: number; failed: number }>();
    for (const e of events) {
      const key = e.cadence_id as string;
      const entry = map.get(key) ?? { sent: 0, replied: 0, optOut: 0, tasks: 0, failed: 0 };
      if (e.event === "sent") entry.sent += 1;
      else if (e.event === "replied") entry.replied += 1;
      else if (e.event === "opt_out") entry.optOut += 1;
      else if (e.event === "task") entry.tasks += 1;
      else if (e.event === "failed") entry.failed += 1;
      map.set(key, entry);
    }
    return map;
  }, [events]);

  const onSave = async (row: CadenceRow) => {
    if (!workspaceId) return;
    try {
      await save({
        data: {
          workspaceId,
          id: row.id || null,
          name: row.name,
          description: row.description,
          triggerType: row.trigger_type as "source",
          triggerValue: row.trigger_value,
          isActive: row.is_active,
          steps: row.steps,
          exitRules: row.exit_rules,
        },
      });
      toast.success("Cadência salva.");
      setEditing(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cadências"
        subtitle="Sequências automáticas de follow-up com janela de envio, variáveis e saída automática."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                if (!workspaceId) return;
                const { created } = await install({ data: { workspaceId } });
                toast.success(created ? `${created} modelo(s) instalado(s).` : "Modelos já instalados.");
                refresh();
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" /> Modelos prontos
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!workspaceId) return;
                try {
                  const r = await runNow({ data: { workspaceId } });
                  toast.success(`${r.executed} passo(s) executado(s).`);
                  refresh();
                } catch {
                  toast.error("Não foi possível executar agora.");
                }
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Executar agora
            </Button>
            <Button
              onClick={() =>
                setEditing({
                  id: "",
                  name: "",
                  description: "",
                  trigger_type: "manual",
                  trigger_value: null,
                  is_active: false,
                  steps: [{ ...EMPTY_STEP, delay_minutes: 0 }],
                  exit_rules: {
                    on_reply: true,
                    on_stage_change: true,
                    on_won_lost: true,
                    on_opt_out: true,
                    on_human_takeover: true,
                  },
                })
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Nova cadência
            </Button>
          </div>
        }
      />
      <div className="mb-6">
        <HowTo title={GUIDES.cadences.title} steps={GUIDES.cadences.steps} references={GUIDES.cadences.references ?? []} />
      </div>

      <Section title="Cadências do workspace" description="Ative para começar a inscrever leads automaticamente.">
        <div className="space-y-3">
          {cadences.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma cadência ainda. Instale os modelos prontos ou crie a sua.
            </p>
          )}
          {cadences.map((c) => {
            const m = metrics.get(c.id) ?? { sent: 0, replied: 0, optOut: 0, tasks: 0, failed: 0 };
            const active = runs.filter((r) => r.cadence_id === c.id && r.status === "running").length;
            const rate = m.sent ? Math.round((m.replied / m.sent) * 100) : 0;
            return (
              <div key={c.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{c.name}</h3>
                      <Badge variant={c.is_active ? "default" : "secondary"}>
                        {c.is_active ? "Ativa" : "Pausada"}
                      </Badge>
                      <Badge variant="outline">{TRIGGER_LABELS[c.trigger_type] ?? c.trigger_type}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{c.description || "Sem descrição."}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.steps?.length ?? 0} passos · {active} lead(s) em andamento
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={c.is_active}
                      onCheckedChange={async (v) => {
                        await onSave({ ...c, is_active: v });
                      }}
                    />
                    <Button variant="outline" size="sm" onClick={() => setEditing(c)}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (!workspaceId) return;
                        await remove({ data: { workspaceId, id: c.id } });
                        toast.success("Cadência excluída.");
                        refresh();
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                  <Metric label="Enviados" value={m.sent} />
                  <Metric label="Respostas" value={m.replied} />
                  <Metric label="Taxa de resposta" value={`${rate}%`} />
                  <Metric label="Tarefas" value={m.tasks} />
                  <Metric label="Opt-outs" value={m.optOut} />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {editing && (
        <Section title={editing.id ? "Editar cadência" : "Nova cadência"} description="Passos, janelas e regras de saída.">
          <CadenceForm
            value={editing}
            stages={stages}
            onCancel={() => setEditing(null)}
            onSave={onSave}
          />
        </Section>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
  );
}

function CadenceForm({
  value,
  stages,
  onCancel,
  onSave,
}: {
  value: CadenceRow;
  stages: { id: string; name: string }[];
  onCancel: () => void;
  onSave: (row: CadenceRow) => void;
}) {
  const [row, setRow] = useState<CadenceRow>(value);
  const patch = (p: Partial<CadenceRow>) => setRow((r) => ({ ...r, ...p }));
  const patchStep = (i: number, p: Partial<CadenceStep>) =>
    setRow((r) => ({ ...r, steps: r.steps.map((s, idx) => (idx === i ? { ...s, ...p } : s)) }));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground">Nome</label>
          <Input value={row.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Novo lead Meta" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Descrição</label>
          <Input value={row.description} onChange={(e) => patch({ description: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Gatilho de entrada</label>
          <Select value={row.trigger_type} onChange={(v) => patch({ trigger_type: v, trigger_value: null })}>
            {Object.entries(TRIGGER_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Valor do gatilho</label>
          {row.trigger_type === "source" ? (
            <Select value={row.trigger_value ?? ""} onChange={(v) => patch({ trigger_value: v })}>
              <option value="">Selecione…</option>
              {Object.entries(LEAD_SOURCES).map(([k, label]) => (
                <option key={k} value={k}>
                  {String(label)}
                </option>
              ))}
            </Select>
          ) : row.trigger_type === "stage" ? (
            <Select value={row.trigger_value ?? ""} onChange={(v) => patch({ trigger_value: v })}>
              <option value="">Selecione…</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : row.trigger_type === "manual" ? (
            <p className="pt-2 text-xs text-muted-foreground">Inclusão manual pela lista de leads.</p>
          ) : (
            <Input
              value={row.trigger_value ?? ""}
              onChange={(e) => patch({ trigger_value: e.target.value })}
              placeholder={row.trigger_type === "tag" ? "nome da tag" : "nome da campanha"}
            />
          )}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-medium">Saída automática</h4>
        <div className="flex flex-wrap gap-4 text-sm">
          {(
            [
              ["on_reply", "Responde"],
              ["on_stage_change", "Muda de etapa"],
              ["on_won_lost", "Ganho ou Perdido"],
              ["on_opt_out", "Pede opt-out"],
              ["on_human_takeover", "Assumido por humano"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <Switch
                checked={row.exit_rules[key] !== false}
                onCheckedChange={(v) => patch({ exit_rules: { ...row.exit_rules, [key]: v } })}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium">Passos</h4>
        {row.steps.map((step, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="text-xs text-muted-foreground">Canal</label>
                <Select value={step.channel} onChange={(v) => patchStep(i, { channel: v as CadenceChannel })}>
                  {Object.entries(CHANNEL_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Espera (minutos)</label>
                <Input
                  type="number"
                  value={step.delay_minutes}
                  onChange={(e) => patchStep(i, { delay_minutes: Number(e.target.value) })}
                />
                <p className="mt-1 text-xs text-muted-foreground">{delayLabel(step.delay_minutes)}</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Início da janela</label>
                <Input
                  type="time"
                  value={step.window?.start ?? "08:00"}
                  onChange={(e) =>
                    patchStep(i, {
                      window: { days: step.window?.days ?? [1, 2, 3, 4, 5], start: e.target.value, end: step.window?.end ?? "20:00" },
                    })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Fim da janela</label>
                <Input
                  type="time"
                  value={step.window?.end ?? "20:00"}
                  onChange={(e) =>
                    patchStep(i, {
                      window: { days: step.window?.days ?? [1, 2, 3, 4, 5], start: step.window?.start ?? "08:00", end: e.target.value },
                    })
                  }
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {WEEKDAYS.map((label, day) => {
                const days = step.window?.days ?? [1, 2, 3, 4, 5];
                const on = days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      patchStep(i, {
                        window: {
                          days: on ? days.filter((d) => d !== day) : [...days, day].sort(),
                          start: step.window?.start ?? "08:00",
                          end: step.window?.end ?? "20:00",
                        },
                      })
                    }
                    className={`rounded-md border px-2 py-1 text-xs ${
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {step.channel === "wa_template" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input
                  value={step.template_name ?? ""}
                  onChange={(e) => patchStep(i, { template_name: e.target.value })}
                  placeholder="nome_do_template"
                />
                <Input
                  value={step.template_language ?? "pt_BR"}
                  onChange={(e) => patchStep(i, { template_language: e.target.value })}
                  placeholder="pt_BR"
                />
              </div>
            ) : null}

            <Textarea
              className="mt-3"
              rows={3}
              value={step.message ?? ""}
              onChange={(e) => patchStep(i, { message: e.target.value })}
              placeholder="Conteúdo com variáveis: {{nome}}, {{cidade}}, {{empresa}}, {{responsavel}}"
            />
            {step.channel === "wa_text" && (
              <Input
                className="mt-2"
                value={step.fallback_template ?? ""}
                onChange={(e) => patchStep(i, { fallback_template: e.target.value })}
                placeholder="Template usado fora da janela de 24h (opcional)"
              />
            )}

            <div className="mt-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRow((r) => ({ ...r, steps: r.steps.filter((_, idx) => idx !== i) }))}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Remover passo
              </Button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setRow((r) => ({ ...r, steps: [...r.steps, { ...EMPTY_STEP }] }))}>
          <Plus className="mr-2 h-4 w-4" /> Adicionar passo
        </Button>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => onSave(row)}>
          <Play className="mr-2 h-4 w-4" /> Salvar cadência
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
