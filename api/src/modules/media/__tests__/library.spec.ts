import JSZip from 'jszip';
jest.setTimeout(120_000);

import { LibraryService, MAX_UPLOAD_BYTES } from '../library.service';
import { buildMediaWhere, MediaQueryService, mediaOrderBy, sanitizeSearch } from '../media-query.service';
import { ADMIN, MARKETING, mediaWorld, OWNER, sampleImage, sampleMp4, status, STRANGER, VIEWER, WS_A, WS_B } from './mem';

function setup() {
  const w = mediaWorld();
  const lib = new LibraryService(w.prisma, w.access, w.assets, w.images, w.files);
  const q = new MediaQueryService(w.prisma);
  return { w, lib, q };
}

async function seed(w: ReturnType<typeof mediaWorld>) {
  const brand = await w.t['brands']!.create({ data: { workspace_id: WS_A, name: 'Bar do Zé' } });
  const campaign = await w.t['campaigns']!.create({ data: { workspace_id: WS_A, brand_id: brand.id, name: 'Black Friday' } });
  const img = await w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'other', source: 'upload', bytes: await sampleImage(w.images, 240, 160), title: 'Chopp', brandId: brand.id, prompt: 'copo de chopp' });
  const png = await w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'other', source: 'upload', bytes: await sampleImage(w.images, 120, 120, true), mime: 'image/png', title: 'Logo', normalize: false });
  const vid = await w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'gemini', bytes: sampleMp4(), title: 'Reel do chopp', brandId: brand.id });
  const foreign = await w.assets.ingest({ workspaceId: WS_B, kind: 'image', targetFormat: 'other', source: 'upload', bytes: await sampleImage(w.images, 100, 100), title: 'Alheia' });
  return { brand, campaign, img, png, vid, foreign };
}

describe('LibraryService — autorização', () => {
  it('quem não é membro: 403 "área de trabalho"; viewer lê mas não escreve; id de outro workspace é 404', async () => {
    const { w, lib } = setup();
    const { img, foreign } = await seed(w);
    expect(await status(lib.downloadAsset(STRANGER, WS_A, img.id))).toBe('403:Você não tem acesso a esta área de trabalho.');
    expect(await status(lib.downloadAsset(VIEWER, WS_A, img.id))).toBe('ok');
    expect(await status(lib.downloadAsset(OWNER, WS_A, foreign.id))).toBe('404:Mídia não encontrada.');
    expect(await status(lib.reformat(VIEWER, WS_A, img.id, ['ig_story']))).toBe('403:Seu papel não permite esta ação.');
    expect(await status(lib.useInInstagram(VIEWER, WS_A, [img.id]))).toBe('403:Seu papel não permite esta ação.');
    expect(await status(lib.revalidate(VIEWER, WS_A, [img.id]))).toBe('403:Seu papel não permite esta ação.');
    expect(await status(lib.upload(VIEWER, WS_A, { filename: 'a.png', mimetype: 'image/png', bytes: Buffer.from('x') }, { target: 'other' }))).toBe('403:Seu papel não permite esta ação.');
    expect(await status(lib.deleteAssets(VIEWER, WS_A, [img.id]))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(lib.renameTag(VIEWER, WS_A, 'a', 'b'))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(lib.renameFolder(STRANGER, WS_A, 'a', 'b'))).toBe('403:Você não tem acesso a esta empresa.');
    expect(await status(lib.adResults(STRANGER, WS_A, img.id))).toBe('403:Você não tem acesso a esta empresa.');
    w.cleanup();
  });
});

