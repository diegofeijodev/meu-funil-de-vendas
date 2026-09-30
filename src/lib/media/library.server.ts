/** Ações da Biblioteca de mídia no servidor (chamadas só após checar o membro). */
import {
  ingestAsset,
  reformatAsset,
  readAssetBytes,
  storeBytes,
  MEDIA_BUCKET,
} from "./assets.server";
import { convertImage } from "./normalize.server";
import { IG_FORMATS, TARGET_FORMATS, type TargetFormat } from "./formats";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function loadAssets(workspaceId: string, ids: string[]) {
  const s = await db();
  const { data, error } = await s
    .from("media_assets" as never)
    .select("*, brands(name)")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  return ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as any[];
}

const slug = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "midia";

function fileName(a: any, ext: string, i?: number) {
  const brand = slug(a.brands?.name ?? "meu-funil");
  const fmt = slug((TARGET_FORMATS as any)[a.target_format]?.short ?? a.target_format ?? "midia");
  const date = String(a.created_at ?? new Date().toISOString()).slice(0, 10);
  return `${brand}_${fmt}_${date}${i != null ? `_${i + 1}` : ""}.${ext}`;
}

const extOf = (a: any) =>
  a.kind === "video"
    ? a.mime?.includes("quicktime")
      ? "mov"
      : "mp4"
    : a.mime?.includes("png")
      ? "png"
      : "jpg";

async function signedDownload(path: string, name: string) {
  const s = await db();
  const { data, error } = await s.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, 600, { download: name });
  if (error || !data?.signedUrl) throw new Error("Não foi possível gerar o link de download.");
  return data.signedUrl;
}

export async function downloadAsset(
  workspaceId: string,
  assetId: string,
  format: "original" | "png" | "jpg",
) {
  const [a] = await loadAssets(workspaceId, [assetId]);
  if (!a) throw new Error("Mídia não encontrada.");
  if (a.kind === "video" || format === "original") {
    const name = fileName(a, extOf(a));
    if (a.storage_path) return { url: await signedDownload(a.storage_path, name), name };
    const { bytes, mime } = await readAssetBytes(a);
    const path = `exports/${workspaceId}/${crypto.randomUUID()}_${name}`;
    await storeBytes(path, bytes, mime ?? "application/octet-stream");
    return { url: await signedDownload(path, name), name };
  }
  const { bytes } = await readAssetBytes(a);
  const out = await convertImage(bytes, format);
  const name = fileName(a, format);
  const path = `exports/${workspaceId}/${crypto.randomUUID()}_${name}`;
  await storeBytes(path, out, format === "png" ? "image/png" : "image/jpeg");
  return { url: await signedDownload(path, name), name };
}

export async function exportZip(workspaceId: string, ids: string[]) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  let total = 0;
  const assets = await loadAssets(workspaceId, ids);
  for (const [i, a] of assets.entries()) {
    const { bytes } = await readAssetBytes(a);
    total += bytes.length;
    if (total > 250 * 1024 * 1024)
      throw new Error(
        "Seleção grande demais para um ZIP (limite de 250 MB). Selecione menos itens.",
      );
    zip.file(fileName(a, extOf(a), i), bytes);
  }
  const data = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const name = `biblioteca_${new Date().toISOString().slice(0, 10)}.zip`;
  const path = `exports/${workspaceId}/${crypto.randomUUID()}_${name}`;
  await storeBytes(path, data, "application/zip");
  return { url: await signedDownload(path, name), name, count: assets.length };
}

export async function exportPdf(
  workspaceId: string,
  ids: string[],
  layout: "one_per_page" | "contact_sheet",
) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const assets = await loadAssets(workspaceId, ids);
  const safe = (t: string) => t.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "").slice(0, 90);

  async function imageFor(a: any) {
    if (a.kind === "video") return null;
    const src =
      a.thumbnail_path && layout === "contact_sheet"
        ? { storage_path: a.thumbnail_path, url: null }
        : a;
    const { bytes } = await readAssetBytes(src);
    return pdf.embedJpg(await convertImage(bytes, "jpg"));
  }

  function videoBox(page: any, x: number, y: number, w: number, h: number) {
    page.drawRectangle({ x, y, width: w, height: h, color: rgb(0.03, 0.11, 0.22) });
    const label = "VIDEO";
    const size = Math.max(10, Math.min(w, h) / 8);
    page.drawText(label, {
      x: x + w / 2 - bold.widthOfTextAtSize(label, size) / 2,
      y: y + h / 2 - size / 2,
      size,
      font: bold,
      color: rgb(0.07, 0.74, 0.65),
    });
  }

  if (layout === "one_per_page") {
    for (const a of assets) {
      const img = await imageFor(a);
      const w = a.width ?? 1080;
      const h = a.height ?? 1080;
      // 1 px = 0,75 pt (96 dpi) → página no tamanho real da peça.
      const page = pdf.addPage([w * 0.75, h * 0.75]);
      if (img) page.drawImage(img, { x: 0, y: 0, width: w * 0.75, height: h * 0.75 });
      else videoBox(page, 0, 0, w * 0.75, h * 0.75);
    }
  } else {
    const [PW, PH] = [595.28, 841.89];
    const cols = 2;
    const rows = 3;
    const margin = 36;
    const cellW = (PW - margin * 2 - 18) / cols;
    const cellH = (PH - margin * 2 - 30 - 18 * (rows - 1)) / rows;
    for (let i = 0; i < assets.length; i += cols * rows) {
      const page = pdf.addPage([PW, PH]);
      page.drawText("Biblioteca de mídia · Meu Funil", {
        x: margin,
        y: PH - margin - 12,
        size: 12,
        font: bold,
      });
      for (let j = 0; j < cols * rows && i + j < assets.length; j++) {
        const a = assets[i + j];
        const c = j % cols;
        const r = Math.floor(j / cols);
        const x = margin + c * (cellW + 18);
        const top = PH - margin - 30 - r * (cellH + 18);
        const boxH = cellH - 40;
        const ratio = (a.width ?? 1) / (a.height ?? 1);
        let iw = cellW;
        let ih = iw / ratio;
        if (ih > boxH) {
          ih = boxH;
          iw = ih * ratio;
        }
        const ix = x + (cellW - iw) / 2;
        const iy = top - ih;
        const img = await imageFor(a);
        if (img) page.drawImage(img, { x: ix, y: iy, width: iw, height: ih });
        else videoBox(page, ix, iy, iw, ih);
        const fmt = (TARGET_FORMATS as any)[a.target_format]?.short ?? "Outro";
        page.drawText(safe(a.title ?? "Mídia"), { x, y: top - boxH - 14, size: 9, font: bold });
        page.drawText(
          safe(
            `${fmt} · ${a.width ?? "?"}x${a.height ?? "?"}${a.duration_seconds ? ` · ${a.duration_seconds}s` : ""}`,
          ),
          { x, y: top - boxH - 26, size: 8, font, color: rgb(0.35, 0.4, 0.5) },
        );
        if (a.prompt)
          page.drawText(safe(a.prompt), {
            x,
            y: top - boxH - 37,
            size: 7,
            font,
            color: rgb(0.45, 0.5, 0.6),
          });
      }
    }
  }
  const bytes = await pdf.save();
  const name = `biblioteca_${layout === "one_per_page" ? "impressao" : "folha-de-contato"}_${new Date().toISOString().slice(0, 10)}.pdf`;
  const path = `exports/${workspaceId}/${crypto.randomUUID()}_${name}`;
  await storeBytes(path, bytes, "application/pdf");
  return { url: await signedDownload(path, name), name };
}

