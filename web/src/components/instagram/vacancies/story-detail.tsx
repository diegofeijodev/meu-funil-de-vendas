"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { attemptsLine, fieldLabel } from "@/lib/vacancy-stories";
import { getVacancyStory, type VacancyStory } from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { SituationLabel, StoryActionsBar, StoryBadges, type OnStoryAction } from "./stories-list";
import { vacancyDetailKey, type StoryActions } from "./use-story-actions";

/** Detalhe em painel de baixo para cima: prévia 9:16, conferência com a vaga, tentativas, reserva e ações. */
export function StoryDetailSheet({
  workspaceId,
  story,
  actions,
  onAction,
  onClose,
}: {
  workspaceId: string;
  story: VacancyStory | null;
  actions: StoryActions;
  onAction: OnStoryAction;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!story} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto sm:mx-auto sm:max-w-xl">
        {story && <DetailBody workspaceId={workspaceId} story={story} actions={actions} onAction={onAction} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  workspaceId,
  story,
  actions,
  onAction,
  onClose,
}: {
  workspaceId: string;
  story: VacancyStory;
  actions: StoryActions;
  onAction: OnStoryAction;
  onClose: () => void;
}) {
  const q = useQuery({ queryKey: vacancyDetailKey(workspaceId, story.id), queryFn: () => getVacancyStory(workspaceId, story.id) });
  const [cover, setCover] = useState(false);
  const [showTries, setShowTries] = useState(false);
  const d = q.data;
  const s = d ?? story; // enquanto carrega, o cartão da lista já tem o essencial
  const line = d ? attemptsLine(d) : null;
  const busy = actions.busy.has(s.id);

  return (
    <>
      <SheetHeader className="text-left">
        <SheetTitle>
          {s.funcao}
          {s.estabelecimento ? ` · ${s.estabelecimento}` : ""}
        </SheetTitle>
        <SheetDescription>{[s.valor, s.quando, s.cidade].filter(Boolean).join(" · ")}</SheetDescription>
      </SheetHeader>

      <div className="mt-4 space-y-5">
        <div className="space-y-1">
          <SituationLabel story={s} />
          {s.support && <p className="text-sm text-muted-foreground">{s.support}</p>}
          {s.reason && <p className="text-sm text-muted-foreground">{s.reason}</p>}
          <StoryBadges story={s} />
        </div>

        {s.media_url ? (
          <div className="space-y-2">
            <div className="relative mx-auto aspect-[9/16] w-[280px] max-w-full overflow-hidden rounded-lg bg-muted">
              <img src={s.media_url} alt={d?.alt ?? `Story: ${s.funcao}, ${s.quando}`} className="size-full object-cover" />
              {cover && (
                <>
                  {/* O Instagram cobre ~14% no topo (perfil) e ~20% embaixo (resposta). */}
                  <div className="absolute inset-x-0 top-0 h-[14%] bg-black/50" aria-hidden />
                  <div className="absolute inset-x-0 bottom-0 h-[20%] bg-black/50" aria-hidden />
                </>
              )}
            </div>
            <div className="flex justify-center">
              <Button className="h-11" variant="outline" aria-pressed={cover} onClick={() => setCover((v) => !v)}>
                {cover ? "Esconder o que o Instagram cobre" : "Mostrar o que o Instagram cobre"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">A arte ainda não foi criada.</p>
        )}

        {q.isLoading ? (
          <Skeleton className="h-32 w-full" aria-label="Carregando a conferência" />
        ) : q.isError ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm">Não conseguimos carregar o detalhe. Verifique a conexão e toque em Tentar de novo.</p>
            <Button className="h-11" variant="outline" onClick={() => q.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : d ? (
          <>
            {d.own_art ? (
              <p className="rounded-lg border bg-muted/40 p-3 text-sm">A sua arte não passa pela conferência.</p>
            ) : d.checks.length > 0 ? (
              <table className="w-full text-sm">
                <caption className="pb-2 text-left font-semibold">Confira com a vaga</caption>
                <tbody>
                  {d.checks.map((c) => (
                    <tr key={c.key} className="border-t">
                      <th scope="row" className="py-2 pr-3 text-left font-medium capitalize">
                        {c.label}
                      </th>
                      <td className="py-2">
                        {c.ok ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <Check className="size-4" aria-hidden /> confere
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <X className="size-4" aria-hidden /> diferente{c.read ? `: a arte diz ${c.read}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {line && !d.used_fallback && <p className="text-sm text-muted-foreground">{line}</p>}

            {d.used_fallback && (
              <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
                <p className="text-sm">{line}</p>
                <div className="flex flex-wrap gap-2">
                  {d.can.redo && (
                    <Button className="h-11" variant="outline" disabled={busy} onClick={() => onAction("redo", d)}>
                      Tentar de novo com a IA
                    </Button>
                  )}
                  <Button className="h-11" variant="outline" aria-expanded={showTries} onClick={() => setShowTries((v) => !v)}>
                    Ver as 3 tentativas
                  </Button>
                </div>
                {showTries && (
                  <ol className="space-y-1 text-sm">
                    {d.attempts_log
                      .filter((a) => a.kind === "ai")
                      .map((a) => (
                        <li key={a.n}>
                          Tentativa {a.n}:{" "}
                          {a.ok ? "confere" : a.wrong.length ? `errou ${a.wrong.map(fieldLabel).join(" e ")}` : a.error ?? "não passou na conferência"}
                        </li>
                      ))}
                  </ol>
                )}
              </div>
            )}
          </>
        ) : null}

        <a
          href={s.freela_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          Abrir a vaga no Freela <span aria-hidden>↗</span>
        </a>

        <div className="space-y-2">
          <StoryActionsBar story={s} onAction={onAction} actions={actions} />
          {s.can.redo && !d?.used_fallback && (
            <Button className="h-11 w-full sm:w-auto" variant="outline" disabled={busy} onClick={() => onAction("redo", s)}>
              Refazer a arte
            </Button>
          )}
          <Button className="h-11 w-full sm:w-auto" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </>
  );
}
