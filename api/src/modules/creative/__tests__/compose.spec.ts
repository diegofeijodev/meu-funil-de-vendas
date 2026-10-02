jest.setTimeout(120_000);

import { composeCreative, fillPolys, flatten, hexToRgb } from '../compose';
import { loadDefaultFont } from '../refs.service';
import { ImageService } from '../../media/image.service';

const images = new ImageService();

/** Pixel RGB de uma imagem JPEG/PNG já codificada. */
async function pixelAt(bytes: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const img = await images.read(bytes);
  const o = (y * img.bitmap.width + x) * 4;
  return [img.bitmap.data[o], img.bitmap.data[o + 1], img.bitmap.data[o + 2]];
}
/** Quantos pixels de uma região diferem (muito) da cor de fundo. */
async function changed(bytes: Uint8Array, bg: [number, number, number], box: [number, number, number, number]) {
  const img = await images.read(bytes);
  let n = 0;
  for (let y = box[1]; y < box[3]; y++)
    for (let x = box[0]; x < box[2]; x++) {
      const o = (y * img.bitmap.width + x) * 4;
      const d = Math.abs(img.bitmap.data[o] - bg[0]) + Math.abs(img.bitmap.data[o + 1] - bg[1]) + Math.abs(img.bitmap.data[o + 2] - bg[2]);
      if (d > 120) n++;
    }
  return n;
}

const font = loadDefaultFont();
const BG = 0x808080ff; // cinza médio (luminância < 140 → faixa escura/azul)
const base = async (w = 600, h = 600, color = BG) => new Uint8Array(await images.encode(images.blank(w, h, color), false));

describe('fonte vendorizada', () => {
  it('Archivo Black carrega do repositório (sem rede) e é uma fonte TrueType válida', () => {
    expect(font.byteLength).toBeGreaterThan(50_000);
    expect(Buffer.from(font).subarray(0, 4).toString('hex')).toBe('00010000');
  });
});

describe('rasterização do texto', () => {
  it('flatten transforma curvas em polígonos; fillPolys preenche com antisserrilhado e alfa', () => {
    const polys = flatten([
      { type: 'M', x: 10, y: 10 }, { type: 'L', x: 30, y: 10 }, { type: 'Q', x1: 40, y1: 20, x: 30, y: 30 }, { type: 'L', x: 10, y: 30 }, { type: 'Z' },
    ]);
    expect(polys).toHaveLength(1);
    expect(polys[0]!.length).toBe(1 + 1 + 8 + 1);
    const img = images.blank(50, 50, 0x000000ff);
    fillPolys(img, [[[10, 10], [30, 10], [30, 30], [10, 30]]], [255, 255, 255], 1);
    const px = (x: number, y: number) => img.bitmap.data[(y * 50 + x) * 4];
    expect(px(20, 20)).toBe(255);
    expect(px(5, 5)).toBe(0);
    fillPolys(img, [[[0, 40], [49, 40], [49, 49], [0, 49]]], [255, 255, 255], 0.5);
    expect(px(25, 45)).toBeGreaterThan(100);
    expect(px(25, 45)).toBeLessThan(160);
  });

  it('cor hex: inválida cai no padrão', () => {
    expect(hexToRgb('#ff8800', [0, 0, 0])).toEqual([255, 136, 0]);
    expect(hexToRgb('xx', [1, 2, 3])).toEqual([1, 2, 3]);
    expect(hexToRgb(null, [9, 9, 9])).toEqual([9, 9, 9]);
  });
});

