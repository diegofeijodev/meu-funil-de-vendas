/**
 * Biblioteca de mídia (servidor): baixa, padroniza, valida e salva toda mídia no bucket
 * "creative-assets", registrando em media_assets. Nunca guarda só a URL do provedor.
 */
import { normalizeImage, imageSize } from "./normalize.server";
import {
  readVideoMeta,
  validateImageForInstagram,
  validateVideoForInstagram,
  type QualityReport,
} from "./video-meta.server";
import { aspectFor, targetFromAspect, type TargetFormat } from "./formats";

export const MEDIA_BUCKET = "creative-assets";
const SIGN_SECONDS = 60 * 60 * 24 * 365 * 5;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type IngestInput = {
  workspaceId: string;
  kind: "image" | "video";
  targetFormat: TargetFormat;
  source: string; // higgsfield | chatgpt | gemini | upload | mock
  bytes?: Uint8Array | undefined;
  sourceUrl?: string | undefined;
  mime?: string | null;
  title?: string;
  prompt?: string | null;
  provider?: string | null;
  cost?: number | null;
  brandId?: string | null;
  campaignId?: string | null;
  creativeId?: string | null;
  igPostId?: string | null;
  parentId?: string | null;
  /** Ângulo da estratégia que esta mídia testa. */
  angle?: string | null;
  createdBy?: string | null;
  status?: "draft" | "approved";
  /** Recorta para o tamanho exato (padrão true para imagens). */
  normalize?: boolean;
};

export type MediaAssetRow = {
  id: string;
  url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  ig_ready: boolean;
  quality_report: QualityReport;
  kind: "image" | "video";
  mime: string | null;
  target_format: TargetFormat;
};

const SOURCES = new Set(["higgsfield", "chatgpt", "gemini", "upload", "mock", "canva", "instagram"]);

async function downloadBytes(url: string) {
  // Assets já no nosso bucket: lê direto pelo storage (evita depender de link assinado).
  const m = /\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/.exec(url);
  if (m) {
    const s = await db();
    const { data, error } = await s.storage
      .from(decodeURIComponent(m[1]!))
      .download(decodeURIComponent(m[2]!));
    if (!error && data)
      return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || null };
  }
  if (url.startsWith("data:")) {
    const [head, b64] = url.split(",", 2);
    return {
      bytes: new Uint8Array(Buffer.from(b64 ?? "", "base64")),
      mime: /data:([^;]+)/.exec(head ?? "")?.[1] ?? null,
    };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Não foi possível baixar a mídia do provedor (HTTP ${res.status}).`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") };
}

export async function storeBytes(path: string, bytes: Uint8Array, contentType: string) {
  const s = await db();
  const { error } = await s.storage
    .from(MEDIA_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Falha ao salvar a mídia: ${error.message}`);
  const { data, error: e2 } = await s.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, SIGN_SECONDS);
  if (e2 || !data?.signedUrl) throw new Error("Falha ao gerar o link da mídia.");
  return data.signedUrl;
}

