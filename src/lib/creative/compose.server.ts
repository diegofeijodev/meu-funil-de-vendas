/**
 * Composição final: logo e textos aplicados por cima da imagem (nunca gerados pela IA).
 * jimp para a imagem + opentype.js para desenhar a fonte da marca (puro JS, sem binário).
 */
import type { LogoPosition, TextLayout } from "./visual-style";

type RGB = [number, number, number];

const hex = (h: string | null | undefined, fb: RGB): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h ?? "").trim());
  if (!m) return fb;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* ---------- rasterização de texto (preenchimento por varredura com antisserrilhado) ---------- */

type Pt = [number, number];

function flatten(commands: any[]): Pt[][] {
  const polys: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  const seg = 8;
  for (const c of commands) {
    if (c.type === "M") {
      if (cur.length) polys.push(cur);
      cur = [[c.x, c.y]];
      x = c.x;
      y = c.y;
    } else if (c.type === "L") {
      cur.push([c.x, c.y]);
      x = c.x;
      y = c.y;
    } else if (c.type === "Q") {
      for (let i = 1; i <= seg; i++) {
        const t = i / seg;
        const a = (1 - t) ** 2;
        const b = 2 * (1 - t) * t;
        const d = t * t;
        cur.push([a * x + b * c.x1 + d * c.x, a * y + b * c.y1 + d * c.y]);
      }
      x = c.x;
      y = c.y;
    } else if (c.type === "C") {
      for (let i = 1; i <= seg; i++) {
        const t = i / seg;
        const a = (1 - t) ** 3;
        const b = 3 * (1 - t) ** 2 * t;
        const e = 3 * (1 - t) * t * t;
        const d = t ** 3;
        cur.push([
          a * x + b * c.x1 + e * c.x2 + d * c.x,
          a * y + b * c.y1 + e * c.y2 + d * c.y,
        ]);
      }
      x = c.x;
      y = c.y;
    } else if (c.type === "Z") {
      if (cur.length) polys.push(cur);
      cur = [];
    }
  }
  if (cur.length) polys.push(cur);
  return polys;
}

function fillPolys(img: any, polys: Pt[][], color: RGB, alpha = 1) {
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  const data = img.bitmap.data as Uint8Array;
  const edges: [number, number, number, number, number][] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i]!;
      const [x1, y1] = p[(i + 1) % p.length]!;
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1]);
      minY = Math.min(minY, y0, y1);
      maxY = Math.max(maxY, y0, y1);
    }
  }
  const S = 4;
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  const cov = new Float32Array(W);
  for (let py = y0; py <= y1; py++) {
    cov.fill(0);
    let any = false;
    for (let k = 0; k < S; k++) {
      const sy = py + (k + 0.5) / S;
      const xs: [number, number][] = [];
      for (const e of edges) {
        if (sy < e[1] || sy >= e[3]) continue;
        xs.push([e[0] + ((sy - e[1]) / (e[3] - e[1])) * (e[2] - e[0]), e[4]]);
      }
      if (!xs.length) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i]![1];
        if (wind === 0) continue;
        const a = Math.max(0, xs[i]![0]);
        const b = Math.min(W, xs[i + 1]![0]);
        if (b <= a) continue;
        any = true;
        const ia = Math.floor(a);
        const ib = Math.floor(b);
        if (ia === ib) cov[ia]! += (b - a) / S;
        else {
          cov[ia]! += (ia + 1 - a) / S;
          for (let x = ia + 1; x < ib && x < W; x++) cov[x]! += 1 / S;
          if (ib < W) cov[ib]! += (b - ib) / S;
        }
      }
    }
    if (!any) continue;
    for (let x = 0; x < W; x++) {
      const c = Math.min(1, cov[x]!) * alpha;
      if (c <= 0) continue;
      const o = (py * W + x) * 4;
      data[o] = data[o]! * (1 - c) + color[0] * c;
      data[o + 1] = data[o + 1]! * (1 - c) + color[1] * c;
      data[o + 2] = data[o + 2]! * (1 - c) + color[2] * c;
    }
  }
}

