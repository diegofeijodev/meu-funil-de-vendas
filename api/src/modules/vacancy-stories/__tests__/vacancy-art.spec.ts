jest.setTimeout(120_000);

import { ImageService } from '../../media/image.service';
import { loadDefaultFont } from '../../creative/refs.service';
import {
  ART_BOX,
  CHECK_CROP_BOTTOM,
  FOOTER_BOX,
  STORY_H,
  STORY_W,
  composeFallback,
  composeStoryFrame,
  cropForCheck,
  edgeColor,
  fitWrapped,
  loadBadges,
} from '../vacancy-art';
import { parseFont } from '../../creative/compose';
import type { VacancyFields } from '../vacancy-types';

const images = new ImageService();
const font = loadDefaultFont();
const badges = loadBadges();

const solid = async (w: number, h: number, color: number) => images.encode(images.blank(w, h, color), false);
const px = (img: { bitmap: { width: number; data: Uint8Array } }, x: number, y: number): [number, number, number] => {
  const o = (y * img.bitmap.width + x) * 4;
  return [img.bitmap.data[o]!, img.bitmap.data[o + 1]!, img.bitmap.data[o + 2]!];
};
const isWhite = (p: number[]) => p.every((v) => v > 240);
const isDark = (p: number[]) => p.every((v) => v < 110);
/** Há algum pixel que satisfaz `f` na faixa? */
const anyIn = (img: { bitmap: { width: number; data: Uint8Array } }, x0: number, x1: number, y0: number, y1: number, f: (p: number[]) => boolean) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (f(px(img, x, y))) return true;
  return false;
};

const fields: VacancyFields = {
  funcao: 'Garçom',
  estabelecimento: 'Coco Bambu',
  data: 'Sáb, 29/10',
  horario: '18h às 23h',
  valor: 'R$ 150',
  cidade: 'Campinas',
  expected: { cents: 15000, day: 29, month: 10, weekday: 4, startMin: 1080, endMin: 1380 },
};

