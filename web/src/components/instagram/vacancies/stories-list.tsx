"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  Hourglass,
  Loader2,
  MinusCircle,
  Radio,
  ThumbsUp,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { arrivedEmptyText, reasonChipsFeedback, redoLabel } from "@/lib/vacancy-stories";
import {
  listVacancyStories,
  type VacancySettings,
  type VacancyStory,
  type VacancyStoryFilter,
} from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { vacancyListKey, type StoryActions } from "./use-story-actions";

/** Ação pedida por um botão; o pai decide se abre diálogo (postar agora, vaga de teste) ou executa direto. */
export type StoryActionKind = "approve" | "dont_post" | "post_now" | "create_anyway" | "redo" | "retry";
export type OnStoryAction = (kind: StoryActionKind, story: VacancyStory) => void;

const SITUATION: Record<VacancyStory["display"], { icon: LucideIcon; tone: string; spin?: boolean }> = {
  queued: { icon: Clock, tone: "text-muted-foreground" },
  generating: { icon: Loader2, tone: "text-primary", spin: true },
  waiting_window: { icon: CalendarClock, tone: "text-muted-foreground" },
  waiting_cap: { icon: Hourglass, tone: "text-muted-foreground" },
  to_approve: { icon: ThumbsUp, tone: "text-warning" },
  ready: { icon: CheckCircle2, tone: "text-success" },
  live: { icon: Radio, tone: "text-success" },
  was_live: { icon: History, tone: "text-muted-foreground" },
  skipped: { icon: MinusCircle, tone: "text-muted-foreground" },
  cancelled: { icon: Ban, tone: "text-muted-foreground" },
  failed: { icon: XCircle, tone: "text-destructive" },
};

/** Situação sempre com ícone + texto; "Criando a arte" vive numa região `aria-live`. */
export function SituationLabel({ story }: { story: VacancyStory }) {
  const { icon: Icon, tone, spin } = SITUATION[story.display];
  return (
    <p className="flex items-center gap-1.5 text-sm font-medium" aria-live={story.display === "generating" ? "polite" : undefined}>
      <Icon className={cn("size-4 shrink-0", tone, spin && "animate-spin motion-reduce:animate-none")} aria-hidden />
      <span>{story.label}</span>
    </p>
  );
}

/** Selos "Versão de reserva" e "Refeita {n} vez(es)". */
export function StoryBadges({ story }: { story: VacancyStory }) {
  const redo = redoLabel(story.redo_count);
  if (!story.used_fallback && !redo) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {story.used_fallback && <Badge>Versão de reserva</Badge>}
      {redo && <Badge>{redo}</Badge>}
    </div>
  );
}
function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">{children}</span>;
}

/** Miniatura 9:16 (decorativa nas listas: o texto ao lado já diz tudo). */
export function StoryThumb({ story, className, alt = "" }: { story: VacancyStory; className?: string; alt?: string }) {
  const src = story.thumb_url ?? story.media_url;
  return (
    <div className={cn("relative aspect-[9/16] shrink-0 overflow-hidden rounded-md bg-muted", className)}>
      {src && <img src={src} alt={alt} className="size-full object-cover" loading="lazy" />}
    </div>
  );
}

/** Botões permitidos por `can` (h-11 = 44 px, 8 px de espaço). "Não postar" fica à esquerda de "Aprovar". */
export function StoryActionsBar({
  story,
  onAction,
  actions,
  className,
}: {
  story: VacancyStory;
  onAction: OnStoryAction;
  actions: Pick<StoryActions, "busy">;
  className?: string;
}) {
  const c = story.can;
  const busy = actions.busy.has(story.id);
  const b = (kind: StoryActionKind, label: string, variant: "default" | "outline" = "outline") => (
    <Button key={kind} className="h-11 min-w-[44px] flex-1 sm:flex-none" variant={variant} disabled={busy} onClick={() => onAction(kind, story)}>
      {label}
    </Button>
  );
  const items = [
    c.post_now && b("post_now", "Postar agora"),
    c.create_anyway && b("create_anyway", "Criar story mesmo assim"),
    c.retry && b("retry", "Tentar de novo"),
    c.dont_post && b("dont_post", "Não postar"),
    c.approve && b("approve", "Aprovar", "default"),
  ].filter(Boolean);
  const live = story.display === "live" && story.permalink;
  if (!items.length && !live) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items}
      {live && (
        <Button asChild className="h-11 flex-1 sm:flex-none" variant="outline">
          <a href={story.permalink!} target="_blank" rel="noopener noreferrer">
            Ver no Instagram <ExternalLink className="ml-1 size-4" aria-hidden />
          </a>
        </Button>
      )}
    </div>
  );
}

