import { Logger } from '@nestjs/common';
import { Jimp } from 'jimp';
import { WorkspaceAccessService } from '../../access/access.service';
import { FakeTable } from '../../brands/__tests__/fake-prisma';
import { ImageService } from '../../media/image.service';
import { AiError, AiKeysFailedError } from '../../ai/ai-error';
import { NO_AI_MESSAGE } from '../../ai/ai.service';
import { STYLE_NOTES_HEADER } from '../style-notes';
import { isTransientReadError, StyleRefsService } from '../style-refs.service';
import { RSS } from './fixtures';

const WS = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const VIEWER = '33333333-3333-4333-8333-333333333333';
const BRAND = '44444444-4444-4444-8444-444444444444';
const CAMP = '55555555-5555-4555-8555-555555555555';

const status = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus?.() ?? 500}:${e.getResponse?.().message ?? e.message}`; }
};

async function png(): Promise<Uint8Array> {
  return new Uint8Array(await new Jimp({ width: 8, height: 8, color: 0xff8800ff }).getBuffer('image/png'));
}

const NOTES = { paleta: ['laranja', 'creme'], composicao: 'prato ao centro', luz: 'de fim de tarde', enquadramento: 'bem de perto', clima: 'aconchegante', evitar: ['fundo branco'], categorias: ['comida_hamburguer'], assunto: 'hambúrguer no balcão', acabamento: 'madeira escura, fundo desfocado' };

async function setup(opts: { pinterest?: boolean; env?: Record<string, unknown> } = {}) {
  const t = {
    brands: new FakeTable(() => ({ segment: null, style_library_enabled: true, style_library_segment: null, style_library_checked_at: null, style_selection_day: null, style_selection_reads: 0 })),
    campaigns: new FakeTable(),
    style_references: new FakeTable(() => ({ status: 'processing', style_notes: {}, error: null, claimed_at: null, attempts: 0, campaign_id: null, source_id: null, pin_id: null, kind: 'image', origin: 'own' })),
    style_ref_sources: new FakeTable(() => ({ last_synced_at: null, last_error: null, title: null, seen_pin_ids: [], origin: 'own' })),
    workspace_members: {
      findUnique: async ({ where }: any) => {
        const k = where.workspace_id_user_id;
        if (k.workspace_id !== WS) return null;
        return k.user_id === OWNER ? { role: 'owner' } : k.user_id === VIEWER ? { role: 'viewer' } : null;
      },
    },
  };
  await t.brands.create({ data: { id: BRAND, workspace_id: WS, name: 'Freela' } });
  await t.campaigns.create({ data: { id: CAMP, workspace_id: WS, brand_id: BRAND, name: 'Jundiaí' } });
  const prisma: any = { ...t, $transaction: async (fn: any) => fn(prisma) };
  const img = await png();
  const routes = new Map<string, () => Response>();
  const fetched: string[] = [];
  const fetch = jest.fn(async (url: string) => {
    fetched.push(url);
    const r = routes.get(url);
    return r ? r() : new Response('não', { status: 404 });
  });
  const files = new Map<string, Uint8Array>();
  const filesSvc: any = {
    put: async (b: string, k: string, bytes: Uint8Array) => { files.set(`${b}/${k}`, new Uint8Array(bytes)); },
    read: async (b: string, k: string) => Buffer.from(files.get(`${b}/${k}`)!),
    delete: async (b: string, k: string) => { files.delete(`${b}/${k}`); },
    signedUrl: (b: string, k: string) => `https://api.test/v1/files/${b}/${k}?sig=x`,
  };
  const ai = { json: jest.fn(async () => NOTES) };
  const svc = new StyleRefsService(prisma, new WorkspaceAccessService(prisma), ai as any, filesSvc, new ImageService(), fetch as any, { STYLE_REFS_PINTEREST_ENABLED: opts.pinterest ?? true, STYLE_LIBRARY_ENABLED: false, STYLE_LIBRARY_WORKSPACE_ID: '', ...opts.env } as any);
  svc.autoProcess = false;
  const image = () => new Response(Buffer.from(img), { status: 200, headers: { 'content-type': 'image/png' } });
  return { t, svc, ai, fetch, fetched, routes, files, img, image };
}

