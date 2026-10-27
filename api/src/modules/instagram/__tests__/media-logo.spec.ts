// A composição real usa Jimp/opentype; aqui só importa O QUE a geração pede para compor (logo + posição), então ela é falsa.
jest.mock('../../creative/compose', () => ({
  ...jest.requireActual('../../creative/compose'),
  composeCreative: jest.fn(async () => new Uint8Array([0xff, 0xd8, 0xff])),
}));

import { composeCreative } from '../../creative/compose';
import { WS_A } from '../../media/__tests__/mem';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';

const compose = composeCreative as jest.Mock;
const LOGO = new Uint8Array([1, 2, 3]);

function setup(visual_style: Record<string, unknown> = {}, logo: Uint8Array | null = LOGO) {
  compose.mockClear();
  const w: IgWorld = igWorld();
  const s = igServices(w);
  s.refs.loadLogo.mockResolvedValue(logo);
  const brand = { id: uuid(), workspace_id: WS_A, name: 'Zé', primary_color: '#c00', secondary_color: '#fff', visual_style };
  w.t['brands']!.rows.push(brand);
  const plan = { id: uuid(), workspace_id: WS_A, status: 'active', requires_approval: true, brand_id: brand.id, auto_publish: false };
  w.t['ig_content_plans']!.rows.push(plan);
  const idea = (over: Record<string, unknown> = {}) => seedPost(w, { status: 'idea', media: [], approved_at: null, plan_id: plan.id, creative_brief: { prompt: 'copo de chopp' }, ...over });
  return { w, s, idea, brand };
}

describe('Instagram — logo da marca nas imagens geradas', () => {
  it('carrossel: todo slide recebe a logo no canto padrão (inferior direito) quando o guia não define a posição', async () => {
    const { s, idea, brand } = setup();
    const post = idea({ format: 'feed_carousel', creative_brief: { prompt: 'base', slides: ['s1', 's2', 's3'] } });
    expect(await s.mediaGen.generatePostAssets(WS_A, post.id)).toMatchObject({ ok: true, items: 3 });
    expect(compose).toHaveBeenCalledTimes(3);
    for (const [, inp] of compose.mock.calls) expect(inp).toMatchObject({ logo: LOGO, logoPosition: 'bottom_right' });
    expect(s.refs.loadLogo).toHaveBeenCalledWith(WS_A, brand.id);
  });

  it('carrossel com posição escolhida usa a escolhida; "none" não carrega a logo', async () => {
    const top = setup({ posicao_logo: 'top_left' });
    await top.s.mediaGen.generatePostAssets(WS_A, top.idea({ format: 'feed_carousel', creative_brief: { prompt: 'b', slides: ['s1', 's2'] } }).id);
    expect(compose.mock.calls.map(([, i]) => i.logoPosition)).toEqual(['top_left', 'top_left']);

    const none = setup({ posicao_logo: 'none' });
    await none.s.mediaGen.generatePostAssets(WS_A, none.idea({ format: 'feed_carousel', creative_brief: { prompt: 'b', slides: ['s1', 's2'] } }).id);
    expect(none.s.refs.loadLogo).not.toHaveBeenCalled();
    for (const [, inp] of compose.mock.calls) expect(inp.logo).toBeNull();
  });

  it('imagem única/story que chega sem o pipeline (provedor assíncrono): só a logo no canto, sem texto; sem logo fica como veio', async () => {
    for (const format of ['feed_image', 'story_image']) {
      const { s, idea } = setup();
      s.pipeline.run.mockResolvedValueOnce({ pending: { jobId: 'j1' }, ad: {} });
      const post = idea({ format, hook: 'Gancho', cta: 'Peça' });
      expect(await s.mediaGen.generatePostAssets(WS_A, post.id)).toMatchObject({ ok: true, items: 1 });
      expect(compose).toHaveBeenCalledTimes(1);
      expect(compose.mock.calls[0][1]).toMatchObject({ layout: 'limpo', logo: LOGO, logoPosition: 'bottom_right' });
      expect(compose.mock.calls[0][1].title ?? null).toBeNull();
      expect(compose.mock.calls[0][1].cta ?? null).toBeNull();
      expect(s.assets.ingest.mock.calls.at(-1)[0]).toMatchObject({ mime: 'image/jpeg' });
    }
    const { s, idea } = setup({}, null);
    s.pipeline.run.mockResolvedValueOnce({ pending: { jobId: 'j1' }, ad: {} });
    await s.mediaGen.generatePostAssets(WS_A, idea({ format: 'feed_image' }).id);
    expect(compose).not.toHaveBeenCalled();
  });
});
