jest.setTimeout(120_000);

import { OWNER, WS_A, WS_B } from '../../media/__tests__/mem';
import { DEFAULT_LOGO_POSITION, resolveLogoPosition } from '../visual-style';
import { creativeWorld, CreativeWorld } from './world';

const dto = (extra: Record<string, unknown> = {}) => ({ workspaceId: WS_A, title: 'Chopp gelado', type: 'static_image', aspectRatio: '1:1', targetFormat: 'other', variations: 1, provider: 'auto', ...extra }) as any;

async function brandOf(w: CreativeWorld, visual_style: Record<string, unknown> = {}, logo_url: string | null = null) {
  return w.t['brands']!.create({ data: { workspace_id: WS_A, name: 'Bar do Zé', primary_color: '#c0392b', secondary_color: '#222222', visual_style, logo_url } });
}
async function putLogo(w: CreativeWorld, ws = WS_A, ext = 'png') {
  const key = w.files.newUploadKey('brands', ws, ext);
  await w.files.put('creative-assets', key, w.png);
  return key;
}
const refsOf = (w: CreativeWorld) => (w.svc as any).refs as { loadLogo: (ws: string, brandId: string | null) => Promise<Uint8Array | null> };

describe('posição padrão da logo', () => {
  it('não definida (ou inválida) = canto inferior direito; "none" explícito = sem logo', () => {
    expect(DEFAULT_LOGO_POSITION).toBe('bottom_right');
    expect(resolveLogoPosition(undefined)).toBe('bottom_right');
    expect(resolveLogoPosition(null)).toBe('bottom_right');
    expect(resolveLogoPosition('meio')).toBe('bottom_right');
    expect(resolveLogoPosition('toString')).toBe('bottom_right');
    expect(resolveLogoPosition('none')).toBe('none');
    expect(resolveLogoPosition('top_left')).toBe('top_left');
  });
});

describe('RefsService.loadLogo', () => {
  it('sem brand_assets de logo usa brands.logo_url quando é arquivo NOSSO deste workspace', async () => {
    const w = await creativeWorld();
    const key = await putLogo(w);
    const brand = await brandOf(w, {}, w.files.signedUrl('creative-assets', key));
    const bytes = await refsOf(w).loadLogo(WS_A, brand.id);
    expect(bytes && Buffer.from(bytes).equals(w.png)).toBe(true);
    w.cleanup();
  });

  it('URL externa, arquivo de outro workspace, SVG/PDF ou marca de outra empresa → sem logo (e nenhuma rede)', async () => {
    const w = await creativeWorld();
    const refs = refsOf(w);
    const external = await brandOf(w, {}, 'https://site-do-cliente.com/logo.png');
    expect(await refs.loadLogo(WS_A, external.id)).toBeNull();
    const otherWs = await brandOf(w, {}, w.files.signedUrl('creative-assets', await putLogo(w, WS_B)));
    expect(await refs.loadLogo(WS_A, otherWs.id)).toBeNull();
    const svg = await brandOf(w, {}, w.files.signedUrl('creative-assets', await putLogo(w, WS_A, 'svg')));
    expect(await refs.loadLogo(WS_A, svg.id)).toBeNull();
    const ours = await brandOf(w, {}, w.files.signedUrl('creative-assets', await putLogo(w)));
    expect(await refs.loadLogo(WS_B, ours.id)).toBeNull(); // a marca é do WS_A
    expect(await refs.loadLogo(WS_A, null)).toBeNull();
    expect(w.calls).toHaveLength(0);
    w.cleanup();
  });

  it('brand_assets de logo continua tendo prioridade sobre logo_url', async () => {
    const w = await creativeWorld();
    const brand = await brandOf(w, {}, 'https://site-do-cliente.com/logo.png');
    const key = await putLogo(w);
    await w.t['brand_assets']!.create({ data: { workspace_id: WS_A, brand_id: brand.id, kind: 'logo', name: 'logo.png', storage_path: key } });
    expect(await refsOf(w).loadLogo(WS_A, brand.id)).not.toBeNull();
    w.cleanup();
  });
});

describe('pipeline — logo na composição final', () => {
  const finals = (w: CreativeWorld) => w.t['media_assets']!.rows.filter((a) => (a.quality_report as any)?.version === 'final');

  it('layout limpo + logo enviada + posição não definida: compõe a versão final com a logo (sem texto)', async () => {
    const w = await creativeWorld();
    const brand = await brandOf(w);
    await w.t['brand_assets']!.create({ data: { workspace_id: WS_A, brand_id: brand.id, kind: 'logo', name: 'logo.png', storage_path: await putLogo(w) } });
    const r = await w.svc.generate(OWNER, dto({ brandId: brand.id, layout: 'limpo' }));
    expect(r.status).toBe('ready');
    expect(finals(w)).toHaveLength(1);
    expect(finals(w)[0]!.quality_report).toMatchObject({ layout: 'limpo', winner: true });
    expect(r.assetUrl).toBe(finals(w)[0]!.url);
    w.cleanup();
  });

  it('posição "none" explícita ou marca sem logo: a vencedora limpa é o criativo (nada composto)', async () => {
    for (const vs of [{ posicao_logo: 'none' }, null]) {
      const w = await creativeWorld();
      const brand = await brandOf(w, vs ?? {});
      if (vs) await w.t['brand_assets']!.create({ data: { workspace_id: WS_A, brand_id: brand.id, kind: 'logo', name: 'logo.png', storage_path: await putLogo(w) } });
      const r = await w.svc.generate(OWNER, dto({ brandId: brand.id, layout: 'limpo' }));
      expect(r.status).toBe('ready');
      expect(finals(w)).toHaveLength(0);
      expect(w.t['media_assets']!.rows).toHaveLength(1);
      w.cleanup();
    }
  });
});
