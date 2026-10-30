import { Jimp } from 'jimp';
import { WorkspaceAccessService } from '../../access/access.service';
import { FakeTable } from '../../brands/__tests__/fake-prisma';
import { ImageService } from '../../media/image.service';
import { StyleRefsService } from '../style-refs.service';
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

const NOTES = { paleta: ['laranja', 'creme'], composicao: 'prato ao centro', luz: 'de fim de tarde', enquadramento: 'bem de perto', clima: 'aconchegante', evitar: ['fundo branco'] };

async function setup(opts: { pinterest?: boolean } = {}) {
  const t = {
    brands: new FakeTable(),
    campaigns: new FakeTable(),
    style_references: new FakeTable(() => ({ status: 'processing', style_notes: {}, error: null, claimed_at: null, campaign_id: null, source_id: null, pin_id: null, kind: 'image' })),
    style_ref_sources: new FakeTable(() => ({ last_synced_at: null, last_error: null, title: null })),
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
  const svc = new StyleRefsService(prisma, new WorkspaceAccessService(prisma), ai as any, filesSvc, new ImageService(), fetch as any, { STYLE_REFS_PINTEREST_ENABLED: opts.pinterest ?? true } as any);
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
    ai.json.mockRejectedValueOnce(new Error('caiu'));
    await svc.processPending(5);
    const list = await svc.list(OWNER, WS, BRAND);
    expect(list.refs[0]).toMatchObject({ status: 'failed', error: 'Não conseguimos ler o estilo desta referência. Remova e tente outra.' });
    expect(await status(svc.upload(OWNER, WS, BRAND, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }))).toBe('400:Envie uma imagem JPG, PNG ou WEBP.');
    expect(await status(svc.upload(VIEWER, WS, BRAND, { bytes: img, mime: 'image/png' }))).toMatch(/^403:/);
  });

  it('loadStyleNotes: só as prontas da marca/campanha, como texto de inspiração; sem nenhuma = null', async () => {
    const { svc, img } = await setup();
    expect(await svc.loadStyleNotes(WS, BRAND, CAMP)).toBeNull();
    await svc.upload(OWNER, WS, BRAND, { bytes: img, mime: 'image/png' }, CAMP);
    await svc.processPending(5);
    const text = await svc.loadStyleNotes(WS, BRAND, CAMP);
    expect(text).toMatch(/^INSPIRAÇÃO DE ESTILO \(não copie composição, pessoas, marcas nem textos; use só como clima\): 1\) paleta laranja, creme/);
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
