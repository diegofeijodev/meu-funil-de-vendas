import { serverFnPost } from "@/lib/server-fn";

type Format = "feed_image" | "feed_carousel" | "reel" | "story_image" | "story_video";
type Schedule = { startDate: string; endDate: string; weekdays: number[]; times: string[]; storyTimes: string[]; formats: Format[]; asap?: boolean };

/** `POST /v1/instagram/create-auto-calendar` — "publica sozinho" só dono/admin; com aprovação, quem edita. */
export const createAutoCalendar = serverFnPost<
  Schedule & { workspaceId: string; planId?: string | null; brandId?: string | null; campaignId?: string | null; focus: string; mode: "publish" | "approval"; recurring?: boolean },
  { runId: string; planId: string; total: number; skipped: number }
>("/v1/instagram/create-auto-calendar");

/** `POST /v1/instagram/fill-auto-calendar` — próximo lote da estrategista (a tela chama até `done`). */
export const fillAutoCalendar = serverFnPost<{ runId: string }, { filled: number; total: number; done: boolean; busy: boolean; strategyReview: boolean }>(
  "/v1/instagram/fill-auto-calendar",
);

/** `POST /v1/instagram/approve-auto-strategy` — aprova (e opcionalmente ajusta em texto) a estratégia do período: libera a geração dos posts. */
export const approveAutoStrategy = serverFnPost<{ runId: string; editedText?: string | null }, { ok: true }>("/v1/instagram/approve-auto-strategy");

/** `POST /v1/instagram/redo-auto-strategy` — descarta a estratégia atual e pede outra à IA. */
export const redoAutoStrategy = serverFnPost<{ runId: string }, { ok: true }>("/v1/instagram/redo-auto-strategy");

/** `POST /v1/instagram/generate-next-auto-media` — gera o criativo do próximo post na janela (laço do navegador). */
export const generateNextAutoMedia = serverFnPost<{ runId: string; withinHours?: number }, { done: boolean; ok: boolean; error?: string | null; remaining: number }>(
  "/v1/instagram/generate-next-auto-media",
);

/** `POST /v1/instagram/cancel-auto-calendar` */
export const cancelAutoCalendar = serverFnPost<{ runId: string }, { cancelled: number }>("/v1/instagram/cancel-auto-calendar");

/** `POST /v1/instagram/preview-auto-calendar` — prévia dos horários, sem gastar IA. */
export const previewAutoCalendar = serverFnPost<
  Schedule,
  { ok: true; total: number; skipped: number; first: string | null; last: string | null; slots: { index: number; at: string; format: Format; kind: "main" | "story" }[] } | { ok: false; error: string }
>("/v1/instagram/preview-auto-calendar");