describe('LibraryService — downloads e exportações', () => {
  it('original com storage_path: URL de 10 min com `dl` (nome marca_formato_data.ext)', async () => {
    const { w, lib } = setup();
    const { img } = await seed(w);
    const r = await lib.downloadAsset(MARKETING, WS_A, img.id, 'original');
    expect(r.name).toMatch(/^bar-do-ze_other_\d{4}-\d{2}-\d{2}\.jpg$/);
    expect(r.url).toContain(`/v1/files/creative-assets/${img.storage_path}`);
    expect(r.url).toContain(`dl=${encodeURIComponent(r.name)}`);
    const exp = Number(new URL(r.url).searchParams.get('exp'));
    expect(exp - Date.now() / 1000).toBeLessThanOrEqual(600);
    expect(exp - Date.now() / 1000).toBeGreaterThan(590);
    w.cleanup();
  });

  it('converte para PNG/JPG gravando em exports/<workspace>/', async () => {
    const { w, lib } = setup();
    const { img } = await seed(w);
    const png = await lib.downloadAsset(OWNER, WS_A, img.id, 'png');
    expect(png.name.endsWith('.png')).toBe(true);
    const key = decodeURIComponent(new URL(png.url).pathname.replace('/v1/files/creative-assets/', ''));
    expect(key.startsWith(`exports/${WS_A}/`)).toBe(true);
    expect((await w.files.read('creative-assets', key)).subarray(1, 4).toString()).toBe('PNG');
    // vídeo ignora o formato e baixa o original
    const { vid } = await seed(w);
    expect((await lib.downloadAsset(OWNER, WS_A, vid.id, 'png')).name.endsWith('.mp4')).toBe(true);
    w.cleanup();
  });

  it('ZIP: um arquivo por mídia, nomes numerados, só do workspace; estouro de 250 MB é recusado', async () => {
    const { w, lib } = setup();
    const { img, vid, foreign } = await seed(w);
    const r = await lib.exportZip(VIEWER, WS_A, [img.id, vid.id, foreign.id]);
    expect(r.count).toBe(2); // a mídia de outro workspace nem entra
    expect(r.name).toMatch(/^biblioteca_\d{4}-\d{2}-\d{2}\.zip$/);
    const key = decodeURIComponent(new URL(r.url).pathname.replace('/v1/files/creative-assets/', ''));
    const zip = await JSZip.loadAsync(await w.files.read('creative-assets', key));
    const names = Object.keys(zip.files).sort();
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^bar-do-ze_other_\d{4}-\d{2}-\d{2}_1\.jpg$/);
    expect(names[1]).toMatch(/^bar-do-ze_reel_\d{4}-\d{2}-\d{2}_2\.mp4$/);
    // limite: força o total acima de 250 MB sem criar arquivos gigantes
    const big = jest.spyOn(w.assets, 'readBytes').mockResolvedValue({ bytes: { length: 251 * 1024 * 1024 } as any, mime: null });
    expect(await status(lib.exportZip(OWNER, WS_A, [img.id]))).toBe('400:Seleção grande demais para um ZIP (limite de 250 MB). Selecione menos itens.');
    big.mockRestore();
    w.cleanup();
  });

  it('PDF nos dois layouts (uma por página no tamanho real; folha de contato A4) com vídeo como caixa "VIDEO"', async () => {
    const { w, lib } = setup();
    const { img, vid } = await seed(w);
    const { PDFDocument } = await import('pdf-lib');
    for (const [layout, pages] of [['one_per_page', 2], ['contact_sheet', 1]] as const) {
      const r = await lib.exportPdf(OWNER, WS_A, [img.id, vid.id], layout);
      expect(r.name).toContain(layout === 'one_per_page' ? 'impressao' : 'folha-de-contato');
      const key = decodeURIComponent(new URL(r.url).pathname.replace('/v1/files/creative-assets/', ''));
      const bytes = await w.files.read('creative-assets', key);
      expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(pages);
      if (layout === 'one_per_page') expect(Math.round(doc.getPage(0).getWidth())).toBe(Math.round(240 * 0.75));
    }
    w.cleanup();
  });
});

