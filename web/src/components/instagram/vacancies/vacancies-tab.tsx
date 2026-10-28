"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/lib/workspace";
import { useNavigate, useSearch } from "@/lib/router";
import { approvableStories, postNowDialog, vagasTabState } from "@/lib/vacancy-stories";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
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
  getVacancyStory,
  useVacancySettings,
  type VacancyStory,
  type VacancyStoryFilter,
} from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { ApproveList } from "./approve-list";
import { StoriesList, useStoriesQuery, type StoryActionKind } from "./stories-list";
import { StoryDetailSheet } from "./story-detail";
import { useStoryActions } from "./use-story-actions";
import { VacanciesFirstRun } from "./first-run";
import { VacanciesStatusCard } from "./status-card";
import { VacanciesSettingsPanel } from "./settings-panel";

type Confirm = { kind: "post_now" | "create_anyway"; story: VacancyStory };

/**
 * Aba "Vagas" do Instagram. Ordem no celular: situação → "Para aprovar" → "Vagas que chegaram" → "Ajustes"; com story esperando
 * aprovação, "Para aprovar" vem antes da situação (B5a). Sem arte modelo, só a primeira vez e os Ajustes. `?story=<id>` (vindo de
 * Aprovações) abre o detalhe desse story (B5e).
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
  const stories = useStoriesQuery(workspaceId, "all"); // mesma consulta do "Para aprovar" (cache compartilhado)
  const waiting = approvableStories(stories.data ?? [], actions.hidden).length > 0;
  const search = useSearch();
  const navigate = useNavigate({ from: "/instagram" });
  const deepLink = typeof search["story"] === "string" ? search["story"] : null;

  // B5e: abre o detalhe do story pedido e tira o `story` da URL (voltar à aba não reabre). Fora das 100 mais novas: busca o detalhe.
  useEffect(() => {
    if (!deepLink || !stories.data) return;
    navigate({ search: { tab: "vagas" }, replace: true });
    const found = stories.data.find((s) => s.id === deepLink);
    if (found) setOpen(found);
    else
      getVacancyStory(workspaceId, deepLink).then(setOpen, (e) =>
        toast.error(apiErrorMessage(e, "Não achamos este story. Ele pode ter sido apagado; atualize a tela.")),
      );
  }, [deepLink, stories.data, workspaceId, navigate]);

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

  const status = settings.template ? (
    <VacanciesStatusCard workspaceId={workspaceId} settings={settings} canManage={canManage} />
  ) : (
    <VacanciesFirstRun workspaceId={workspaceId} canEdit={canEdit} />
  );
  const approve = (
    <div data-vac-section="approve">
      <ApproveList workspaceId={workspaceId} actions={actions} onAction={onAction} onOpen={setOpen} />
    </div>
  );

  return (
    <div className="space-y-6">
      {settings.template && waiting && approve}
      {status}
      {/* Sem arte modelo não há story: "Para aprovar" e "Vagas que chegaram" só repetiriam o vazio. */}
      {settings.template && !waiting && approve}
      {settings.template && (
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
      )}
      <StoryDetailSheet workspaceId={workspaceId} story={open} actions={actions} onAction={onAction} onClose={() => setOpen(null)} />
      <ConfirmStory confirm={confirm} settings={settings} onClose={() => setConfirm(null)} actions={actions} />
      <div data-vac-section="settings">
        <VacanciesSettingsPanel workspaceId={workspaceId} settings={settings} canEdit={canEdit} canManage={canManage} />
      </div>
    </div>
  );
}

/** Diálogos de "Postar agora" (pelo motivo da espera, B3) e "Criar story" em vaga de teste (UI §4). */
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
    text = postNowDialog(confirm.story, settings, new Date());
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
              if (confirm.kind === "post_now") void actions.postNow(confirm.story, settings.auto_publish);
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
