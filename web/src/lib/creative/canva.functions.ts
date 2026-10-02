import { serverFnPost } from "@/lib/server-fn";

/** `POST /v1/creative/canva-create-from-brief` — a rota nasce na tarefa de Canva (estúdio criativo). */
export const canvaCreateFromBrief = serverFnPost<
  { workspaceId: string; title: string; size?: "portrait" | "square" | "landscape"; assetId?: string },
  { editUrl?: string }
>("/v1/creative/canva-create-from-brief");
