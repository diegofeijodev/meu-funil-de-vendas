/**
 * Arte do story no layout da arte modelo do Freela, desenhada pelo SISTEMA (nenhum texto vem da IA): logo no alto, título
 * "VAGA / FUNÇÃO / FREELANCER" em faixas, um cartão por informação (ícone redondo, rótulo pequeno, valor grande) e o rodapé com
 * os selos oficiais. A IA só fornece a foto do canto direito. Tudo aqui é determinístico: mesma vaga = mesma arte.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { RGB, fillPolys, flatten, parseFont, rect } from '../creative/compose';
import { ImageService, Img } from '../media/image.service';
import { Badges, FOOTER_LINE1, FOOTER_LINE2, STORY_H, STORY_W, fitWrapped } from './vacancy-art';
import { drawQr, QR_BOX, type QrPlan } from './vacancy-qr';
import { clipText } from './vacancy-text';

/** 3ª linha do rodapé com QR (UI 24/11 §2.4: a loja vem antes; o QR é o "ou"). */
export const FOOTER_LINE3_QR = 'ou leia o QR para ver a vaga';
import type { VacancyFields } from './vacancy-types';

type Pt = [number, number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Font = any;

export const YELLOW: RGB = [255, 198, 26];
const YELLOW_SOFT: RGB = [255, 221, 110];
export const INK: RGB = [17, 17, 17];
export const WHITE: RGB = [255, 255, 255];
const PAPER: RGB = [250, 250, 250];
const toInt = ([r, g, b]: RGB) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;

export type BaseFonts = { title: ArrayBuffer; bold: ArrayBuffer; extra: ArrayBuffer };

function fontDirs(): string[] {
  return [
    path.resolve(process.cwd(), 'assets/fonts'),
    path.resolve(__dirname, '../../../assets/fonts'),
    path.resolve(__dirname, '../../../../assets/fonts'),
    path.resolve(__dirname, '../../../../../assets/fonts'),
  ];
}

let fontCache: BaseFonts | null = null;

/** Fontes vendorizadas (OFL) em `api/assets/fonts`: Archivo Black no título, Inter Bold nos rótulos e Inter ExtraBold nos valores. */
export function loadBaseFonts(): BaseFonts {
  if (fontCache) return fontCache;
  const names = { title: 'ArchivoBlack-Regular.ttf', bold: 'Inter-Bold.otf', extra: 'Inter-ExtraBold.otf' };
  for (const dir of fontDirs()) {
    if (Object.values(names).every((n) => existsSync(path.join(dir, n)))) {
      const read = (n: string) => {
        const b = readFileSync(path.join(dir, n));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      };
      fontCache = { title: read(names.title), bold: read(names.bold), extra: read(names.extra) };
      return fontCache;
    }
  }
  throw new Error('Fontes da arte das vagas não encontradas (ArchivoBlack, Inter-Bold e Inter-ExtraBold em assets/fonts).');
}

/** A Inter traz substituições (GSUB) que o opentype.js não entende e fazem `getPath` falhar: sem a tabela, o texto sai glifo a glifo. */
function plainFont(buf: ArrayBuffer): Font {
  const font = parseFont(buf);
  if (font.tables) delete font.tables.gsub;
  return font;
}

const circlePts = (cx: number, cy: number, r: number, n = 48): Pt[] =>
  Array.from({ length: n }, (_, k) => [cx + r * Math.cos((k / n) * 2 * Math.PI), cy + r * Math.sin((k / n) * 2 * Math.PI)] as Pt);
const disc = (img: Img, cx: number, cy: number, r: number, c: RGB) => fillPolys(img, [circlePts(cx, cy, r)], c);

const rot = (pts: Pt[], cx: number, cy: number, deg: number): Pt[] => {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return pts.map(([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos] as Pt);
};

export function text(img: Img, font: Font, s: string, size: number, x: number, baseline: number, color: RGB, o: { align?: 'left' | 'center'; rot?: [number, number, number] } = {}) {
  const w = font.getAdvanceWidth(s, size);
  const left = o.align === 'center' ? x - w / 2 : x;
  let polys = flatten(font.getPath(s, left, baseline, size).commands) as Pt[][];
  if (o.rot) polys = polys.map((p) => rot(p, o.rot![0], o.rot![1], o.rot![2]));
  fillPolys(img, polys, color);
}

/** Faixa "pincelada": retângulo com as pontas serrilhadas (sempre igual), girado em torno de (cx, cy). */
export function brush(img: Img, x: number, y: number, w: number, h: number, color: RGB, cx: number, cy: number, deg: number) {
  const teeth = 7;
  const pts: Pt[] = [[x, y], [x + w, y]];
  for (let k = 0; k < teeth; k++) {
    const yy = y + ((k + 0.5) / teeth) * h;
    pts.push([x + w + (k % 2 ? 6 : 26) + ((k * 7) % 11), yy]);
  }
  pts.push([x + w, y + h], [x, y + h]);
  for (let k = teeth - 1; k >= 0; k--) {
    const yy = y + ((k + 0.5) / teeth) * h;
    pts.push([x - (k % 2 ? 24 : 8) - ((k * 5) % 9), yy]);
  }
  fillPolys(img, [rot(pts, cx, cy, deg)], color);
}

export type IconKind = 'store' | 'person' | 'calendar' | 'clock' | 'pin' | 'money' | 'clipboard' | 'wallet' | 'check';

/** Ícone simples dentro de um círculo de raio `r`; `fg` desenha, `bg` recorta. */
export function icon(img: Img, kind: IconKind, cx: number, cy: number, r: number, fg: RGB, bg: RGB, font: Font) {
  const u = r / 48; // unidade: o ícone foi desenhado para r = 48
  const R = (x: number, y: number, w: number, h: number, c: RGB, rad = 0) => rect(img, cx + x * u, cy + y * u, w * u, h * u, c, 1, rad * u);
  switch (kind) {
    case 'person':
      disc(img, cx, cy - 11 * u, 11 * u, fg);
      fillPolys(img, [[...Array.from({ length: 17 }, (_, k) => [cx + 22 * u * Math.cos(Math.PI + (k / 16) * Math.PI), cy + 24 * u + 20 * u * Math.sin(Math.PI + (k / 16) * Math.PI)] as Pt)]], fg);
      break;
    case 'store':
      fillPolys(img, [[[cx - 26 * u, cy - 6 * u], [cx - 20 * u, cy - 24 * u], [cx + 20 * u, cy - 24 * u], [cx + 26 * u, cy - 6 * u]]], fg);
      R(-22, -4, 44, 28, fg, 3);
      R(-14, 4, 12, 20, bg, 2);
      R(4, 4, 12, 10, bg, 2);
      break;
    case 'calendar':
      R(-22, -20, 44, 42, fg, 7);
      R(-16, -8, 32, 24, bg, 3);
      for (const dx of [-11, -2, 7]) for (const dy of [-4, 6]) R(dx, dy, 5, 5, fg, 1);
      R(-13, -27, 5, 12, fg, 2);
      R(8, -27, 5, 12, fg, 2);
      break;
    case 'clock':
      disc(img, cx, cy, 24 * u, fg);
      disc(img, cx, cy, 18 * u, bg);
      R(-2.5, -13, 5, 15, fg, 2);
      R(-2.5, -2.5, 13, 5, fg, 2);
      break;
    case 'pin':
      disc(img, cx, cy - 7 * u, 17 * u, fg);
      fillPolys(img, [[[cx - 15 * u, cy + 1 * u], [cx + 15 * u, cy + 1 * u], [cx, cy + 27 * u]]], fg);
      disc(img, cx, cy - 7 * u, 7 * u, bg);
      break;
    case 'money':
      text(img, font, '$', 62 * u, cx, cy + 22 * u, fg, { align: 'center' });
      break;
    case 'clipboard':
      R(-18, -22, 36, 46, fg, 5);
      R(-9, -28, 18, 11, fg, 3);
      for (const dy of [-8, 2, 12]) R(-11, dy, 22, 4, bg, 1);
      break;
    case 'wallet': // carteira de trabalho: capa com a faixa em cima (vagas fixas)
      R(-20, -26, 40, 52, fg, 6);
      R(-14, -18, 28, 6, bg, 2);
      R(-10, -2, 20, 4, bg, 1);
      R(-10, 7, 14, 4, bg, 1);
      break;
    case 'check': // "✓" dos benefícios
      fillPolys(img, [[[cx - 24 * u, cy + 1 * u], [cx - 14 * u, cy - 9 * u], [cx - 6 * u, cy + 0 * u], [cx + 16 * u, cy - 22 * u], [cx + 26 * u, cy - 12 * u], [cx - 6 * u, cy + 20 * u]]], fg);
      break;
  }
}

/** Corta em `max` caracteres na última palavra inteira, com reticências (mora em `vacancy-text`: a CLT também usa). */
export const clip = clipText;

export type CardCol = { label: string; value: string; big?: boolean; lines?: number; bold?: boolean; start?: number };
export type Card = { icon: IconKind; dark?: boolean; filled?: boolean; cols: CardCol[] };

function cardsOf(f: VacancyFields): Card[] {
  const cards: Card[] = [];
  if (f.estabelecimento) cards.push({ icon: 'store', cols: [{ label: 'Estabelecimento:', value: f.estabelecimento.toUpperCase(), lines: 2 }] });
  cards.push({ icon: 'person', cols: [{ label: 'Função:', value: f.funcao }] });
  cards.push({ icon: 'calendar', cols: [{ label: 'Data:', value: f.data }, { label: 'Horário:', value: f.horario }] });
  cards.push({ icon: 'pin', cols: [{ label: f.regiao ? 'Região:' : 'Cidade:', value: f.regiao ? `${f.regiao}, ${f.cidade}` : f.cidade, lines: 2 }] });
  cards.push({ icon: 'money', dark: true, filled: true, cols: [{ label: 'Valor para o freela:', value: f.valor, big: true }] });
  if (f.descricao) cards.push({ icon: 'clipboard', dark: true, cols: [{ label: 'Descrição:', value: clip(f.descricao, 150), lines: 3 }] });
  return cards;
}

/** Topo dos cartões quando o título tem uma linha; com a função em duas linhas eles começam logo abaixo da pílula. */
const CARDS_TOP = 742;
const CARDS_BOTTOM = 1478;
const FOOT_TOP = 1500;
const FOOT_H = 196;

/**
 * Story 1080×1920 no layout da base. `photo` (da IA, sem texto) entra recortada num círculo no canto direito; sem foto, o canto
 * fica só com o amarelo. `logo` é a logo da marca (ou o recorte da arte modelo). JPEG q92.
 */
export async function composeBaseArt(
  images: ImageService,
  i: { fields: VacancyFields; photo: Uint8Array | null; logo: Uint8Array | null; badges: Badges; fonts: BaseFonts; qr?: QrPlan | null },
): Promise<Uint8Array> {
  const f = i.fields;
  const { fTitle, fBold, fExtra } = artFonts(i.fonts);
  const cv = await drawBackdrop(images, i.photo, i.logo);

  // Título em faixas inclinadas: VAGA (preto), a função (amarelo) e FREELANCER (pílula preta com o ícone).
  const vagaSize = 104;
  const vagaW = fTitle.getAdvanceWidth('VAGA', vagaSize);
  brush(cv, 70, 392, vagaW + 110, 122, INK, TITLE_PIVOT[0], TITLE_PIVOT[1], TITLE_DEG);
  text(cv, fTitle, 'VAGA', vagaSize, 70 + 55, 392 + 100, WHITE, { rot: TITLE_PIVOT });

  const { pillTop } = drawRole(cv, fTitle, f.funcao);
  const flSize = 58;
  const flW = fTitle.getAdvanceWidth('FREELANCER', flSize);
  drawPill(cv, pillTop, flW, INK, (icx, icy) => icon(cv, 'person', icx, icy + 2, 26, INK, WHITE, fTitle));
  text(cv, fTitle, 'FREELANCER', flSize, 70 + 86, pillTop + PILL_H / 2 + flSize * 0.36, WHITE, { rot: TITLE_PIVOT });

  drawCards(cv, cardsOf(f), Math.max(CARDS_TOP, pillTop + PILL_H + 40), fBold, fExtra);
  await drawFooter(images, cv, i.qr ?? null, i.badges, fBold, fExtra);
  return images.encode(cv, false, 92);
}

/** As três fontes da arte já prontas para desenhar. */
export function artFonts(fonts: BaseFonts): { fTitle: Font; fBold: Font; fExtra: Font } {
  return { fTitle: parseFont(fonts.title), fBold: plainFont(fonts.bold), fExtra: plainFont(fonts.extra) };
}

/** Inclinação do título (faixas e pílula): −4° em torno de (330, 520). */
export const TITLE_DEG = -4;
export const TITLE_PIVOT: [number, number, number] = [330, 520, TITLE_DEG];
export const PILL_H = 84;

/** Quadro 1080×1920 com o fundo (curvas e base amarelas), a foto no círculo (ou o círculo amarelo) e a logo no alto. */
export async function drawBackdrop(images: ImageService, photo: Uint8Array | null, logoBytes: Uint8Array | null): Promise<Img> {
  const cv = images.blank(STORY_W, STORY_H, toInt(PAPER));

  // Fundo: curvas amarelas no canto de cima e a base amarela.
  disc(cv, 40, -30, 190, YELLOW);
  disc(cv, 40, -30, 150, PAPER);
  disc(cv, -40, 40, 120, YELLOW);
  rect(cv, 0, 1660, STORY_W, STORY_H - 1660, YELLOW, 1);
  fillPolys(cv, [[[0, 1660], [0, 1560], [300, 1640], [STORY_W, 1590], [STORY_W, 1660]]], YELLOW);

  // Foto num círculo com contorno amarelo (ou só o círculo amarelo).
  const PC = { x: 860, y: 430, r: 470 };
  disc(cv, PC.x, PC.y, PC.r + 34, YELLOW);
  disc(cv, PC.x - 6, PC.y + 4, PC.r + 14, PAPER);
  if (photo) {
    const ph = await images.read(photo);
    ph.cover({ w: PC.r * 2, h: PC.r * 2 });
    const d = ph.bitmap.data as Uint8Array;
    const n = PC.r * 2;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const dist = Math.hypot(x + 0.5 - PC.r, y + 0.5 - PC.r);
        d[(y * n + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, PC.r - dist)));
      }
    cv.composite(ph, PC.x - PC.r, PC.y - PC.r);
  } else {
    disc(cv, PC.x, PC.y, PC.r, YELLOW_SOFT);
  }

  // Logo no alto, à esquerda, sobre um fundo claro para não brigar com a foto.
  if (logoBytes) {
    const logo = await images.read(logoBytes).catch(() => null);
    if (logo) {
      logo.scaleToFit({ w: 380, h: 210 });
      rect(cv, 40, 140, logo.bitmap.width + 36, logo.bitmap.height + 28, PAPER, 0.94, 28);
      cv.composite(logo, 58, 154);
    }
  }
  return cv;
}