/** Consulta compartilhada com "Para aprovar" (filtro "all"); atualiza a cada 15 s enquanto a aba está aberta. */
export function useStoriesQuery(ws: string, filter: VacancyStoryFilter) {
  return useQuery({
    queryKey: [...vacancyListKey(ws), filter],
    queryFn: () => listVacancyStories(ws, filter),
    refetchInterval: 15_000,
  });
}

const FILTERS: { value: VacancyStoryFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "live", label: "No ar" },
  { value: "not_posted", label: "Não postadas" },
];

/**
 * "Vagas que chegaram": filtros, cartões com situação/apoio/motivo/selos/ações; toque no cartão abre o detalhe. Story esperando
 * aprovação fica sem botões aqui (B5c): aprovar é em "Para aprovar" ou no detalhe, olhando a arte.
 */
export function StoriesList({
  workspaceId,
  settings,
  filter,
  onFilter,
  actions,
  onAction,
  onOpen,
}: {
  workspaceId: string;
  settings: VacancySettings;
  filter: VacancyStoryFilter;
  onFilter: (f: VacancyStoryFilter) => void;
  actions: StoryActions;
  onAction: OnStoryAction;
  onOpen: (story: VacancyStory) => void;
}) {
  const q = useStoriesQuery(workspaceId, filter);
  const rows = (q.data ?? []).filter((s) => !actions.hidden.has(s.id));

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="vac-arrived-title">
      <h2 id="vac-arrived-title" className="text-base font-semibold">
        Vagas que chegaram
      </h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar vagas">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            className="h-11 min-w-[44px]"
            variant={filter === f.value ? "default" : "outline"}
            aria-pressed={filter === f.value}
            onClick={() => onFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

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

      {q.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando as vagas">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : q.isError && !q.data ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm">Não conseguimos carregar as vagas. Verifique a conexão e toque em Tentar de novo.</p>
          <Button className="h-11" variant="outline" disabled={q.isFetching} onClick={() => q.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{arrivedEmptyText(filter, settings)}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <li key={s.id} className="rounded-lg border p-3">
              <div className="flex gap-3">
                <StoryThumb story={s} className="w-16" />
                <div className="min-w-0 flex-1 space-y-1">
                  <button
                    type="button"
                    className="block min-h-11 w-full text-left font-medium hover:underline focus-visible:outline focus-visible:outline-2"
                    onClick={() => onOpen(s)}
                    aria-label={`Abrir detalhe: ${s.funcao}${s.estabelecimento ? ` · ${s.estabelecimento}` : ""}`}
                  >
                    {s.funcao}
                    {s.estabelecimento ? ` · ${s.estabelecimento}` : ""}
                  </button>
                  <p className="text-xs text-muted-foreground">{[s.valor, s.quando, s.cidade].filter(Boolean).join(" · ")}</p>
                  <SituationLabel story={s} />
                  {s.support && <p className="text-sm text-muted-foreground">{s.support}</p>}
                  {s.reason && (
                    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>{s.reason}</span>
                    </p>
                  )}
                  <StoryBadges story={s} />
                </div>
              </div>
              {s.display !== "to_approve" && <StoryActionsBar story={s} onAction={onAction} actions={actions} className="mt-3" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
