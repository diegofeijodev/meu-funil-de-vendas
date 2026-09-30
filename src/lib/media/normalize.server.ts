/**
 * Padronização de imagens no servidor (WASM, compatível com o runtime do app).
 * Corte central "cover" para o tamanho exato do formato, remove metadados (re-encode),
 * exporta JPEG 92 (ou PNG com transparência) e gera miniatura de 400px.
 */
import { PhotonImage, crop, resize, SamplingFilter } from "@cf-wasm/photon";
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

function hasTransparency(img: PhotonImage) {
  const px = img.get_raw_pixels();
  // Amostra até ~200 mil pixels para não pesar em imagens grandes.
  const step = Math.max(4, Math.floor(px.length / 4 / 200_000) * 4);
  for (let i = 3; i < px.length; i += step) if (px[i]! < 250) return true;
  return false;
}

function cover(img: PhotonImage, w: number, h: number) {
  const sw = img.get_width();
  const sh = img.get_height();
  const scale = Math.max(w / sw, h / sh);
  const cw = Math.min(sw, Math.round(w / scale));
  const ch = Math.min(sh, Math.round(h / scale));
  const x = Math.floor((sw - cw) / 2);
  const y = Math.floor((sh - ch) / 2);
  const cropped = crop(img, x, y, x + cw, y + ch);
  const out = resize(cropped, w, h, SamplingFilter.Lanczos3);
  cropped.free();
  return out;
}

export function normalizeImage(
  bytes: Uint8Array,
  target: TargetFormat,
  forceFormat?: "jpg" | "png",
): NormalizedImage {
  const src = PhotonImage.new_from_byteslice(bytes);
  try {
    const dims =
      target === "other"
        ? { width: src.get_width(), height: src.get_height() }
        : TARGET_FORMATS[target];
    const out =
      target === "other"
        ? resize(src, dims.width, dims.height, SamplingFilter.Lanczos3)
        : cover(src, dims.width, dims.height);
    const png = forceFormat ? forceFormat === "png" : hasTransparency(out);
    const data = png ? out.get_bytes() : out.get_bytes_jpeg(92);
    const tw = 400;
    const th = Math.round((out.get_height() / out.get_width()) * tw);
    const t = resize(out, tw, th, SamplingFilter.Triangle);
    const thumb = t.get_bytes_jpeg(80);
    const res: NormalizedImage = {
      bytes: data,
      mime: png ? "image/png" : "image/jpeg",
      ext: png ? "png" : "jpg",
      width: out.get_width(),
      height: out.get_height(),
      size: data.length,
      thumb,
    };
    t.free();
    out.free();
    return res;
  } finally {
    src.free();
  }
}

/** Converte uma imagem para JPEG ou PNG sem mudar o tamanho (usado nos downloads). */
export function convertImage(bytes: Uint8Array, to: "jpg" | "png") {
  const img = PhotonImage.new_from_byteslice(bytes);
  try {
    return to === "png" ? img.get_bytes() : img.get_bytes_jpeg(92);
  } finally {
    img.free();
  }
}

export function imageSize(bytes: Uint8Array) {
  const img = PhotonImage.new_from_byteslice(bytes);
  try {
    return { width: img.get_width(), height: img.get_height() };
  } finally {
    img.free();
  }
}
