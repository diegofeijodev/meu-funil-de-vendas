/** Arquivos da marca usados na geração: fotos de referência, logo e fonte (somente servidor). */
import type { Img } from "./llm.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const REF_KINDS = ["reference", "photo"];

async function bytesOf(a: { storage_path: string | null; url: string | null }) {
  const { readAssetBytes } = await import("@/lib/media/assets.server");
  return readAssetBytes(a);
}

/** Reduz para no máx. `max` px (JPEG), para economizar envio à IA. */
export async function shrink(bytes: Uint8Array, max = 1024): Promise<Img> {
  const { Jimp } = await import("@/lib/media/jimp.server");
  const img = await Jimp.read(Buffer.from(bytes));
  const { width, height } = img.bitmap;
  if (Math.max(width, height) > max) img.scaleToFit({ w: max, h: max });
  const out = await img.getBuffer("image/jpeg", { quality: 85 });
  return { bytes: new Uint8Array(out), mime: "image/jpeg" };
}

export type BrandRef = Img & { id: string; tag: string | null; url: string };

export async function loadBrandRefs(
  brandId: string | null | undefined,
  opts: { max?: number; ids?: string[] | undefined } = {},
): Promise<BrandRef[]> {
  if (!brandId) return [];
  const s = await db();
  let q = s
    .from("brand_assets")
    .select("id, kind, tag, name, url, storage_path, created_at")
    .eq("brand_id", brandId)
    .in("kind", REF_KINDS)
    .order("created_at", { ascending: false })
    .limit(20);
  if (opts.ids?.length) q = q.in("id", opts.ids);
  const { data } = await q;
  const rows = ((data ?? []) as any[]).filter((r) => !String(r.name ?? "").toLowerCase().endsWith(".pdf"));
  // Produto primeiro: é o que precisa ficar fiel.
  rows.sort((a, b) => Number(b.tag === "produto") - Number(a.tag === "produto"));
  const out: BrandRef[] = [];
  for (const r of rows.slice(0, opts.max ?? 4)) {
    try {
      const { bytes } = await bytesOf(r);
      out.push({ ...(await shrink(bytes)), id: r.id, tag: r.tag ?? null, url: r.url });
    } catch (e) {
      console.warn("[refs] referência ignorada", r.id, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

export async function loadLogo(brandId: string | null | undefined): Promise<Uint8Array | null> {
  if (!brandId) return null;
  const s = await db();
  const { data } = await s
    .from("brand_assets")
    .select("url, storage_path, name")
    .eq("brand_id", brandId)
    .eq("kind", "logo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as any;
  if (!row || /\.(svg|pdf)$/i.test(row.name ?? "")) return null;
  try {
    return (await bytesOf(row)).bytes;
  } catch {
    return null;
  }
}

let defaultFont: ArrayBuffer | null = null;
const DEFAULT_FONT_URL =
  "https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf";

/** Fonte .ttf/.otf enviada na marca; senão Archivo Black (forte e legível em anúncios). */
export async function loadFont(brandId: string | null | undefined): Promise<ArrayBuffer> {
  if (brandId) {
    const s = await db();
    const { data } = await s
      .from("brand_assets")
      .select("url, storage_path")
      .eq("brand_id", brandId)
      .eq("kind", "font")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      try {
        const { bytes } = await bytesOf(data as any);
        return bytes.slice().buffer;
      } catch (e) {
        console.warn("[font] fonte da marca ignorada", e instanceof Error ? e.message : e);
      }
    }
  }
  if (!defaultFont) {
    const r = await fetch(DEFAULT_FONT_URL, { redirect: "follow" });
    if (!r.ok) throw new Error("Não foi possível carregar a fonte padrão.");
    defaultFont = await r.arrayBuffer();
  }
  return defaultFont;
}
