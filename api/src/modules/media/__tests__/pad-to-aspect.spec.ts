jest.setTimeout(60_000);

import { dominantColor, ImageService } from '../image.service';

describe('ImageService.padToAspect (primeiro quadro do vídeo em 9:16)', () => {
  const images = new ImageService();
  const rgb = (img: any, x: number, y: number) => {
    const c = img.getPixelColor(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  };
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 40);

  it('encaixa a foto INTEIRA em 720×1280 sem distorcer; as sobras ficam na cor dominante', async () => {
    const img = images.blank(300, 100, 0x0000ffff); // azul (2/3)
    img.composite(images.blank(100, 100, 0xffffffff), 200, 0); // branco (1/3) à direita
    const out = await images.padToAspect(await images.encode(img, true), 720, 1280);
    expect(out.mime).toBe('image/jpeg');
    const r = await images.read(out.bytes);
    expect([r.bitmap.width, r.bitmap.height]).toEqual([720, 1280]);
    expect(near(rgb(r, 5, 5), [0, 0, 255])).toBe(true); // preenchimento = cor dominante (azul)
    expect(near(rgb(r, 5, 1275), [0, 0, 255])).toBe(true);
    // a foto escalada (720×240) fica centralizada na altura: faixa branca à direita, azul à esquerda
    expect(near(rgb(r, 700, 640), [255, 255, 255])).toBe(true);
    expect(near(rgb(r, 100, 640), [0, 0, 255])).toBe(true);
  });

  it('cor dominante é a mais frequente (não a média)', () => {
    const img = images.blank(100, 100, 0xff0000ff);
    img.composite(images.blank(40, 100, 0x00ff00ff), 60, 0);
    expect(dominantColor(img)).toEqual([255, 0, 0]);
  });
});