describe('LibraryService — envio, reformatação e usos', () => {
  it('upload: só imagem/vídeo, teto de tamanho, marca/campanha do workspace; devolve {id, igReady, issues}', async () => {
    const { w, lib } = setup();
    const { brand, campaign } = await seed(w);
    const png = await sampleImage(w.images, 200, 200, true);
    expect(await status(lib.upload(OWNER, WS_A, { filename: 'a.pdf', mimetype: 'application/pdf', bytes: Buffer.from('x') }, { target: 'other' }))).toBe('400:a.pdf: envie imagem ou vídeo.');
    expect(await status(lib.upload(OWNER, WS_A, { filename: 'g.png', mimetype: 'image/png', bytes: { length: MAX_UPLOAD_BYTES + 1 } as any }, { target: 'other' }))).toBe('400:g.png: arquivo maior que 100 MB.');
    const other = await w.t['brands']!.create({ data: { workspace_id: WS_B, name: 'Alheia' } });
    expect(await status(lib.upload(OWNER, WS_A, { filename: 'a.png', mimetype: 'image/png', bytes: png }, { target: 'other', brandId: other.id }))).toBe('404:Marca não encontrada.');
    expect(await status(lib.upload(OWNER, WS_A, { filename: 'a.png', mimetype: 'image/png', bytes: png }, { target: 'other', campaignId: '00000000-0000-4000-8000-000000000001' }))).toBe('404:Campanha não encontrada.');
    const ok = await lib.upload(MARKETING, WS_A, { filename: 'Foto do bar.png', mimetype: 'image/png', bytes: png }, { target: 'ig_feed_square', brandId: brand.id, campaignId: campaign.id });
    expect(ok.igReady).toBe(true);
    expect(ok.issues).toEqual([]);
    const row = w.t['media_assets']!.rows.find((r) => r.id === ok.id)!;
    expect([row.title, row.source, row.created_by, row.brand_id, row.campaign_id, row.width, row.height]).toEqual(['Foto do bar', 'upload', MARKETING, brand.id, campaign.id, 1080, 1080]);
    // vídeo fora do padrão volta com os problemas
    const bad = await lib.upload(MARKETING, WS_A, { filename: 'v.mp4', mimetype: 'video/mp4', bytes: sampleMp4({ codec: 'hvc1' }) }, { target: 'ig_reel' });
    expect(bad.igReady).toBe(false);
    expect(bad.issues[0]).toContain('hvc1');
    w.cleanup();
  });

  it('reformat gera um asset por formato, filho do original', async () => {
    const { w, lib } = setup();
    const { img } = await seed(w);
    const out = await lib.reformat(OWNER, WS_A, img.id, ['other', 'other']);
    expect(out.ids).toHaveLength(2);
    expect(w.t['media_assets']!.rows.filter((r) => r.parent_id === img.id)).toHaveLength(2);
    w.cleanup();
  });

  it('usar no Instagram cria o post-rascunho (formato pela 1ª mídia; carrossel se >1) e liga as mídias', async () => {
    const { w, lib } = setup();
    const { img, vid, foreign } = await seed(w);
    await w.prisma.media_assets.update({ where: { id: img.id }, data: { target_format: 'ig_feed_portrait' } });
    const single = await lib.useInInstagram(MARKETING, WS_A, [img.id]);
    expect(single.format).toBe('feed_image');
    const reel = await lib.useInInstagram(MARKETING, WS_A, [vid.id]);
    expect(reel.format).toBe('reel');
    const multi = await lib.useInInstagram(MARKETING, WS_A, [img.id, vid.id, foreign.id]);
    expect(multi.format).toBe('feed_carousel');
    const post = w.t['ig_posts']!.rows.find((p) => p.id === multi.postId)!;
    expect(post.media).toHaveLength(2); // a mídia de outro workspace não entra
    expect([post.status, post.theme, post.creative_brief]).toEqual(['idea', 'Chopp', { from_library: [img.id, vid.id, foreign.id] }]);
    expect(w.t['media_assets']!.rows.find((r) => r.id === foreign.id)!.ig_post_id).toBeFalsy();
    expect(await status(lib.useInInstagram(OWNER, WS_A, [foreign.id]))).toBe('400:Selecione ao menos uma mídia.');
    w.cleanup();
  });

  it('usar em campanha: campanha de outro workspace → 404; cria criativos aprovados e liga as mídias', async () => {
    const { w, lib } = setup();
    const { campaign, img, vid } = await seed(w);
    const otherBrand = await w.t['brands']!.create({ data: { workspace_id: WS_B, name: 'B' } });
    const otherCamp = await w.t['campaigns']!.create({ data: { workspace_id: WS_B, brand_id: otherBrand.id, name: 'X' } });
    expect(await status(lib.useInCampaign(OWNER, WS_A, [img.id], otherCamp.id))).toBe('404:Campanha não encontrada.');
    expect(await lib.useInCampaign(ADMIN, WS_A, [img.id, vid.id], campaign.id)).toEqual({ count: 2 });
    const crs = w.t['creatives']!.rows;
    expect(crs.map((c) => [c.status, c.type, c.campaign_id])).toEqual([['approved', 'static_image', campaign.id], ['approved', 'video', campaign.id]]);
    expect(w.t['media_assets']!.rows.find((r) => r.id === img.id)).toMatchObject({ status: 'approved', campaign_id: campaign.id, creative_id: crs[0]!.id });
    w.cleanup();
  });

  it('anexar ao post: post do workspace; só mídia ig_ready; carrossel até 10, senão 1', async () => {
    const { w, lib } = setup();
    const { img, vid } = await seed(w);
    const feed = await w.t['ig_posts']!.create({ data: { workspace_id: WS_A, format: 'feed_image' } });
    const foreignPost = await w.t['ig_posts']!.create({ data: { workspace_id: WS_B, format: 'feed_image' } });
    expect(await status(lib.attachToPost(OWNER, WS_A, foreignPost.id, [img.id]))).toBe('400:Post não encontrado.');
    // a imagem "other" não passa na validação do Instagram? (240x160 = 1,5 — dentro da faixa → pronta)
    await w.prisma.media_assets.update({ where: { id: img.id }, data: { ig_ready: false, quality_report: { issues: ['Largura de 240px é pequena demais.'] } } });
    expect(await status(lib.attachToPost(OWNER, WS_A, feed.id, [img.id]))).toBe('400:Mídia não está pronta para o Instagram: Largura de 240px é pequena demais.');
    await w.prisma.media_assets.update({ where: { id: img.id }, data: { ig_ready: true } });
    expect(await lib.attachToPost(OWNER, WS_A, feed.id, [img.id, vid.id])).toEqual({ ok: true, items: 1 });
    const car = await w.t['ig_posts']!.create({ data: { workspace_id: WS_A, format: 'feed_carousel' } });
    expect(await lib.attachToPost(OWNER, WS_A, car.id, [img.id, vid.id])).toEqual({ ok: true, items: 2 });
    w.cleanup();
  });

  it('revalidar refaz medidas/validação/miniatura; mídia "mock" é arquivada; erro de arquivo não derruba o lote', async () => {
    const { w, lib } = setup();
    const { img, vid } = await seed(w);
    await w.prisma.media_assets.update({ where: { id: vid.id }, data: { ig_ready: false, width: 1, height: 1 } });
    const mock = await w.t['media_assets']!.create({ data: { workspace_id: WS_A, title: 'Mock', source: 'mock', url: 'https://picsum.photos/1', status: 'draft' } });
    const missing = await w.t['media_assets']!.create({ data: { workspace_id: WS_A, title: 'Sumiu', storage_path: `media/${WS_A}/x/nao-existe.jpg`, url: null } });
    const r = await lib.revalidate(OWNER, WS_A, [img.id, vid.id, mock.id, missing.id]);
    expect([r.total, r.archived, r.failed]).toEqual([4, 1, 1]);
    expect(w.t['media_assets']!.rows.find((x) => x.id === vid.id)).toMatchObject({ width: 1080, height: 1920, ig_ready: true });
    expect(w.t['media_assets']!.rows.find((x) => x.id === mock.id)!.status).toBe('archived');
    expect((w.t['media_assets']!.rows.find((x) => x.id === img.id)!.quality_report as any).revalidated_at).toBeTruthy();
    w.cleanup();
  });
});

