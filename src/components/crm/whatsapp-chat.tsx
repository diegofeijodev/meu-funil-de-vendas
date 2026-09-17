import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Send, Image as ImageIcon, Mic, Check, CheckCheck, Clock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/routes/_authenticated/crm.index";
import { cn } from "@/lib/utils";
import { sendWhatsAppMessage } from "@/lib/crm-integrations.functions";

type Message = {
  id: string;
  direction: "in" | "out";
  kind: string;
  body: string | null;
  media_url: string | null;
  status: string;
  created_at: string;
};

const STATUS_ICON: Record<string, typeof Check> = {
  queued: Clock,
  sent: Check,
  delivered: CheckCheck,
  read: CheckCheck,
  failed: AlertTriangle,
};

/** WhatsApp conversation for one lead: sends text, media and templates. */
export function WhatsAppChat({
  workspaceId,
  leadId,
  phone,
  unsubscribed,
}: {
  workspaceId: string;
  leadId: string;
  phone: string | null;
  unsubscribed: boolean;
}) {
  const qc = useQueryClient();
  const send = useServerFn(sendWhatsAppMessage);
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaKind, setMediaKind] = useState<"image" | "audio">("image");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const { data: integration } = useQuery({
    queryKey: ["crm-wa-integration", workspaceId],
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_integrations")
        .select("provider, status")
        .eq("workspace_id", workspaceId)
        .eq("kind", "whatsapp")
        .maybeSingle();
      return data;
    },
  });

  const { data: conversation } = useQuery({
    queryKey: ["crm-conversation", leadId],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_conversations")
        .select("id, window_expires_at, unread_count")
        .eq("lead_id", leadId)
        .maybeSingle();
      return data;
    },
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["crm-messages", conversation?.id],
    enabled: !!conversation?.id,
    refetchInterval: 10000,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_messages")
        .select("id, direction, kind, body, media_url, status, created_at")
        .eq("conversation_id", conversation!.id)
        .order("created_at");
      return (data ?? []) as unknown as Message[];
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["crm-wa-templates", workspaceId],
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_wa_templates")
        .select("name, language, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "APPROVED")
        .order("name");
      return data ?? [];
    },
  });

  const { data: quickReplies = [] } = useQuery({
    queryKey: ["crm-quick-replies", workspaceId],
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_quick_replies")
        .select("id, title, body")
        .eq("workspace_id", workspaceId)
        .order("title");
      return data ?? [];
    },
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const connected = integration?.status === "connected";
  const official = integration?.provider === "whatsapp_cloud";
  const expires = conversation?.window_expires_at ? new Date(conversation.window_expires_at).getTime() : 0;
  const windowOpen = !official || expires > Date.now();
  const blocked = !connected || unsubscribed || !phone;

  const doSend = async (payload: Parameters<typeof send>[0]["data"]) => {
    setBusy(true);
    try {
      await send({ data: payload });
      setText("");
      setMediaUrl("");
      await qc.invalidateQueries({ queryKey: ["crm-messages", conversation?.id] });
      await qc.invalidateQueries({ queryKey: ["crm-conversation", leadId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar a mensagem.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="max-h-[420px] min-h-[180px] flex-1 space-y-2 overflow-y-auto rounded-lg border border-border bg-background/50 p-3">
        {!messages.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma mensagem nesta conversa ainda.</p>
        )}
        {messages.map((m) => {
          const Icon = STATUS_ICON[m.status] ?? Clock;
          return (
            <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                  m.direction === "out" ? "bg-primary text-primary-foreground" : "bg-secondary",
                )}
              >
                {m.media_url && m.kind === "image" && (
                  <img src={m.media_url} alt="Imagem enviada na conversa" className="mb-1 max-h-48 rounded-lg" loading="lazy" />
                )}
                {m.media_url && m.kind === "audio" && <audio controls src={m.media_url} className="mb-1 w-56" />}
                {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
                  {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  {m.direction === "out" && <Icon className={cn("size-3", m.status === "read" && "text-sky-400")} />}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {!connected && (
        <p className="mt-3 rounded-lg border border-border p-3 text-sm text-muted-foreground">
          Conecte o WhatsApp em CRM › Integrações para conversar por aqui.
        </p>
      )}
      {connected && unsubscribed && (
        <p className="mt-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          Este contato pediu para sair. Envios estão bloqueados.
        </p>
      )}

      {connected && !unsubscribed && (
        <div className="mt-3 space-y-3">
          {!!quickReplies.length && windowOpen && (
            <div className="flex flex-wrap gap-1">
              {quickReplies.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setText(q.body)}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:bg-secondary"
                >
                  {q.title}
                </button>
              ))}
            </div>
          )}

          {windowOpen ? (
            <>
              <div className="flex gap-2">
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Escreva uma mensagem…"
                  disabled={blocked || busy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && text.trim()) doSend({ workspaceId, leadId, kind: "text", body: text });
                  }}
                />
                <Button
                  disabled={blocked || busy || !text.trim()}
                  onClick={() => doSend({ workspaceId, leadId, kind: "text", body: text })}
                >
                  <Send className="size-4" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Select value={mediaKind} onChange={(v) => setMediaKind(v as "image" | "audio")}>
                  <option value="image">Imagem</option>
                  <option value="audio">Áudio</option>
                </Select>
                <Input
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  placeholder="URL da mídia"
                  disabled={blocked || busy}
                />
                <Button
                  variant="outline"
                  disabled={blocked || busy || !mediaUrl.trim()}
                  onClick={() => doSend({ workspaceId, leadId, kind: mediaKind, mediaUrl })}
                >
                  {mediaKind === "image" ? <ImageIcon className="size-4" /> : <Mic className="size-4" />}
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2 rounded-lg border border-amber-500/40 p-3">
              <p className="text-sm text-muted-foreground">
                Passaram mais de 24 horas desde a última mensagem do contato. Só é possível enviar um template aprovado.
              </p>
              <div className="flex gap-2">
                <Select value={template} onChange={setTemplate}>
                  <option value="">Escolha um template</option>
                  {templates.map((t) => (
                    <option key={`${t.name}-${t.language}`} value={`${t.name}|${t.language}`}>
                      {t.name} ({t.language})
                    </option>
                  ))}
                </Select>
                <Button
                  disabled={blocked || busy || !template}
                  onClick={() => {
                    const [name, language] = template.split("|");
                    doSend({
                      workspaceId,
                      leadId,
                      kind: "template",
                      templateName: name ?? "",
                      templateLanguage: language ?? "pt_BR",
                    });
                  }}
                >
                  Enviar template
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
