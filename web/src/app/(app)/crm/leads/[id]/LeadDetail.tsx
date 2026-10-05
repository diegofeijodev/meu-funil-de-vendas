"use client";

import { Link, useParams } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import { ArrowLeft, Bot, UserCheck } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/crm/select";
import {
  addLeadNote, createLeadTask, getLead, listLeadInteractions, listLeadTasks, setLeadAi, updateLead,
} from "@/modules/crm/infrastructure/crm.api";
import { WhatsAppChat } from "@/components/crm/whatsapp-chat";
import { useServerFn } from "@/lib/server-fn";
import { sendLeadEmailNow } from "@/lib/crm-integrations.functions";
import { usePipelines, useStages, useMembers } from "@/lib/crm-queries";
import { AUTHOR_TYPES, INTERACTION_KINDS, LEAD_SOURCES, TEMPERATURES, TASK_STATUS, type Lead } from "@/lib/crm";
import { brl, fullDate } from "@/lib/format";

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  const { data: pipelines = [] } = usePipelines(workspaceId);
  const { data: stages = [] } = useStages(workspaceId, pipelines[0]?.id ?? null);
  const { data: members = [] } = useMembers(workspaceId);
  const [note, setNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");

  const { data } = useQuery({
    queryKey: ["crm-lead", id],
    enabled: !!workspaceId,
    queryFn: async () => {
      if (!workspaceId) return { lead: null as Lead | null, interactions: [], tasks: [] };
      const lead = await getLead(workspaceId, id);
      // lead inexistente: não consulta timeline/tarefas (a ficha fica em "Carregando lead…", como no protótipo)
      if (!lead) return { lead: null as Lead | null, interactions: [], tasks: [] };
      const [interactions, tasks] = await Promise.all([
        listLeadInteractions(workspaceId, id).catch(() => []),
        listLeadTasks(workspaceId, id).catch(() => []),
      ]);
      return { lead, interactions, tasks };
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["crm-lead", id] });
  const lead = data?.lead;

  const patch = async (values: Record<string, string | boolean | number | null>) => {
    try {
      await updateLead(workspaceId!, id, values);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível salvar."));
      return;
    }
    refresh();
  };

  const toggleAi = async (active: boolean) => {
    if (!workspaceId) return;
    try {
      // alterna ai_active e grava a nota ("Atendimento assumido…" / "Conversa devolvida…") numa transação
      await setLeadAi(workspaceId, id, active);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível salvar."));
      return;
    }
    refresh();
    toast.success(active ? "IA reativada." : "Você assumiu a conversa.");
  };

  const addNote = async () => {
    if (!workspaceId || !note.trim()) return;
    try {
      await addLeadNote(workspaceId, id, note.trim());
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível salvar."));
      return;
    }
    setNote("");
    refresh();
  };

  const addTask = async () => {
    if (!workspaceId || !taskTitle.trim()) return;
    try {
      await createLeadTask(workspaceId, id, taskTitle.trim());
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível criar a tarefa."));
      return;
    }
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
                <div key={it.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {INTERACTION_KINDS[it.kind] ?? it.kind} · {AUTHOR_TYPES[it.author_type] ?? it.author_type}
                    </p>
                    <p className="text-xs text-muted-foreground">{fullDate(it.created_at)}</p>
                  </div>
                  <p className="mt-1 text-sm">{it.content}</p>
                </div>
              ))}
              {!data?.interactions.length && <p className="text-sm text-muted-foreground">Sem interações ainda.</p>}
            </div>
          </Section>

          <Section title="Conversa" description="WhatsApp e Direct do Instagram, com status de entrega e leitura.">
            {workspaceId && (
              <WhatsAppChat
                workspaceId={workspaceId}
                leadId={lead.id}
                phone={lead.phone ?? null}
                instagramId={(lead as { instagram_id?: string | null }).instagram_id ?? null}
                unsubscribed={!!lead.unsubscribed}
              />
            )}
          </Section>

          {lead.email && !lead.unsubscribed && workspaceId && (
            <Section title="Enviar e-mail" description="Sai pelo Resend configurado em CRM → Integrações, com link de descadastro.">
              <LeadEmailForm workspaceId={workspaceId} leadId={lead.id} onSent={refresh} />
            </Section>
          )}
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
                <div key={t.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                  <div>
                    <p>{t.title}</p>
                    <p className="text-xs text-muted-foreground">Vence {fullDate(t.due_at)}</p>
                  </div>
                  <StatusPill
                    status={t.status}
                    label={TASK_STATUS[t.status] ?? (t.status)}
                  />
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

function LeadEmailForm({ workspaceId, leadId, onSent }: { workspaceId: string; leadId: string; onSent: () => void }) {
  const send = useServerFn(sendLeadEmailNow);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <Input placeholder="Assunto" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <Textarea rows={4} placeholder="Mensagem" value={body} onChange={(e) => setBody(e.target.value)} />
      <Button
        disabled={busy || !subject.trim() || !body.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await send({ data: { workspaceId, leadId, subject, body } });
            setSubject("");
            setBody("");
            toast.success("E-mail enviado.");
            onSent();
          } catch (e) {
            toast.error(apiErrorMessage(e, "Não foi possível enviar."));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Enviando..." : "Enviar e-mail"}
      </Button>
    </div>
  );
}