export async function ingestAsset(input: IngestInput): Promise<MediaAssetRow> {
  let bytes = input.bytes;
  let mime = input.mime ?? null;
  if (!bytes) {
    if (!input.sourceUrl) throw new Error("Mídia sem arquivo nem URL.");
    const d = await downloadBytes(input.sourceUrl);
    bytes = d.bytes;
    mime = mime ?? d.mime;
  }
  const id = crypto.randomUUID();
  const base = `media/${input.workspaceId}/${new Date().toISOString().slice(0, 10)}/${id}`;
  const target = input.targetFormat;
  let row: Record<string, unknown>;

  if (input.kind === "image") {
    let width: number;
    let height: number;
    let data: Uint8Array;
    let ext: string;
    let thumb: Uint8Array | null = null;
    if (input.normalize === false) {
      ({ width, height } = await imageSize(bytes));
      data = bytes;
      ext = mime?.includes("png") ? "png" : "jpg";
      mime = ext === "png" ? "image/png" : "image/jpeg";
    } else {
      const n = await normalizeImage(bytes, target);
      ({ width, height, ext } = n);
      data = n.bytes;
      mime = n.mime;
      thumb = n.thumb;
    }
    const url = await storeBytes(`${base}.${ext}`, data, mime!);
    const thumbUrl = thumb ? await storeBytes(`${base}_thumb.jpg`, thumb, "image/jpeg") : url;
    const report = validateImageForInstagram(width, height, target);
    row = {
      storage_path: `${base}.${ext}`,
      url,
      thumbnail_path: thumb ? `${base}_thumb.jpg` : null,
      thumbnail_url: thumbUrl,
      mime,
      width,
      height,
      size_bytes: data.length,
      aspect_ratio: aspectFor(target),
      ig_ready: report.ok,
      quality_report: report,
    };
  } else {
    const meta = readVideoMeta(bytes);
    const report = validateVideoForInstagram(meta, target);
    const ext = meta.container === "qt" ? "mov" : "mp4";
    const ct = ext === "mov" ? "video/quicktime" : "video/mp4";
    const url = await storeBytes(`${base}.${ext}`, bytes, ct);
    row = {
      storage_path: `${base}.${ext}`,
      url,
      thumbnail_url: null,
      mime: ct,
      width: meta.width,
      height: meta.height,
      duration_seconds: meta.duration,
      size_bytes: bytes.length,
      aspect_ratio:
        meta.width && meta.height
          ? meta.width < meta.height
            ? "9:16"
            : meta.width === meta.height
              ? "1:1"
              : "16:9"
          : aspectFor(target),
      ig_ready: report.ok,
      quality_report: report,
    };
  }

  const s = await db();
  const { data, error } = await s
    .from("media_assets" as never)
    .insert({
      id,
      workspace_id: input.workspaceId,
      brand_id: input.brandId ?? null,
      campaign_id: input.campaignId ?? null,
      creative_id: input.creativeId ?? null,
      ig_post_id: input.igPostId ?? null,
      parent_id: input.parentId ?? null,
      angle: input.angle ?? null,
      title: (input.title || "Mídia").slice(0, 200),
      kind: input.kind,
      source: SOURCES.has(input.source) ? input.source : "other",
      target_format: target,
      prompt: input.prompt ?? null,
      provider: input.provider ?? input.source,
      cost: input.cost ?? null,
      created_by: input.createdBy ?? null,
      status: input.status ?? "draft",
      ...row,
    } as never)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as MediaAssetRow;
}

/** Reprocessa um asset de imagem para outro formato (sem IA — só corte/redimensionamento). */
export async function reformatAsset(
  assetId: string,
  target: TargetFormat,
  createdBy?: string | null,
) {
  const s = await db();
  const { data: a } = await s
    .from("media_assets" as never)
    .select("*")
    .eq("id", assetId)
    .maybeSingle();
  const asset = a as any;
  if (!asset) throw new Error("Mídia não encontrada.");
  if (asset.kind !== "image")
    throw new Error("Vídeos não são recortados no servidor. Gere um novo vídeo neste formato.");
  const src = asset.storage_path
    ? await s.storage
        .from(MEDIA_BUCKET)
        .download(asset.storage_path)
        .then(async (r) => ({
          bytes: new Uint8Array(await r.data!.arrayBuffer()),
          mime: r.data!.type,
        }))
    : await downloadBytes(asset.url);
  return ingestAsset({
    workspaceId: asset.workspace_id,
    kind: "image",
    targetFormat: target,
    source: asset.source,
    bytes: src.bytes,
    mime: src.mime,
    title: asset.title,
    prompt: asset.prompt,
    provider: asset.provider,
    brandId: asset.brand_id,
    campaignId: asset.campaign_id,
    parentId: asset.id,
    createdBy: createdBy ?? null,
  });
}

export function guessTarget(
  aspect: string | null | undefined,
  video: boolean,
  explicit?: string | null,
): TargetFormat {
  return (explicit as TargetFormat) || targetFromAspect(aspect, video);
}

export async function readAssetBytes(asset: { storage_path: string | null; url: string | null }) {
  const s = await db();
  if (asset.storage_path) {
    const { data, error } = await s.storage.from(MEDIA_BUCKET).download(asset.storage_path);
    if (error || !data) throw new Error("Arquivo não encontrado no armazenamento.");
    return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type };
  }
  if (!asset.url) throw new Error("Mídia sem arquivo.");
  return downloadBytes(asset.url);
}