describe('StyleRefsService — envio e leitura do estilo', () => {
  it('envio grava "processing"; processPending manda a imagem à visão e grava as notas; a tela vê o resumo', async () => {
    const { t, svc, ai, img } = await setup();
    const ref = await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' }, CAMP);
    expect(ref).toMatchObject({ source: 'upload', status: 'processing', campaign_id: CAMP });
    expect(await svc.processPending(5)).toBe(1);
    const req = (ai.json.mock.calls[0] as any)[1];
    expect(req.images).toHaveLength(1);
    expect(req.images[0].mime).toBe('image/jpeg');
    expect(t.style_references.rows[0]).toMatchObject({ status: 'ready', style_notes: NOTES });
    const list = await svc.list(VIEWER, WS, BRAND, CAMP);
    expect(list.refs[0]).toMatchObject({ status: 'ready', summary: 'cores laranja, creme; luz de fim de tarde; bem de perto; clima aconchegante' });
    expect(list.refs[0]!.image_url).toContain('/v1/files/style-refs/');
  });

  it('falha da visão: só aquela fica "failed" com a frase; arquivo que não é imagem → 400; viewer não envia', async () => {
    const { svc, ai, img } = await setup();
    await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' });
    ai.json.mockResolvedValueOnce({} as any);
    await svc.processPending(5);
    const list = await svc.list(OWNER, WS, BRAND);
    expect(list.refs[0]).toMatchObject({ status: 'failed', error: 'Não conseguimos ler o estilo desta referência. Remova e tente outra.' });
    expect(await status(svc.upload(OWNER, WS, BRAND, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }))).toBe('400:Envie uma imagem JPG ou PNG.');
    expect(await status(svc.upload(VIEWER, WS, BRAND, { bytes: img, mime: 'image/png' }))).toMatch(/^403:/);
  });

  it('loadStyleNotes: só as prontas da marca/campanha, como texto de inspiração; sem nenhuma = null', async () => {
    const { t, svc, img } = await setup();
    expect(await svc.loadStyleNotes(WS, BRAND, CAMP)).toBeNull();
    await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' }, CAMP);
    await svc.processPending(5);
    const pick = (await svc.loadStyleNotes(WS, BRAND, CAMP))!;
    expect(pick.text.startsWith(`${STYLE_NOTES_HEADER} 1) [hambúrguer e lanches] «assunto hambúrguer no balcão; paleta laranja, creme`)).toBe(true);
    expect(pick.used).toEqual({ own: [t.style_references.rows[0].id], library: [] });
  });

  it('loadPhotoStyle (vagas): nota completa dá paleta, luz e clima; reduzida só paleta e luz; sem repetição; notesInUse conta a escolha', async () => {
    const { t, svc } = await setup();
    expect(await svc.loadPhotoStyle(WS, BRAND, 'Vaga de Garçom')).toBeNull();
    expect(await svc.loadPhotoStyle(WS, null, 'Vaga de Garçom')).toBeNull();
    expect(await svc.notesInUse(WS, BRAND)).toBe(0);
    const mk = (categorias: string[], over: Record<string, unknown> = {}) =>
      t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, campaign_id: null, source: 'upload', status: 'ready', style_notes: { ...NOTES, categorias, ...over } } }) as Promise<{ id: string }>;
    const full = await mk(['pessoas_trabalhando'], { paleta: ['laranja', 'creme'], luz: 'de fim de tarde', clima: 'aconchegante' });
    const reduced = await mk(['beleza'], { paleta: ['Creme', 'verde'], luz: 'suave', clima: 'sofisticado' });
    const r = (await svc.loadPhotoStyle(WS, BRAND, 'Vaga de Garçom'))!;
    expect(r.style.paleta).toEqual(expect.arrayContaining(['laranja', 'creme', 'verde']));
    expect(r.style.paleta.filter((x) => x.toLowerCase() === 'creme')).toHaveLength(1);
    expect(r.style.luz).toEqual(expect.arrayContaining(['de fim de tarde', 'suave']));
    expect(r.used.own).toEqual(expect.arrayContaining([full.id, reduced.id]));
    expect(r.used.library).toEqual([]);
    expect(await svc.notesInUse(WS, BRAND)).toBe(2);
    // empresa errada não lê
    expect(await svc.loadPhotoStyle('99999999-9999-4999-8999-999999999999', BRAND, 'Vaga de Garçom')).toBeNull();
  });

  it('texto rotulado e nota reduzida', async () => {
    const { t, svc } = await setup();
    const mk = (campaign_id: string | null, categorias: string[], assunto: string) =>
      t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, campaign_id, source: 'upload', status: 'ready', style_notes: { ...NOTES, categorias, assunto } } }) as Promise<{ id: string }>;
    const c2 = await mk(CAMP, ['comida_hamburguer'], 'hambúrguer');
    const c3 = await mk(CAMP, ['comida_hamburguer'], 'hambúrguer artesanal');
    const b1 = await mk(null, ['comida_hamburguer'], 'lanche');
    const b2 = await mk(null, ['bebida_bar'], 'chope');
    const b3 = await mk(null, [], 'x');
    const pick = (await svc.loadStyleNotes(WS, BRAND, CAMP, 'Hambúrguer artesanal'))!;
    expect(pick.text).toContain(' 1) [hambúrguer e lanches] «assunto hambúrguer artesanal; ');
    expect(pick.text.endsWith(' 4) «paleta laranja, creme; luz de fim de tarde»')).toBe(true);
    expect(pick.used.own).toEqual([c3.id, c2.id, b1.id, b3.id]);
    expect(pick.used.own).not.toContain(b2.id);
  });

  it('processPending grava v: 2', async () => {
    const { t, svc, img } = await setup();
    await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' });
    await svc.processPending(5);
    expect(t.style_references.rows[0].style_notes).toMatchObject({ v: 2, acabamento: 'madeira escura, fundo desfocado' });
  });

  it('empresa A não lê notas de B', async () => {
    const { t, svc } = await setup();
    const OTHER = '66666666-6666-4666-8666-666666666666';
    const OTHER_BRAND = '77777777-7777-4777-8777-777777777777';
    await t.style_references.create({ data: { workspace_id: OTHER, brand_id: OTHER_BRAND, source: 'upload', status: 'ready', style_notes: NOTES } });
    expect(await svc.loadStyleNotes(WS, OTHER_BRAND, null)).toBeNull();
    expect((await svc.loadStyleNotes(OTHER, OTHER_BRAND, null))!.text).toContain('INSPIRAÇÃO DE ESTILO');
  });

  it('até 4 notas, as da campanha primeiro', async () => {
    const { t, svc } = await setup();
    const mk = (campaign_id: string | null) => t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, campaign_id, source: 'upload', status: 'ready', style_notes: NOTES } }) as Promise<{ id: string }>;
    const b1 = await mk(null), b2 = await mk(null), c1 = await mk(CAMP), c2 = await mk(CAMP), b3 = await mk(null), b4 = await mk(null);
    const pick = (await svc.loadStyleNotes(WS, BRAND, CAMP))!;
    expect(pick.used.own).toEqual([c2.id, c1.id, b4.id, b3.id]);
    expect([b1.id, b2.id].some((id) => pick.used.own.includes(id))).toBe(false);
  });

  it('8 por campanha: a 9ª é recusada com a frase da tela', async () => {
    const { svc, img } = await setup();
    for (let i = 0; i < 8; i++) await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' }, CAMP);
    expect(await status(svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' }, CAMP))).toBe('400:Chegou a 8 referências nesta campanha. Remova uma para pôr outra.');
  });
});

