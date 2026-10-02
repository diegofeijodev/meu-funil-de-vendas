import { api, apiErrorMessage } from "@/modules/shared/infrastructure/http";
import { serverFnPost } from "@/lib/server-fn";
import type { TargetFormat } from "./formats";

type Ws = { workspaceId: string };

/** `POST /v1/media/download-asset` — link de download de 10 min (`url` já força o nome do arquivo). */
export const downloadAsset = serverFnPost<Ws & { assetId: string; format?: "original" | "png" | "jpg" }, { url: string; name: string }>("/v1/media/download-asset");

/** `POST /v1/media/export-pdf` — PDF (uma peça por página no tamanho real, ou folha de contato A4). */
export const exportPdf = serverFnPost<Ws & { assetIds: string[]; layout: "one_per_page" | "contact_sheet" }, { url: string; name: string }>("/v1/media/export-pdf");

/** `POST /v1/media/export-zip` — ZIP com as mídias selecionadas (máx. 250 MB). */
export const exportZip = serverFnPost<Ws & { assetIds: string[] }, { url: string; name: string; count: number }>("/v1/media/export-zip");

/**
 * `POST /v1/media/upload-media` — multipart (`workspaceId`, `target`, `brandId?`, `file`), UM arquivo por chamada
 * (o `data` é o `FormData`, como no protótipo).
 */
export const uploadMedia = async (opts?: { data?: FormData }): Promise<{ id: string; igReady: boolean; issues: string[] }> => {
  try {
    const res = await api.post<{ id: string; igReady: boolean; issues: string[] }>("/v1/media/upload-media", opts?.data);
    return res.data;
  } catch (e) {
    throw new Error(apiErrorMessage(e));
  }
};

/** `POST /v1/media/reformat-media` — recorta a imagem para outros formatos (sem IA). */
export const reformatMedia = serverFnPost<Ws & { assetId: string; targets: TargetFormat[] }, { ids: string[] }>("/v1/media/reformat-media");

/** `POST /v1/media/use-media-in-instagram` — cria um post-rascunho no Instagram com as mídias. */
export const useMediaInInstagram = serverFnPost<Ws & { assetIds: string[] }, { postId: string; format: string }>("/v1/media/use-media-in-instagram");

/** `POST /v1/media/use-media-in-campaign` — cria criativos aprovados na campanha a partir das mídias. */
export const useMediaInCampaign = serverFnPost<Ws & { assetIds: string[]; campaignId: string }, { count: number }>("/v1/media/use-media-in-campaign");

/** `POST /v1/media/attach-media-to-post` — anexa mídia(s) da biblioteca a um post do Instagram (substitui a atual). */
export const attachMediaToPost = serverFnPost<Ws & { postId: string; assetIds: string[] }, { ok: true; items: number }>("/v1/media/attach-media-to-post");

/** `POST /v1/media/revalidate-assets` — refaz medidas, validação do Instagram e miniatura. */
export const revalidateAssets = serverFnPost<
  Ws & { assetIds: string[] },
  { total: number; ready: number; archived: number; failed: number; results: { id: string; ok: boolean; archived?: boolean; error?: string }[] }
>("/v1/media/revalidate-assets");