/** Função/cargo em pincelada amarela: numa linha enquanto couber com letra grande; senão em duas, menores. Devolve o topo da pílula. */
export function drawRole(cv: Img, fTitle: Font, value: string): { pillTop: number } {
  const roleText = value.toUpperCase();
  const oneLine = fitWrapped(fTitle, roleText, 860, { start: 92, floor: 64, maxLines: 1 });
  const role = oneLine.size >= 64 ? oneLine : fitWrapped(fTitle, roleText, 820, { start: 76, floor: 46, maxLines: 2 });
  const roleLine = role.size * 1.04;
  const roleW = Math.max(...role.lines.map((l) => fTitle.getAdvanceWidth(l, role.size)));
  const roleH = Math.round(role.lines.length * roleLine + 26);
  const roleTop = 516;
  brush(cv, 36, roleTop, roleW + 84, roleH, YELLOW, TITLE_PIVOT[0], TITLE_PIVOT[1], TITLE_DEG);
  role.lines.forEach((l, k) => text(cv, fTitle, l, role.size, 36 + 42, roleTop + 12 + role.size * 0.82 + k * roleLine, INK, { rot: TITLE_PIVOT }));
  return { pillTop: roleTop + roleH + 10 };
}

/** Pílula inclinada (texto de largura `textW`) na cor `fill`, com o disco branco do ícone; `drawIcon` recebe o centro do disco. */
export function drawPill(cv: Img, pillTop: number, textW: number, fill: RGB, drawIcon: (cx: number, cy: number) => void): void {
  const pillH = PILL_H;
  const pillPts: Pt[] = [];
  for (let k = 0; k <= 16; k++) pillPts.push([70 + 86 + textW + 34 - pillH / 2 + (pillH / 2) * Math.cos(-Math.PI / 2 + (k / 16) * Math.PI), pillTop + pillH / 2 + (pillH / 2) * Math.sin(-Math.PI / 2 + (k / 16) * Math.PI)]);
  for (let k = 0; k <= 16; k++) pillPts.push([70 + pillH / 2 + (pillH / 2) * Math.cos(Math.PI / 2 + (k / 16) * Math.PI), pillTop + pillH / 2 + (pillH / 2) * Math.sin(Math.PI / 2 + (k / 16) * Math.PI)]);
  fillPolys(cv, [rot(pillPts, TITLE_PIVOT[0], TITLE_PIVOT[1], TITLE_DEG)], fill);
  const [icx, icy] = rot([[70 + pillH / 2, pillTop + pillH / 2]], TITLE_PIVOT[0], TITLE_PIVOT[1], TITLE_DEG)[0]!;
  disc(cv, icx, icy, 30, WHITE);
  drawIcon(icx, icy);
}

