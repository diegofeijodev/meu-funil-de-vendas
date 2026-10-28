"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { approvableStories, checkAlertLine } from "@/lib/vacancy-stories";
import type { VacancyStory } from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { StoryThumb, useStoriesQuery, type OnStoryAction } from "./stories-list";
import type { StoryActions } from "./use-story-actions";

/**
 * Cartão "Para aprovar" (UI §2): um por story esperando E ainda no prazo (A4: depois do prazo sai daqui, mesmo antes da expiração),
 * com a conferência (ou o alerta da reserva reprovada — A3), o prazo dito pela API e os botões Não postar / Aprovar.
 */
export function ApproveList({
  workspaceId,
  actions,
  onAction,
  onOpen,
}: {
  workspaceId: string;
  actions: StoryActions;
  onAction: OnStoryAction;
  onOpen: (story: VacancyStory) => void;
}) {
  const q = useStoriesQuery(workspaceId, "all");
  const rows = approvableStories(q.data ?? [], actions.hidden);

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="vac-approve-title">
      <h2 id="vac-approve-title" className="text-base font-semibold">
        Para aprovar{rows.length > 0 ? ` (${rows.length})` : ""}
      </h2>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" aria-label="Carregando os stories para aprovar" />
      ) : q.isError && !q.data ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm">Não conseguimos carregar as vagas. Verifique a conexão e toque em Tentar de novo.</p>
          <Button className="h-11" variant="outline" disabled={q.isFetching} onClick={() => q.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum story esperando você agora.</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((s) => {
            const busy = actions.busy.has(s.id);
            return (
              <li key={s.id} className="rounded-lg border p-3">
                <div className="flex gap-3">
                  {/* B5b: a miniatura é o caminho natural para ver a arte grande antes de aprovar. */}
                  <button
                    type="button"
                    className="w-24 shrink-0 space-y-1 rounded-md text-center text-xs font-medium text-primary focus-visible:outline focus-visible:outline-2"
                    onClick={() => onOpen(s)}
                    aria-label={`Ver a arte: ${s.funcao}${s.valor ? `, ${s.valor}` : ""}, ${s.quando}${s.cidade ? `, ${s.cidade}` : ""}`}
                  >
                    <StoryThumb story={s} className="w-24" />
                    <span className="block underline-offset-4 hover:underline">Ver a arte</span>
                  </button>
                  <div className="min-w-0 flex-1 space-y-1 text-sm">
                    <button
                      type="button"
                      className="block min-h-11 w-full text-left text-base font-semibold hover:underline focus-visible:outline focus-visible:outline-2"
                      onClick={() => onOpen(s)}
                    >
                      {s.funcao}
                      {s.estabelecimento ? ` · ${s.estabelecimento}` : ""}
                    </button>
                    {s.valor && <p>{s.valor}</p>}
                    <p>{s.quando}</p>
                    {s.cidade && <p>{s.cidade}</p>}
                    {s.own_art ? (
                      <p>A sua arte não passa pela conferência.</p>
                    ) : s.check_alert ? (
                      <p className="font-medium">
                        <span className="text-warning" aria-hidden>
                          !
                        </span>{" "}
                        {checkAlertLine(s.check_alert)}
                      </p>
                    ) : (
                      <p>
                        <span className="text-success" aria-hidden>
                          ✓
                        </span>{" "}
                        Conferido: função, valor, data, horário, cidade
                      </p>
                    )}
                    {s.support && (
                      <p className="font-medium">
                        <span className="text-warning" aria-hidden>
                          !
                        </span>{" "}
                        {s.support}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button className="h-11 flex-1" variant="outline" disabled={busy} onClick={() => onAction("dont_post", s)}>
                    Não postar
                  </Button>
                  <Button className="h-11 flex-1" disabled={busy || !s.can.approve} onClick={() => onAction("approve", s)}>
                    Aprovar
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
