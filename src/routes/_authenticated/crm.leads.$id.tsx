import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Bot, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/routes/_authenticated/crm.index";
import { usePipelines, useStages, useMembers } from "@/lib/crm-queries";
import { AUTHOR_TYPES, INTERACTION_KINDS, LEAD_SOURCES, TEMPERATURES, TASK_STATUS, type Lead } from "@/lib/crm";
import { brl, fullDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/crm/leads/$id")({
  head: () => ({
    meta: [
      { title: "CRM · Ficha do lead · AI Marketing OS" },
      { name: "description", content: "Dados, timeline de interações, tarefas e controle da IA do lead." },
      { property: "og:title", content: "CRM · Ficha do lead" },
      { property: "og:description", content: "Histórico completo e ações do lead." },
    ],
  }),
  component: LeadDetail,
});

function LeadDetail() {
  const { id } = Route.useParams();
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  const { data: pipelines = [] } = usePipelines(workspaceId);
  const { data: stages = [] } = useStages(workspaceId, pipelines[0]?.id ?? null);
  const { data: members = [] } = useMembers(workspaceId);
  const [note, setNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");

  const { data } = useQuery({
    queryKey: ["crm-lead", id],
    queryFn: async () => {
      const [lead, interactions, tasks] = await Promise.all([
        supabase.from("crm_leads").select("*").eq("id", id).maybeSingle(),
        supabase.from("crm_interactions").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
        supabase.from("crm_tasks").select("*").eq("lead_id", id).order("due_at"),
      ]);
      return {
        lead: (lead.data ?? null) as unknown as Lead | null,
        interactions: interactions.data ?? [],
        tasks: tasks.data ?? [],
      };
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["crm-lead", id] });
  const lead = data?.lead;

  const patch = async (values: Record<string, string | boolean | number | null>) => {
    const { error } = await supabase.from("crm_leads").update(values as never).eq("id", id);
    if (error) {
      toast.error("Não foi possível salvar.");
      return;
    }
    refresh();
  };

  const toggleAi = async (active: boolean) => {
    if (!workspaceId) return;
    await patch({ ai_active: active });
    await supabase.from("crm_interactions").insert({
      workspace_id: workspaceId,
      lead_id: id,
      kind: "note",
      author_type: "user",
      content: active ? "Conversa devolvida para a IA." : "Atendimento assumido por humano (IA pausada).",
    });
    refresh();
    toast.success(active ? "IA reativada." : "Você assumiu a conversa.");
  };

  const addNote = async () => {
    if (!workspaceId || !note.trim()) return;
    await supabase.from("crm_interactions").insert({
      workspace_id: workspaceId,
      lead_id: id,
      kind: "note",
      author_type: "user",
      content: note.trim(),
    });
    await patch({ last_interaction_at: new Date().toISOString() });
    setNote("");
    refresh();
  };

  const addTask = async () => {
    if (!workspaceId || !taskTitle.trim()) return;
    await supabase.from("crm_tasks").insert({
      workspace_id: workspaceId,
      lead_id: id,
      title: taskTitle.trim(),
      due_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    setTaskTitle("");
    refresh();
    toast.success("Tarefa criada.");
  };

  if (!lead) return <p className="text-sm text-muted-foreground">Carregando lead…</p>;

  return (
    <div>
      <Link to="/crm/leads" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Voltar para leads
      </Link>
      <PageHeader
        title={lead.name}
        subtitle={`${LEAD_SOURCES[lead.source] ?? lead.source} · score ${lead.score} · ${brl(lead.estimated_value)}`}
        actions={
          lead.ai_active ? (
            <Button size="sm" variant="outline" onClick={() => toggleAi(false)}>
              <UserCheck className="size-4" /> Assumir conversa
            </Button>
          ) : (
            <Button size="sm" onClick={() => toggleAi(true)}>
              <Bot className="size-4" /> Devolver para IA
            </Button>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title="Timeline de interações" description="Mensagens, notas, ligações e ações da IA.">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row">
              <Textarea placeholder="Registrar nota…" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button onClick={addNote}>Adicionar</Button>
            </div>
            <div className="space-y-3">
              {data?.interactions.map((it) => (
                <div key={it.id as string} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {INTERACTION_KINDS[it.kind as string] ?? it.kind} · {AUTHOR_TYPES[it.author_type as string] ?? it.author_type}
                    </p>
                    <p className="text-xs text-muted-foreground">{fullDate(it.created_at as string)}</p>
                  </div>
                  <p className="mt-1 text-sm">{it.content as string}</p>
                </div>
              ))}
              {!data?.interactions.length && <p className="text-sm text-muted-foreground">Sem interações ainda.</p>}
            </div>
          </Section>

          <Section title="Chat WhatsApp" description="Integração de mensagens chega na fase 2.">
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Área reservada para a conversa de WhatsApp do lead.
            </div>
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Dados do lead">
            <div className="space-y-3 text-sm">
              <Field label="Telefone" value={lead.phone ?? "—"} />
              <Field label="E-mail" value={lead.email ?? "—"} />
              <Field label="Cidade" value={lead.city ?? "—"} />
              <Field label="Campanha" value={lead.campaign_name ?? "—"} />
              <Field label="Conjunto / anúncio" value={`${lead.adset_name ?? "—"} · ${lead.ad_name ?? "—"}`} />
              <Field label="UTM" value={`${lead.utm_source ?? "—"} / ${lead.utm_medium ?? "—"} / ${lead.utm_campaign ?? "—"}`} />
              <Field label="Temperatura" value={TEMPERATURES[lead.temperature] ?? lead.temperature} />
              <Field
                label="Consentimento LGPD"
                value={lead.lgpd_consent ? `Sim · ${fullDate(lead.lgpd_consent_at)}` : "Não"}
              />
              <Field label="Descadastrado" value={lead.unsubscribed ? "Sim" : "Não"} />
              <div>
                <p className="text-xs text-muted-foreground">Etapa</p>
                <Select
                  value={lead.stage_id ?? ""}
                  onChange={(v) => patch({ stage_id: v, stage_entered_at: new Date().toISOString() })}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Responsável</p>
                <Select value={lead.owner_id ?? ""} onChange={(v) => patch({ owner_id: v || null })}>
                  <option value="">Sem responsável</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.label}</option>
                  ))}
                </Select>
              </div>
              {lead.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {lead.tags.map((t) => (
                    <span key={t} className="rounded-full border border-border px-2 py-0.5 text-xs">{t}</span>
                  ))}
                </div>
              )}
            </div>
          </Section>

          <Section title="Tarefas e cadência">
            <div className="mb-3 flex gap-2">
              <Input placeholder="Nova tarefa" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
              <Button onClick={addTask}>Criar</Button>
            </div>
            <div className="space-y-2">
              {data?.tasks.map((t) => (
                <div key={t.id as string} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                  <div>
                    <p>{t.title as string}</p>
                    <p className="text-xs text-muted-foreground">Vence {fullDate(t.due_at as string)}</p>
                  </div>
                  <StatusPill status={t.status as string} label={TASK_STATUS[t.status as string]} />
                </div>
              ))}
              {!data?.tasks.length && <p className="text-sm text-muted-foreground">Sem tarefas.</p>}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Cadência da IA: {lead.ai_active ? "ativa" : "pausada (atendimento humano)"}.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}
