import { Injectable } from '@nestjs/common';
import { Jimp } from 'jimp';
import { TARGET_FORMATS, TargetFormat } from './formats';
import { bad } from './user-error';

/** Teto de pixels decodificados (bomba de descompressão): 50 megapixels e no máximo 20 000 px por lado. */
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_IMAGE_SIDE = 20_000;

/** Largura/altura lidas do CABEÇALHO (PNG, JPEG, GIF, WebP, BMP), sem decodificar. null = formato não reconhecido. */
export function imageHeaderSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1]!;
      if (m === 0xff) { p++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (b[p + 5]! << 8) | b[p + 6]!, width: (b[p + 7]! << 8) | b[p + 8]! };
      p += 2 + ((b[p + 2]! << 8) | b[p + 3]!);
    }
  }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (o: number, t: string) => b.length >= o + t.length && [...t].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b.length >= 10 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (b.length >= 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8 ')) return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (ascii(12, 'VP8L')) {
      const v = dv.getUint32(21, true);
      return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
    }
    if (ascii(12, 'VP8X')) return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    return { width: 0, height: 0 }; // WebP com cabeçalho desconhecido: recusa
  }
  if (b.length >= 26 && ascii(0, 'BM')) {
    if (dv.getUint32(14, true) === 12) return { width: dv.getUint16(18, true), height: dv.getUint16(20, true) };
    return { width: Math.abs(dv.getInt32(18, true)), height: Math.abs(dv.getInt32(22, true)) };
  }
  return null;
}

export interface NormalizedImage {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
  ext: 'jpg' | 'png';
  width: number;
  height: number;
  size: number;
  thumb: Uint8Array;
}

/** Imagem em memória do jimp (tipada como `any`: a API de camadas do jimp 1.x não precisa vazar). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Img = any;

/**
 * Processamento de imagens no servidor com jimp (JavaScript puro, sem binário nativo — igual ao protótipo).
 * Corte central "cover" para o tamanho exato, re-encode sem metadados, JPEG 92 (ou PNG com alfa) e miniatura 400px.
 */
/** Cor mais frequente da imagem (histograma com 16 níveis por canal, amostrado), na média dos pixels daquele balde. */
export function dominantColor(img: Img): [number, number, number] {
  const data = img.bitmap.data as Uint8Array;
  const step = Math.max(4, Math.floor(data.length / 4 / 50_000) * 4);
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += step) {
    if (data[i + 3]! < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const c = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += r;
    c.g += g;
    c.b += b;
    buckets.set(key, c);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const c of buckets.values()) if (!best || c.n > best.n) best = c;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [0, 0, 0];
}