/** Cartões: a pilha ocupa a faixa `cardsTop`–CARDS_BOTTOM; com menos cartões, eles crescem (até 1,3×). */
export function drawCards(cv: Img, cards: Card[], cardsTop: number, fBold: Font, fExtra: Font): void {
  const GAP = 14;
  const X0 = 40;
  const ICON_R = 52;
  const cardX = X0 + ICON_R;
  const cardW = STORY_W - 40 - cardX;
  const textX = X0 + ICON_R * 2 + 22;
  const textW = STORY_W - 40 - 28 - textX;
  // Fonte do valor: Inter Bold nos textos longos (`lines === 3`, ou `bold`), Inter ExtraBold no resto.
  const fontOf = (col: CardCol) => (col.bold || col.lines === 3 ? fBold : fExtra);
  const layout = (k: number) => {
    const rows = cards.map((c) => {
      const colW = c.cols.length > 1 ? (textW - 30) / 2 : textW;
      const cols = c.cols.map((col) => {
        const start = (col.start ?? (col.big ? 64 : col.lines === 3 ? 30 : 42)) * k;
        const fit = fitWrapped(fontOf(col), col.value, colW, { start, floor: start * 0.62, maxLines: col.lines ?? 1 });
        return { ...col, fit, colW };
      });
      const label = 25 * k;
      const lines = Math.max(...cols.map((c2) => c2.fit.lines.length));
      const size = Math.max(...cols.map((c2) => c2.fit.size));
      const h = Math.max(ICON_R * 2 * Math.min(1, k) , Math.round(16 * k + label + 8 * k + lines * size * 1.14 + 14 * k));
      return { c, cols, label, h };
    });
    return { rows, total: rows.reduce((a, r) => a + r.h, 0) + GAP * (rows.length - 1) };
  };
  const room = CARDS_BOTTOM - cardsTop;
  let k = 1.3;
  let L = layout(k);
  while (L.total > room && k > 0.5) {
    k *= 0.97;
    L = layout(k);
  }
  let y = cardsTop + Math.max(0, Math.round((room - L.total) / 2));
  for (const r of L.rows) {
    const { c, h } = r;
    const rad = Math.min(26, h / 2);
    rect(cv, cardX, y, cardW, h, YELLOW, 1, rad);
    if (!c.filled) rect(cv, cardX + 3, y + 3, cardW - 6, h - 6, WHITE, 1, rad - 3);
    const ir = Math.min(ICON_R, h / 2 + 4);
    const cy = y + h / 2;
    disc(cv, X0 + ICON_R, cy, ir, c.dark ? INK : YELLOW);
    icon(cv, c.icon, X0 + ICON_R, cy, ir * 0.92, c.dark ? YELLOW : WHITE, c.dark ? INK : YELLOW, fExtra);
    r.cols.forEach((col, ci) => {
      const x = textX + ci * (col.colW + 30);
      if (ci > 0) rect(cv, x - 16, y + 14, 3, h - 28, YELLOW, 1);
      const top = y + 16 * k;
      text(cv, fBold, col.label, r.label, x, top + r.label * 0.8, INK);
      const font = fontOf(col);
      col.fit.lines.forEach((l, li) => text(cv, font, l, col.fit.size, x, top + r.label + 8 * k + col.fit.size * 0.82 + li * col.fit.size * 1.14, INK));
    });
    y += h + GAP;
  }
}