describe('LibraryService — gestão', () => {
  it('excluir: remove arquivo + miniatura, solta as versões filhas e só toca no workspace', async () => {
    const { w, lib } = setup();
    const { img, foreign } = await seed(w);
    const child = await w.assets.reformat(WS_A, img.id, 'other', OWNER);
    const paths = [img.storage_path!, img.thumbnail_path!];
    expect(await lib.deleteAssets(MARKETING, WS_A, [img.id, foreign.id])).toEqual({ deleted: 1 });
    for (const p of paths) expect(await w.files.exists('creative-assets', p)).toBe(false);
    expect(await w.files.exists('creative-assets', foreign.storage_path!)).toBe(true);
    expect(w.t['media_assets']!.rows.find((r) => r.id === child.id)!.parent_id).toBeNull();
    expect(await lib.deleteAssets(MARKETING, WS_A, [foreign.id])).toEqual({ deleted: 0 });
    w.cleanup();
  });

  it('renomear tag (e remover com "to" vazio) e pasta (e desfazer)', async () => {
    const { w, lib } = setup();
    const { img, png, foreign } = await seed(w);
    await w.prisma.media_assets.update({ where: { id: img.id }, data: { tags: ['promo', 'chopp'], folder: 'Verão' } });
    await w.prisma.media_assets.update({ where: { id: png.id }, data: { tags: ['promo', 'Promo2'], folder: 'Verão' } });
    await w.prisma.media_assets.update({ where: { id: foreign.id }, data: { tags: ['promo'], folder: 'Verão' } });
    expect(await lib.renameTag(OWNER, WS_A, 'promo', '  oferta ')).toEqual({ updated: 2 });
    expect(w.t['media_assets']!.rows.find((r) => r.id === img.id)!.tags).toEqual(['oferta', 'chopp']);
    expect(w.t['media_assets']!.rows.find((r) => r.id === foreign.id)!.tags).toEqual(['promo']);
    expect(await lib.renameTag(OWNER, WS_A, 'oferta', '')).toEqual({ updated: 2 });
    expect(w.t['media_assets']!.rows.find((r) => r.id === img.id)!.tags).toEqual(['chopp']);
    expect(await lib.renameFolder(OWNER, WS_A, 'Verão', 'Verão 2026')).toEqual({ updated: 2 });
    expect(await lib.renameFolder(OWNER, WS_A, 'Verão 2026', '')).toEqual({ updated: 2 });
    expect(w.t['media_assets']!.rows.find((r) => r.id === img.id)!.folder).toBeNull();
    expect(w.t['media_assets']!.rows.find((r) => r.id === foreign.id)!.folder).toBe('Verão');
    w.cleanup();
  });

  it('resultados em anúncios: soma performance_daily (sem demo) do criativo, com nomes das campanhas', async () => {
    const { w, lib } = setup();
    const { campaign } = await seed(w);
    const cr = await w.t['creatives']!.create({ data: { workspace_id: WS_A, title: 'C' } });
    const mk = (spend: number, source = 'meta') => w.t['performance_daily']!.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, creative_id: cr.id, spend, impressions: 100, clicks: 10, leads: 2, conversions: 1, revenue: spend * 3, source } });
    await mk(10);
    await mk(20);
    await mk(999, 'demo');
    expect(await lib.adResults(VIEWER, WS_A, cr.id)).toEqual({ spend: 30, impressions: 200, clicks: 20, leads: 4, conversions: 2, revenue: 90, campaigns: ['Black Friday'], days: 2 });
    w.cleanup();
  });
});

