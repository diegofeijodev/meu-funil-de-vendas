"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { Bot, Loader2, Plus, Send, Trash2, Upload } from "lucide-react";
import { Section } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  getSdrAgent,
  saveSdrAgent,
  uploadSdrDocument,
  deleteSdrDocument,
  testSdrAgent,
} from "@/lib/crm-sdr.functions";

type Question = { key: string; question: string; weight: number };
type Hours = { timezone: string; days: number[]; start: string; end: string };

const DAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

const DEFAULTS = {
  isActive: false,
  name: "Agente SDR",
  persona: "Consultor comercial experiente, direto e acolhedor.",
  tone: "consultivo e cordial",
  goal: "Qualificar o lead e agendar uma reunião com o time comercial.",
  knowledgeText: "",
  questions: [
    { key: "cidade", question: "Em qual cidade você pretende atuar?", weight: 20 },
    { key: "capital", question: "Qual capital você tem disponível para investir?", weight: 30 },
    { key: "prazo", question: "Em quanto tempo pretende começar?", weight: 25 },
    { key: "decisor", question: "A decisão é sua ou com mais alguém?", weight: 25 },
  ] as Question[],
  minScore: 60,
  schedulingLink: "",
  availableSlots: [] as string[],
  businessHours: { timezone: "America/Sao_Paulo", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } as Hours,
  offhoursMessage: "Recebemos sua mensagem! Nosso time responde no próximo horário comercial.",
  maxMessages: 20,
  handoffTriggers: ["negociação de preço", "reclamação", "assunto jurídico", "falar com atendente"],
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function SdrAgentPanel({ workspaceId }: { workspaceId: string | null }) {
  const qc = useQueryClient();
  const load = useServerFn(getSdrAgent);
  const save = useServerFn(saveSdrAgent);
  const upload = useServerFn(uploadSdrDocument);
  const removeDoc = useServerFn(deleteSdrDocument);
  const test = useServerFn(testSdrAgent);

  const { data } = useQuery({
    queryKey: ["crm-sdr-agent", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => load({ data: { workspaceId: workspaceId as string } }),
  });

  const [form, setForm] = useState(DEFAULTS);
  const [slotsText, setSlotsText] = useState("");
  const [triggersText, setTriggersText] = useState(DEFAULTS.handoffTriggers.join(", "));

  useEffect(() => {
    const agent = data?.agent;
    if (!agent) return;
    setForm({
      isActive: agent.is_active,
      name: agent.name,
      persona: agent.persona,
      tone: agent.tone,
      goal: agent.goal,
      knowledgeText: agent.knowledge_text,
      questions: (agent.questions as Question[]) ?? [],
      minScore: agent.min_score,
      schedulingLink: agent.scheduling_link ?? "",
      availableSlots: (agent.available_slots as string[]) ?? [],
      businessHours: { ...DEFAULTS.businessHours, ...((agent.business_hours as Hours) ?? {}) },
      offhoursMessage: agent.offhours_message,
      maxMessages: agent.max_messages,
      handoffTriggers: (agent.handoff_triggers as string[]) ?? [],
    });
    setSlotsText(((agent.available_slots as string[]) ?? []).join("\n"));
    setTriggersText(((agent.handoff_triggers as string[]) ?? []).join(", "));
  }, [data?.agent]);

  const totalWeight = useMemo(
    () => form.questions.reduce((sum, q) => sum + (Number(q.weight) || 0), 0),
    [form.questions],
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          workspaceId: workspaceId as string,
          ...form,
          schedulingLink: form.schedulingLink.trim() || null,
          availableSlots: slotsText.split("\n").map((s) => s.trim()).filter(Boolean),
          handoffTriggers: triggersText.split(",").map((s) => s.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("Agente SDR salvo.");
      void qc.invalidateQueries({ queryKey: ["crm-sdr-agent", workspaceId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of buffer) binary += String.fromCharCode(byte);
      return upload({
        data: {
          workspaceId: workspaceId as string,
          fileName: file.name,
          mimeType: file.type || "application/pdf",
          contentBase64: btoa(binary),
        },
      });
    },
    onSuccess: () => {
      toast.success("Arquivo adicionado à base de conhecimento.");
      void qc.invalidateQueries({ queryKey: ["crm-sdr-agent", workspaceId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!workspaceId) return null;

  return (
    <div className="space-y-6">
      <Section
        title="Agente SDR"
        description="Um agente por marca. Responde no WhatsApp, qualifica, pontua e agenda reuniões."
        actions={
          <div className="flex items-center gap-3">
            <Badge variant={form.isActive ? "default" : "secondary"}>
              {form.isActive ? "Ativo" : "Inativo"}
            </Badge>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              aria-label="Ativar agente"
            />
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome do agente">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Tom de voz">
            <Input value={form.tone} onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value }))} />
          </Field>
          <Field label="Persona" hint="Como o agente se apresenta e se comporta.">
            <Textarea
              rows={3}
              value={form.persona}
              onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
            />
          </Field>
          <Field label="Objetivo">
            <Textarea rows={3} value={form.goal} onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))} />
          </Field>
        </div>
      </Section>

      <Section title="Base de conhecimento" description="Texto livre e arquivos PDF ou FAQ. O agente nunca inventa informação.">
        <Textarea
          rows={6}
          placeholder="Produtos, preços públicos, diferenciais, perguntas frequentes…"
          value={form.knowledgeText}
          onChange={(e) => setForm((f) => ({ ...f, knowledgeText: e.target.value }))}
        />
        <div className="mt-4 space-y-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            {uploadMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Enviar PDF ou FAQ
            <input
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
                e.target.value = "";
              }}
            />
          </label>
          <ul className="space-y-2">
            {(data?.documents ?? []).map((doc) => (
              <li key={doc.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span className="truncate">{doc.file_name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remover arquivo"
                  onClick={() =>
                    removeDoc({ data: { workspaceId, documentId: doc.id } }).then(() => {
                      toast.success("Arquivo removido.");
                      void qc.invalidateQueries({ queryKey: ["crm-sdr-agent", workspaceId] });
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section
        title="Perguntas de qualificação"
        description={`Soma dos pesos: ${totalWeight}. Nota mínima para qualificar: ${form.minScore}.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setForm((f) => ({ ...f, questions: [...f.questions, { key: "", question: "", weight: 10 }] }))
            }
          >
            <Plus className="size-4" /> Pergunta
          </Button>
        }
      >
        <div className="space-y-3">
          {form.questions.map((q, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-[1fr_2fr_auto_auto] md:items-center">
              <Input
                placeholder="chave (ex.: cidade)"
                value={q.key}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    questions: f.questions.map((item, i) => (i === index ? { ...item, key: e.target.value } : item)),
                  }))
                }
              />
              <Input
                placeholder="Pergunta feita ao lead"
                value={q.question}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    questions: f.questions.map((item, i) => (i === index ? { ...item, question: e.target.value } : item)),
                  }))
                }
              />
              <Input
                type="number"
                className="md:w-24"
                value={q.weight}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    questions: f.questions.map((item, i) =>
                      i === index ? { ...item, weight: Number(e.target.value) } : item,
                    ),
                  }))
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remover pergunta"
                onClick={() => setForm((f) => ({ ...f, questions: f.questions.filter((_, i) => i !== index) }))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Field label="Nota mínima para considerar Qualificado">
            <Input
              type="number"
              className="w-32"
              value={form.minScore}
              onChange={(e) => setForm((f) => ({ ...f, minScore: Number(e.target.value) }))}
            />
          </Field>
        </div>
      </Section>

      <Section title="Agenda e atendimento" description="Link de agenda ou horários fixos, janela de atendimento e limites.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Link de agenda" hint="Google Calendar, Calendly ou similar.">
            <Input
              placeholder="https://calendly.com/…"
              value={form.schedulingLink}
              onChange={(e) => setForm((f) => ({ ...f, schedulingLink: e.target.value }))}
            />
          </Field>
          <Field label="Horários disponíveis" hint="Um por linha, usados quando não há link de agenda.">
            <Textarea rows={3} value={slotsText} onChange={(e) => setSlotsText(e.target.value)} />
          </Field>
          <Field label="Início do atendimento">
            <Input
              type="time"
              value={form.businessHours.start}
              onChange={(e) =>
                setForm((f) => ({ ...f, businessHours: { ...f.businessHours, start: e.target.value } }))
              }
            />
          </Field>
          <Field label="Fim do atendimento">
            <Input
              type="time"
              value={form.businessHours.end}
              onChange={(e) => setForm((f) => ({ ...f, businessHours: { ...f.businessHours, end: e.target.value } }))}
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {DAYS.map((day) => {
            const active = form.businessHours.days.includes(day.value);
            return (
              <Button
                key={day.value}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    businessHours: {
                      ...f.businessHours,
                      days: active
                        ? f.businessHours.days.filter((d) => d !== day.value)
                        : [...f.businessHours.days, day.value].sort(),
                    },
                  }))
                }
              >
                {day.label}
              </Button>
            );
          })}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Mensagem fora do horário">
            <Textarea
              rows={2}
              value={form.offhoursMessage}
              onChange={(e) => setForm((f) => ({ ...f, offhoursMessage: e.target.value }))}
            />
          </Field>
          <Field label="Limite de mensagens por conversa">
            <Input
              type="number"
              value={form.maxMessages}
              onChange={(e) => setForm((f) => ({ ...f, maxMessages: Number(e.target.value) }))}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Gatilhos de transferência para humano" hint="Separe por vírgula.">
            <Input value={triggersText} onChange={(e) => setTriggersText(e.target.value)} />
          </Field>
        </div>
        <div className="mt-6">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar agente
          </Button>
        </div>
      </Section>

      <TestChat workspaceId={workspaceId} run={test} enabled={!!data?.agent} />

      <Section title="Log de execuções" description="Auditoria de cada resposta: decisão, score, tokens e tempo.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Quando</th>
                <th>Modo</th>
                <th>Score</th>
                <th>Decisão</th>
                <th>Tokens</th>
                <th>Tempo</th>
              </tr>
            </thead>
            <tbody>
              {(data?.runs ?? []).map((run) => (
                <tr key={run.id} className="border-t border-border/60">
                  <td className="py-2">{new Date(run.created_at).toLocaleString("pt-BR")}</td>
                  <td>{run.mode === "test" ? "Teste" : "Produção"}</td>
                  <td>{run.score ?? "—"}</td>
                  <td className="max-w-[240px] truncate">
                    {run.status === "error" ? `Erro: ${run.error_message}` : run.handoff ? "Transferido" : "Respondido"}
                  </td>
                  <td>{(run.input_tokens ?? 0) + (run.output_tokens ?? 0) || "—"}</td>
                  <td>{run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                </tr>
              ))}
              {!(data?.runs ?? []).length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    Nenhuma execução registrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function TestChat({
  workspaceId,
  run,
  enabled,
}: {
  workspaceId: string;
  run: ReturnType<typeof useServerFn<typeof testSdrAgent>>;
  enabled: boolean;
}) {
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [last, setLast] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...history, { role: "user" as const, content: text }];
    setHistory(next);
    setDraft("");
    setBusy(true);
    try {
      const result = await run({ data: { workspaceId, history: next } });
      setHistory([...next, { role: "assistant", content: result.reply }]);
      setLast(result.decision as unknown as Record<string, unknown>);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível testar o agente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Testar agente" description="Converse com o agente antes de ativá-lo. Nada é salvo em leads reais.">
      {!enabled ? (
        <p className="text-sm text-muted-foreground">Salve a configuração do agente para liberar o teste.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-3">
            <div className="min-h-[220px] space-y-2 rounded-md border border-border p-3">
              {history.length === 0 && (
                <p className="text-sm text-muted-foreground">Envie uma mensagem como se fosse o lead.</p>
              )}
              {history.map((msg, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user" ? "bg-muted" : "ml-auto bg-primary/10"
                  }`}
                >
                  {msg.role === "assistant" && <Bot className="mb-1 inline size-3.5 opacity-70" />} {msg.content}
                </div>
              ))}
              {busy && <p className="text-sm text-muted-foreground">Agente pensando…</p>}
            </div>
            <div className="flex gap-2">
              <Input
                value={draft}
                placeholder="Mensagem do lead"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void send();
                }}
              />
              <Button onClick={() => void send()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
          <pre className="max-h-[320px] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
            {last ? JSON.stringify(last, null, 2) : "A decisão da IA aparece aqui."}
          </pre>
        </div>
      )}
    </Section>
  );
}
