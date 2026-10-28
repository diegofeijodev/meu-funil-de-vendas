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
import { awaitsHuman } from "@/lib/instagram/production";
import { useNavigate } from "@/lib/router";
import { checkedLine, funcaoOfTheme, isOwnArt, postVacancy, reasonChipsFeedback, vagasTabState } from "@/lib/vacancy-stories";
import { useVacancySettings, vacancyDontPost } from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { useStoryActions } from "./vacancies/use-story-actions";

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
  const navigate = useNavigate();
  const actions = useStoryActions(workspaceId);
  const vagasState = vagasTabState(useVacancySettings(workspaceId));
  const hasVagas = vagasState === "ready" || vagasState === "error";
  // Stories de vaga em espera do "Desfazer" (6 s) somem da lista como na aba Vagas.
  const pending = posts.filter(awaitsHuman).filter((p) => {
    const v = postVacancy(p);
    return !(v && actions.hidden.has(v.story_id));
  });

  const open = (p: (typeof posts)[number]) => {
    if (postVacancy(p) && hasVagas) navigate({ to: "/instagram", search: { tab: "vagas" } });
    else onOpen?.(p.id);
  };

  const act = async (ids: string[], kind: "approve" | "reject") => {
    const byId = new Map(posts.map((p) => [p.id, p]));
    const vacancyIds = kind === "reject" ? ids.filter((id) => postVacancy(byId.get(id) ?? {})) : [];
    const others = ids.filter((id) => !vacancyIds.includes(id));
    let reason = "";
    // Só os que não são de vaga pedem motivo: "Não postar" não exige (D5).
    if (kind === "reject" && others.length) {
      reason = window.prompt("Motivo da rejeição:") ?? "";
      if (!reason) return;
    }
    setBusy(true);
    let ok = 0;
    for (const id of ids) {
      try {
        const v = postVacancy(byId.get(id) ?? {});
        if (kind === "reject" && v) await vacancyDontPost(workspaceId, v.story_id);
        else
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
    if (vacancyIds.length) actions.refresh();
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
      {actions.feedback && (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-3" role="status" aria-live="polite">
          <p className="text-sm">O story da vaga {actions.feedback.funcao} não vai ao ar. Quer dizer o motivo?</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(reasonChipsFeedback).map(([label, value]) => (
              <Button key={value} className="h-11" size="sm" variant="outline" onClick={() => actions.sendFeedback(value)}>
                {label}
              </Button>
            ))}
            <Button className="h-11" size="sm" variant="ghost" onClick={actions.dismissFeedback}>
              Agora não
            </Button>
          </div>
        </div>
      )}
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
      {pending.map((p) => {
        const vac = postVacancy(p);
        const own = vac ? isOwnArt(p) : false;
        const conferido = vac && !own ? checkedLine(vac.checked_fields) : null;
        return (
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
            onClick={() => open(p)}
            disabled={!onOpen && !(vac && hasVagas)}
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={p.status === "needs_review" ? "error" : "pending"} label={`${p.status === "needs_review" ? "Precisa de revisão" : "Instagram"} · ${FORMATS[p.format]?.label}`} />
              <span className="text-xs text-muted-foreground">{fmtDateTime(p.scheduled_at)}</span>
            </div>
            <p className="mt-1 truncate text-sm font-medium">{p.theme ?? "Post"}</p>
            {vac ? (
              own ? (
                <p className="text-xs text-muted-foreground">A sua arte não passa pela conferência.</p>
              ) : (
                conferido && (
                <p className="text-xs text-muted-foreground">
                  <span className="text-success" aria-hidden>
                    ✓
                  </span>{" "}
                  {conferido}
                </p>
                )
              )
            ) : (
              <p className="line-clamp-1 text-xs text-muted-foreground">{p.caption}</p>
            )}
            {p.review_reason && <p className="mt-1 text-xs text-destructive">Motivo: {p.review_reason}</p>}
          </button>
          {canEdit && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => (vac ? actions.dontPost({ id: vac.story_id, funcao: funcaoOfTheme(p.theme) }) : act([p.id], "reject"))}
              >
                {vac ? "Não postar" : "Rejeitar"}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => act([p.id], "approve")}>
                Aprovar
              </Button>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}