/** Rodapé preto com a chamada e os selos oficiais (só redimensionados); com `qr`, o rodapé com o QR da vaga. */
export async function drawFooter(images: ImageService, cv: Img, qr: QrPlan | null, badges: Badges, fBold: Font, fExtra: Font): Promise<void> {
  if (qr) return footerWithQr(images, cv, qr, badges, fBold, fExtra);
  rect(cv, 40, FOOT_TOP, STORY_W - 80, FOOT_H, INK, 1, 40);
  text(cv, fExtra, FOOTER_LINE1, 44, 76, FOOT_TOP + 78, YELLOW);
  text(cv, fBold, FOOTER_LINE2, 28, 76, FOOT_TOP + 128, WHITE);
  const gp = await images.read(badges.googlePlay);
  const as = await images.read(badges.appStore);
  gp.resize({ h: 64 });
  as.resize({ h: 64 });
  const bx = STORY_W - 76 - Math.max(gp.bitmap.width, as.bitmap.width);
  cv.composite(gp, bx, FOOT_TOP + 22);
  cv.composite(as, bx, FOOT_TOP + 22 + 64 + 22);
}

/**
 * Rodapé com o QR da vaga (UI 24/11 §2.3): o mesmo preto, o QR à esquerda em (64, 1508) e o texto em 3 linhas de x 268 até 24 px antes dos
 * selos — L1 amarela (Inter ExtraBold 44, piso 36), L2 e L3 brancas (Inter Bold 30, piso 26). Selos iguais, na mesma posição.
 */
