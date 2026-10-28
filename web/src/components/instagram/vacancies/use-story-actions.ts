"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { approvePost } from "@/lib/instagram/instagram.functions";
import { APPROVED_TOAST, DONT_POST_UNDO_MS, createUndoQueue, postNowToast } from "@/lib/vacancy-stories";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import {
  vacancyCreateAnyway,
  vacancyDontPost,
  vacancyDontPostKeepalive,
  vacancyPostNow,
  vacancyRedo,
  vacancySettingsKey,
  type VacancyFeedback,
  type VacancyStory,
} from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";

/** Prefixos das consultas da lista e do detalhe (invalidadas depois de toda ação). */
export const vacancyListKey = (ws: string) => ["vacancy-stories-list", ws] as const;
export const vacancyDetailKey = (ws: string, id: string) => ["vacancy-story", ws, id] as const;

type Pending = { id: string; funcao: string };

/**
 * M3: "Não postar" esperando o Desfazer, compartilhado por todas as telas (o editor fecha logo depois de pedir). Se a aba vai para o
 * fundo ou fecha nesses 6 s, a chamada sai já, com `keepalive`, em vez de se perder com o timer.
 */
const dontPostQueue = createUndoQueue();
let listening = false;
function flushOnLeave() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pagehide", () => dontPostQueue.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") dontPostQueue.flush();
  });
}

/**
 * Ações sobre um story de vaga. Depois de cada uma, atualiza a lista, o detalhe, as configurações (contadores) e o selo do menu.
 * `dontPost` segura a chamada por 6 s com "Desfazer" (D5; sai já se a aba fechar — M3); `hidden` são os stories em espera (a tela os esconde), e `feedback`
 * guarda o story que acabou de ser descartado para oferecer os chips de motivo.
 */
export function useStoryActions(ws: string) {
  const qc = useQueryClient();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: vacancyListKey(ws) }),
        qc.invalidateQueries({ queryKey: ["vacancy-story", ws] }),
        qc.invalidateQueries({ queryKey: vacancySettingsKey(ws) }),
        qc.invalidateQueries({ queryKey: ["ig-pending-badge", ws] }),
        qc.invalidateQueries({ queryKey: ["ig-posts", ws] }),
      ]).then(() => undefined),
    [qc, ws],
  );

  const setIn = (set: (f: (s: ReadonlySet<string>) => ReadonlySet<string>) => void, id: string, on: boolean) =>
    set((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  /** Roda uma ação marcando o story como ocupado; erro vira toast e a tela é atualizada do mesmo jeito. */
  const run = useCallback(
    async (story: { id: string }, fn: () => Promise<unknown>, okMsg: string | null, errMsg: string): Promise<boolean> => {
      setIn(setBusy, story.id, true);
      try {
        await fn();
        if (okMsg) toast.success(okMsg);
        return true;
      } catch (e) {
        toast.error(apiErrorMessage(e, errMsg));
        return false;
      } finally {
        setIn(setBusy, story.id, false);
        refresh();
      }
    },
    [refresh],
  );

  const approve = useCallback(
    (story: VacancyStory) => {
      if (!story.ig_post_id) {
        toast.error("Este story ainda não tem arte para aprovar.");
        return Promise.resolve(false);
      }
      return run(story, () => approvePost({ data: { workspaceId: ws, postId: story.ig_post_id! } }), APPROVED_TOAST, "Não conseguimos aprovar agora. Tente de novo.");
    },
    [run, ws],
  );

  const dontPost = useCallback(
    (story: Pending) => {
      flushOnLeave();
      setIn(setHidden, story.id, true);
      setFeedback(null);
      // Só mostra o cartão de novo depois da revalidação: senão o já cancelado reaparece com "Aprovar" ativo.
      const reshow = async () => {
        await refresh();
        setIn(setHidden, story.id, false);
      };
      // Toast some 500 ms antes do envio: um "Desfazer" no último instante nunca chega depois da chamada.
      const toastId = toast(`O story da vaga ${story.funcao} não vai ao ar.`, {
        duration: DONT_POST_UNDO_MS - 500,
        action: {
          label: "Desfazer",
          onClick: () => {
            if (dontPostQueue.cancel(story.id)) setIn(setHidden, story.id, false);
          },
        },
      });
      dontPostQueue.add(
        story.id,
        async () => {
          try {
            await vacancyDontPost(ws, story.id);
            setFeedback({ id: story.id, funcao: story.funcao });
          } catch (e) {
            toast.error(apiErrorMessage(e, "Não conseguimos cancelar o story agora. Tente de novo."));
          } finally {
            await reshow();
          }
        },
        // Aba indo para o fundo/fechando: envia já e tira o "Desfazer" (não dá mais para desfazer).
        () => {
          toast.dismiss(toastId);
          void vacancyDontPostKeepalive(ws, story.id).then(reshow);
        },
        DONT_POST_UNDO_MS,
      );
    },
    [refresh, ws],
  );

  /** Chip de motivo: repete a rota com `feedback` (idempotente) e fecha a barra de chips. */
  const sendFeedback = useCallback(
    async (value: VacancyFeedback) => {
      const cur = feedback;
      if (!cur) return;
      setFeedback(null);
      try {
        await vacancyDontPost(ws, cur.id, value);
        toast.success("Obrigado, anotamos o motivo.");
      } catch (e) {
        toast.error(apiErrorMessage(e, "Não conseguimos anotar o motivo agora."));
      }
    },
    [feedback, ws],
  );

  /** B3: com arte vai em até 5 min; sem arte (esperava o limite) a arte é criada antes — o toast diz para onde ela vai. */
  const postNow = useCallback(
    (story: VacancyStory, autoPublish: boolean) =>
      run(story, () => vacancyPostNow(ws, story.id), postNowToast(!!story.ig_post_id, autoPublish), "Não conseguimos postar agora. Tente de novo."),
    [run, ws],
  );
  const createAnyway = useCallback(
    (story: VacancyStory) => run(story, () => vacancyCreateAnyway(ws, story.id), "Vamos criar o story.", "Não conseguimos criar o story. Tente de novo."),
    [run, ws],
  );
  const redo = useCallback(
    (story: { id: string }) => run(story, () => vacancyRedo(ws, story.id), "Vamos refazer a arte.", "Não conseguimos refazer a arte. Tente de novo."),
    [run, ws],
  );

  return { refresh, approve, dontPost, postNow, createAnyway, redo, sendFeedback, dismissFeedback: () => setFeedback(null), hidden, feedback, busy };
}
export type StoryActions = ReturnType<typeof useStoryActions>;