describe('MediaQueryService — filtros da tela', () => {
  it('buildMediaWhere: filtros, status "active", tag, período e busca sanitizada; sempre com workspace_id', () => {
    const now = Date.UTC(2026, 9, 2);
    expect(sanitizeSearch(' (chopp%,gelado) ')).toBe('chopp  gelado');
    const where = buildMediaWhere(WS_A, { search: 'chopp%', kind: 'image', status: 'active', tag: 'promo', folder: 'F', source: 'upload', brand_id: 'b', campaign_id: 'c', target_format: 'ig_story', period: 7 }, now);
    expect(where).toEqual({
      workspace_id: WS_A,
      OR: [{ title: { contains: 'chopp', mode: 'insensitive' } }, { prompt: { contains: 'chopp', mode: 'insensitive' } }],
      brand_id: 'b', campaign_id: 'c', kind: 'image', target_format: 'ig_story', folder: 'F', source: 'upload',
      status: { not: 'archived' }, tags: { has: 'promo' }, created_at: { gte: new Date(now - 7 * 86_400_000) },
    });
    expect(buildMediaWhere(WS_A, { status: 'approved' }).status).toBe('approved');
    expect(buildMediaWhere(WS_A, {})).toEqual({ workspace_id: WS_A });
    expect(mediaOrderBy('size')).toEqual({ size_bytes: { sort: 'desc', nulls: 'last' } });
    expect(mediaOrderBy('old')).toEqual({ created_at: 'asc' });
    expect(mediaOrderBy(undefined)).toEqual({ created_at: 'desc' });
  });

  it('list devolve {rows (com brands/campaigns), count}; bulk e tags só no workspace; facets; copies com campaigns(name, brand_id)', async () => {
    const { w, q } = setup();
    const { brand, campaign, img, png, foreign } = await seed(w);
    await w.prisma.media_assets.update({ where: { id: img.id }, data: { campaign_id: campaign.id, tags: ['a'] } });
    const l = await q.list(WS_A, { kind: 'image', status: 'active', sort: 'new' });
    expect(l.count).toBe(2);
    const row = l.rows.find((r: any) => r.id === img.id) as any;
    expect(row.brands).toEqual({ name: 'Bar do Zé' });
    expect(row.campaigns).toEqual({ name: 'Black Friday' });
    expect(l.rows.map((r: any) => r.id)).not.toContain(foreign.id);
    expect((await q.list(WS_A, { search: 'copo' })).rows.map((r: any) => r.id)).toEqual([img.id]);
    // bulk: ids de outro workspace são ignorados
    expect(await q.bulkUpdate(WS_A, [img.id, foreign.id], { status: 'approved' })).toEqual({ updated: 1 });
    expect(w.t['media_assets']!.rows.find((r) => r.id === foreign.id)!.status).toBe('draft');
    expect(await q.bulkUpdate(WS_A, [img.id], { folder: '  Pasta  ' })).toEqual({ updated: 1 });
    expect(await q.bulkUpdate(WS_A, [img.id], { folder: null })).toEqual({ updated: 1 });
    expect(w.t['media_assets']!.rows.find((r) => r.id === img.id)!.folder).toBeNull();
    expect(await q.bulkUpdate(WS_A, [img.id], {})).toEqual({ updated: 0 });
    // tags: limpa/dedup; asset de outro workspace → 404
    expect((await q.setTags(WS_A, png.id, [' x ', 'x', '', 'y'])).tags).toEqual(['x', 'y']);
    expect(await status(q.setTags(WS_A, foreign.id, ['x']))).toBe('404:Mídia não encontrada.');
    expect((await q.facets(WS_A)).length).toBe(3);
    await w.t['copies']!.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, angle: 'promo', content: { headline: 'x' } } });
    const copies = await q.copies(WS_A);
    expect(copies[0]).toMatchObject({ angle: 'promo', campaigns: { name: 'Black Friday', brand_id: brand.id } });
    w.cleanup();
  });
});
