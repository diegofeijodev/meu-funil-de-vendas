"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/lib/workspace";
import { postNowDialog, vagasTabState } from "@/lib/vacancy-stories";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useVacancySettings,
  type VacancyStory,
  type VacancyStoryFilter,
} from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { ApproveList } from "./approve-list";
import { StoriesList, type StoryActionKind } from "./stories-list";
import { StoryDetailSheet } from "./story-detail";
import { useStoryActions } from "./use-story-actions";
import { VacanciesFirstRun } from "./first-run";
import { VacanciesStatusCard } from "./status-card";

type Confirm = { kind: "post_now" | "create_anyway"; story: VacancyStory };

/**
 * Aba "Vagas" do Instagram. Ordem no celular: situação → "Para aprovar" → "Vagas que chegaram" → "Ajustes".
 * Os três últimos entram nas Tasks 13 e 14 pelos contêineres `data-vac-section` abaixo.
 */
export function VacanciesTab({ workspaceId }: { workspaceId: string }) {
  const { role, canEdit } = useWorkspace();
  const canManage = role === "owner" || role === "admin";
  const query = useVacancySettings(workspaceId);
  const { data: settings, refetch, isFetching } = query;
  const state = vagasTabState(query);
  const actions = useStoryActions(workspaceId);
  const [filter, setFilter] = useState<VacancyStoryFilter>("all");
  const [open, setOpen] = useState<VacancyStory | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  // Postar agora e vaga de teste pedem confirmação. O painel de detalhe fecha antes: nada de diálogo dentro de diálogo.
  const onAction = (kind: StoryActionKind, story: VacancyStory) => {
    if (kind === "post_now" || (kind === "create_anyway" && story.is_test)) {
      setOpen(null);
      setConfirm({ kind, story });
      return;
    }
    if (kind === "dont_post") {
      setOpen(null);
      actions.dontPost(story);
    } else if (kind === "approve") void actions.approve(story).then((ok) => ok && setOpen(null));
    else if (kind === "create_anyway") void actions.createAnyway(story);
    else void actions.redo(story); // redo e retry usam a mesma rota
  };

  if (state === "loading")
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Carregando as vagas">
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[9/16] w-full max-w-[200px]" />
          ))}
        </div>
      </div>
    );

  if (state === "error")
    return (
      <div className="panel space-y-3 p-5" role="alert">
        <p className="text-sm">Não conseguimos carregar as vagas. Verifique a conexão e toque em Tentar de novo.</p>
        <Button className="h-11" variant="outline" disabled={isFetching} onClick={() => refetch()}>
          Tentar de novo
        </Button>
      </div>
    );

  // 404 = empresa fora da lista: sem aba (a página já cai em "Visão geral").
  if (state === "hidden" || !settings) return null;

  return (
    <div className="space-y-6">
      {settings.template ? (
        <VacanciesStatusCard workspaceId={workspaceId} settings={settings} canManage={canManage} />
      ) : (
        <VacanciesFirstRun workspaceId={workspaceId} canEdit={canEdit} />
      )}
      <div data-vac-section="approve">
        <ApproveList workspaceId={workspaceId} actions={actions} onAction={onAction} onOpen={setOpen} />
      </div>
      <div data-vac-section="arrived">
        <StoriesList
          workspaceId={workspaceId}
          settings={settings}
          filter={filter}
          onFilter={setFilter}
          actions={actions}
          onAction={onAction}
          onOpen={setOpen}
        />
      </div>
      <StoryDetailSheet workspaceId={workspaceId} story={open} actions={actions} onAction={onAction} onClose={() => setOpen(null)} />
      <ConfirmStory confirm={confirm} settings={settings} onClose={() => setConfirm(null)} actions={actions} />
      {/* Task 14: "Ajustes" (fechado, com o resumo de 1 linha) */}
      <div data-vac-section="settings" />
    </div>
  );
}

/** Diálogos de "Postar agora" (fora do horário / acima do limite) e "Criar story" em vaga de teste (UI §4). */
function ConfirmStory({
  confirm,
  settings,
  actions,
  onClose,
}: {
  confirm: Confirm | null;
  settings: NonNullable<ReturnType<typeof useVacancySettings>["data"]>;
  actions: ReturnType<typeof useStoryActions>;
  onClose: () => void;
}) {
  let text = { title: "", description: "", confirm: "", cancel: "" };
  if (confirm?.kind === "post_now") {
    text = postNowDialog(confirm.story.display === "waiting_cap" ? "waiting_cap" : "waiting_window", settings, new Date());
  } else if (confirm) {
    text = {
      title: "Criar story numa vaga de teste?",
      description: `Essa vaga parece de teste (${confirm.story.contractor_name ?? confirm.story.funcao}). Criar o story mesmo assim?`,
      confirm: "Criar story",
      cancel: "Cancelar",
    };
  }
  return (
    <AlertDialog open={!!confirm} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-11">{text.cancel}</AlertDialogCancel>
          <AlertDialogAction
            className="h-11"
            onClick={() => {
              if (!confirm) return;
              if (confirm.kind === "post_now") void actions.postNow(confirm.story);
              else void actions.createAnyway(confirm.story);
            }}
          >
            {text.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
