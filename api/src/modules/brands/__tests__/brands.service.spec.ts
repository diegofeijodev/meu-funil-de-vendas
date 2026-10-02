import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FilesService } from '../../files/files.service';
import { BrandsService } from '../brands.service';
import { FakeTable } from './fake-prisma';

const dir = mkdtempSync(path.join(tmpdir(), 'mf-brands-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const WS_A = randomUUID();
const WS_B = randomUUID();
const USER = randomUUID();

function setup() {
  const t = {
    brands: new FakeTable(() => ({ description: null, logo_url: null, visual_style: {}, segment: null })),
    products: new FakeTable(),
    personas: new FakeTable(),
    brand_assets: new FakeTable(),
    brand_learnings: new FakeTable(),
    campaigns: new FakeTable(),
  };
  // `_count` do Prisma: contamos as tabelas fake.
  const brands = t.brands;
  const origFindMany = brands.findMany.bind(brands);
  brands.findMany = (async (a: any) => {
    const rows = await origFindMany(a);
    return rows.map((b: any) => ({
      ...b,
      _count: { campaigns: t.campaigns.rows.filter((c) => c.brand_id === b.id).length, products: t.products.rows.filter((p) => p.brand_id === b.id).length },
    }));
  }) as any;
  const prisma: any = { ...t, $transaction: async (fn: any) => fn(prisma) };
  const logs: any[] = [];
  const activity: any = { log: async (...args: any[]) => logs.push(args) };
  const files = new FilesService({ UPLOADS_DIR: dir, JWT_SECRET: 'segredo-de-teste-16+', PUBLIC_URL: 'http://api.test', FILES_SIGNING_SECRET: undefined } as any);
  const svc = new BrandsService(prisma, activity, files);
  return { svc, t, logs, files };
}

const status = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus()}:${e.getResponse().message}`; }
};

describe('BrandsService — marcas', () => {
  it('cria (trim + atividade brand.created), lista com contagens e devolve só as do workspace', async () => {
    const { svc, t, logs } = setup();
    const b = await svc.create(USER, WS_A, { name: '  Bar do Zé  ', segment: 'Bar' });
    expect(b.name).toBe('Bar do Zé');
    expect(logs[0]).toEqual([WS_A, USER, 'brand.created', 'brand', { name: 'Bar do Zé' }]);
    await t.products.create({ data: { brand_id: b.id, workspace_id: WS_A, name: 'x' } });
    await svc.create(USER, WS_B, { name: 'Outra empresa' });
    const list = await svc.list(WS_A);
    expect(list).toHaveLength(1);
    expect(list[0]!.campaigns).toEqual([{ count: 0 }]);
    expect(list[0]!.products).toEqual([{ count: 1 }]);
  });

  it('nome em branco → 400', async () => {
    const { svc } = setup();
    expect(await status(svc.create(USER, WS_A, { name: '   ' }))).toBe('400:Informe o nome da marca.');
  });

  it('marca de OUTRO workspace → 404 (get, update, delete e filhos)', async () => {
    const { svc } = setup();
    const b = await svc.create(USER, WS_B, { name: 'Alheia' });
    expect(await status(svc.get(WS_A, b.id))).toBe('404:Marca não encontrada.');
    expect(await status(svc.update(USER, WS_A, b.id, { name: 'x' }))).toBe('404:Marca não encontrada.');
    expect(await status(svc.remove(USER, WS_A, b.id))).toBe('404:Marca não encontrada.');
    expect(await status(svc.listProducts(WS_A, b.id))).toBe('404:Marca não encontrada.');
    expect(await status(svc.createPersona(WS_A, b.id, { name: 'p' }))).toBe('404:Marca não encontrada.');
    expect(await status(svc.listAssets(WS_A, b.id))).toBe('404:Marca não encontrada.');
  });

  it('update grava brand.updated; só visual_style não grava atividade; guia gigante → 400', async () => {
    const { svc, logs } = setup();
    const b = await svc.create(USER, WS_A, { name: 'M' });
    logs.length = 0;
    const up = await svc.update(USER, WS_A, b.id, { description: 'd', preferred_words: ['a'] });
    expect(up.description).toBe('d');
    expect(logs).toEqual([[WS_A, USER, 'brand.updated', 'brand', { brand_id: b.id }]]);
    logs.length = 0;
    // instância de DTO: campos não enviados chegam como `undefined`
    const g = await svc.update(USER, WS_A, b.id, { visual_style: { iluminacao: 'quente' }, name: undefined, description: undefined } as any);
    expect(g.visual_style).toEqual({ iluminacao: 'quente' });
    expect(logs).toHaveLength(0);
    expect(await status(svc.update(USER, WS_A, b.id, { visual_style: { x: 'a'.repeat(60_000) } }))).toBe('400:Guia visual grande demais.');
    expect(await status(svc.update(USER, WS_A, b.id, { name: ' ' }))).toBe('400:Informe o nome da marca.');
  });

  it('exclui e registra brand.deleted com o nome', async () => {
    const { svc, logs } = setup();
    const b = await svc.create(USER, WS_A, { name: 'Some' });
    logs.length = 0;
    await svc.remove(USER, WS_A, b.id);
    expect(logs).toEqual([[WS_A, USER, 'brand.deleted', 'brand', { name: 'Some' }]]);
    expect(await svc.list(WS_A)).toHaveLength(0);
  });
});

describe('BrandsService — produtos e personas', () => {
  it('CRUD de produto com defaults 0 e 404 para produto de outra marca/workspace', async () => {
    const { svc } = setup();
    const b1 = await svc.create(USER, WS_A, { name: 'B1' });
    const b2 = await svc.create(USER, WS_A, { name: 'B2' });
    const p = await svc.createProduct(WS_A, b1.id, { name: 'Novo produto' });
    expect([p.price, p.margin_percent]).toEqual([0, 0]);
    const up = await svc.updateProduct(WS_A, b1.id, p.id, { price: 12.5 });
    expect(up.price).toBe(12.5);
    expect(await status(svc.updateProduct(WS_A, b2.id, p.id, { price: 1 }))).toBe('404:Não encontrado.');
    expect(await status(svc.removeProduct(WS_B, b1.id, p.id))).toBe('404:Não encontrado.');
    await svc.removeProduct(WS_A, b1.id, p.id);
    expect(await svc.listProducts(WS_A, b1.id)).toHaveLength(0);
  });

  it('CRUD de persona', async () => {
    const { svc } = setup();
    const b = await svc.create(USER, WS_A, { name: 'B' });
    const p = await svc.createPersona(WS_A, b.id, { name: 'Nova persona' });
    const up = await svc.updatePersona(WS_A, b.id, p.id, { age_range: '25-34', segment_type: 'B2B' });
    expect([up.age_range, up.segment_type]).toEqual(['25-34', 'B2B']);
    await svc.removePersona(WS_A, b.id, p.id);
    expect(await svc.listPersonas(WS_A, b.id)).toHaveLength(0);
    expect(await status(svc.removePersona(WS_A, b.id, randomUUID()))).toBe('404:Não encontrado.');
  });

  it('aprendizados: ordem por score desc', async () => {
    const { svc, t } = setup();
    const b = await svc.create(USER, WS_A, { name: 'B' });
    await t.brand_learnings.create({ data: { brand_id: b.id, workspace_id: WS_A, category: 'c', value: 'baixo', score: 1 } });
    await t.brand_learnings.create({ data: { brand_id: b.id, workspace_id: WS_A, category: 'c', value: 'alto', score: 9 } });
    expect((await svc.listLearnings(WS_A, b.id)).map((l: any) => l.value)).toEqual(['alto', 'baixo']);
  });
});

describe('BrandsService — arquivos da marca', () => {
  it('registra arquivo enviado: url assinada pela API; logo também grava brands.logo_url', async () => {
    const { svc, files } = setup();
    const b = await svc.create(USER, WS_A, { name: 'B' });
    const key = files.newUploadKey('brands', WS_A, 'png');
    await files.put('creative-assets', key, Buffer.from('png'));
    const a = await svc.createAsset(WS_A, b.id, { kind: 'logo', name: 'logo.png', storage_path: key });
    expect(a.url!.startsWith(`http://api.test/v1/files/creative-assets/${key}?exp=`)).toBe(true);
    expect(a.tag).toBeNull();
    expect((await svc.get(WS_A, b.id)).logo_url).toBe(a.url);
  });

  it('referência guarda a tag; outras artes ignoram a tag', async () => {
    const { svc, files } = setup();
    const b = await svc.create(USER, WS_A, { name: 'B' });
    const k1 = files.newUploadKey('brands', WS_A, 'jpg');
    const k2 = files.newUploadKey('brands', WS_A, 'jpg');
    await files.put('creative-assets', k1, Buffer.from('a'));
    await files.put('creative-assets', k2, Buffer.from('b'));
    expect((await svc.createAsset(WS_A, b.id, { kind: 'reference', name: 'a.jpg', storage_path: k1, tag: 'produto' })).tag).toBe('produto');
    expect((await svc.createAsset(WS_A, b.id, { kind: 'identity', name: 'b.jpg', storage_path: k2, tag: 'produto' })).tag).toBeNull();
  });

  it('chave de outro workspace, de outro prefixo ou inexistente → 400', async () => {
    const { svc, files } = setup();
    const b = await svc.create(USER, WS_A, { name: 'B' });
    const foreign = files.newUploadKey('brands', WS_B, 'png');
    await files.put('creative-assets', foreign, Buffer.from('x'));
    const media = files.newUploadKey('media', WS_A, 'png');
    await files.put('creative-assets', media, Buffer.from('x'));
    const ghost = files.newUploadKey('brands', WS_A, 'png');
    for (const k of [foreign, media, ghost, '../../etc/passwd', 'brands/xx']) {
      expect(await status(svc.createAsset(WS_A, b.id, { kind: 'reference', name: 'x.png', storage_path: k }))).toBe('400:Chave de arquivo inválida.');
    }
  });

  it('remove o registro; arquivo de outra marca → 404', async () => {
    const { svc, files } = setup();
    const b1 = await svc.create(USER, WS_A, { name: 'B1' });
    const b2 = await svc.create(USER, WS_A, { name: 'B2' });
    const k = files.newUploadKey('brands', WS_A, 'png');
    await files.put('creative-assets', k, Buffer.from('x'));
    const a = await svc.createAsset(WS_A, b1.id, { kind: 'identity', name: 'x.png', storage_path: k });
    expect(await status(svc.removeAsset(WS_A, b2.id, a.id))).toBe('404:Não encontrado.');
    await svc.removeAsset(WS_A, b1.id, a.id);
    expect(await svc.listAssets(WS_A, b1.id)).toHaveLength(0);
  });
});
