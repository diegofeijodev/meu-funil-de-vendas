import { serverFnPost } from "@/lib/server-fn";

type Ws = { workspaceId: string };

/** `POST /v1/media/delete-media-assets` — exclui de verdade (arquivo + registro); versões filhas ficam soltas. */
export const deleteMediaAssets = serverFnPost<Ws & { assetIds: string[] }, { deleted: number }>("/v1/media/delete-media-assets");

/** `POST /v1/media/rename-media-tag` — renomeia (ou remove, com `to` vazio) uma tag em todas as mídias. */
export const renameMediaTag = serverFnPost<Ws & { from: string; to: string }, { updated: number }>("/v1/media/rename-media-tag");

/** `POST /v1/media/rename-media-folder` — renomeia (ou desfaz, com `to` vazio) uma pasta em todas as mídias. */
export const renameMediaFolder = serverFnPost<Ws & { from: string; to: string }, { updated: number }>("/v1/media/rename-media-folder");

/** `POST /v1/media/media-ad-results` — resultados da mídia nos anúncios (pelo criativo ligado a ela). */
export const mediaAdResults = serverFnPost<
  Ws & { creativeId: string },
  { spend: number; impressions: number; clicks: number; leads: number; conversions: number; revenue: number; campaigns: string[]; days: number }
>("/v1/media/media-ad-results");