@Injectable()
export class ImageService {
  /** Lê JPEG/PNG (e o que o jimp detectar); arquivo ilegível = 400 com mensagem simples. */
  async read(bytes: Uint8Array): Promise<Img> {
    // Antes de decodificar: um PNG/JPEG minúsculo pode declarar bilhões de pixels e esgotar a memória.
    const dim = imageHeaderSize(bytes);
    if (dim && (dim.width < 1 || dim.height < 1 || dim.width > MAX_IMAGE_SIDE || dim.height > MAX_IMAGE_SIDE || dim.width * dim.height > MAX_IMAGE_PIXELS)) {
      throw bad(`Imagem grande demais (${dim.width}x${dim.height}). O limite é de 50 megapixels e 20.000 px por lado.`);
    }
    // TIFF: o jimp decodifica, mas sem como ler as dimensões do cabeçalho aqui — não entra.
    if (bytes.length > 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a))) {
      throw bad('Formato TIFF não suportado. Envie PNG ou JPEG.');
    }
    try {
      return await Jimp.read(Buffer.from(bytes));
    } catch (e) {
      // O jimp detecta o tipo com `import('file-type')` (ESM). O jest em CommonJS sem `--experimental-vm-modules`
      // não permite isso — só nesse caso decodifica à mão (JPEG/PNG). Em produção/dev esse ramo nunca roda.
      if ((e as { code?: string })?.code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG') return this.readWithoutDetection(bytes);
      throw bad('Não foi possível ler a imagem (arquivo inválido ou formato não suportado).');
    }
  }

  private readWithoutDetection(bytes: Uint8Array): Img {
    const b = Buffer.from(bytes);
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      if (b[0] === 0x89 && b[1] === 0x50) {
        const png = require('pngjs').PNG.sync.read(b);
        return Jimp.fromBitmap({ width: png.width, height: png.height, data: png.data });
      }
      if (b[0] === 0xff && b[1] === 0xd8) {
        const jpg = require('jpeg-js').decode(b, { formatAsRGBA: true });
        return Jimp.fromBitmap({ width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) });
      }
      /* eslint-enable @typescript-eslint/no-require-imports */
    } catch {
      /* cai no erro padrão abaixo */
    }
    throw bad('Não foi possível ler a imagem (arquivo inválido ou formato não suportado).');
  }

  /** Imagem nova (cor sólida 0xRRGGBBAA) — usada nos testes e na composição. */
  blank(width: number, height: number, color = 0x000000ff): Img {
    return new Jimp({ width, height, color });
  }

  private hasAlpha(img: Img): boolean {
    const px: Uint8Array = img.bitmap.data;
    const step = Math.max(4, Math.floor(px.length / 4 / 200_000) * 4);
    for (let i = 3; i < px.length; i += step) if (px[i]! < 250) return true;
    return false;
  }

  async encode(img: Img, png: boolean, quality = 92): Promise<Uint8Array> {
    const buf = png ? await img.getBuffer('image/png') : await img.getBuffer('image/jpeg', { quality });
    return new Uint8Array(buf);
  }

  async normalize(bytes: Uint8Array, target: TargetFormat, forceFormat?: 'jpg' | 'png'): Promise<NormalizedImage> {
    const img = await this.read(bytes);
    if (target !== 'other') {
      const { width, height } = TARGET_FORMATS[target];
      img.cover({ w: width, h: height }); // centraliza por padrão
    }
    const png = forceFormat ? forceFormat === 'png' : this.hasAlpha(img);
    const data = await this.encode(img, png);
    const w = img.bitmap.width as number;
    const h = img.bitmap.height as number;
    const t = img.clone().resize({ w: 400, h: Math.max(1, Math.round((h / w) * 400)) });
    const thumb = await this.encode(t, false, 80);
    return { bytes: data, mime: png ? 'image/png' : 'image/jpeg', ext: png ? 'png' : 'jpg', width: w, height: h, size: data.length, thumb };
  }

  /** Converte para JPEG ou PNG sem mudar o tamanho (downloads). */
  async convert(bytes: Uint8Array, to: 'jpg' | 'png'): Promise<Uint8Array> {
    return this.encode(await this.read(bytes), to === 'png');
  }

  async size(bytes: Uint8Array): Promise<{ width: number; height: number }> {
    const img = await this.read(bytes);
    return { width: img.bitmap.width, height: img.bitmap.height };
  }

  /** Miniatura JPEG de 400px de largura. */
  async thumb(bytes: Uint8Array): Promise<Uint8Array> {
    const img = await this.read(bytes);
    const w = img.bitmap.width as number;
    const h = img.bitmap.height as number;
    return this.encode(img.resize({ w: 400, h: Math.max(1, Math.round((h / w) * 400)) }), false, 80);
  }

  /** Reduz para no máx. `max` px (JPEG q85) — economiza envio à IA (referências 1024px, crítico 768px). */
  async shrink(bytes: Uint8Array, max = 1024): Promise<{ bytes: Uint8Array; mime: string }> {
    const img = await this.read(bytes);
    const { width, height } = img.bitmap as { width: number; height: number };
    if (Math.max(width, height) > max) img.scaleToFit({ w: max, h: max });
    return { bytes: new Uint8Array(await img.getBuffer('image/jpeg', { quality: 85 })), mime: 'image/jpeg' };
  }

  /** Primeiro quadro do vídeo: encaixa a imagem INTEIRA em `width`×`height` (sem cortar nem distorcer); sobras na cor dominante. JPEG q90. */
  async padToAspect(bytes: Uint8Array, width: number, height: number): Promise<{ bytes: Uint8Array; mime: string }> {
    const img = await this.read(bytes);
    img.scaleToFit({ w: width, h: height });
    const [r, g, b] = dominantColor(img);
    const canvas = this.blank(width, height, ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0);
    canvas.composite(img, Math.round((width - img.bitmap.width) / 2), Math.round((height - img.bitmap.height) / 2));
    return { bytes: new Uint8Array(await canvas.getBuffer('image/jpeg', { quality: 90 })), mime: 'image/jpeg' };
  }
}