describe('selos oficiais', () => {
  it('loadBadges devolve dois PNG mais largos que altos', async () => {
    for (const b of [badges.googlePlay, badges.appStore]) {
      expect([...b.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      const s = await images.size(b);
      expect(s.width).toBeGreaterThan(s.height);
    }
  });
});

describe('fitWrapped (R14: nunca corta texto da vaga)', () => {
  const f = parseFont(font);
  it('função longa que cabe em 3 linhas: todas as palavras aparecem e ≥ 110 px', () => {
    const text = 'AUXILIAR DE SERVIÇOS GERAIS';
    const r = fitWrapped(f, text, 936, { start: 130, floor: 110, maxLines: 3 });
    expect(r.lines.join(' ')).toBe(text);
    expect(r.lines.length).toBeLessThanOrEqual(3);
    expect(r.size).toBeGreaterThanOrEqual(110);
  });
  it('função que não cabe em 3 linhas a 110 px (AUXILIAR DE SERVIÇOS GERAIS E LIMPEZA PESADA): encolhe, sem descartar palavra', () => {
    const text = 'AUXILIAR DE SERVIÇOS GERAIS E LIMPEZA PESADA';
    const r = fitWrapped(f, text, 936, { start: 130, floor: 110, maxLines: 3 });
    expect(r.lines.join(' ')).toBe(text);
    expect(r.lines.length).toBeLessThanOrEqual(3);
    expect(r.size).toBeLessThan(110);
    expect(r.lines.every((l) => f.getAdvanceWidth(l, r.size) <= 936)).toBe(true);
  });
  it('estabelecimento longo quebra em 2 linhas com ≥ 48 px', () => {
    const text = 'Restaurante e Churrascaria Fogo de Chão Unidade Centro';
    const r = fitWrapped(f, text, 936, { start: 54, floor: 48, maxLines: 2 });
    expect(r.lines.join(' ')).toBe(text);
    expect(r.lines.length).toBe(2);
    expect(r.size).toBeGreaterThanOrEqual(48);
  });
});

describe('composeStoryFrame', () => {
  let portraitFrame: Uint8Array;
  beforeAll(async () => {
    portraitFrame = await composeStoryFrame(images, { art: await solid(1024, 1536, 0xff0000ff), bg: '#ffffff', font, badges });
  });

  it('arte em pé: 1080x1920, faixas na cor do modelo, rodapé com texto e selos, nada abaixo de 1600', async () => {
    const out = portraitFrame;
    const img = await images.read(out);
    expect([img.bitmap.width, img.bitmap.height]).toEqual([STORY_W, STORY_H]);
    const [r, g, b] = px(img, 540, 800);
    expect(r).toBeGreaterThan(220);
    expect(g).toBeLessThan(40);
    expect(b).toBeLessThan(40);
    expect(isWhite(px(img, 540, 100))).toBe(true);
    expect(isWhite(px(img, 20, 800))).toBe(true);
    expect(anyIn(img, 0, STORY_W, 1390, 1470, isDark)).toBe(true); // texto do rodapé
    expect(anyIn(img, 0, STORY_W, 1480, FOOTER_BOX.bottom, (p) => !isWhite(p))).toBe(true); // selos
    expect(anyIn(img, 0, STORY_W, FOOTER_BOX.bottom, STORY_H, (p) => !isWhite(p))).toBe(false);
  });

  it('arte deitada cabe inteira: largura 1080 centralizada na caixa', async () => {
    const art = await solid(1536, 1024, 0x0000ffff);
    const img = await images.read(await composeStoryFrame(images, { art, bg: '#ffffff', font, badges }));
    const h = Math.round((1080 * 1024) / 1536); // 720
    const top = ART_BOX.top + Math.round((ART_BOX.bottom - ART_BOX.top - h) / 2);
    expect(px(img, 540, top + 10)[2]).toBeGreaterThan(200);
    expect(px(img, 540, top + 10)[0]).toBeLessThan(60);
    expect(px(img, 2, top + 10)[2]).toBeGreaterThan(200); // largura inteira
    expect(px(img, 1077, top + h - 10)[2]).toBeGreaterThan(200);
    expect(isWhite(px(img, 540, top - 15))).toBe(true);
    expect(isWhite(px(img, 540, top + h + 15))).toBe(true);
  });

  it('fundo escuro: texto do rodapé branco', async () => {
    const art = await solid(1024, 1536, 0x336699ff);
    const img = await images.read(await composeStoryFrame(images, { art, bg: '#101010', font, badges }));
    expect(anyIn(img, 0, STORY_W, 1390, 1470, (p) => p.every((v) => v > 200))).toBe(true);
  });
});

describe('cropForCheck', () => {
  let portraitFrame: Uint8Array;
  beforeAll(async () => {
    portraitFrame = await composeStoryFrame(images, { art: await solid(1024, 1536, 0xff0000ff), bg: '#ffffff', font, badges });
  });

  it('corta em y 1360 (proporcional, ≤ 1024 px) e o rodapé não entra', async () => {
    const { bytes, mime } = await cropForCheck(images, portraitFrame);
    expect(mime).toBe('image/jpeg');
    const img = await images.read(bytes);
    const { width, height } = img.bitmap;
    expect(Math.max(width, height)).toBeLessThanOrEqual(1024);
    expect(height / width).toBeCloseTo(CHECK_CROP_BOTTOM / STORY_W, 1);
    // última linha = linha y≈1359 do quadro (faixa branca depois da arte), sem texto/selos do rodapé
    expect(anyIn(img, 0, width, 0, height, isDark)).toBe(false);
    expect(isWhite(px(img, Math.floor(width / 2), height - 1))).toBe(true);
  });
});

describe('edgeColor', () => {
  it('borda amarela com miolo azul → #ffd400', async () => {
    const img = images.blank(400, 600, 0xffd400ff);
    const inner = images.blank(300, 500, 0x0000ffff);
    img.composite(inner, 50, 50);
    const hex = await edgeColor(images, await images.encode(img, false));
    const n = parseInt(hex.slice(1), 16);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(Math.abs(((n >> 16) & 255) - 0xff)).toBeLessThanOrEqual(8);
    expect(Math.abs(((n >> 8) & 255) - 0xd4)).toBeLessThanOrEqual(8);
    expect(Math.abs((n & 255) - 0x00)).toBeLessThanOrEqual(8);
  });
});

describe('composeFallback', () => {
  const base = { photo: null, fields, bg: '#fde68a', accent: '#c2410c', logo: null, font, badges };
  const near = (p: number[], c: number[]) => p.every((v, i) => Math.abs(v - c[i]!) < 12);

  it('sem foto e sem logo: 1080x1920, fundo bg, texto na área livre, rodapé presente', async () => {
    const img = await images.read(await composeFallback(images, base));
    expect([img.bitmap.width, img.bitmap.height]).toEqual([STORY_W, STORY_H]);
    expect(near(px(img, 5, 5), [0xfd, 0xe6, 0x8a])).toBe(true);
    expect(near(px(img, 5, 1800), [0xfd, 0xe6, 0x8a])).toBe(true);
    expect(anyIn(img, 0, STORY_W, ART_BOX.top, ART_BOX.bottom, isDark)).toBe(true);
    expect(anyIn(img, 0, STORY_W, 0, ART_BOX.top - 1, (p) => !near(p, [0xfd, 0xe6, 0x8a]))).toBe(false);
    expect(anyIn(img, 0, STORY_W, 1390, 1470, isDark)).toBe(true);
    expect(anyIn(img, 0, STORY_W, 1480, FOOTER_BOX.bottom, (p) => !near(p, [0xfd, 0xe6, 0x8a]))).toBe(true);
    expect(anyIn(img, 0, STORY_W, FOOTER_BOX.bottom, STORY_H, (p) => !near(p, [0xfd, 0xe6, 0x8a]))).toBe(false);
  });

  it('com foto, logo e estabelecimento nulo: tudo dentro de 250–1350', async () => {
    const photo = await solid(800, 600, 0x2e7d32ff);
    const logo = await images.encode(images.blank(300, 100, 0x6a1b9aff), true);
    const out = await composeFallback(images, { ...base, photo, logo, fields: { ...fields, estabelecimento: null, funcao: 'Auxiliar de cozinha' } });
    const img = await images.read(out);
    expect([img.bitmap.width, img.bitmap.height]).toEqual([STORY_W, STORY_H]);
    expect(anyIn(img, 0, STORY_W, 0, ART_BOX.top - 1, (p) => !near(p, [0xfd, 0xe6, 0x8a]))).toBe(false);
    expect(anyIn(img, 0, STORY_W, ART_BOX.top, ART_BOX.bottom, (p) => p[1]! > p[0]! + 40 && p[1]! > p[2]! + 20)).toBe(true); // foto verde
    expect(anyIn(img, 0, STORY_W, FOOTER_BOX.bottom, STORY_H, (p) => !near(p, [0xfd, 0xe6, 0x8a]))).toBe(false);
  });

  it('textos longos: nada é cortado nem sai da área 250–1350', async () => {
    const long = { ...fields, funcao: 'Auxiliar de serviços gerais e limpeza pesada', estabelecimento: 'Restaurante e Churrascaria Fogo de Chão Unidade Centro', cidade: 'São José do Rio Preto' };
    const img = await images.read(await composeFallback(images, { ...base, fields: long }));
    expect(anyIn(img, 0, STORY_W, 0, ART_BOX.top - 1, (p) => !near(p, [0xfd, 0xe6, 0x8a]))).toBe(false);
    expect(anyIn(img, 0, STORY_W, ART_BOX.bottom + 1, FOOTER_BOX.top - 1, (p) => !near(p, [0xfd, 0xe6, 0x8a]))).toBe(false);
  });

  it('foto + logo de 120 px + textos longos: a foto some, a logo vai ao topo e nada passa de y 1350', async () => {
    const photo = await solid(800, 600, 0x2e7d32ff);
    const logo = await images.encode(images.blank(300, 120, 0x6a1b9aff), true);
    const long = { ...fields, funcao: 'AUXILIAR DE SERVIÇOS GERAIS E LIMPEZA PESADA', estabelecimento: 'Restaurante e Churrascaria Fogo de Chão Unidade Centro', cidade: 'São José do Rio Preto' };
    const img = await images.read(await composeFallback(images, { ...base, fields: long, photo, logo }));
    expect(anyIn(img, 0, STORY_W, 0, ART_BOX.top - 8, (p) => !near(p, [0xfd, 0xe6, 0x8a]))).toBe(false);
    expect(anyIn(img, 0, STORY_W, ART_BOX.bottom + 1, FOOTER_BOX.top - 1, (p) => !near(p, [0xfd, 0xe6, 0x8a]))).toBe(false);
    expect(anyIn(img, 0, STORY_W, 1390, 1470, isDark)).toBe(true); // rodapé intacto
  });
});
