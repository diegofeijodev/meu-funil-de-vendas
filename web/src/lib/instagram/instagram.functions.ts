import { serverFnPost } from "@/lib/server-fn";
import { api, apiErrorMessage } from "@/modules/shared/infrastructure/http";

type Engine = "auto" | "chatgpt" | "gemini";
type Provider = "auto" | "higgsfield" | "chatgpt" | "gemini";
type Ws = { workspaceId: string };
type Post = Ws & { postId: string };
type Ok = { ok: boolean; error?: string };
type MediaOut = { ok: true; items: number; provider: string; pending?: boolean } | { ok: false; error: string };

/** `POST /v1/instagram/connect-instagram-account` (dono/admin) — liga/troca a conta; `{ ok:false, error }` em falha (HTTP 200). */
export const connectInstagramAccount = serverFnPost<Ws & { pageId?: string }, { ok: true; username: string | null; igUserId: string } | { ok: false; error: string }>(
  "/v1/instagram/connect-instagram-account",
);
/** `POST /v1/instagram/list-instagram-options` (dono/admin) — Páginas do Facebook com Instagram vinculado. */
export const listInstagramOptions = serverFnPost<
  Ws,
  { ok: boolean; error?: string; options: { pageId: string; pageName: string; picture: string | null; username: string | null; igUserId: string | null }[] }
>("/v1/instagram/list-instagram-options");
/** `POST /v1/instagram/sync-instagram-history` — importa os últimos 30 posts e coleta métricas. */
export const syncInstagramHistory = serverFnPost<Ws, { ok: true; imported: number; total: number; metrics: number }>("/v1/instagram/sync-instagram-history");
/** `POST /v1/instagram/disconnect-instagram-account` (dono/admin). */
export const disconnectInstagramAccount = serverFnPost<Ws, { ok: true }>("/v1/instagram/disconnect-instagram-account");
/** `POST /v1/instagram/generate-content-calendar` — a IA cria os posts-ideia do plano. */
export const generateContentCalendar = serverFnPost<Ws & { planId: string; weeks?: number; engine?: Engine }, { created: number; provider: string }>(
  "/v1/instagram/generate-content-calendar",
);
/** `POST /v1/instagram/generate-post-assets` — gera (ou ajusta) a mídia do post. */
export const generatePostAssets = serverFnPost<Post & { provider?: Provider; adjust?: string }, MediaOut>("/v1/instagram/generate-post-assets");
/** `POST /v1/instagram/regenerate-caption` */
export const regenerateCaption = serverFnPost<Post & { instructions?: string; engine?: Engine }, { ok: true }>("/v1/instagram/regenerate-caption");
/** `POST /v1/instagram/regenerate-media` */
export const regenerateMedia = serverFnPost<Post & { instructions?: string; provider?: Provider }, MediaOut>("/v1/instagram/regenerate-media");
/** `POST /v1/instagram/approve-post` (dono/admin/marketing) */
export const approvePost = serverFnPost<Post, { ok: true }>("/v1/instagram/approve-post");
/** `POST /v1/instagram/reject-post` (dono/admin/marketing) */
export const rejectPost = serverFnPost<Post & { reason: string }, { ok: true }>("/v1/instagram/reject-post");
/** `POST /v1/instagram/schedule-post` — entra na fila de publicação no horário (ISO com fuso). */
export const schedulePost = serverFnPost<Post & { scheduledAt: string }, { ok: true; sandbox: boolean }>("/v1/instagram/schedule-post");
/** `POST /v1/instagram/publish-instagram-post` — publica agora; falha volta `{ ok:false, error }`. */
export const publishInstagramPost = serverFnPost<Post, { ok: boolean; sandbox: boolean; permalink?: string | null; error?: string }>("/v1/instagram/publish-instagram-post");
/** `POST /v1/instagram/collect-post-metrics` */
export const collectPostMetrics = serverFnPost<Post, { ok: true; values: Record<string, number> }>("/v1/instagram/collect-post-metrics");
/** `POST /v1/instagram/suggest-pillars` */
export const suggestPillars = serverFnPost<Ws & { brandId?: string | null; objective?: string; tone?: string; audience?: string }, { pillars: string[] }>(
  "/v1/instagram/suggest-pillars",
);
/** `POST /v1/instagram/collect-account-insights-now` — `{ days, followers }` ou `{ skipped }` (sem conta conectada). */
export const collectAccountInsightsNow = serverFnPost<Ws, { days: number; followers: number | null } | { skipped: string }>("/v1/instagram/collect-account-insights-now");

/**
 * `POST /v1/instagram/upload-post-media` (multipart) — imagem ou vídeo MP4 do próprio usuário. O protótipo recebia
 * `FormData` direto na server function (`run({ data: fd })`); aqui o mesmo `FormData` vai como multipart.
 */
export const uploadPostMedia = async (opts: { data: FormData }): Promise<Ok> => {
  try {
    const res = await api.post<Ok>("/v1/instagram/upload-post-media", opts.data);
    return res.data;
  } catch (e) {
    throw new Error(apiErrorMessage(e));
  }
};