export async function uploadToLibrary(
  workspaceId: string,
  file: File,
  target: TargetFormat,
  userId: string,
  extra: { brandId?: string | null; campaignId?: string | null },
) {
  const video = file.type.startsWith("video/");
  if (!video && !file.type.startsWith("image/"))
    throw new Error(`${file.name}: envie imagem ou vídeo.`);
  if (file.size > 500 * 1024 * 1024) throw new Error(`${file.name}: arquivo maior que 500 MB.`);
  return ingestAsset({
    workspaceId,
    kind: video ? "video" : "image",
    targetFormat: target,
    source: "upload",
    bytes: new Uint8Array(await file.arrayBuffer()),
    mime: file.type,
    title: file.name.replace(/\.[^.]+$/, ""),
    createdBy: userId,
    brandId: extra.brandId ?? null,
    campaignId: extra.campaignId ?? null,
  });
}

export async function reformat(
  workspaceId: string,
  assetId: string,
  targets: TargetFormat[],
  userId: string,
) {
  const [a] = await loadAssets(workspaceId, [assetId]);
  if (!a) throw new Error("Mídia não encontrada.");
  const out = [];
  for (const t of targets) out.push(await reformatAsset(assetId, t, userId));
  return out.map((r) => r.id);
}

export const allIgTargets = () => IG_FORMATS;

const IG_FROM_TARGET: Record<string, string> = {
  ig_feed_square: "feed_image",
  ig_feed_portrait: "feed_image",
  ig_story: "story_image",
  ig_reel: "reel",
};

/** Cria um post rascunho no Instagram com as mídias escolhidas. */
export async function useInInstagram(workspaceId: string, ids: string[]) {
  const assets = await loadAssets(workspaceId, ids);
  if (!assets.length) throw new Error("Selecione ao menos uma mídia.");
  const first = assets[0];
  let format =
    first.kind === "video"
      ? first.target_format === "ig_story"
        ? "story_video"
        : "reel"
      : (IG_FROM_TARGET[first.target_format] ?? "feed_image");
  if (assets.length > 1) format = "feed_carousel";
  const media = assets.slice(0, 10).map((a, i) => ({
    url: a.url,
    type: a.kind,
    order: i,
    width: a.width,
    height: a.height,
    duration: a.duration_seconds,
    asset_id: a.id,
    ig_ready: a.ig_ready,
  }));
  const s = await db();
  const { data, error } = await s
    .from("ig_posts")
    .insert({
      workspace_id: workspaceId,
      format,
      status: "idea",
      theme: first.title,
      media,
      creative_brief: { from_library: ids },
    } as never)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await s
    .from("media_assets" as never)
    .update({ ig_post_id: (data as any).id } as never)
    .in("id", ids);
  return { postId: (data as any).id as string, format };
}

/** Cria criativos aprovados na campanha a partir das mídias. */
export async function useInCampaign(workspaceId: string, ids: string[], campaignId: string) {
  const s = await db();
  const { data: camp } = await s
    .from("campaigns")
    .select("id, brand_id")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!camp) throw new Error("Campanha não encontrada.");
  const assets = await loadAssets(workspaceId, ids);
  let n = 0;
  for (const a of assets) {
    const { data: cr, error } = await s
      .from("creatives")
      .insert({
        workspace_id: workspaceId,
        campaign_id: campaignId,
        brand_id: a.brand_id ?? camp.brand_id,
        title: a.title,
        type: a.kind === "video" ? "video" : "static_image",
        aspect_ratio: a.aspect_ratio,
        prompt: a.prompt,
        status: "approved",
        provider: a.provider ?? a.source,
        preview_url: a.url,
        thumbnail_url: a.thumbnail_url,
        version: 1,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await s
      .from("media_assets" as never)
      .update({ campaign_id: campaignId, creative_id: (cr as any).id, status: "approved" } as never)
      .eq("id", a.id);
    n++;
  }
  return { count: n };
}