function rect(img: any, x: number, y: number, w: number, h: number, color: RGB, alpha: number, r = 0) {
  const pts: Pt[] = [];
  if (r <= 0) pts.push([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
  else {
    const arc = (cx: number, cy: number, a0: number) => {
      for (let i = 0; i <= 8; i++) {
        const a = a0 + (i / 8) * (Math.PI / 2);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    arc(x + w - r, y + r, -Math.PI / 2);
    arc(x + w - r, y + h - r, 0);
    arc(x + r, y + h - r, Math.PI / 2);
    arc(x + r, y + r, Math.PI);
  }
  fillPolys(img, [pts], color, alpha);
}

function regionLum(img: any, x: number, y: number, w: number, h: number) {
  const W = img.bitmap.width;
  const d = img.bitmap.data as Uint8Array;
  let sum = 0;
  let n = 0;
  const step = Math.max(2, Math.floor(Math.min(w, h) / 30));
  for (let yy = Math.max(0, y); yy < Math.min(img.bitmap.height, y + h); yy += step)
    for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx += step) {
      const o = (yy * W + xx) * 4;
      sum += lum([d[o]!, d[o + 1]!, d[o + 2]!]);
      n++;
    }
  return n ? sum / n : 128;
}

/* ---------- layout ---------- */

export type ComposeInput = {
  image: Uint8Array;
  aspectRatio: string;
  layout: TextLayout;
  title?: string | null;
  price?: string | null;
  cta?: string | null;
  logo?: Uint8Array | null;
  logoPosition?: LogoPosition;
  font: ArrayBuffer;
  primary?: string | null;
  secondary?: string | null;
};

export async function composeCreative(inp: ComposeInput): Promise<Uint8Array> {
  const { Jimp } = await import("jimp");
  const opentype = await import("opentype.js");
  const img = await Jimp.read(Buffer.from(inp.image));
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  const font = (opentype as any).parse(inp.font);
  const primary = hex(inp.primary, [22, 135, 232]);
  const vertical = inp.aspectRatio === "9:16";
  // Zonas seguras: no 9:16 a interface do Instagram cobre ~14% no topo e ~20% embaixo.
  const topSafe = vertical ? H * 0.14 : H * 0.06;
  const bottomSafe = vertical ? H * 0.8 : H * 0.94;
  const margin = W * 0.06;

  const wrap = (text: string, size: number, maxW: number) => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (font.getAdvanceWidth(t, size) > maxW && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  };
  const fit = (text: string, start: number, maxW: number, maxLines: number) => {
    let size = start;
    let lines = wrap(text, size, maxW);
    while ((lines.length > maxLines || lines.some((l) => font.getAdvanceWidth(l, size) > maxW)) && size > 18) {
      size *= 0.92;
      lines = wrap(text, size, maxW);
    }
    return { size, lines: lines.slice(0, maxLines) };
  };
  const drawLines = (lines: string[], size: number, top: number, color: RGB, align: "center" | "left" = "center") => {
    let y = top;
    for (const l of lines) {
      const w = font.getAdvanceWidth(l, size);
      const x = align === "center" ? (W - w) / 2 : margin;
      y += size;
      fillPolys(img, flatten(font.getPath(l, x, y - size * 0.18, size).commands), color);
      y += size * 0.15;
    }
    return y;
  };
  /** Faixa com contraste automático atrás do texto. */
  const band = (top: number, height: number) => {
    const dark = regionLum(img, 0, Math.round(top), W, Math.round(height)) > 140;
    rect(img, 0, top, W, height, dark ? [0, 0, 0] : [7, 27, 57], dark ? 0.42 : 0.35);
    return [255, 255, 255] as RGB;
  };

  const title = (inp.title ?? "").trim();
  const cta = (inp.cta ?? "").trim();
  const price = (inp.price ?? "").trim();

  if (inp.layout === "titulo_topo" && title) {
    const { size, lines } = fit(title, W * 0.085, W - margin * 2, 2);
    const h = lines.length * size * 1.15 + size * 0.9;
    const color = band(topSafe - size * 0.3, h);
    drawLines(lines, size, topSafe, color);
  }

  if (inp.layout === "preco_destaque") {
    if (title) {
      const { size, lines } = fit(title, W * 0.07, W - margin * 2, 2);
      const color = band(topSafe - size * 0.3, lines.length * size * 1.15 + size * 0.9);
      drawLines(lines, size, topSafe, color);
    }
    if (price) {
      const size = W * 0.1;
      const tw = font.getAdvanceWidth(price, size);
      const bw = tw + size * 0.9;
      const bh = size * 1.5;
      const x = W - margin - bw;
      const y = bottomSafe - bh - H * 0.02;
      rect(img, x, y, bw, bh, primary, 0.95, bh / 2);
      fillPolys(img, flatten(font.getPath(price, x + (bw - tw) / 2, y + bh / 2 + size * 0.35, size).commands), [255, 255, 255]);
    }
  }

  if (inp.layout === "cta_rodape") {
    const label = cta || "Saiba mais";
    const size = W * 0.05;
    const tw = font.getAdvanceWidth(label, size);
    const bw = tw + size * 1.6;
    const bh = size * 2;
    const by = bottomSafe - bh - H * 0.02;
    if (title) {
      const t = fit(title, W * 0.065, W - margin * 2, 2);
      const th = t.lines.length * t.size * 1.15;
      const color = band(by - th - t.size * 0.9, th + bh + t.size * 1.4);
      drawLines(t.lines, t.size, by - th - t.size * 0.5, color);
    }
    rect(img, (W - bw) / 2, by, bw, bh, primary, 0.97, bh / 2);
    fillPolys(img, flatten(font.getPath(label, (W - tw) / 2, by + bh / 2 + size * 0.35, size).commands), [255, 255, 255]);
  }

  if (inp.logo && inp.logoPosition && inp.logoPosition !== "none") {
    try {
      const logo = await Jimp.read(Buffer.from(inp.logo));
      logo.scaleToFit({ w: Math.round(W * 0.18), h: Math.round(W * 0.12) });
      const lx = inp.logoPosition.endsWith("left") ? margin : W - margin - logo.bitmap.width;
      const top = inp.logoPosition.startsWith("top");
      // Evita a faixa do título quando o layout usa o topo.
      const busyTop = top && (inp.layout === "titulo_topo" || inp.layout === "preco_destaque") && !!title;
      const ly = top && !busyTop ? topSafe : bottomSafe - logo.bitmap.height - H * 0.02;
      const shiftX = !top && inp.layout === "cta_rodape" ? 0 : 0;
      img.composite(logo, Math.round(lx + shiftX), Math.round(busyTop ? bottomSafe - logo.bitmap.height - H * 0.02 : ly));
    } catch (e) {
      console.warn("[compose] logo ignorada", e instanceof Error ? e.message : e);
    }
  }

  return new Uint8Array(await img.getBuffer("image/jpeg", { quality: 92 }));
}
