/**
 * Padronização de imagens no servidor com "jimp" (JavaScript puro — sem binário nativo e sem WASM,
 * pois "sharp" não roda no runtime do app). A biblioteca é carregada só quando usada, para que
 * uma falha nela afete apenas aquela operação, nunca a inicialização do servidor.
 * Corte central "cover" para o tamanho exato, re-encode sem metadados, JPEG 92 (ou PNG com alfa)
 * e miniatura de 400px.
 */
import { TARGET_FORMATS, type TargetFormat } from "./formats";

export type NormalizedImage = {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  ext: "jpg" | "png";
  width: number;
  height: number;
  size: number;
  thumb: Uint8Array;
};

async function lib() {
  try {
    return await import("@/lib/media/jimp.server");
  } catch (e) {
    console.error("[media] falha ao carregar jimp", e);
    throw new Error("O processamento de imagens está indisponível no momento.");
  }
}

async function load(bytes: Uint8Array) {
  const { Jimp } = await lib();
  return Jimp.read(Buffer.from(bytes));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Img = any;

function hasAlpha(img: Img) {
  const px = img.bitmap.data;
  const step = Math.max(4, Math.floor(px.length / 4 / 200_000) * 4);
  for (let i = 3; i < px.length; i += step) if (px[i]! < 250) return true;
  return false;
}

async function encode(img: Img, png: boolean, quality = 92) {
  const buf = png
    ? await img.getBuffer("image/png")
    : await img.getBuffer("image/jpeg", { quality });
  return new Uint8Array(buf);
}

export async function normalizeImage(
  bytes: Uint8Array,
  target: TargetFormat,
  forceFormat?: "jpg" | "png",
): Promise<NormalizedImage> {
  const img = await load(bytes);
  if (target !== "other") {
    const { width, height } = TARGET_FORMATS[target];
    img.cover({ w: width, h: height }); // centraliza por padrão
  }
  const png = forceFormat ? forceFormat === "png" : hasAlpha(img);
  const data = await encode(img, png);
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const t = img.clone().resize({ w: 400, h: Math.round((h / w) * 400) });
  const thumb = await encode(t, false, 80);
  return {
    bytes: data,
    mime: png ? "image/png" : "image/jpeg",
    ext: png ? "png" : "jpg",
    width: w,
    height: h,
    size: data.length,
    thumb,
  };
}

/** Converte uma imagem para JPEG ou PNG sem mudar o tamanho (usado nos downloads). */
export async function convertImage(bytes: Uint8Array, to: "jpg" | "png") {
  return encode(await load(bytes), to === "png");
}

export async function imageSize(bytes: Uint8Array) {
  const img = await load(bytes);
  return { width: img.bitmap.width, height: img.bitmap.height };
}

/** Miniatura JPEG de 400px de largura. */
export async function makeThumb(bytes: Uint8Array) {
  const img = await load(bytes);
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  return encode(img.resize({ w: 400, h: Math.max(1, Math.round((h / w) * 400)) }), false, 80);
}
