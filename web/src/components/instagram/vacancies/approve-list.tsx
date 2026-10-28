"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { dmLabel, hhLabel } from "@/lib/vacancy-stories";
import type { VacancyStory } from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { StoryThumb, useStoriesQuery, type OnStoryAction } from "./stories-list";
import type { StoryActions } from "./use-story-actions";

/** "Aprove até 16h" (com o dia quando não é hoje). */
function untilLabel(iso: string): string {
  const hoje = dmLabel(new Date().toISOString());
  return dmLabel(iso) === hoje ? `Aprove até ${hhLabel(iso)}` : `Aprove até ${dmLabel(iso)} às ${hhLabel(iso)}`;
}

/** Cartão "Para aprovar" (UI §2): um por story esperando, com a conferência e os botões Não postar / Aprovar. */
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
  const rows = (q.data ?? []).filter((s) => s.display === "to_approve" && !actions.hidden.has(s.id));

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="vac-approve-title">
      <h2 id="vac-approve-title" className="text-base font-semibold">
        Para aprovar{rows.length > 0 ? ` (${rows.length})` : ""}
      </h2>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" aria-label="Carregando os stories para aprovar" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum story esperando você agora.</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((s) => {
            const busy = actions.busy.has(s.id);
            return (
              <li key={s.id} className="rounded-lg border p-3">
                <div className="flex gap-3">
                  <StoryThumb story={s} className="w-24" alt={`Story: ${s.funcao}${s.valor ? `, ${s.valor}` : ""}, ${s.quando}${s.cidade ? `, ${s.cidade}` : ""}`} />
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
                    <p className="text-success">✓ Conferido: função, valor, data, horário, cidade</p>
                    {s.approve_until && <p className="font-medium text-warning">! {untilLabel(s.approve_until)}</p>}
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