describe('StyleRefsService — Pinterest', () => {
  const PIN = 'https://www.pinterest.com/pin/424605071146230977/';
  const OEMBED = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(PIN)}`;

  it('Pin: imagem pelo oEmbed (736x de i.pinimg.com); o mesmo Pin de novo é recusado', async () => {
    const { svc, routes, fetched, image } = await setup();
    routes.set(OEMBED, () => Response.json({ thumbnail_url: 'https://i.pinimg.com/236x/9a/95/x.jpg' }));
    routes.set('https://i.pinimg.com/736x/9a/95/x.jpg', image);
    const r = await svc.addPinterest(OWNER, WS, BRAND, 'https://br.pinterest.com/pin/424605071146230977/', CAMP);
    expect(r).toMatchObject({ kind: 'pin', added: 1 });
    expect(fetched).toContain('https://i.pinimg.com/736x/9a/95/x.jpg');
    expect(await status(svc.addPinterest(OWNER, WS, BRAND, PIN))).toBe('400:Esse Pin já está nas referências.');
  });

  it('pin.it que redireciona para fora do Pinterest → recusado; link de outro site → frase do Pin', async () => {
    const { svc, routes } = await setup();
    routes.set('https://pin.it/2abcD', () => new Response(null, { status: 301, headers: { location: 'https://evil.com/pin/1/' } }));
    const msg = '400:Esse link não é de um Pin nem de uma pasta do Pinterest. No Pinterest, toque em Compartilhar → Copiar link.';
    expect(await status(svc.addPinterest(OWNER, WS, BRAND, 'https://pin.it/2abcD'))).toBe(msg);
    expect(await status(svc.addPinterest(OWNER, WS, BRAND, 'https://site.com/foto.jpg'))).toBe(msg);
  });

  it('pasta: vira fonte acompanhada + referências do RSS; a mesma pasta de novo = a mesma fonte, sem duplicar Pins', async () => {
    const { t, svc, routes, image } = await setup();
    routes.set('https://www.pinterest.com/foodnetwork/5-star-recipes.rss', () => new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } }));
    routes.set('https://i.pinimg.com/736x/dc/b0/fb/dcb0fb8eefbe6f3549ee942c86557393.jpg', image);
    routes.set('https://i.pinimg.com/736x/9a/95/b6/9a95b6ef9aa358907c5947e6f80eb86f.jpg', image);
    const a = await svc.addPinterest(OWNER, WS, BRAND, 'https://br.pinterest.com/foodnetwork/5-star-recipes/');
    expect(a).toMatchObject({ kind: 'board', added: 2 });
    const b = await svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/foodnetwork/5-star-recipes/');
    expect(b).toMatchObject({ kind: 'board', added: 0 });
    expect(t.style_ref_sources.rows).toHaveLength(1);
    expect(t.style_ref_sources.rows[0]).toMatchObject({ title: '5 Star Recipes', last_error: null });
    expect(t.style_references.rows.map((r) => r.pin_id).sort()).toEqual(['424605071146230977', 'e1_AfqPShxtN_7i28uqhW']);
    expect(t.style_references.rows.every((r) => r.source_id === t.style_ref_sources.rows[0]!.id && r.campaign_id === null)).toBe(true);
  });

  it('lista da marca: nome da campanha, título da pasta, tentativa e quantas cada pasta tem', async () => {
    const { t, svc, routes, image } = await setup();
    routes.set('https://www.pinterest.com/foodnetwork/5-star-recipes.rss', () => new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } }));
    routes.set('https://i.pinimg.com/736x/dc/b0/fb/dcb0fb8eefbe6f3549ee942c86557393.jpg', image);
    routes.set('https://i.pinimg.com/736x/9a/95/b6/9a95b6ef9aa358907c5947e6f80eb86f.jpg', image);
    await svc.upload(OWNER, WS, BRAND, { bytes: await png(), mime: 'image/png' }, CAMP);
    await svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/foodnetwork/5-star-recipes/');
    expect(t.style_references.rows).toHaveLength(3);
    const l = await svc.list(VIEWER, WS, BRAND);
    expect(l.refs.find((r) => r.campaign_id === CAMP)).toMatchObject({ campaign_name: 'Jundiaí', source_title: null, attempts: 0 });
    expect(l.refs.filter((r) => r.from_source)).toHaveLength(2);
    expect(l.refs.filter((r) => r.from_source).every((r) => r.source_title === '5 Star Recipes' && r.campaign_name === null)).toBe(true);
    expect(l.sources[0]).toMatchObject({ title: '5 Star Recipes', refs_count: 2 });
    expect(l.limits).toMatchObject({ in_brand: 3, brand: 30, campaign: 8 });
  });

  it('Correção 1: mais de 38 referências — refs_count e in_brand reais, e sem campaign_id todas aparecem', async () => {
    const { t, svc } = await setup();
    await t.style_ref_sources.create({ data: { id: 'src-1', workspace_id: WS, brand_id: BRAND, url: 'u', rss_url: 'r' } });
    for (let i = 0; i < 30; i++) await t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, source_id: 'src-1', source: 'pinterest', created_at: new Date(2026, 0, 1, 0, i) } });
    for (let i = 0; i < 10; i++) await t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, campaign_id: CAMP, source: 'upload', created_at: new Date(2026, 5, 1, 0, i) } });
    const all = await svc.list(VIEWER, WS, BRAND);
    expect(all.refs).toHaveLength(40);
    expect(all.sources[0]!.refs_count).toBe(30);
    expect(all.limits.in_brand).toBe(40);
    const camp = await svc.list(VIEWER, WS, BRAND, CAMP);
    expect(camp.refs).toHaveLength(38);
    expect(camp.sources[0]!.refs_count).toBe(30);
  });

  it('origem: envio e Pin colado gravam own; pasta da Seleção faz o sync gravar as referências com selection', async () => {
    const { t, svc, routes, image } = await setup();
    routes.set(`https://www.pinterest.com/oembed.json?url=${encodeURIComponent('https://www.pinterest.com/pin/424605071146230977/')}`, () => Response.json({ thumbnail_url: 'https://i.pinimg.com/236x/9a/95/x.jpg' }));
    routes.set('https://i.pinimg.com/736x/9a/95/x.jpg', image);
    await svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/pin/424605071146230977/');
    expect(t.style_references.rows[0]).toMatchObject({ source: 'pinterest', origin: 'own' });
    routes.set('https://www.pinterest.com/foodnetwork/5-star-recipes.rss', () => new Response(RSS, { status: 200 }));
    routes.set('https://i.pinimg.com/736x/dc/b0/fb/dcb0fb8eefbe6f3549ee942c86557393.jpg', image);
    routes.set('https://i.pinimg.com/736x/9a/95/b6/9a95b6ef9aa358907c5947e6f80eb86f.jpg', image);
    await t.style_ref_sources.create({ data: { workspace_id: WS, brand_id: BRAND, url: 'https://www.pinterest.com/foodnetwork/5-star-recipes/', rss_url: 'https://www.pinterest.com/foodnetwork/5-star-recipes.rss', origin: 'selection' } });
    expect(await svc.refreshDueSources(5)).toBe(1);
    const fromFolder = t.style_references.rows.filter((r) => r.source_id);
    expect(fromFolder.length).toBeGreaterThan(0);
    expect(fromFolder.every((r) => r.origin === 'selection')).toBe(true);
  });

  it('RSS fora do ar: a fonte guarda o erro e as referências antigas continuam; Pinterest desligado → 404', async () => {
    const { t, svc, routes, image } = await setup();
    routes.set('https://www.pinterest.com/foodnetwork/5-star-recipes.rss', () => new Response(RSS, { status: 200 }));
    routes.set('https://i.pinimg.com/736x/dc/b0/fb/dcb0fb8eefbe6f3549ee942c86557393.jpg', image);
    routes.set('https://i.pinimg.com/736x/9a/95/b6/9a95b6ef9aa358907c5947e6f80eb86f.jpg', image);
    await svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/foodnetwork/5-star-recipes/');
    routes.set('https://www.pinterest.com/foodnetwork/5-star-recipes.rss', () => new Response('erro', { status: 503 }));
    t.style_ref_sources.rows[0]!.last_synced_at = new Date(Date.now() - 25 * 3600_000);
    expect(await svc.refreshDueSources(5)).toBe(1);
    expect(t.style_ref_sources.rows[0]!.last_error).toBe('O Pinterest não respondeu agora. Tentamos de novo amanhã.');
    expect(t.style_references.rows).toHaveLength(2);
    const off = await setup({ pinterest: false });
    expect(await status(off.svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/pin/1/'))).toBe('404:Não encontrado.');
  });

  it('teto de 30 na marca: a referência de RSS mais antiga sai para a nova entrar', async () => {
    const { t, svc, img } = await setup();
    for (let i = 0; i < 30; i++) {
      await t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, source: 'pinterest', source_id: 'src', pin_id: `p${i}`, storage_path: `x/${i}.jpg`, created_at: new Date(2026, 0, 1, 0, i) } });
    }
    await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' });
    expect(t.style_references.rows).toHaveLength(30);
    expect(t.style_references.rows.some((r) => r.pin_id === 'p0')).toBe(false);
  });
});

