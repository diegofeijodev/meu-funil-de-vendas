"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { approvePost, rejectPost } from "@/lib/instagram/instagram.functions";
import { EmptyState, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FORMATS, MediaThumb, fmtDateTime, useIgPosts } from "./shared";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

/** Lista de posts do Instagram aguardando aprovação — usada na aba Instagram e em Aprovações. */
export function IgApprovalList({
  workspaceId,
  onOpen,
  canEdit = true,
}: {
  workspaceId: string;
  onOpen?: (id: string) => void;
  canEdit?: boolean;
}) {
  const qc = useQueryClient();
  const { data: posts = [], isLoading } = useIgPosts(workspaceId);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const approve = useServerFn(approvePost);
  const reject = useServerFn(rejectPost);
  const pending = posts.filter((p) => p.status === "pending_approval" || p.status === "needs_review");

  const act = async (ids: string[], kind: "approve" | "reject") => {
    let reason = "";
    if (kind === "reject") {
      reason = window.prompt("Motivo da rejeição:") ?? "";
      if (!reason) return;
    }
    setBusy(true);
    let ok = 0;
    for (const id of ids) {
      try {
        await (kind === "approve"
          ? approve({ data: { workspaceId, postId: id } })
          : reject({ data: { workspaceId, postId: id, reason } }));
        ok++;
      } catch (e) {
        toast.error(apiErrorMessage(e, "Falha."));
      }
    }
    setBusy(false);
    setSel(new Set());
    qc.invalidateQueries({ queryKey: ["ig-posts", workspaceId] });
    if (ok)
      toast.success(
        kind === "approve" ? `${ok} post(s) aprovado(s).` : `${ok} post(s) rejeitado(s).`,
      );
  };

  if (isLoading) return <div className="h-32 animate-pulse rounded-lg bg-muted" />;
  if (!pending.length)
    return (
      <EmptyState
        title="Nenhum post do Instagram pendente"
        description="Posts com mídia gerada aparecem aqui para aprovação."
      />
    );

  const all = sel.size === pending.length;
  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={all}
              onCheckedChange={() => setSel(all ? new Set() : new Set(pending.map((p) => p.id)))}
            />
            Selecionar todos
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={!sel.size || busy}
              onClick={() => act([...sel], "reject")}
            >
              Rejeitar selecionados
            </Button>
            <Button size="sm" disabled={!sel.size || busy} onClick={() => act([...sel], "approve")}>
              {busy && <Loader2 className="size-4 animate-spin" />} Aprovar selecionados ({sel.size}
              )
            </Button>
          </div>
        </div>
      )}
      {pending.map((p) => (
        <div
          key={p.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface/50 p-3"
        >
          {canEdit && (
            <Checkbox
              checked={sel.has(p.id)}
              onCheckedChange={() => {
                const n = new Set(sel);
                n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                setSel(n);
              }}
              aria-label="Selecionar post"
            />
          )}
          <MediaThumb post={p} className="size-14 shrink-0" />
          <button
            className="min-w-0 flex-1 text-left"
            onClick={() => onOpen?.(p.id)}
            disabled={!onOpen}
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={p.status === "needs_review" ? "error" : "pending"} label={`${p.status === "needs_review" ? "Precisa de revisão" : "Instagram"} · ${FORMATS[p.format]?.label}`} />
              <span className="text-xs text-muted-foreground">{fmtDateTime(p.scheduled_at)}</span>
            </div>
            <p className="mt-1 truncate text-sm font-medium">{p.theme ?? "Post"}</p>
            <p className="line-clamp-1 text-xs text-muted-foreground">{p.caption}</p>
            {p.review_reason && <p className="mt-1 text-xs text-destructive">Motivo: {p.review_reason}</p>}
          </button>
          {canEdit && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => act([p.id], "reject")}
              >
                Rejeitar
              </Button>
              <Button size="sm" disabled={busy} onClick={() => act([p.id], "approve")}>
                Aprovar
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
