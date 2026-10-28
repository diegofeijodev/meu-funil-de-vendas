/**
 * Quadro do story das vagas (1080×1920): arte da IA no meio, rodapé e selos oficiais desenhados pelo sistema, e a arte de reserva
 * (foto + textos do sistema) para quando a IA erra. Nada aqui chama rede; os selos são os arquivos oficiais de `assets/badges`
 * (só redimensionados, nunca redesenhados).
 */
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { RGB, fillPolys, flatten, hexToRgb, parseFont, rect } from '../creative/compose';
import { ImageService, Img, dominantColor } from '../media/image.service';
import type { VacancyFields } from './vacancy-types';

export const STORY_W = 1080;
export const STORY_H = 1920;
/** Área livre da arte (o Instagram cobre o topo e a base). */
export const ART_BOX = { top: 250, bottom: 1350 };
export const FOOTER_BOX = { top: 1370, bottom: 1600 };
/** A conferência às cegas vê só o quadro até aqui (sem o rodapé do sistema). */
export const CHECK_CROP_BOTTOM = 1360;
export const FOOTER_LINE1 = 'Candidate-se pelo app';
export const FOOTER_LINE2 = 'Procure Freela Serviços na loja';

export type Badges = { googlePlay: Uint8Array; appStore: Uint8Array };

const BADGE_H = 72;
const BADGE_GAP = 24;

/** Pasta `assets/badges` da API: funciona em `ts-node` (src/), em `dist/` e no contêiner (cwd = /app). */
function badgeDirs(): string[] {
  return [
    path.resolve(process.cwd(), 'assets/badges'),
    path.resolve(__dirname, '../../../assets/badges'),
    path.resolve(__dirname, '../../../../assets/badges'),
    path.resolve(__dirname, '../../../../../assets/badges'),
  ];
}

let badgeCache: Badges | null = null;

/** Selos oficiais (Google Play e App Store, pt-BR) lidos do disco uma vez. */
export function loadBadges(): Badges {
  if (badgeCache) return badgeCache;
  for (const dir of badgeDirs()) {
    const gp = path.join(dir, 'google-play-pt-br.png');
    const as = path.join(dir, 'app-store-pt-br.png');
    if (existsSync(gp) && existsSync(as)) {
      badgeCache = { googlePlay: new Uint8Array(readFileSync(gp)), appStore: new Uint8Array(readFileSync(as)) };
      return badgeCache;
    }
  }
  throw new Error('Selos oficiais não encontrados (google-play-pt-br.png e app-store-pt-br.png em assets/badges).');
}

const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const toInt = ([r, g, b]: RGB) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const INK: RGB = [17, 17, 17];
const WHITE: RGB = [255, 255, 255];

/** Cor dominante da borda de 3% da imagem (`#rrggbb`): as faixas do quadro herdam a cor do modelo. */
export async function edgeColor(images: ImageService, bytes: Uint8Array): Promise<string> {
  const img = await images.read(bytes);
  const w = img.bitmap.width as number;
  const h = img.bitmap.height as number;
  const t = Math.max(1, Math.round(Math.min(w, h) * 0.03));
  const src = img.bitmap.data as Uint8Array;
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    const edgeRow = y < t || y >= h - t;
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= t && x < w - t) continue;
      const o = (y * w + x) * 4;
      out.push(src[o]!, src[o + 1]!, src[o + 2]!, src[o + 3]!);
    }
  }
  const strip = images.blank(out.length / 4, 1);
  (strip.bitmap.data as Uint8Array).set(out);
  return toHex(dominantColor(strip));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Font = any;

/** Texto numa linha, `baseline` = y da linha de base; `align` em relação a `x`. */
function drawText(img: Img, font: Font, text: string, size: number, x: number, baseline: number, color: RGB, align: 'center' | 'left' = 'center') {
  const w = font.getAdvanceWidth(text, size);
  const left = align === 'center' ? x - w / 2 : x;
  fillPolys(img, flatten(font.getPath(text, left, baseline, size).commands), color);
}