describe('StyleRefsService — revisão das Fatias 5/6', () => {
  const RSS_URL = 'https://www.pinterest.com/foodnetwork/5-star-recipes.rss';
  const IMG1 = 'https://i.pinimg.com/736x/dc/b0/fb/dcb0fb8eefbe6f3549ee942c86557393.jpg';
  const IMG2 = 'https://i.pinimg.com/736x/9a/95/b6/9a95b6ef9aa358907c5947e6f80eb86f.jpg';

  it('Pin removido de uma pasta não volta na renovação seguinte', async () => {
    const { t, svc, routes, image } = await setup();
    routes.set(RSS_URL, () => new Response(RSS, { status: 200 }));
    routes.set(IMG1, image);
    routes.set(IMG2, image);
    await svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/foodnetwork/5-star-recipes/');
    const gone = t.style_references.rows.find((r) => r.pin_id === '424605071146230977')!;
    await svc.remove(OWNER, WS, BRAND, gone.id);
    t.style_ref_sources.rows[0]!.last_synced_at = new Date(Date.now() - 25 * 3600_000);
    await svc.refreshDueSources(5);
    expect(t.style_references.rows.map((r) => r.pin_id)).toEqual(['e1_AfqPShxtN_7i28uqhW']);
  });

  it('o mesmo Pin colado duas vezes ao mesmo tempo: o segundo recebe "já está" (sem 500) e o arquivo dele é apagado', async () => {
    const { t, svc, routes, image, files } = await setup();
    const PIN = 'https://www.pinterest.com/pin/424605071146230977/';
    routes.set(`https://www.pinterest.com/oembed.json?url=${encodeURIComponent(PIN)}`, () => Response.json({ thumbnail_url: 'https://i.pinimg.com/236x/9a/95/x.jpg' }));
    routes.set('https://i.pinimg.com/736x/9a/95/x.jpg', image);
    const orig = t.style_references.create.bind(t.style_references);
    let n = 0;
    t.style_references.create = (async (a: any) => {
      if (++n === 2) throw Object.assign(new Error('unique'), { code: 'P2002' });
      return orig(a);
    }) as any;
    const [a, b] = await Promise.all([status(svc.addPinterest(OWNER, WS, BRAND, PIN)), status(svc.addPinterest(OWNER, WS, BRAND, PIN))]);
    expect([a, b].sort()).toEqual(['400:Esse Pin já está nas referências.', 'ok']);
    expect(files.size).toBe(1);
  });

  it('WEBP: a frase diz que só JPG e PNG valem (o decodificador do servidor não lê WEBP)', async () => {
    const { svc } = await setup();
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
    expect(await status(svc.upload(OWNER, WS, BRAND, { bytes: webp, mime: 'image/webp' }))).toBe('400:Envie uma imagem JPG ou PNG.');
  });

  it('resposta sem content-length maior que o teto é cortada (não entra inteira na memória)', async () => {
    const { svc, routes } = await setup();
    const big = new ReadableStream({ start(c) { for (let i = 0; i < 4; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); } });
    routes.set(RSS_URL, () => new Response(big, { status: 200 }));
    expect(await status(svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/foodnetwork/5-star-recipes/'))).toBe(
      '400:Não conseguimos ler essa pasta do Pinterest agora. Confira se ela é pública e tente de novo.',
    );
  });
});


describe('StyleRefsService — falha transitória da leitura (Fatia 0)', () => {
  const noCredit = () => new AiKeysFailedError('Sua conta OpenAI está sem créditos…', [{ vendor: 'openai', kind: 'noCredit' }]);
  const MSG = 'Não conseguimos ler o estilo desta referência. Remova e tente outra.';

  it('sem crédito: volta para a fila (attempts 1, sem erro) e só relê depois de 30 min', async () => {
    const { t, svc, ai, img } = await setup();
    await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' });
    ai.json.mockRejectedValueOnce(noCredit());
    await svc.processPending(5);
    const row = t.style_references.rows[0];
    expect(row).toMatchObject({ status: 'processing', attempts: 1, error: null });
    expect(await svc.processPending(5)).toBe(0);
    row.claimed_at = new Date(Date.now() - 31 * 60_000);
    expect(await svc.processPending(5)).toBe(1);
    expect(row).toMatchObject({ status: 'ready' });
    expect(ai.json).toHaveBeenCalledTimes(2);
  });

  it('3 falhas transitórias espaçadas → failed com a frase e attempts 3', async () => {
    const { t, svc, ai, img } = await setup();
    await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' });
    ai.json.mockRejectedValue(noCredit());
    const row = t.style_references.rows[0];
    await svc.processPending(5);
    expect(row).toMatchObject({ status: 'processing', attempts: 1 });
    row.claimed_at = new Date(Date.now() - 31 * 60_000);
    await svc.processPending(5);
    expect(row).toMatchObject({ status: 'processing', attempts: 2 });
    row.claimed_at = new Date(Date.now() - (3 * 3600_000 + 60_000));
    await svc.processPending(5);
    expect(row).toMatchObject({ status: 'failed', attempts: 3, error: MSG });
  });

  it('tempo esgotado e rede (erro que não é da IA) são transitórios; AI_NOT_CONFIGURED também', () => {
    expect(isTransientReadError(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))).toBe(true);
    expect(isTransientReadError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientReadError(new AiError(NO_AI_MESSAGE, 'AI_NOT_CONFIGURED'))).toBe(true);
    expect(isTransientReadError(new AiKeysFailedError('x', [{ vendor: 'openai', kind: 'format' }, { vendor: 'gemini', kind: 'noCredit' }]))).toBe(true);
    expect(isTransientReadError(new AiKeysFailedError('x', [{ vendor: 'openai', kind: 'format' }, { vendor: 'gemini', kind: 'rejected' }]))).toBe(false);
  });

  it('definitiva na hora: arquivo da imagem sumido → failed com attempts 0', async () => {
    const { t, svc, files, ai, img } = await setup();
    await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' });
    files.clear();
    await svc.processPending(5);
    expect(t.style_references.rows[0]).toMatchObject({ status: 'failed', attempts: 0, error: MSG });
    expect(ai.json).not.toHaveBeenCalled();
  });

  it('Review Focus #2: 12 linhas esperando a vez não travam a nova', async () => {
    const { t, svc, img } = await setup();
    for (let i = 0; i < 12; i++) {
      await t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, source: 'upload', storage_path: `x/${i}`, status: 'processing', attempts: 1, claimed_at: new Date(), created_at: new Date(Date.now() - 100_000 + i) } });
    }
    await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' });
    const newRow = t.style_references.rows[t.style_references.rows.length - 1];
    expect(await svc.processPending(10)).toBe(1);
    expect(newRow.status).toBe('ready');
  });

  it('trava roubada no meio da leitura: a escrita do worker antigo não altera a linha (pronta, falha ou volta à fila)', async () => {
    for (const outcome of ['ok', 'transitoria', 'definitiva'] as const) {
      const { t, svc, ai, img } = await setup();
      await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' });
      const row = t.style_references.rows[0];
      const stolen = new Date(Date.now() + 5000);
      ai.json.mockImplementationOnce(async () => {
        row.claimed_at = stolen; // outro worker tomou a linha
        if (outcome === 'transitoria') throw noCredit();
        return outcome === 'ok' ? NOTES : ({} as any);
      });
      await svc.processPending(5);
      expect(row).toMatchObject({ status: 'processing', attempts: 0, error: null, claimed_at: stolen });
    }
  });
});

