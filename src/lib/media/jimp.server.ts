/**
 * Jimp montado sob medida para o runtime do servidor: o PNG padrão do jimp (pngjs) depende de
 * streams do Node e quebra no servidor publicado. Aqui o PNG usa fast-png (puro JS, sem streams).
 */
import { createJimp } from "@jimp/core";
import jpeg from "@jimp/js-jpeg";
import * as blit from "@jimp/plugin-blit";
import * as color from "@jimp/plugin-color";
import * as contain from "@jimp/plugin-contain";
import * as cover from "@jimp/plugin-cover";
import * as crop from "@jimp/plugin-crop";
import * as flip from "@jimp/plugin-flip";
import * as mask from "@jimp/plugin-mask";
import * as resize from "@jimp/plugin-resize";
import * as rotate from "@jimp/plugin-rotate";
import { decode, encode } from "fast-png";

function png() {
  return {
    mime: "image/png" as const,
    hasAlpha: true,
    encode: (bitmap: { width: number; height: number; data: Buffer | Uint8Array }) =>
      Buffer.from(encode({ width: bitmap.width, height: bitmap.height, data: new Uint8Array(bitmap.data), channels: 4, depth: 8 })),
    decode: (data: Buffer) => {
      const img = decode(new Uint8Array(data));
      const { width, height, channels } = img;
      const src = img.data;
      const out = Buffer.alloc(width * height * 4);
      const max = img.depth === 16 ? 257 : 1;
      const pal = img.palette;
      for (let i = 0; i < width * height; i++) {
        let r: number, g: number, b: number, a = 255;
        if (pal) {
          const p = pal[src[i]!] ?? [0, 0, 0, 255];
          [r, g, b] = p as number[] as [number, number, number];
          a = (p as number[])[3] ?? 255;
        } else if (channels === 1 || channels === 2) {
          r = g = b = src[i * channels]! / max;
          if (channels === 2) a = src[i * 2 + 1]! / max;
        } else {
          r = src[i * channels]! / max;
          g = src[i * channels + 1]! / max;
          b = src[i * channels + 2]! / max;
          if (channels === 4) a = src[i * 4 + 3]! / max;
        }
        out[i * 4] = r;
        out[i * 4 + 1] = g;
        out[i * 4 + 2] = b;
        out[i * 4 + 3] = a;
      }
      return { width, height, data: out };
    },
  };
}

export const Jimp = createJimp({
  formats: [jpeg, png as never],
  plugins: [blit.methods, color.methods, contain.methods, cover.methods, crop.methods, flip.methods, mask.methods, resize.methods, rotate.methods],
});