async function footerWithQr(images: ImageService, cv: Img, qr: QrPlan, badges: Badges, fBold: Font, fExtra: Font) {
  rect(cv, 40, FOOT_TOP, STORY_W - 80, FOOT_H, INK, 1, 40);
  const gp = await images.read(badges.googlePlay);
  const as = await images.read(badges.appStore);
  gp.resize({ h: 64 });
  as.resize({ h: 64 });
  const bx = STORY_W - 76 - Math.max(gp.bitmap.width, as.bitmap.width);
  drawQr(cv, qr, INK);
  const x = QR_BOX.x + QR_BOX.size + 24;
  const maxW = bx - 24 - x;
  const line = (font: Font, s: string, start: number, floor: number, baseline: number, color: RGB) => {
    const fit = fitWrapped(font, s, maxW, { start, floor, maxLines: 1 });
    text(cv, font, fit.lines.join(' '), fit.size, x, baseline, color);
  };
  line(fExtra, FOOTER_LINE1, 44, 36, FOOT_TOP + 66, YELLOW);
  line(fBold, FOOTER_LINE2, 30, 26, FOOT_TOP + 116, WHITE);
  line(fBold, FOOTER_LINE3_QR, 30, 26, FOOT_TOP + 160, WHITE);
  cv.composite(gp, bx, FOOT_TOP + 22);
  cv.composite(as, bx, FOOT_TOP + 22 + 64 + 22);
}