describe('StyleRefsService — Seleção do Meu Funil (Fatia 4)', () => {
  const LIB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_WS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ENVON = { STYLE_REFS_PINTEREST_ENABLED: true, STYLE_LIBRARY_ENABLED: true, STYLE_LIBRARY_WORKSPACE_ID: LIB };
  const note = (cat: string, assunto: string) => ({ paleta: ['laranja'], composicao: 'x', luz: 'suave', enquadramento: 'y', clima: 'z', evitar: [], categorias: [cat], assunto, acabamento: 'a' });

  async function ready(t: any, ws: string, brand: string, cat: string, n: number, campaign: string | null = null) {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await t.style_references.create({ data: { workspace_id: ws, brand_id: brand, campaign_id: campaign, status: 'ready', style_notes: note(cat, `nota ${i}`) } });
      out.push(r.id);
    }
    return out;
  }

  async function world(env: Record<string, unknown> = ENVON, own = 1) {
    const w = await setup({ env });
    const acai = await w.t.brands.create({ data: { workspace_id: LIB, name: 'Açaí', style_library_segment: 'acai_sorvete' } });
    const bar = await w.t.brands.create({ data: { workspace_id: LIB, name: 'Bar', style_library_segment: 'bebida_bar' } });
    await w.t.brands.update({ where: { id: BRAND }, data: { segment: 'Açaiteria Frutá' } });
    const libAcai = await ready(w.t, LIB, acai.id, 'acai_sorvete', 3);
    const libBar = await ready(w.t, LIB, bar.id, 'bebida_bar', 2);
    const mine = await ready(w.t, WS, BRAND, 'acai_sorvete', own);
    return { ...w, libAcai, libBar, mine, acai, bar };
  }

  it('1 própria + 3 da seleção; a própria vem primeiro', async () => {
    const { svc, libAcai, mine } = await world();
    const pick = (await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!;
    expect(pick.used.own).toEqual(mine);
    expect([...pick.used.library].sort()).toEqual([...libAcai].sort());
  });
  it('4 próprias → a seleção não entra', async () => {
    const { svc } = await world(ENVON, 4);
    const pick = (await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!;
    expect(pick.used.own).toHaveLength(4);
    expect(pick.used.library).toEqual([]);
  });
  it('interruptor da marca desligado → só as próprias', async () => {
    const { svc, t, mine } = await world();
    await t.brands.update({ where: { id: BRAND }, data: { style_library_enabled: false } });
    expect((await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used).toEqual({ own: mine, library: [] });
  });
  it('"Nenhum desses" → só as próprias', async () => {
    const { svc, t, mine } = await world();
    await t.brands.update({ where: { id: BRAND }, data: { style_library_segment: 'none' } });
    expect((await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used).toEqual({ own: mine, library: [] });
  });
  it('ramo escolhido vale mais que o texto', async () => {
    const { svc, t, libBar } = await world();
    await t.brands.update({ where: { id: BRAND }, data: { style_library_segment: 'bebida_bar' } });
    const pick = (await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!;
    expect([...pick.used.library].sort()).toEqual([...libBar].sort());
  });
  it('empresa A não lê notas de B', async () => {
    const { svc, t, libAcai, libBar } = await world();
    const otherBrand = await t.brands.create({ data: { workspace_id: OTHER_WS, name: 'Açaí do B', style_library_segment: 'acai_sorvete' } });
    const theirs = await ready(t, OTHER_WS, otherBrand.id, 'acai_sorvete', 3);
    const pick = (await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!;
    const all = [...pick.used.own, ...pick.used.library];
    for (const id of theirs) expect(all).not.toContain(id);
    for (const id of libBar) expect(all).not.toContain(id);
    expect([...pick.used.library].sort()).toEqual([...libAcai].sort());
  });
  it('flag desligada → nenhuma consulta à Biblioteca', async () => {
    const { svc, t, mine } = await world({ ...ENVON, STYLE_LIBRARY_ENABLED: false });
    const spy = jest.spyOn(t.style_references, 'findMany');
    const spyB = jest.spyOn(t.brands, 'findMany');
    expect((await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used).toEqual({ own: mine, library: [] });
    expect(spy.mock.calls.some(([a]: any) => a?.where?.workspace_id === LIB)).toBe(false);
    expect(spyB.mock.calls.some(([a]: any) => a?.where?.workspace_id === LIB)).toBe(false);
  });
  it('flag ligada sem id → inerte; id de empresa inexistente → só as próprias, sem erro', async () => {
    const semId = await world({ ...ENVON, STYLE_LIBRARY_WORKSPACE_ID: '' });
    expect(semId.svc.libraryActiveFor(WS)).toBe(false);
    expect((await semId.svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used).toEqual({ own: semId.mine, library: [] });
    const ghost = await world({ ...ENVON, STYLE_LIBRARY_WORKSPACE_ID: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    expect((await ghost.svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used).toEqual({ own: ghost.mine, library: [] });
  });
  it('a própria Biblioteca não se completa com ela mesma (ids comparados em minúsculas)', async () => {
    const { svc, t } = await world({ ...ENVON, STYLE_LIBRARY_WORKSPACE_ID: LIB.toUpperCase() });
    expect(svc.libraryActiveFor(LIB)).toBe(false);
    expect(svc.libraryActiveFor(WS)).toBe(true);
    const libBrand = t.brands.rows.find((b: any) => b.name === 'Açaí');
    const pick = (await svc.loadStyleNotes(LIB, libBrand!.id, null, 'açaí'))!;
    expect(pick.used.library).toEqual([]);
  });
  it('erro ao ler a Biblioteca → segue só com as próprias', async () => {
    const { svc, t, mine } = await world();
    const orig = t.brands.findMany.bind(t.brands);
    jest.spyOn(t.brands, 'findMany').mockImplementation(async (a: any) => { if (a?.where?.workspace_id === LIB) throw new Error('boom'); return orig(a); });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect((await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used).toEqual({ own: mine, library: [] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    warn.mockRestore();
  });
  it('ramo antigo atrás de 300+ notas mais novas de outro ramo continua disponível e entra na seleção', async () => {
    const { svc, t, bar, acai, libAcai } = await world();
    for (let i = 0; i < 320; i++) await t.style_references.create({ data: { workspace_id: LIB, brand_id: bar.id, status: 'ready', style_notes: note('bebida_bar', `bar ${i}`), created_at: new Date(2027, 0, 1, 0, 0, i) } });
    for (const r of t.style_references.rows.filter((x: any) => x.brand_id === acai.id)) r.created_at = new Date(2020, 0, 1);
    const lf = await (svc as any).libraryFor(WS, { segment: 'Açaiteria Frutá', style_library_enabled: true, style_library_segment: null });
    expect([...lf.available].sort()).toEqual(['acai_sorvete', 'bebida_bar']);
    expect(lf.resolved).toEqual({ segment: 'acai_sorvete', source: 'auto' });
    expect(lf.rows.map((r: any) => r.id).sort()).toEqual([...libAcai].sort());
    expect([...(await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used.library].sort()).toEqual([...libAcai].sort());
  });
  it('libraryFor com o interruptor da marca desligado ainda devolve available/resolved; o pickNotes não usa', async () => {
    const { svc, t, mine } = await world();
    await t.brands.update({ where: { id: BRAND }, data: { style_library_enabled: false } });
    const lf = await (svc as any).libraryFor(WS, { segment: 'Açaiteria Frutá', style_library_enabled: false, style_library_segment: null });
    expect([...lf.available].sort()).toEqual(['acai_sorvete', 'bebida_bar']);
    expect(lf.resolved.segment).toBe('acai_sorvete');
    expect(lf.rows).toHaveLength(3);
    expect((await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used).toEqual({ own: mine, library: [] });
  });
  it('isolamento: toda consulta tem workspace_id ∈ {empresa, Biblioteca}; marca da empresa B pedida por A não ganha seleção', async () => {
    const { svc, t } = await world();
    const bBrand = await t.brands.create({ data: { workspace_id: OTHER_WS, name: 'B', segment: 'Açaiteria' } });
    await ready(t, OTHER_WS, bBrand.id, 'acai_sorvete', 1);
    const seen: unknown[] = [];
    for (const [tbl, fns] of [['brands', ['findFirst', 'findMany']], ['style_references', ['findMany', 'groupBy']]] as const) {
      for (const fn of fns) {
        const orig = (t as any)[tbl][fn]?.bind((t as any)[tbl]);
        if (!orig) continue;
        (t as any)[tbl][fn] = async (a: any) => { seen.push(a?.where?.workspace_id); return orig(a); };
      }
    }
    await svc.loadStyleNotes(WS, BRAND, null, 'açaí');
    expect(seen.length).toBeGreaterThan(3);
    for (const w of seen) expect([WS, LIB]).toContain(w);
    expect(await svc.pickNotes(WS, bBrand.id, null, 'açaí')).toEqual([]);
  });
});

describe('StyleRefsService — pickNotes lê só as notas da marca e da campanha pedida', () => {
  it('nota antiga da marca não fica de fora por causa de notas novas de outras campanhas', async () => {
    const { t, svc } = await setup();
    const note = { paleta: ['laranja'], composicao: 'x', luz: 'suave', enquadramento: 'y', clima: 'z', evitar: [], categorias: [], assunto: '', acabamento: 'a' };
    const old = await t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, campaign_id: null, status: 'ready', style_notes: note, created_at: new Date(2020, 0, 1) } });
    const OTHER_CAMP = '66666666-6666-4666-8666-666666666666';
    for (let i = 0; i < 40; i++) await t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, campaign_id: OTHER_CAMP, status: 'ready', style_notes: note, created_at: new Date(2026, 0, 1 + (i % 28), i) } });
    const picked = await svc.pickNotes(WS, BRAND, CAMP, null);
    expect(picked.map((p) => p.row.id)).toEqual([old.id]);
    const sem = await svc.pickNotes(WS, BRAND, null, null);
    expect(sem.map((p) => p.row.id)).toEqual([old.id]);
  });
});

describe('StyleRefsService — GET library (Tarefa 11)', () => {
  const LIB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_WS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ENVON = { STYLE_REFS_PINTEREST_ENABLED: true, STYLE_LIBRARY_ENABLED: true, STYLE_LIBRARY_WORKSPACE_ID: LIB };
  const note = (cat: string, assunto: string) => ({ paleta: ['laranja'], composicao: 'x', luz: 'suave', enquadramento: 'y', clima: 'z', evitar: [], categorias: [cat], assunto, acabamento: 'a' });

  async function ready(t: any, ws: string, brand: string, cat: string, n: number) {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await t.style_references.create({ data: { workspace_id: ws, brand_id: brand, campaign_id: null, status: 'ready', title: 'Pin secreto', source_url: 'https://pin.it/xyz', style_notes: note(cat, `nota ${i}`) } });
      out.push(r.id);
    }
    return out;
  }

  async function world(env: Record<string, unknown> = ENVON, own = 1) {
    const w = await setup({ env });
    const acai = await w.t.brands.create({ data: { workspace_id: LIB, name: 'Açaí', style_library_segment: 'acai_sorvete' } });
    const bar = await w.t.brands.create({ data: { workspace_id: LIB, name: 'Bar', style_library_segment: 'bebida_bar' } });
    await w.t.brands.update({ where: { id: BRAND }, data: { segment: 'Açaiteria Frutá' } });
    const libAcai = await ready(w.t, LIB, acai.id, 'acai_sorvete', 3);
    await ready(w.t, LIB, bar.id, 'bebida_bar', 2);
    await ready(w.t, WS, BRAND, 'acai_sorvete', own);
    return { ...w, libAcai };
  }

  it('ramo reconhecido: quantas, descrições só em texto', async () => {
    const { svc, libAcai } = await world();
    const view = await svc.library(OWNER, WS, BRAND);
    expect(view).toMatchObject({ count: 3, segment: 'acai_sorvete', segment_label: 'açaí e sorvete', segment_source: 'auto', brand_segment: 'Açaiteria Frutá', enabled: true, own_ready: 1, in_use: true });
    expect(view.descriptions).toHaveLength(3);
    const json = JSON.stringify(view);
    for (const id of libAcai) expect(json).not.toContain(id);
    expect(json).not.toContain('http');
    expect(json).not.toContain('Pin secreto');
  });

  it('não reconhecido → segment null e as opções com seleção', async () => {
    const { svc, t } = await world();
    await t.brands.update({ where: { id: BRAND }, data: { segment: 'Floricultura' } });
    const view = await svc.library(OWNER, WS, BRAND);
    expect(view.segment).toBeNull();
    expect(view.segment_label).toBeNull();
    expect(view.count).toBe(0);
    expect(view.in_use).toBe(false);
    expect(view.options).toEqual([{ id: 'acai_sorvete', label: 'açaí e sorvete' }, { id: 'bebida_bar', label: 'bebida e bar' }]);
  });

  it('in_use false com 4 próprias e com o interruptor desligado', async () => {
    const quatro = await world(ENVON, 4);
    const v4 = await quatro.svc.library(OWNER, WS, BRAND);
    expect(v4).toMatchObject({ own_ready: 4, count: 3, in_use: false });
    const off = await world();
    await off.t.brands.update({ where: { id: BRAND }, data: { style_library_enabled: false } });
    expect(await off.svc.library(OWNER, WS, BRAND)).toMatchObject({ enabled: false, count: 3, in_use: false });
  });

  it('chave desligada → 404; viewer lê; não-membro 403; marca de outra empresa 404', async () => {
    const { svc, t } = await world();
    expect((await svc.library(VIEWER, WS, BRAND)).count).toBe(3);
    expect(await status(svc.library('99999999-9999-4999-8999-999999999999', WS, BRAND))).toMatch(/^403/);
    const outra = await t.brands.create({ data: { workspace_id: OTHER_WS, name: 'B' } });
    expect(await status(svc.library(OWNER, WS, outra.id))).toMatch(/^404/);
    const off = await world({ ...ENVON, STYLE_LIBRARY_ENABLED: false });
    expect(await status(off.svc.library(OWNER, WS, BRAND))).toBe('404:Não encontrado.');
    const ownLib = await world({ ...ENVON, STYLE_LIBRARY_WORKSPACE_ID: WS });
    expect(await status(ownLib.svc.library(OWNER, WS, BRAND))).toBe('404:Não encontrado.');
  });

  it('ramo com mais de 100 prontas: count real e descriptions só com as 20 mais recentes', async () => {
    const { svc, t } = await world();
    const extra = await t.brands.create({ data: { workspace_id: LIB, name: 'Açaí 2', style_library_segment: 'acai_sorvete' } });
    await ready(t, LIB, extra.id, 'acai_sorvete', 117);
    const view = await svc.library(OWNER, WS, BRAND);
    expect(view.count).toBe(120);
    expect(view.descriptions).toHaveLength(20);
    expect(view.in_use).toBe(true);
  });

  it('segment_source chosen (ramo escolhido) e none ("Nenhum desses")', async () => {
    const { svc, t } = await world();
    await t.brands.update({ where: { id: BRAND }, data: { style_library_segment: 'bebida_bar' } });
    expect(await svc.library(OWNER, WS, BRAND)).toMatchObject({ segment: 'bebida_bar', segment_label: 'bebida e bar', segment_source: 'chosen', count: 2, in_use: true });
    await t.brands.update({ where: { id: BRAND }, data: { style_library_segment: 'none' } });
    expect(await svc.library(OWNER, WS, BRAND)).toMatchObject({ segment: null, segment_label: null, segment_source: 'none', count: 0, in_use: false });
  });
});
