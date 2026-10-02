"use client";

import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/crm/select";
import { useMembers } from "@/lib/crm-queries";
import { listConversations, type InboxRow } from "@/modules/crm/infrastructure/crm-channels.api";
import { WhatsAppChat } from "@/components/crm/whatsapp-chat";
import { cn } from "@/lib/utils";
import { fullDate } from "@/lib/format";

type Row = InboxRow;

export function InboxPage() {
  const { workspaceId } = useWorkspace();
  const { data: members = [] } = useMembers(workspaceId);
  const [owner, setOwner] = useState("all");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ["crm-inbox", workspaceId],
    enabled: !!workspaceId,
    refetchInterval: 15000,
    queryFn: () => listConversations(workspaceId!),
  });

  const filtered = conversations.filter((c) => {
    if (onlyUnread && !c.unread_count) return false;
    if (owner !== "all" && c.crm_leads?.owner_id !== owner) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${c.crm_leads?.name ?? ""} ${c.phone}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const active = selected ?? filtered[0] ?? null;

  return (
    <div>
      <PageHeader title="Inbox do WhatsApp" subtitle="Todas as conversas do workspace, com não lidas em destaque." />
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Section title="Conversas" description={`${filtered.length} conversa(s)`}>
          <div className="space-y-2">
            <Input placeholder="Buscar nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={owner} onChange={setOwner}>
              <option value="all">Todos os responsáveis</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.label}</option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
              Somente não lidas
            </label>
          </div>
          <div className="mt-3 max-h-[520px] space-y-1 overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c)}
                className={cn(
                  "w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-secondary",
                  active?.id === c.id && "border-primary bg-secondary",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.crm_leads?.name ?? c.phone}</span>
                  {c.unread_count > 0 && (
                    <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">{c.unread_count}</span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{c.last_message_preview ?? "Sem mensagens"}</p>
                {c.last_message_at && <p className="text-[10px] text-muted-foreground">{fullDate(c.last_message_at)}</p>}
              </button>
            ))}
            {!filtered.length && <p className="p-4 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada.</p>}
          </div>
        </Section>

        <Section
          title={active?.crm_leads?.name ?? active?.phone ?? "Conversa"}
          description={active?.lead_id ? "Chat conectado à ficha do lead." : "Conversa sem lead vinculado."}
        >
          {active?.lead_id && workspaceId ? (
            <>
              <Link to="/crm/leads/$id" params={{ id: active.lead_id }} className="mb-3 inline-flex items-center gap-1 text-sm text-primary">
                <MessageSquare className="size-4" /> Abrir ficha completa
              </Link>
              <WhatsAppChat
                workspaceId={workspaceId}
                leadId={active.lead_id}
                phone={active.crm_leads?.phone ?? active.phone}
                unsubscribed={!!active.crm_leads?.unsubscribed}
              />
            </>
          ) : (
            <p className="p-8 text-center text-sm text-muted-foreground">Selecione uma conversa para responder.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
