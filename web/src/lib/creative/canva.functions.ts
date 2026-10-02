import { serverFnPost } from "@/lib/server-fn";

type Ws = { workspaceId: string };
export type CanvaStatus = {
  appSaved: boolean;
  clientIdHint: string | null;
  connected: boolean;
  inherited: boolean;
  name: string | null;
  email: string | null;
};

/** `POST /v1/creative/canva-get-status` */
export const canvaGetStatus = serverFnPost<Ws, CanvaStatus>("/v1/creative/canva-get-status");
/** `POST /v1/creative/canva-save-app` (dono/admin) */
export const canvaSaveApp = serverFnPost<Ws & { clientId: string; clientSecret?: string | null }, { ok: true }>("/v1/creative/canva-save-app");
/** `POST /v1/creative/canva-o-auth-start` (dono/admin) */
export const canvaOAuthStart = serverFnPost<Ws, { authUrl: string }>("/v1/creative/canva-o-auth-start");
/** `POST /v1/creative/canva-test` */
export const canvaTest = serverFnPost<Ws, { name: string | null }>("/v1/creative/canva-test");
/** `POST /v1/creative/canva-disconnect` (dono/admin) */
export const canvaDisconnect = serverFnPost<Ws, { ok: true }>("/v1/creative/canva-disconnect");
/** `POST /v1/creative/canva-send-asset` — envia uma mídia da biblioteca para os uploads do Canva. */
export const canvaSendAsset = serverFnPost<Ws & { assetId: string }, { assetId: string | null }>("/v1/creative/canva-send-asset");
/** `POST /v1/creative/canva-create-from-brief` — cria um design editável (mídia opcional) e devolve o link de edição. */
export const canvaCreateFromBrief = serverFnPost<
  { workspaceId: string; title: string; size?: "portrait" | "square" | "story" | "landscape" | null; assetId?: string | null },
  { designId: string | null; editUrl: string | null }
>("/v1/creative/canva-create-from-brief");
/** `POST /v1/creative/canva-list-designs` */
export const canvaListDesigns = serverFnPost<Ws & { query?: string | null }, { id: string; title: string; thumbnail: string | null }[]>("/v1/creative/canva-list-designs");
/** `POST /v1/creative/canva-import-design` — traz um design do Canva (PNG/JPG/MP4) para a biblioteca. */
export const canvaImportDesign = serverFnPost<
  Ws & { designId: string; title?: string | null; format?: "png" | "jpg" | "mp4" | null; brandId?: string | null; campaignId?: string | null },
  { id: string; url: string | null }
>("/v1/creative/canva-import-design");