describe('composeCreative (texto e logo por cima, nunca pela IA)', () => {
  it('"limpo" sem logo devolve a imagem sem alterar o conteúdo (só recodifica em JPEG)', async () => {
    const out = await composeCreative(images, { image: await base(), aspectRatio: '1:1', layout: 'limpo', title: 'IGNORADO', font });
    expect(out[0]).toBe(0xff);
    expect(await changed(out, [128, 128, 128], [0, 0, 600, 600])).toBe(0);
  });

  it('título no topo: faixa + texto claro na zona segura do topo, o resto intacto', async () => {
    const out = await composeCreative(images, { image: await base(), aspectRatio: '1:1', layout: 'titulo_topo', title: 'Chopp gelado todo dia', font });
    expect(await changed(out, [128, 128, 128], [0, 20, 600, 130])).toBeGreaterThan(500); // faixa + letras
    expect(await changed(out, [128, 128, 128], [0, 300, 600, 600])).toBe(0);
    // há letra branca (pixel claro) dentro da faixa
    const img = await images.read(out);
    let white = 0;
    for (let y = 30; y < 130; y++) for (let x = 0; x < 600; x++) if (img.bitmap.data[(y * 600 + x) * 4] > 230) white++;
    expect(white).toBeGreaterThan(200);
  });

  it('9:16 respeita a zona segura (topo 14%): nada é desenhado acima dela', async () => {
    const out = await composeCreative(images, { image: await base(450, 800), aspectRatio: '9:16', layout: 'titulo_topo', title: 'Oferta', font });
    expect(await changed(out, [128, 128, 128], [0, 0, 450, Math.floor(800 * 0.14) - 30])).toBe(0);
    expect(await changed(out, [128, 128, 128], [0, 100, 450, 220])).toBeGreaterThan(300);
  });

  it('preço em destaque: pílula na cor da marca no canto inferior direito', async () => {
    const out = await composeCreative(images, { image: await base(), aspectRatio: '1:1', layout: 'preco_destaque', price: 'R$ 9,90', primary: '#e11d48', font });
    // procura pixel próximo de #e11d48 na metade inferior direita
    const img = await images.read(out);
    let pill = 0;
    for (let y = 300; y < 600; y++) for (let x = 300; x < 600; x++) {
      const o = (y * 600 + x) * 4;
      if (Math.abs(img.bitmap.data[o] - 225) < 40 && Math.abs(img.bitmap.data[o + 1] - 29) < 40 && Math.abs(img.bitmap.data[o + 2] - 72) < 40) pill++;
    }
    expect(pill).toBeGreaterThan(1500);
  });

  it('chamada no rodapé: botão centralizado; sem texto usa "Saiba mais"', async () => {
    const out = await composeCreative(images, { image: await base(), aspectRatio: '1:1', layout: 'cta_rodape', cta: '', primary: '#16a34a', font });
    const img = await images.read(out);
    const o = (505 * 600 + 300) * 4; // centro do botão, na zona inferior
    const [r, g, b] = [img.bitmap.data[o], img.bitmap.data[o + 1], img.bitmap.data[o + 2]];
    // verde (#16a34a) ou letra branca no meio do botão
    expect(g > r && g > b ? true : r > 200 && g > 200 && b > 200).toBe(true);
    expect(await changed(out, [128, 128, 128], [150, 470, 450, 560])).toBeGreaterThan(1500);
  });

  it('logo no canto escolhido (escala ≤18% da largura), nunca em cima da faixa do título', async () => {
    const logo = new Uint8Array(await images.encode(images.blank(300, 100, 0xff0000ff), true));
    const bottomRight = await composeCreative(images, { image: await base(), aspectRatio: '1:1', layout: 'limpo', logo, logoPosition: 'bottom_right', font });
    const [r, g] = await pixelAt(bottomRight, 600 - 36 - 20, Math.round(600 * 0.94 - 12 - 8));
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    // topo com título → logo desce para a base
    const busy = await composeCreative(images, { image: await base(), aspectRatio: '1:1', layout: 'titulo_topo', title: 'Oi', logo, logoPosition: 'top_left', font });
    expect(await changed(busy, [128, 128, 128], [0, 20, 600, 130])).toBeGreaterThan(100); // o título ocupa o topo
    const topLeft = await pixelAt(busy, 40, 45);
    expect(topLeft[0] > 200 && topLeft[1] < 60).toBe(false); // …e o logo NÃO foi para lá
    expect((await pixelAt(busy, 40, Math.round(600 * 0.94 - 12 - 8)))[0]).toBeGreaterThan(200);
    // logo quebrado é ignorado sem derrubar a composição
    const ok = await composeCreative(images, { image: await base(), aspectRatio: '1:1', layout: 'limpo', logo: new Uint8Array([1, 2, 3]), logoPosition: 'top_right', font });
    expect(ok[0]).toBe(0xff);
  });

  it('texto longo é reduzido para caber (máx. 2 linhas) sem estourar a imagem', async () => {
    const out = await composeCreative(images, { image: await base(), aspectRatio: '1:1', layout: 'titulo_topo', title: 'Uma chamada gigantesca que precisa ser reduzida para caber em duas linhas na imagem toda', font });
    expect(await changed(out, [128, 128, 128], [0, 20, 600, 200])).toBeGreaterThan(500);
    expect(await changed(out, [128, 128, 128], [0, 330, 600, 600])).toBe(0);
  });
});
