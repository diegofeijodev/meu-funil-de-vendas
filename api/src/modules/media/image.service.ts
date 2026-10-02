import { Injectable } from '@nestjs/common';
import { Jimp } from 'jimp';
import { TARGET_FORMATS, TargetFormat } from './formats';
import { bad } from './user-error';

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
@Injectable()
export class ImageService {
  /** Lê JPEG/PNG (e o que o jimp detectar); arquivo ilegível = 400 com mensagem simples. */
  async read(bytes: Uint8Array): Promise<Img> {
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
}
