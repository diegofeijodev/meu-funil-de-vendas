import { estimatePilot, slotCost, suggestedOptions } from '../pilot-estimate';
import type { PilotOptions } from '../pilot.types';

const opts = (o: Partial<PilotOptions> = {}): PilotOptions => ({
  max_angles: 3, images_per_angle: 2, variations: 3, videos: 1,
  instagram: { enabled: true, mode: 'approval', weekdays: [1, 3, 5], times: ['11:00'], story_times: [], formats: ['feed_image'] },
  meta: { enabled: true, review_creatives: false }, max_credits: 48, ...o,
});
const SOURCE = 'tabela de custo do Meu Funil (imagem 1,5 · vídeo 6)';

describe('estimatePilot (créditos com a conta e a fonte)', () => {
  it('exemplo padrão da spec dá 27 + 9 + 12 = 48', () => {
    const e = estimatePilot(opts(), null);
    expect(e.items).toEqual([
      { label: 'Artes', formula: '3 jeitos × 2 artes × 3 versões × 1,5', value: 27, source: SOURCE },
      { label: 'Refações', formula: 'até 6 × 1,5', value: 9, source: SOURCE },
      { label: 'Vídeo', formula: '1 × 2 tentativas × 6', value: 12, source: SOURCE },
    ]);
    expect(e.total).toBe(48);
    expect(e.instagram).toBeNull();
  });

  it('sem vídeo não tem item de vídeo', () => {
    const e = estimatePilot(opts({ videos: 0, max_angles: 1, images_per_angle: 1, variations: 1 }), null);
    expect(e.items.map((i) => i.label)).toEqual(['Artes', 'Refações']);
    expect(e.total).toBe(3);
  });

  it('Instagram fica fora do teto: 4 feed_image + 2 reel + 4 story_image = 24', () => {
    const slots = [...Array(4).fill({ format: 'feed_image' }), ...Array(2).fill({ format: 'reel' }), ...Array(4).fill({ format: 'story_image' })];
    const e = estimatePilot(opts(), { slots });
    expect(e.instagram).toEqual({ label: 'Posts do Instagram (fora do teto)', formula: '4 post × 1,5 + 2 reels × 6 + 4 stories × 1,5', value: 24, source: SOURCE });
    expect(e.total).toBe(48);
  });

  it('carrossel conta 5 slides', () => {
    expect(estimatePilot(opts(), { slots: [{ format: 'feed_carousel' }] }).instagram).toMatchObject({ formula: '1 carrossel × 5 slides × 1,5', value: 7.5 });
  });
});

describe('slotCost', () => {
  it('imagem = versões × 1,5 + 1 refação; vídeo = 2 × 6', () => {
    expect(slotCost('image', 3)).toBe(6);
    expect(slotCost('video', 3)).toBe(12);
  });
});

describe('suggestedOptions', () => {
  const strategy: any = { angulos_detalhados: [{ nome: 'A' }, { nome: 'B' }, { nome: 'C' }, { nome: 'D' }] };
  it('padrão: 3 jeitos × 2 artes + 1 vídeo, Instagram em "eu aprovo", G1, teto = estimativa', () => {
    const o = suggestedOptions(strategy, 10);
    expect(o).toMatchObject({ max_angles: 3, images_per_angle: 2, variations: 3, videos: 1, max_credits: 48 });
    expect(o.instagram).toEqual({ enabled: true, mode: 'approval', weekdays: [1, 3, 5], times: ['11:00', '18:00'], story_times: ['12:00'], formats: ['feed_image', 'reel', 'story_image'] });
    expect(o.meta).toEqual({ enabled: true, review_creatives: false });
  });
  it('corta artes por jeito para caber no máximo de peças; estratégia sem ângulos = 1 jeito', () => {
    expect(suggestedOptions(strategy, 5)).toMatchObject({ max_angles: 3, images_per_angle: 1, videos: 1 });
    expect(suggestedOptions({ angulos_detalhados: [] } as any, 10).max_angles).toBe(1);
    expect(suggestedOptions(null, 10).max_angles).toBe(1);
  });
});
