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

async function setup(opts: { pinterest?: boolean } = {}) {
  const t = {
    brands: new FakeTable(),
    campaigns: new FakeTable(),
    style_references: new FakeTable(() => ({ status: 'processing', style_notes: {}, error: null, claimed_at: null, attempts: 0, campaign_id: null, source_id: null, pin_id: null, kind: 'image' })),
    style_ref_sources: new FakeTable(() => ({ last_synced_at: null, last_error: null, title: null, seen_pin_ids: [] })),
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
    expect(pick.text.startsWith(`${STYLE_NOTES_HEADER} 1) «assunto hambúrguer no balcão; paleta laranja, creme`)).toBe(true);
    expect(pick.used).toEqual({ own: [t.style_references.rows[0].id], library: [] });
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