function wrap(font: Font, text: string, size: number, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const t = line ? `${line} ${w}` : w;
    if (font.getAdvanceWidth(t, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Maior tamanho (≤ start) em que o texto cabe em `maxLines` linhas de `maxW`. */
function fitText(font: Font, text: string, start: number, maxW: number, maxLines: number, min = 40) {
  let size = start;
  let lines = wrap(font, text, size, maxW);
  while ((lines.length > maxLines || lines.some((l) => font.getAdvanceWidth(l, size) > maxW)) && size > min) {
    size = Math.max(min, size * 0.94);
    lines = wrap(font, text, size, maxW);
  }
  return { size, lines: lines.slice(0, maxLines) };
}

/** Rodapé do sistema dentro de FOOTER_BOX: duas linhas de texto e os selos lado a lado, centralizados. */
async function drawFooter(images: ImageService, canvas: Img, font: Font, badges: Badges, bg: RGB): Promise<void> {
  const ink = lum(bg) > 140 ? INK : WHITE;
  drawText(canvas, font, FOOTER_LINE1, 56, STORY_W / 2, FOOTER_BOX.top + 10 + 56 * 0.8, ink);
  drawText(canvas, font, FOOTER_LINE2, 44, STORY_W / 2, FOOTER_BOX.top + 10 + 56 * 1.2 + 44 * 0.85, ink);
  const gp = await images.read(badges.googlePlay);
  const as = await images.read(badges.appStore);
  gp.resize({ h: BADGE_H });
  as.resize({ h: BADGE_H });
  const total = gp.bitmap.width + BADGE_GAP + as.bitmap.width;
  const y = FOOTER_BOX.top + 10 + 56 * 1.2 + 44 * 1.2 + 14;
  const x0 = Math.round((STORY_W - total) / 2);
  canvas.composite(gp, x0, Math.round(y));
  canvas.composite(as, x0 + gp.bitmap.width + BADGE_GAP, Math.round(y));
}

/** Quadro final: a arte inteira (sem cortar) na ART_BOX, faixas na cor `bg` e o rodapé do sistema. JPEG q92. */
export async function composeStoryFrame(
  images: ImageService,
  i: { art: Uint8Array; bg: string; font: ArrayBuffer; badges: Badges },
): Promise<Uint8Array> {
  const bg = hexToRgb(i.bg, WHITE);
  const canvas = images.blank(STORY_W, STORY_H, toInt(bg));
  const art = await images.read(i.art);
  art.scaleToFit({ w: STORY_W, h: ART_BOX.bottom - ART_BOX.top });
  canvas.composite(art, Math.round((STORY_W - art.bitmap.width) / 2), ART_BOX.top + Math.round((ART_BOX.bottom - ART_BOX.top - art.bitmap.height) / 2));
  await drawFooter(images, canvas, parseFont(i.font), i.badges, bg);
  return images.encode(canvas, false, 92);
}

/** O que a conferência às cegas vê: o quadro de y 0 a 1360 (sem o rodapé), JPEG de no máximo 1024 px. */
export async function cropForCheck(images: ImageService, frame: Uint8Array): Promise<{ bytes: Uint8Array; mime: string }> {
  const img = await images.read(frame);
  img.crop({ x: 0, y: 0, w: img.bitmap.width, h: Math.min(CHECK_CROP_BOTTOM, img.bitmap.height) });
  img.scaleToFit({ w: 1024, h: 1024 });
  return { bytes: new Uint8Array(await img.getBuffer('image/jpeg', { quality: 85 })), mime: 'image/jpeg' };
}

/** Cantos arredondados: pixels fora do arco viram `bg` (com borda suave). */
function roundCorners(img: Img, r: number, bg: RGB) {
  const w = img.bitmap.width as number;
  const h = img.bitmap.height as number;
  const d = img.bitmap.data as Uint8Array;
  for (let y = 0; y < r; y++)
    for (let x = 0; x < r; x++) {
      const dist = Math.hypot(r - x - 0.5, r - y - 0.5);
      const keep = Math.max(0, Math.min(1, r - dist + 0.5));
      if (keep >= 1) continue;
      for (const [px, py] of [[x, y], [w - 1 - x, y], [x, h - 1 - y], [w - 1 - x, h - 1 - y]] as const) {
        const o = (py * w + px) * 4;
        for (let c = 0; c < 3; c++) d[o + c] = d[o + c]! * keep + bg[c]! * (1 - keep);
      }
    }
}

const M = 48; // margem lateral dos cartões
const CARD_W = STORY_W - M * 2;
const GAP = 10;

/**
 * Arte de reserva (a IA errou 3 vezes): os textos escritos pelo sistema por cima de uma foto (ou só cartões). Foto em cima, com a logo da
 * marca no canto; abaixo, faixa "VAGA FREELA", função, valor, quando, onde e estabelecimento em cartões brancos. Tudo em 250–1350.
 */
export async function composeFallback(
  images: ImageService,
  i: { photo: Uint8Array | null; fields: VacancyFields; bg: string; accent: string; logo: Uint8Array | null; font: ArrayBuffer; badges: Badges },
): Promise<Uint8Array> {
  const bg = hexToRgb(i.bg, WHITE);
  const accent = hexToRgb(i.accent, [194, 65, 12]);
  const accentInk = lum(accent) > 140 ? INK : WHITE;
  const font = parseFont(i.font);
  const f = i.fields;
  const canvas = images.blank(STORY_W, STORY_H, toInt(bg));
  const innerW = CARD_W - 48;

  const logo = i.logo ? await images.read(i.logo).then((l: Img) => (l.scaleToFit({ w: 220, h: 120 }), l)).catch(() => null) : null;

  // Medidas dos blocos (altura de cada cartão) antes de posicionar.
  const fn = fitText(font, f.funcao.toUpperCase(), 130, innerW, 2, 110 * 0.6);
  const fnH = Math.round(fn.lines.length * fn.size * 1.0 + 36);
  const valSize = fitText(font, f.valor, 150, innerW, 1, 100).size;
  const valLabel = 40;
  const valH = Math.round(valLabel + 14 + valSize * 0.8 + 40);
  const whenSize = fitText(font, `${f.data} · ${f.horario}`, 66, innerW, 1, 40).size;
  const whenH = Math.round(whenSize * 0.8 + 40);
  const pinW = 56;
  const whereSize = fitText(font, f.cidade, 66, innerW - pinW - 20, 1, 40).size;
  const whereH = Math.round(whereSize * 0.8 + 40);
  const estSize = f.estabelecimento ? fitText(font, f.estabelecimento, 54, innerW, 1, 40).size : 0;
  const estH = f.estabelecimento ? Math.round(estSize * 0.8 + 36) : 0;
  const stripH = 56;
  const blocks = [stripH, fnH, valH, whenH, whereH, ...(estH ? [estH] : [])];
  const stack = blocks.reduce((a, b) => a + b, 0) + GAP * (blocks.length - 1);
  const free = ART_BOX.bottom - ART_BOX.top;

  // Foto ocupa o que sobra em cima (até 550 px); sem espaço para ao menos 200 px, os cartões ficam sozinhos.
  let photoH = i.photo ? Math.min(550, free - stack - GAP) : 0;
  if (photoH < 200) photoH = 0;
  const logoH = logo ? (logo.bitmap.height as number) : 0;
  let y = ART_BOX.top;

  if (photoH > 0 && i.photo) {
    const ph = await images.read(i.photo);
    ph.cover({ w: CARD_W, h: photoH });
    roundCorners(ph, 32, bg);
    canvas.composite(ph, M, y);
    if (logo) {
      const pad = 10;
      rect(canvas, M + 16, y + 16, logo.bitmap.width + pad * 2, logoH + pad * 2, WHITE, 0.95, 18);
      canvas.composite(logo, M + 16 + pad, y + 16 + pad);
    }
    y += photoH + GAP;
  } else {
    const rest = free - stack - (logo ? logoH + GAP : 0);
    // Sem foto: logo no topo e o excedente de altura vira respiro, repartido entre os cartões.
    if (logo) {
      canvas.composite(logo, Math.round((STORY_W - logo.bitmap.width) / 2), y);
      y += logoH + GAP;
    }
    y += Math.max(0, Math.round(rest / 2));
  }

  const card = (h: number) => {
    rect(canvas, M, y, CARD_W, h, WHITE, 1, 28);
    const top = y;
    y += h + GAP;
    return top;
  };

  // Faixa "VAGA FREELA"
  rect(canvas, M, y, CARD_W, stripH, accent, 1, 28);
  drawText(canvas, font, 'VAGA FREELA', 36, STORY_W / 2, y + stripH / 2 + 36 * 0.36, accentInk);
  y += stripH + GAP;

  // Função
  let top = card(fnH);
  fn.lines.forEach((l, k) => drawText(canvas, font, l, fn.size, STORY_W / 2, top + 18 + fn.size * 0.8 + k * fn.size, INK));

  // Valor
  top = card(valH);
  drawText(canvas, font, 'Valor para o freela', valLabel, STORY_W / 2, top + 20 + valLabel * 0.8, INK);
  drawText(canvas, font, f.valor, valSize, STORY_W / 2, top + 20 + valLabel + 14 + valSize * 0.8, INK);

  // Quando
  top = card(whenH);
  drawText(canvas, font, `${f.data} · ${f.horario}`, whenSize, STORY_W / 2, top + 20 + whenSize * 0.8, INK);

  // Onde (pino = círculo + triângulo)
  top = card(whereH);
  const tw = font.getAdvanceWidth(f.cidade, whereSize);
  const gx = (STORY_W - (pinW + 20 + tw)) / 2;
  const cy = top + whereH / 2 - 6;
  const pr = 17;
  const cx = gx + pinW / 2;
  const circle: [number, number][] = Array.from({ length: 32 }, (_, k) => [cx + pr * Math.cos((k / 32) * 2 * Math.PI), cy + pr * Math.sin((k / 32) * 2 * Math.PI)]);
  fillPolys(canvas, [[[cx - pr * 0.9, cy + pr * 0.4], [cx + pr * 0.9, cy + pr * 0.4], [cx, cy + pr * 2.1]], circle], accent);
  rect(canvas, cx - 6, cy - 6, 12, 12, WHITE, 1, 6);
  drawText(canvas, font, f.cidade, whereSize, gx + pinW + 20, top + 20 + whereSize * 0.8, INK, 'left');

  // Estabelecimento
  if (f.estabelecimento) {
    top = card(estH);
    drawText(canvas, font, f.estabelecimento, estSize, STORY_W / 2, top + 18 + estSize * 0.8, INK);
  }

  await drawFooter(images, canvas, font, i.badges, bg);
  return images.encode(canvas, false, 92);
}
