import { Logger } from '@nestjs/common';
import { todaySp } from '../../../common/time/dates';
import { parsePinterestLink } from '../pinterest';
import { SELECTION_CATALOG, SELECTION_OPTIONS } from '../selection-catalog';
import { RSS } from './fixtures';
import { BRAND, CAMP, OWNER, setup, status, VIEWER, WS } from './style-world';

const OTHER_WS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_BRAND = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ON = { STYLE_REFS_PINTEREST_ENABLED: true, STYLE_LIBRARY_ENABLED: true };
const FOLDER = { url: 'https://www.pinterest.com/stellarfooddiary/acai-bowls-photography/', rss_url: 'https://www.pinterest.com/stellarfooddiary/acai-bowls-photography.rss' };

const note = (cat: string, assunto: string) => ({ paleta: ['laranja'], composicao: 'x', luz: 'suave', enquadramento: 'y', clima: 'z', evitar: [], categorias: [cat], assunto, acabamento: 'a' });

async function refs(t: any, ws: string, brand: string, origin: 'own' | 'selection', n: number, over: Record<string, unknown> = {}) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await t.style_references.create({
      data: { workspace_id: ws, brand_id: brand, campaign_id: null, status: 'ready', origin, source_url: 'https://pin.it/xyz', title: 'Pin secreto', style_notes: note('acai_sorvete', `nota ${origin} ${i}`), ...over },
    });
    out.push(r.id);
  }
  return out;
}

async function world(opts: Parameters<typeof setup>[0] = { env: ON }, own = 1, selection = 3) {
  const w = await setup(opts);
  await w.t.brands.update({ where: { id: BRAND }, data: { segment: 'Açaiteria Frutá' } });
  const mine = await refs(w.t, WS, BRAND, 'own', own);
  const sel = await refs(w.t, WS, BRAND, 'selection', selection);
  return { ...w, mine, sel };
}

/** Espião: guarda o `workspace_id` do `where` (ou do `data`, nos `create`) de toda chamada às três tabelas. */
function spy(t: any) {
  const seen: { table: string; fn: string; ws: unknown }[] = [];
  for (const tbl of ['brands', 'style_references', 'style_ref_sources']) {
    for (const fn of ['findMany', 'findFirst', 'count', 'create', 'updateMany', 'delete', 'deleteMany']) {
      const orig = t[tbl][fn]?.bind(t[tbl]);
      if (!orig) continue;
      t[tbl][fn] = async (a: any) => { seen.push({ table: tbl, fn, ws: a?.where?.workspace_id ?? a?.data?.workspace_id }); return orig(a); };
    }
  }
  return seen;
}

describe('Seleção do Meu Funil (por empresa)', () => {
  describe('escolha das notas (pickNotes / loadStyleNotes)', () => {
    it('1 própria + 3 da Seleção: used = { own: [p1], library: [3 ids] } e a própria vem primeiro no texto', async () => {
      const { svc, mine, sel } = await world();
      const pick = (await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!;
      expect(pick.used.own).toEqual(mine);
      expect([...pick.used.library].sort()).toEqual([...sel].sort());
      expect(pick.text.indexOf('nota own 0')).toBeGreaterThan(-1);
      expect(pick.text.indexOf('nota own 0')).toBeLessThan(pick.text.indexOf('nota selection'));
    });

    it('4 próprias: a Seleção não entra', async () => {
      const { svc, mine } = await world(undefined, 4, 3);
      const pick = (await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!;
      expect(pick.used).toEqual({ own: expect.arrayContaining(mine), library: [] });
      expect(pick.used.own).toHaveLength(4);
    });

    it('interruptor da marca desligado: só as próprias', async () => {
      const { svc, t, mine } = await world();
      await t.brands.update({ where: { id: BRAND }, data: { style_library_enabled: false } });
      expect((await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used).toEqual({ own: mine, library: [] });
    });

    it('sem nenhuma própria, só com a Seleção: as notas dela valem', async () => {
      const { svc, sel } = await world(undefined, 0, 3);
      const pick = (await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!;
      expect(pick.used.own).toEqual([]);
      expect([...pick.used.library].sort()).toEqual([...sel].sort());
    });

    it('falha ao rereler a marca: segue só com as próprias e registra o aviso', async () => {
      const { svc, t, mine } = await world();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const orig = t.brands.findFirst.bind(t.brands);
      t.brands.findFirst = async () => { throw new Error('banco caiu'); };
      try {
        expect((await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used).toEqual({ own: mine, library: [] });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).toContain('banco caiu');
      } finally {
        t.brands.findFirst = orig;
        warn.mockRestore();
      }
    });

    it('referência da Seleção de campanha nunca entra como Seleção', async () => {
      const { svc, t } = await world(undefined, 1, 0);
      await refs(t, WS, BRAND, 'selection', 2, { campaign_id: '55555555-5555-4555-8555-555555555555' });
      expect((await svc.pickNotes(WS, BRAND, null, 'açaí')).filter((p) => p.library)).toEqual([]);
    });

    it.each([
      ['STYLE_LIBRARY_ENABLED desligada', { STYLE_REFS_PINTEREST_ENABLED: true, STYLE_LIBRARY_ENABLED: false }],
      ['STYLE_REFS_PINTEREST_ENABLED desligada', { STYLE_REFS_PINTEREST_ENABLED: false, STYLE_LIBRARY_ENABLED: true }],
    ])('%s: só as próprias, e a escolha não consulta a tabela de marcas', async (_n, env) => {
      const { svc, t, mine } = await world({ env, pinterest: env.STYLE_REFS_PINTEREST_ENABLED });
      const seen = spy(t);
      expect((await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!.used).toEqual({ own: mine, library: [] });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.filter((s) => s.table === 'brands')).toEqual([]);
    });

    it('empresa A não lê notas de B: mesma pasta nas duas, toda consulta leva o workspace_id de A e nenhum id de B aparece', async () => {
      const { svc, t, sel, mine } = await world();
      await t.style_ref_sources.create({ data: { workspace_id: WS, brand_id: BRAND, ...FOLDER, origin: 'selection' } });
      await t.brands.create({ data: { id: OTHER_BRAND, workspace_id: OTHER_WS, name: 'B', segment: 'Açaiteria' } });
      await t.style_ref_sources.create({ data: { workspace_id: OTHER_WS, brand_id: OTHER_BRAND, ...FOLDER, origin: 'selection' } });
      const theirs = await refs(t, OTHER_WS, OTHER_BRAND, 'selection', 5);
      const theirsOwn = await refs(t, OTHER_WS, OTHER_BRAND, 'own', 1);
      const seen = spy(t);
      const pick = (await svc.loadStyleNotes(WS, BRAND, null, 'açaí'))!;
      await svc.pickNotes(WS, BRAND, null, 'açaí');
      const view = await svc.library(OWNER, WS, BRAND);
      expect(seen.length).toBeGreaterThan(6);
      for (const s of seen) expect([s.table, s.fn, s.ws]).toEqual([s.table, s.fn, WS]);
      // `findFirst`/`findMany`/`count` de style_references, style_ref_sources e brands estão todos cobertos pelo espião
      const calls = new Set(seen.map((s) => `${s.table}.${s.fn}`));
      for (const c of ['style_references.findMany', 'brands.findFirst', 'style_references.count', 'style_ref_sources.count']) expect(calls.has(c)).toBe(true);
      expect([...pick.used.library, ...pick.used.own].sort()).toEqual([...sel, ...mine].sort());
      for (const id of [...theirs, ...theirsOwn]) expect([...pick.used.library, ...pick.used.own]).not.toContain(id);
      expect(view).toMatchObject({ sources_count: 1, count: 3, own_ready: 1 });
      // marca de B pedida por A: sem notas, e a vista dá 404
      expect(await svc.pickNotes(WS, OTHER_BRAND, null, 'açaí')).toEqual([]);
      expect(await status(svc.library(OWNER, WS, OTHER_BRAND))).toBe('404:Marca não encontrada.');
    });
  });

  describe('library() — vista da Seleção (P34)', () => {
    it('valores de uma marca de açaí com 1 própria, 3 da Seleção (1 lendo) e 1 pasta; sem descriptions', async () => {
      const { svc, t } = await world(undefined, 1, 3);
      await refs(t, WS, BRAND, 'selection', 1, { status: 'processing' });
      await t.style_ref_sources.create({ data: { workspace_id: WS, brand_id: BRAND, ...FOLDER, origin: 'selection' } });
      const v = await svc.library(OWNER, WS, BRAND);
      expect(v).toEqual({
        segment: 'acai_sorvete', segment_label: 'Açaí e sorvete', segment_source: 'auto', brand_segment: 'Açaiteria Frutá',
        options: SELECTION_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
        enabled: true, needs_ai_key: true, ai_credit: null, daily_left: 12, sources_count: 1, count: 3, reading: 1, own_ready: 1, in_use: true,
      });
      expect(v).not.toHaveProperty('descriptions');
    });

    it('options = SELECTION_OPTIONS (ordem e rótulos de tela)', async () => {
      const { svc } = await world();
      const v = await svc.library(OWNER, WS, BRAND);
      expect(v.options.map((o) => o.label)).toEqual(['Açaí e sorvete', 'Hamburgueria e lanches', 'Churrasco e espetinho', 'Bar e bebidas', 'Restaurante', 'Vagas e equipe']);
    });

    it('needs_ai_key: true sem chave; false com OpenAI ou com Gemini (chaves herdadas contam: é o AiKeysService.get)', async () => {
      const w = await world();
      expect((await w.svc.library(OWNER, WS, BRAND)).needs_ai_key).toBe(true);
      w.keys.get.mockImplementation(async (_ws: string, vendor: string) => (vendor === 'openai' ? 'sk-x' : null));
      expect((await w.svc.library(OWNER, WS, BRAND)).needs_ai_key).toBe(false);
      w.keys.get.mockImplementation(async (_ws: string, vendor: string) => (vendor === 'gemini' ? 'g-x' : null));
      expect((await w.svc.library(OWNER, WS, BRAND)).needs_ai_key).toBe(false);
      expect(w.keys.get).toHaveBeenCalledWith(WS, 'openai');
      expect(w.keys.get).toHaveBeenCalledWith(WS, 'gemini');
    });

    it('ai_credit: o motivo do aviso de créditos (no_credit, daily_limit) ou null', async () => {
      for (const reason of ['no_credit', 'daily_limit'] as const) {
        const w = await world({ env: ON, aiCredit: reason });
        expect((await w.svc.library(OWNER, WS, BRAND)).ai_credit).toBe(reason);
        expect(w.alerts.status).toHaveBeenCalledWith(WS);
      }
      expect((await (await world()).svc.library(OWNER, WS, BRAND)).ai_credit).toBeNull();
    });

    it('daily_left: 12 menos as leituras de hoje; outro dia = 12; nunca negativo', async () => {
      const { svc, t } = await world();
      const today = new Date(`${todaySp()}T00:00:00.000Z`);
      await t.brands.update({ where: { id: BRAND }, data: { style_selection_day: today, style_selection_reads: 5 } });
      expect((await svc.library(OWNER, WS, BRAND)).daily_left).toBe(7);
      await t.brands.update({ where: { id: BRAND }, data: { style_selection_day: new Date('2020-01-01T00:00:00.000Z'), style_selection_reads: 9 } });
      expect((await svc.library(OWNER, WS, BRAND)).daily_left).toBe(12);
      await t.brands.update({ where: { id: BRAND }, data: { style_selection_day: today, style_selection_reads: 40 } });
      expect((await svc.library(OWNER, WS, BRAND)).daily_left).toBe(0);
      await t.brands.update({ where: { id: BRAND }, data: { style_selection_day: null, style_selection_reads: 3 } });
      expect((await svc.library(OWNER, WS, BRAND)).daily_left).toBe(12);
    });

    it('own_ready conta próprias prontas e em processamento sem campanha (a régua do "útil"); falha e campanha não contam', async () => {
      const { svc, t } = await world(undefined, 1, 0);
      await refs(t, WS, BRAND, 'own', 1, { status: 'processing' });
      await refs(t, WS, BRAND, 'own', 1, { status: 'failed' });
      await refs(t, WS, BRAND, 'own', 1, { campaign_id: '55555555-5555-4555-8555-555555555555' });
      await refs(t, WS, BRAND, 'selection', 1);
      const v = await svc.library(OWNER, WS, BRAND);
      expect(v.own_ready).toBe(2);
      expect(v.count).toBe(1);
    });

    it('in_use: falso com 4 próprias, com o interruptor desligado, sem ramo, sem nada da Seleção', async () => {
      expect((await (await world()).svc.library(OWNER, WS, BRAND)).in_use).toBe(true);
      expect((await (await world(undefined, 4, 3)).svc.library(OWNER, WS, BRAND)).in_use).toBe(false);
      const off = await world();
      await off.t.brands.update({ where: { id: BRAND }, data: { style_library_enabled: false } });
      expect(await off.svc.library(OWNER, WS, BRAND)).toMatchObject({ enabled: false, in_use: false });
      const none = await world();
      await none.t.brands.update({ where: { id: BRAND }, data: { style_library_segment: 'none' } });
      expect(await none.svc.library(OWNER, WS, BRAND)).toMatchObject({ segment: null, segment_label: null, segment_source: 'none', in_use: false });
      expect((await (await world(undefined, 1, 0)).svc.library(OWNER, WS, BRAND)).in_use).toBe(false);
    });

    it('ramo escolhido (chosen) e valor gravado fora do catálogo (automático)', async () => {
      const { svc, t } = await world();
      await t.brands.update({ where: { id: BRAND }, data: { style_library_segment: 'bebida_bar' } });
      expect(await svc.library(OWNER, WS, BRAND)).toMatchObject({ segment: 'bebida_bar', segment_label: 'Bar e bebidas', segment_source: 'chosen' });
      await t.brands.update({ where: { id: BRAND }, data: { style_library_segment: 'beleza' } });
      expect(await svc.library(OWNER, WS, BRAND)).toMatchObject({ segment: 'acai_sorvete', segment_source: 'auto' });
    });

    it('Seleção desligada (qualquer das duas chaves) → 404; viewer lê; não-membro 403; marca de outra empresa 404', async () => {
      expect(await status((await world({ env: { STYLE_REFS_PINTEREST_ENABLED: true, STYLE_LIBRARY_ENABLED: false } })).svc.library(OWNER, WS, BRAND))).toBe('404:Não encontrado.');
      expect(await status((await world({ env: { STYLE_REFS_PINTEREST_ENABLED: false, STYLE_LIBRARY_ENABLED: true }, pinterest: false })).svc.library(OWNER, WS, BRAND))).toBe('404:Não encontrado.');
      const { svc } = await world();
      expect((await svc.library(VIEWER, WS, BRAND)).count).toBe(3);
      expect(await status(svc.library('99999999-9999-4999-8999-999999999999', WS, BRAND))).toMatch(/^403:/);
      expect(await status(svc.library(OWNER, WS, '77777777-7777-4777-8777-777777777777'))).toBe('404:Marca não encontrada.');
    });
  });
});

// ── Task 18a: a Seleção se ajusta sozinha em cada marca ─────────────────────────────────────────────────────────────────────────────
const KEY = { env: ON, aiKey: 'sk-teste' };
const rssOf = (url: string) => parsePinterestLink(url)!.kind === 'board' ? (parsePinterestLink(url) as { rssUrl: string }).rssUrl : '';
const ACAI = SELECTION_CATALOG.acai_sorvete!;
const BAR = SELECTION_CATALOG.bebida_bar!;
const hours = (h: number) => new Date(Date.now() - h * 3600_000);

/** Pasta da Seleção (ou própria) na marca, com `n` referências saídas dela (com arquivo guardado). */
async function folder(w: Awaited<ReturnType<typeof world>>, url: string, origin: 'own' | 'selection', n = 0, over: Record<string, unknown> = {}) {
  const src = await w.t.style_ref_sources.create({ data: { workspace_id: WS, brand_id: BRAND, url, rss_url: rssOf(url), origin, created_by: origin === 'own' ? OWNER : null, ...over } });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const path = `${WS}/${BRAND}/${src.id}-${i}.jpg`;
    w.files.set(`style-refs/${path}`, new Uint8Array([1]));
    ids.push((await w.t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, source_id: src.id, status: 'ready', origin, storage_path: path, source: 'pinterest', style_notes: note('acai_sorvete', `da pasta ${i}`) } })).id);
  }
  return { src, ids };
}

describe('Seleção — reconciliação (reconcileSelection)', () => {
  it('ramo resolvido + chave: cria as pastas do catálogo do ramo com origin=selection e grava o checked_at', async () => {
    const w = await world(KEY, 0, 0);
    expect(await w.svc.reconcileSelection(WS, BRAND)).toEqual({ created: 2, removed: 0 });
    const rows = w.t.style_ref_sources.rows;
    expect(rows.map((r) => r.url).sort()).toEqual([...ACAI].sort());
    for (const r of rows) expect(r).toMatchObject({ workspace_id: WS, brand_id: BRAND, origin: 'selection', created_by: null, last_synced_at: null, rss_url: rssOf(r.url) });
    expect(w.t.brands.rows[0]!.style_library_checked_at).toBeInstanceOf(Date);
    // idempotente
    expect(await w.svc.reconcileSelection(WS, BRAND)).toEqual({ created: 0, removed: 0 });
    expect(w.t.style_ref_sources.rows).toHaveLength(2);
  });

  it('sem chave de IA não cria nada e consulta o cofre nas duas chaves; com tudo já criado, nem consulta o cofre', async () => {
    const w = await world({ env: ON }, 0, 0);
    expect(await w.svc.reconcileSelection(WS, BRAND)).toEqual({ created: 0, removed: 0 });
    expect(w.t.style_ref_sources.rows).toEqual([]);
    expect(w.keys.get).toHaveBeenCalledWith(WS, 'openai');
    expect(w.keys.get).toHaveBeenCalledWith(WS, 'gemini');
    expect(w.t.brands.rows[0]!.style_library_checked_at).toBeInstanceOf(Date);
    const full = await world({ env: ON }, 0, 0);
    for (const u of ACAI) await folder(full, u, 'selection');
    await full.svc.reconcileSelection(WS, BRAND);
    expect(full.keys.get).not.toHaveBeenCalled();
  });

  it('chave só do Gemini também vale', async () => {
    const w = await world({ env: ON }, 0, 0);
    w.keys.get.mockImplementation(async (_w: string, v: string) => (v === 'gemini' ? 'g-x' : null));
    expect((await w.svc.reconcileSelection(WS, BRAND)).created).toBe(2);
  });

  it.each([
    ['interruptor da marca desligado', { style_library_enabled: false }],
    ['"Nenhum desses"', { style_library_segment: 'none' }],
  ])('%s: saem as pastas da Seleção e as referências delas (linhas e arquivos), sem precisar de chave', async (_n, patch) => {
    const w = await world({ env: ON }, 1, 0);
    const a = await folder(w, ACAI[0]!, 'selection', 2);
    await folder(w, ACAI[1]!, 'selection', 1);
    await w.t.brands.update({ where: { id: BRAND }, data: patch });
    expect(await w.svc.reconcileSelection(WS, BRAND)).toEqual({ created: 0, removed: 2 });
    expect(w.t.style_ref_sources.rows).toEqual([]);
    expect(w.t.style_references.rows.map((r) => r.origin)).toEqual(['own']);
    expect([...w.files.keys()]).toEqual([]);
    expect(a.ids.length).toBe(2);
  });

  it('trocar de ramo: saem as do ramo velho (com as referências) e entram as do novo', async () => {
    const w = await world(KEY, 0, 0);
    await w.svc.reconcileSelection(WS, BRAND);
    const old = w.t.style_ref_sources.rows[0]!;
    await w.t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, source_id: old.id, status: 'ready', origin: 'selection', style_notes: note('acai_sorvete', 'x') } });
    await w.t.brands.update({ where: { id: BRAND }, data: { style_library_segment: 'bebida_bar' } });
    expect(await w.svc.reconcileSelection(WS, BRAND)).toEqual({ created: 3, removed: 2 });
    expect(w.t.style_ref_sources.rows.map((r) => r.url).sort()).toEqual([...BAR].sort());
    expect(w.t.style_references.rows).toEqual([]);
  });

  it.each([
    ['STYLE_LIBRARY_ENABLED desligada', { STYLE_REFS_PINTEREST_ENABLED: true, STYLE_LIBRARY_ENABLED: false }],
    ['STYLE_REFS_PINTEREST_ENABLED desligada', { STYLE_REFS_PINTEREST_ENABLED: false, STYLE_LIBRARY_ENABLED: true }],
  ])('%s: não faz nada (nem apaga, nem consulta)', async (_n, env) => {
    const w = await world({ env, pinterest: env.STYLE_REFS_PINTEREST_ENABLED, aiKey: 'sk' }, 0, 0);
    await folder(w, BAR[0]!, 'selection', 1); // sobra de quando estava ligada: fica quieta
    const seen = spy(w.t);
    expect(await w.svc.reconcileSelection(WS, BRAND)).toEqual({ created: 0, removed: 0 });
    expect(seen).toEqual([]);
    expect(w.t.style_ref_sources.rows).toHaveLength(1);
    expect(w.t.style_references.rows).toHaveLength(1);
    expect(w.t.brands.rows[0]!.style_library_checked_at).toBeNull();
  });

  it('marca que não existe na empresa: {0,0}', async () => {
    const w = await world(KEY, 0, 0);
    expect(await w.svc.reconcileSelection(OTHER_WS, BRAND)).toEqual({ created: 0, removed: 0 });
    expect(await w.svc.reconcileSelection(WS, OTHER_BRAND)).toEqual({ created: 0, removed: 0 });
    expect(w.t.style_ref_sources.rows).toEqual([]);
  });

  it('pasta própria com a mesma rss_url do catálogo: não cria a da Seleção e a própria fica intacta', async () => {
    const w = await world(KEY, 0, 0);
    const mine = await folder(w, ACAI[0]!, 'own', 2);
    expect(await w.svc.reconcileSelection(WS, BRAND)).toEqual({ created: 1, removed: 0 });
    expect(w.t.style_ref_sources.rows.filter((r) => r.rss_url === rssOf(ACAI[0]!))).toEqual([expect.objectContaining({ id: mine.src.id, origin: 'own', created_by: OWNER })]);
    expect(w.t.style_references.rows.filter((r) => r.source_id === mine.src.id)).toHaveLength(2);
  });

  it('violação do índice único ao criar (P2002) = a pasta já existe: segue, sem erro e sem contar', async () => {
    const w = await world(KEY, 0, 0);
    const orig = w.t.style_ref_sources.create.bind(w.t.style_ref_sources);
    let first = true;
    w.t.style_ref_sources.create = async (a: any) => {
      if (first) { first = false; throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }); }
      return orig(a);
    };
    expect(await w.svc.reconcileSelection(WS, BRAND)).toEqual({ created: 1, removed: 0 });
    expect(w.t.brands.rows[0]!.style_library_checked_at).toBeInstanceOf(Date);
    // outro erro do banco não é engolido
    w.t.style_ref_sources.create = async () => { throw new Error('banco caiu'); };
    await w.t.style_ref_sources.deleteMany({});
    await expect(w.svc.reconcileSelection(WS, BRAND)).rejects.toThrow('banco caiu');
  });

  it('duas reconciliações ao mesmo tempo da mesma marca rodam uma de cada vez (sem pasta duplicada)', async () => {
    const w = await world(KEY, 0, 0);
    const [a, b] = await Promise.all([w.svc.reconcileSelection(WS, BRAND), w.svc.reconcileSelection(WS, BRAND)]);
    expect([a.created, b.created].sort()).toEqual([0, 2]);
    expect(w.t.style_ref_sources.rows).toHaveLength(2);
  });

  it('depois de criar pastas, com autoProcess o chute sincroniza as novas pela fila e lê as pendentes', async () => {
    const w = await world(KEY, 0, 0);
    w.svc.autoProcess = true;
    for (const u of ACAI) w.routes.set(rssOf(u), () => new Response(RSS, { status: 200 }));
    w.routes.set('https://i.pinimg.com/736x/9a/95/b6/9a95b6ef9aa358907c5947e6f80eb86f.jpg', w.image);
    w.routes.set('https://i.pinimg.com/736x/dc/b0/fb/dcb0fb8eefbe6f3549ee942c86557393.jpg', w.image);
    await w.svc.reconcileSelection(WS, BRAND);
    await w.svc.whenIdle();
    // 18b: a 1ª pasta traz as dela (ficam lendo) e a 2ª, sem vaga enquanto há leitura em curso, só grava o carimbo (sem rede)
    expect(w.fetched.filter((u) => u.endsWith('.rss'))).toEqual([rssOf(ACAI[0]!)]);
    expect(w.t.style_ref_sources.rows.every((s) => s.last_synced_at instanceof Date)).toBe(true);
    expect(w.t.style_references.rows.length).toBeGreaterThan(0);
    expect(w.t.style_references.rows.every((r) => r.origin === 'selection')).toBe(true);
    expect(w.ai.json).toHaveBeenCalled(); // processPending leu as pendentes
  });

  it('sem nada criado, o chute não roda (nenhuma ida ao Pinterest)', async () => {
    const w = await world({ env: ON }, 0, 0);
    w.svc.autoProcess = true;
    await w.svc.reconcileSelection(WS, BRAND);
    await w.svc.whenIdle();
    expect(w.fetch).not.toHaveBeenCalled();
  });
});

describe('Seleção — gatilhos (reconcileSoon, reconcileDueBrands, markSelectionDue)', () => {
  it('reconcileSoon devolve na hora (void) e a reconciliação roda pela fila', async () => {
    const w = await world(KEY, 0, 0);
    expect(w.svc.reconcileSoon(WS, BRAND)).toBeUndefined();
    await w.svc.whenIdle();
    expect(w.t.style_ref_sources.rows).toHaveLength(2);
  });

  it('reconcileSoon: erro vai para o logger.warn e nunca vira rejeição solta', async () => {
    const w = await world(KEY, 0, 0);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    w.t.brands.findFirst = async () => { throw new Error('banco caiu'); };
    try {
      w.svc.reconcileSoon(WS, BRAND);
      await w.svc.whenIdle();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('banco caiu');
    } finally {
      warn.mockRestore();
    }
  });

  it('reconcileDueBrands: pega a marca com checked_at nulo, não repete antes de 6 h e pega de novo depois de 6 h', async () => {
    const w = await world(KEY, 0, 0);
    expect(await w.svc.reconcileDueBrands()).toBe(1);
    expect(w.t.style_ref_sources.rows).toHaveLength(2);
    expect(await w.svc.reconcileDueBrands()).toBe(0);
    await w.t.brands.update({ where: { id: BRAND }, data: { style_library_checked_at: hours(5) } });
    expect(await w.svc.reconcileDueBrands()).toBe(0);
    await w.t.brands.update({ where: { id: BRAND }, data: { style_library_checked_at: hours(7) } });
    expect(await w.svc.reconcileDueBrands()).toBe(1);
  });

  it('reconcileDueBrands: nulas primeiro, depois as mais antigas; respeita o limite e cada marca usa o workspace_id da própria linha', async () => {
    const w = await world(KEY, 0, 0);
    await w.t.brands.create({ data: { id: OTHER_BRAND, workspace_id: OTHER_WS, name: 'B', segment: 'Bar e boteco', style_library_checked_at: hours(10) } });
    const third = await w.t.brands.create({ data: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', workspace_id: WS, name: 'C', segment: 'Bar', style_library_checked_at: hours(20) } });
    expect(await w.svc.reconcileDueBrands(1)).toBe(1);
    expect(w.t.brands.rows.find((b) => b.id === BRAND)!.style_library_checked_at).toBeInstanceOf(Date); // a nula foi a 1ª
    expect(w.t.brands.rows.find((b) => b.id === third.id)!.style_library_checked_at).toEqual(third.style_library_checked_at);
    expect(await w.svc.reconcileDueBrands(10)).toBe(2);
    // a marca da empresa B também foi reconciliada, com o workspace_id da própria linha (a chave falsa vale para todas)
    expect(w.t.style_ref_sources.rows.filter((s) => s.workspace_id === OTHER_WS).length).toBeGreaterThan(0);
    expect(w.t.style_ref_sources.rows.filter((s) => s.workspace_id === OTHER_WS).every((s) => s.brand_id === OTHER_BRAND)).toBe(true);
  });

  it('reconcileDueBrands sem Seleção: 0 e nada muda', async () => {
    const w = await world({ env: { STYLE_REFS_PINTEREST_ENABLED: true, STYLE_LIBRARY_ENABLED: false }, aiKey: 'sk' }, 0, 0);
    expect(await w.svc.reconcileDueBrands()).toBe(0);
    expect(w.t.brands.rows[0]!.style_library_checked_at).toBeNull();
  });

  it('markSelectionDue zera o checked_at das marcas da empresa e das que herdam dela, e não das outras', async () => {
    const w = await world(KEY, 0, 0);
    const INH = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const stamp = hours(1);
    await w.t.workspaces.create({ data: { id: INH, ai_inherit_from: WS } });
    await w.t.workspaces.create({ data: { id: OTHER_WS, ai_inherit_from: null } });
    await w.t.brands.update({ where: { id: BRAND }, data: { style_library_checked_at: stamp } });
    await w.t.brands.create({ data: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', workspace_id: INH, name: 'Filha', style_library_checked_at: stamp } });
    await w.t.brands.create({ data: { id: OTHER_BRAND, workspace_id: OTHER_WS, name: 'Outra', style_library_checked_at: stamp } });
    await w.svc.markSelectionDue(WS);
    const by = (ws: string) => w.t.brands.rows.find((b) => b.workspace_id === ws)!.style_library_checked_at;
    expect(by(WS)).toBeNull();
    expect(by(INH)).toBeNull();
    expect(by(OTHER_WS)).toEqual(stamp);
  });
});

describe('Seleção — colisões e lista', () => {
  it('removeSource numa pasta da Seleção: 400 SELECTION_SOURCE com a frase exata, e nada some', async () => {
    const w = await world(KEY, 0, 0);
    const { src } = await folder(w, ACAI[0]!, 'selection', 1);
    let err: any;
    try { await w.svc.removeSource(OWNER, WS, BRAND, src.id); } catch (e) { err = e; }
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toEqual({
      code: 'SELECTION_SOURCE',
      message: 'Esta pasta é da Seleção do Meu Funil e não dá para parar por aqui. Para tirar, desligue a seleção ou troque o ramo na marca, aba Guia visual.',
    });
    expect(w.t.style_ref_sources.rows).toHaveLength(1);
    expect(w.t.style_references.rows).toHaveLength(1);
  });

  it('removeSource numa pasta própria continua apagando a pasta e as referências dela (pela fila)', async () => {
    const w = await world(KEY, 0, 0);
    const { src } = await folder(w, ACAI[0]!, 'own', 2);
    expect(await w.svc.removeSource(OWNER, WS, BRAND, src.id)).toEqual({ ok: true, removed: 2 });
    expect(w.t.style_ref_sources.rows).toEqual([]);
    expect([...w.files.keys()]).toEqual([]);
  });

  it('colar o Pin que a Seleção trouxe: promoted, vira própria sem pasta e sobrevive à reconciliação que tira a pasta', async () => {
    const w = await world(KEY, 0, 0);
    const { src, ids } = await folder(w, ACAI[0]!, 'selection', 2);
    await w.t.style_references.update({ where: { id: ids[0] }, data: { pin_id: '123456' } });
    const out: any = await w.svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/pin/123456/');
    expect(out).toMatchObject({ kind: 'pin', added: 0, promoted: true });
    expect(out.refs).toHaveLength(1);
    expect(out.refs[0]).toMatchObject({ id: ids[0], origin: 'own', from_source: false });
    expect(w.t.style_references.rows.find((r) => r.id === ids[0])).toMatchObject({ origin: 'own', source_id: null });
    expect(w.fetch).not.toHaveBeenCalled(); // não baixou nada
    // a Seleção sai da marca: a promovida fica, a outra vai embora
    await w.t.brands.update({ where: { id: BRAND }, data: { style_library_segment: 'none' } });
    await w.svc.reconcileSelection(WS, BRAND);
    expect(w.t.style_ref_sources.rows.find((s) => s.id === src.id)).toBeUndefined();
    expect(w.t.style_references.rows.map((r) => r.id)).toEqual([ids[0]]);
    expect([...w.files.keys()]).toEqual([`style-refs/${WS}/${BRAND}/${src.id}-0.jpg`]);
  });

  it('colar um Pin próprio repetido continua dando "Esse Pin já está nas referências." (sem promoted)', async () => {
    const w = await world(KEY, 0, 0);
    await w.t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, status: 'ready', origin: 'own', pin_id: '777', source: 'pinterest' } });
    expect(await status(w.svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/pin/777/'))).toBe('400:Esse Pin já está nas referências.');
  });

  function feed(w: Awaited<ReturnType<typeof world>>, url: string) {
    w.routes.set(rssOf(url), () => new Response(RSS, { status: 200 }));
    w.routes.set('https://i.pinimg.com/736x/9a/95/b6/9a95b6ef9aa358907c5947e6f80eb86f.jpg', w.image);
    w.routes.set('https://i.pinimg.com/736x/dc/b0/fb/dcb0fb8eefbe6f3549ee942c86557393.jpg', w.image);
  }

  it('colar a pasta da Seleção: promoted, a pasta e as referências dela viram próprias e a resposta traz kind e added', async () => {
    const w = await world(KEY, 0, 0);
    const { src, ids } = await folder(w, ACAI[0]!, 'selection', 2);
    feed(w, ACAI[0]!);
    const out: any = await w.svc.addPinterest(OWNER, WS, BRAND, ACAI[0]!);
    expect(out).toMatchObject({ kind: 'board', promoted: true });
    expect(out.added).toBe(2);
    expect(w.t.style_ref_sources.rows).toHaveLength(1);
    expect(w.t.style_ref_sources.rows[0]).toMatchObject({ id: src.id, origin: 'own', created_by: OWNER });
    expect(w.t.style_references.rows.filter((r) => ids.includes(r.id)).map((r) => r.origin)).toEqual(['own', 'own']);
    // as novas que o sync trouxe também são próprias
    expect(w.t.style_references.rows.every((r) => r.origin === 'own')).toBe(true);
    // e a reconciliação não mexe mais nela (nem a recria como da Seleção)
    await w.svc.reconcileSelection(WS, BRAND);
    expect(w.t.style_ref_sources.rows.filter((s) => s.rss_url === rssOf(ACAI[0]!))).toEqual([expect.objectContaining({ origin: 'own' })]);
  });

  it('colar a pasta da Seleção com 5 pastas próprias: 400 de hoje e a pasta continua da Seleção', async () => {
    const w = await world(KEY, 0, 0);
    for (let i = 0; i < 5; i++) await folder(w, `https://www.pinterest.com/user${i}/pasta${i}/`, 'own');
    const sel = await folder(w, ACAI[0]!, 'selection');
    expect(await status(w.svc.addPinterest(OWNER, WS, BRAND, ACAI[0]!))).toBe('400:Você já acompanha 5 pastas nesta marca. Pare uma para pôr outra.');
    expect(w.t.style_ref_sources.rows.find((s) => s.id === sel.src.id)!.origin).toBe('selection');
  });

  it('o teto de 5 pastas conta só as próprias: com 3 da Seleção a 5ª própria entra e a 6ª não', async () => {
    const w = await world(KEY, 0, 0);
    for (const u of [...BAR]) await folder(w, u, 'selection');
    for (let i = 0; i < 4; i++) await folder(w, `https://www.pinterest.com/user${i}/pasta${i}/`, 'own');
    w.routes.set(rssOf('https://www.pinterest.com/novo5/pasta5/'), () => new Response(RSS, { status: 200 }));
    w.routes.set(rssOf('https://www.pinterest.com/novo6/pasta6/'), () => new Response(RSS, { status: 200 }));
    expect(await status(w.svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/novo5/pasta5/'))).toBe('ok');
    expect(await status(w.svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/novo6/pasta6/'))).toBe('400:Você já acompanha 5 pastas nesta marca. Pare uma para pôr outra.');
  });

  it('list: origin nos itens, in_brand só das próprias e in_selection das da Seleção', async () => {
    const w = await world(KEY, 2, 0);
    await folder(w, ACAI[0]!, 'selection', 3);
    await folder(w, 'https://www.pinterest.com/meu/minha/', 'own', 1);
    const l = await w.svc.list(OWNER, WS, BRAND);
    expect(l.limits).toMatchObject({ in_brand: 3, in_selection: 3, brand: 30 });
    expect(l.refs.filter((r) => r.origin === 'selection')).toHaveLength(3);
    expect(l.refs.filter((r) => r.origin === 'own')).toHaveLength(3);
    expect(l.sources.map((s) => s.origin).sort()).toEqual(['own', 'selection']);
    expect(l.sources.find((s) => s.origin === 'selection')!.refs_count).toBe(3);
  });

  it('list com a Seleção desligada: esconde pastas e referências da Seleção, in_selection = 0, in_brand só próprias', async () => {
    const w = await world({ env: { STYLE_REFS_PINTEREST_ENABLED: true, STYLE_LIBRARY_ENABLED: false } }, 2, 0);
    await folder(w, ACAI[0]!, 'selection', 3);
    await folder(w, 'https://www.pinterest.com/meu/minha/', 'own', 1);
    const l = await w.svc.list(OWNER, WS, BRAND);
    expect(l.refs.every((r) => r.origin === 'own')).toBe(true);
    expect(l.refs).toHaveLength(3);
    expect(l.sources.map((s) => s.origin)).toEqual(['own']);
    expect(l.limits).toMatchObject({ in_brand: 3, in_selection: 0 });
  });

  it('isolamento: reconcileSelection e list só consultam com o workspace_id da empresa (as outras empresas ficam intactas)', async () => {
    const w = await world(KEY, 1, 1);
    await w.t.brands.create({ data: { id: OTHER_BRAND, workspace_id: OTHER_WS, name: 'B', segment: 'Açaiteria' } });
    await w.t.style_ref_sources.create({ data: { workspace_id: OTHER_WS, brand_id: OTHER_BRAND, url: BAR[0], rss_url: rssOf(BAR[0]!), origin: 'selection' } });
    const theirs = await refs(w.t, OTHER_WS, OTHER_BRAND, 'selection', 2);
    await folder(w, BAR[1]!, 'selection', 1); // sobra do ramo velho: sai
    const seen = spy(w.t);
    await w.svc.reconcileSelection(WS, BRAND);
    await w.svc.list(OWNER, WS, BRAND);
    expect(seen.length).toBeGreaterThan(8);
    for (const s of seen) expect([s.table, s.fn, s.ws]).toEqual([s.table, s.fn, WS]);
    expect(w.t.style_ref_sources.rows.filter((s) => s.workspace_id === OTHER_WS)).toHaveLength(1);
    expect(w.t.style_references.rows.filter((r) => theirs.includes(r.id))).toHaveLength(2);
    expect(w.t.brands.rows.find((b) => b.id === OTHER_BRAND)!.style_library_checked_at).toBeNull();
  });
});

describe('Seleção — rodada 1 de correção (18a)', () => {
  it('reconcileSelection → refreshDueSources → whenIdle: o RSS é buscado UMA vez (a 2ª pasta espera as leituras) e o seen_pin_ids guarda os Pins que entraram', async () => {
    const w = await world(KEY, 0, 0);
    w.svc.autoProcess = true;
    for (const u of ACAI) w.routes.set(rssOf(u), () => new Response(RSS, { status: 200 }));
    w.routes.set('https://i.pinimg.com/736x/9a/95/b6/9a95b6ef9aa358907c5947e6f80eb86f.jpg', w.image);
    w.routes.set('https://i.pinimg.com/736x/dc/b0/fb/dcb0fb8eefbe6f3549ee942c86557393.jpg', w.image);
    await w.svc.reconcileSelection(WS, BRAND);
    await w.svc.refreshDueSources(5);
    await w.svc.whenIdle();
    // 18b: só a 1ª pasta busca o RSS; a 2ª espera (há leitura da Seleção em curso)
    expect(w.fetched.filter((u) => u.endsWith('.rss'))).toEqual([rssOf(ACAI[0]!)]);
    // a 1ª precisa ter guardado os Pins dela
    expect(w.t.style_ref_sources.rows.some((s) => s.seen_pin_ids.length > 0)).toBe(true);
  });

  it('refreshDueSources pula pasta que sumiu, que já foi renovada ou que é da Seleção com a Seleção desligada', async () => {
    const w = await world({ env: ON }, 0, 0);
    const gone = await folder(w, ACAI[0]!, 'selection');
    const fresh = await folder(w, ACAI[1]!, 'selection', 0, { last_synced_at: new Date() });
    const orig = w.t.style_ref_sources.findMany.bind(w.t.style_ref_sources);
    // o job leu as duas como vencidas; antes de a vez chegar, uma sumiu e a outra foi renovada
    w.t.style_ref_sources.findMany = async (a: any) => !a.take ? orig(a) : (await orig(a)).concat([{ ...gone.src }, { ...fresh.src, last_synced_at: null }]).filter((r: any, i: number, arr: any[]) => arr.findIndex((x) => x.id === r.id) === i);
    await w.t.style_ref_sources.deleteMany({ where: { id: gone.src.id } });
    await w.svc.refreshDueSources(5);
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it('o carimbo style_library_checked_at é gravado no INÍCIO: erro depois (cofre) não deixa a marca no topo da fila', async () => {
    const w = await world({ env: ON }, 0, 0);
    w.keys.get.mockImplementation(async () => { throw new Error('cofre caiu'); });
    await expect(w.svc.reconcileSelection(WS, BRAND)).rejects.toThrow('cofre caiu');
    expect(w.t.brands.rows[0]!.style_library_checked_at).toBeInstanceOf(Date);
  });

  it('chave gravada no meio da reconciliação (markSelectionDue): o checked_at continua nulo e o job volta a pegar a marca', async () => {
    const w = await world({ env: ON }, 0, 0);
    w.keys.get.mockImplementation(async () => { await w.svc.markSelectionDue(WS); return null; });
    await w.svc.reconcileSelection(WS, BRAND);
    expect(w.t.brands.rows[0]!.style_library_checked_at).toBeNull();
    expect(await w.svc.reconcileDueBrands()).toBe(1);
  });

  it('a chave da fila é em minúsculas: uuid em maiúsculas espera a mesma fila', async () => {
    const w = await world(KEY, 0, 0);
    expect((w.svc as any).queueKey('AAAA-bbbb', 'CCCC-dddd')).toBe('aaaa-bbbb:cccc-dddd');
  });

  it('promover o Pin da Seleção não espera a fila da marca (updateMany atômico)', async () => {
    const w = await world(KEY, 0, 0);
    const { ids } = await folder(w, ACAI[0]!, 'selection', 1);
    await w.t.style_references.update({ where: { id: ids[0] }, data: { pin_id: '555' } });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const busy = (w.svc as any).queue.run(`${WS}:${BRAND}`, () => gate);
    const out: any = await w.svc.addPinterest(OWNER, WS, BRAND, 'https://www.pinterest.com/pin/555/'); // se esperasse a fila, travaria aqui
    expect(out.promoted).toBe(true);
    expect(w.t.style_references.rows[0]).toMatchObject({ origin: 'own', source_id: null });
    release();
    await busy;
  });

  /** Corrida: o Pin é promovido (mesmo updateMany da promoção) logo depois de a pasta ler as referências dela. */
  function promoteAfterRead(w: Awaited<ReturnType<typeof world>>, pinRef: string) {
    const orig = w.t.style_references.findMany.bind(w.t.style_references);
    let done = false;
    w.t.style_references.findMany = async (a: any) => {
      const rows = await orig(a);
      if (!done && a?.where?.source_id) {
        done = true;
        await w.t.style_references.updateMany({ where: { id: pinRef, workspace_id: WS, origin: 'selection' }, data: { origin: 'own', source_id: null } });
      }
      return rows;
    };
  }

  it('reconciliação × promoção do Pin no meio: o Pin promovido e o arquivo dele ficam', async () => {
    const w = await world(KEY, 0, 0);
    const { src, ids } = await folder(w, ACAI[0]!, 'selection', 2);
    promoteAfterRead(w, ids[0]!);
    await w.t.brands.update({ where: { id: BRAND }, data: { style_library_segment: 'none' } });
    await w.svc.reconcileSelection(WS, BRAND);
    expect(w.t.style_references.rows.map((r) => r.id)).toEqual([ids[0]]);
    expect([...w.files.keys()]).toEqual([`style-refs/${WS}/${BRAND}/${src.id}-0.jpg`]);
  });

  it('removeSource × promoção do Pin no meio: o Pin promovido e o arquivo dele ficam', async () => {
    const w = await world(KEY, 0, 0);
    const { src, ids } = await folder(w, ACAI[0]!, 'own', 2);
    await w.t.style_references.updateMany({ where: { id: ids[0] }, data: { origin: 'selection' } }); // o Pin veio da Seleção, a pasta é própria
    promoteAfterRead(w, ids[0]!);
    await w.svc.removeSource(OWNER, WS, BRAND, src.id);
    expect(w.t.style_references.rows.map((r) => r.id)).toEqual([ids[0]]);
    expect(w.files.has(`style-refs/${WS}/${BRAND}/${src.id}-0.jpg`)).toBe(true);
  });
});

// ── Task 18b: sincronização da Seleção (tetos, cota do dia, chave em apuros) e leitura só com a chave da empresa ────────────────────
type W = Awaited<ReturnType<typeof world>>;
const today = () => new Date(`${todaySp()}T00:00:00Z`);
const dayOf = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : null);
const rssCalls = (w: W) => w.fetched.filter((u) => u.endsWith('.rss'));

/** Pasta com RSS de 25 Pins (`<tag>0`…`<tag>24`) e as imagens deles no servidor falso. */
function feed(w: W, tag: string, n = 25) {
  const url = `https://www.pinterest.com/u${tag}/b${tag}/`;
  const items = Array.from({ length: n }, (_, i) => `<item><title>Pin ${tag}${i}</title><link>https://www.pinterest.com/pin/${tag}${i}/</link><description>&lt;img src=&quot;https://i.pinimg.com/236x/${tag}/${i}.jpg&quot;&gt;</description></item>`).join('');
  w.routes.set(rssOf(url), () => new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>Pasta ${tag}</title>${items}</channel></rss>`, { status: 200 }));
  for (let i = 0; i < n; i++) w.routes.set(`https://i.pinimg.com/736x/${tag}/${i}.jpg`, w.image);
  return url;
}

/** Só esta pasta fica vencida; roda o job e lê as pendentes (um ciclo do dia a dia). */
async function cycle(w: W, srcId: string) {
  for (const r of w.t.style_ref_sources.rows) r.last_synced_at = r.id === srcId ? null : new Date();
  await w.svc.refreshDueSources(5);
  await w.svc.processPending(10);
}

/** Referências pendentes (`processing`) com arquivo guardado, para o `processPending`. */
async function pending(w: W, origin: 'own' | 'selection', n: number, tag: string, over: Record<string, unknown> = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const path = `${WS}/${BRAND}/${tag}-${i}.jpg`;
    w.files.set(`style-refs/${path}`, new Uint8Array(w.img));
    ids.push((await w.t.style_references.create({ data: { workspace_id: WS, brand_id: BRAND, status: 'processing', origin, storage_path: path, source: 'pinterest', ...over } })).id);
  }
  return ids;
}

describe('Seleção — sincronização da pasta (18b)', () => {
  it('1º sync: até 4 por pasta, origem selection, sem makeRoom; a cota do dia guarda o dia de Brasília e as 4 lidas', async () => {
    const w = await world(KEY, 1, 0);
    const a = await folder(w, feed(w, 'a'), 'selection');
    expect(await w.svc.refreshDueSources(5)).toBe(1);
    const mine = w.t.style_references.rows.filter((r) => r.source_id === a.src.id);
    expect(mine).toHaveLength(4);
    expect(mine.every((r) => r.origin === 'selection' && r.status === 'processing')).toBe(true);
    expect(rssCalls(w)).toHaveLength(1);
    const brand = w.t.brands.rows[0]!;
    expect(dayOf(brand.style_selection_day)).toBe(todaySp());
    expect(brand.style_selection_reads).toBe(4);
    expect(w.t.style_ref_sources.rows[0]!.seen_pin_ids).toHaveLength(4);
    expect(w.t.style_references.rows.filter((r) => r.origin === 'own')).toHaveLength(1);
  });

  it('3 pastas → 12 (um ciclo de leitura por pasta); uma 4ª pasta criada à mão não passa de 12 e nem busca o RSS', async () => {
    const w = await world(KEY, 1, 0);
    const srcs = [];
    for (const tag of ['a', 'b', 'c']) srcs.push((await folder(w, feed(w, tag), 'selection')).src);
    for (const s of srcs) await cycle(w, s.id);
    const sel = () => w.t.style_references.rows.filter((r) => r.origin === 'selection');
    expect(sel()).toHaveLength(12);
    expect(sel().every((r) => r.status === 'ready')).toBe(true);
    expect(w.t.brands.rows[0]!.style_selection_reads).toBe(12);
    const d = await folder(w, feed(w, 'd'), 'selection');
    const before = rssCalls(w).length;
    await cycle(w, d.src.id);
    expect(rssCalls(w)).toHaveLength(before); // vaga 0: sem rede
    expect(sel()).toHaveLength(12);
    expect(w.t.style_ref_sources.rows.find((s) => s.id === d.src.id)!.last_synced_at).toBeInstanceOf(Date);
  });

  it('cota: com 10 leituras hoje só entram 2; em outro dia volta a 12 (4 por pasta); ligar/desligar a marca não zera', async () => {
    const w = await world(KEY, 1, 0);
    const a = await folder(w, feed(w, 'a'), 'selection');
    await w.t.brands.update({ where: { id: BRAND }, data: { style_selection_day: today(), style_selection_reads: 10 } });
    await cycle(w, a.src.id);
    expect(w.t.style_references.rows.filter((r) => r.origin === 'selection')).toHaveLength(2);
    expect(w.t.brands.rows[0]!.style_selection_reads).toBe(12);
    // ligar/desligar e reconciliar não mexem na cota
    await w.t.brands.update({ where: { id: BRAND }, data: { style_library_enabled: false } });
    await w.svc.reconcileSelection(WS, BRAND);
    await w.t.brands.update({ where: { id: BRAND }, data: { style_library_enabled: true } });
    await w.svc.reconcileSelection(WS, BRAND);
    expect(w.t.brands.rows[0]!.style_selection_reads).toBe(12);
    expect(dayOf(w.t.brands.rows[0]!.style_selection_day)).toBe(todaySp());
    // amanhã (dia diferente do gravado): a cota volta
    await w.t.style_references.deleteMany({ where: { origin: 'selection' } });
    await w.t.brands.update({ where: { id: BRAND }, data: { style_selection_day: new Date('2020-01-01T00:00:00Z'), style_selection_reads: 12 } });
    const b = await folder(w, feed(w, 'b'), 'selection');
    await cycle(w, b.src.id);
    expect(w.t.style_references.rows.filter((r) => r.origin === 'selection' && r.source_id === b.src.id)).toHaveLength(4);
    expect(w.t.brands.rows[0]!.style_selection_reads).toBe(4);
    expect(dayOf(w.t.brands.rows[0]!.style_selection_day)).toBe(todaySp());
  });

  it('não gira: com 12 da Seleção o sync não busca o RSS e não tira nenhuma', async () => {
    const w = await world(KEY, 1, 12);
    const a = await folder(w, feed(w, 'a'), 'selection');
    const ids = w.t.style_references.rows.filter((r) => r.origin === 'selection').map((r) => r.id);
    await cycle(w, a.src.id);
    expect(rssCalls(w)).toEqual([]);
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.t.style_references.rows.filter((r) => r.origin === 'selection').map((r) => r.id)).toEqual(ids);
  });

  it('total: com 28 próprias (de campanha) a Seleção só põe 2 e nunca tira própria', async () => {
    const w = await world(KEY, 0, 0);
    const own = await refs(w.t, WS, BRAND, 'own', 28, { campaign_id: CAMP });
    const a = await folder(w, feed(w, 'a'), 'selection');
    await cycle(w, a.src.id);
    const rows = w.t.style_references.rows;
    expect(rows.filter((r) => r.origin === 'selection')).toHaveLength(2);
    expect(rows.filter((r) => r.origin === 'own').map((r) => r.id).sort()).toEqual([...own].sort());
    expect(rows).toHaveLength(30);
  });

  it('só quando útil: com 4 próprias prontas, ou 3 prontas + 1 lendo, não busca o RSS', async () => {
    for (const lendo of [false, true]) {
      const w = await world(KEY, lendo ? 3 : 4, 0);
      if (lendo) await refs(w.t, WS, BRAND, 'own', 1, { status: 'processing' });
      const a = await folder(w, feed(w, 'a'), 'selection');
      await cycle(w, a.src.id);
      expect(rssCalls(w)).toEqual([]);
      expect(w.t.style_references.rows.filter((r) => r.origin === 'selection')).toHaveLength(0);
      expect(w.t.style_ref_sources.rows[0]!.last_synced_at).toBeInstanceOf(Date);
    }
  });

  it('não busca o RSS sem chave, com alerta de crédito ou com uma da Seleção lendo (só grava last_synced_at)', async () => {
    const semChave = await world({ env: ON }, 1, 0);
    const comAlerta = await world({ env: ON, aiKey: 'sk', aiCredit: 'no_credit' }, 1, 0);
    const lendo = await world(KEY, 1, 0);
    await refs(lendo.t, WS, BRAND, 'selection', 1, { status: 'processing' });
    for (const w of [semChave, comAlerta, lendo]) {
      const a = await folder(w, feed(w, 'a'), 'selection');
      await w.svc.refreshDueSources(5);
      expect(rssCalls(w)).toEqual([]);
      expect(w.t.style_ref_sources.rows.find((s) => s.id === a.src.id)!.last_synced_at).toBeInstanceOf(Date);
      expect(w.t.style_references.rows.filter((r) => r.origin === 'selection' && r.status === 'ready')).toHaveLength(0);
    }
    expect(semChave.t.style_references.rows.filter((r) => r.origin === 'selection')).toHaveLength(0);
    expect(comAlerta.t.style_references.rows.filter((r) => r.origin === 'selection')).toHaveLength(0);
    expect(lendo.t.style_references.rows.filter((r) => r.origin === 'selection')).toHaveLength(1);
  });

  it('marca sumiu ou interruptor desligado: só grava last_synced_at e devolve 0 (sem rede)', async () => {
    const w = await world(KEY, 1, 0);
    const a = await folder(w, feed(w, 'a'), 'selection');
    await w.t.brands.update({ where: { id: BRAND }, data: { style_library_enabled: false } });
    expect(await (w.svc as any).sync(a.src)).toBe(0);
    expect(rssCalls(w)).toEqual([]);
    expect(w.t.style_ref_sources.rows[0]!.last_synced_at).toBeInstanceOf(Date);
    await w.t.brands.deleteMany({ where: { id: BRAND } });
    expect(await (w.svc as any).sync(a.src)).toBe(0);
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it('falha definitiva sai (linha + arquivo) e o Pin não volta; a transitória esgotada volta para a fila só sem alerta', async () => {
    const w = await world(KEY, 1, 0);
    const a = await folder(w, feed(w, 'a'), 'selection', 3, { seen_pin_ids: ['a0'] });
    const [def, trans, ok] = a.ids as [string, string, string];
    await w.t.style_references.updateMany({ where: { id: def }, data: { status: 'failed', attempts: 1, pin_id: 'a0', error: 'x' } });
    await w.t.style_references.updateMany({ where: { id: trans }, data: { status: 'failed', attempts: 3, error: 'Não conseguimos ler o estilo desta referência. Remova e tente outra.', claimed_at: new Date() } });
    // com alerta de crédito: a definitiva sai, a transitória fica
    w.alerts.status.mockResolvedValue({ level: 'stopped', vendors: [{ reason: 'no_credit' }] });
    await cycle(w, a.src.id);
    expect(w.t.style_references.rows.filter((r) => r.origin === 'selection').map((r) => r.id).sort()).toEqual([trans, ok].sort());
    expect(w.files.has(`style-refs/${WS}/${BRAND}/${a.src.id}-0.jpg`)).toBe(false);
    expect(w.t.style_references.rows.find((r) => r.id === trans)).toMatchObject({ status: 'failed', attempts: 3 });
    // sem alerta: volta para a fila (zerada)
    w.alerts.status.mockResolvedValue(null);
    await w.svc.refreshDueSources(5); // pasta já renovada hoje: o `syncIfDue` pula; força pelo sync direto
    await (w.svc as any).sync(w.t.style_ref_sources.rows[0]!);
    expect(w.t.style_references.rows.find((r) => r.id === trans)).toMatchObject({ status: 'processing', attempts: 0, claimed_at: null, error: null });
    // o Pin da definitiva nunca volta, mesmo com vaga
    await w.t.style_references.updateMany({ where: { id: trans }, data: { status: 'ready' } });
    await w.t.style_references.updateMany({ where: { id: ok }, data: { status: 'ready' } });
    await (w.svc as any).sync(w.t.style_ref_sources.rows[0]!);
    expect(w.t.style_references.rows.some((r) => r.pin_id === 'a0')).toBe(false);
    expect(w.t.style_references.rows.filter((r) => r.pin_id && r.source_id === a.src.id).length).toBeGreaterThan(0);
  });

  it('própria nova com a marca cheia (30) tira a da Seleção mais antiga antes de qualquer própria vinda de pasta', async () => {
    const w = await world(KEY, 0, 0);
    const f = await folder(w, feed(w, 'o'), 'own', 10); // próprias de pasta, as mais antigas
    const s = await folder(w, feed(w, 'a'), 'selection', 20);
    expect(w.t.style_references.rows).toHaveLength(30);
    await w.svc.upload(OWNER, WS, BRAND, { bytes: w.img, mime: 'image/png' });
    const ids = w.t.style_references.rows.map((r) => r.id);
    expect(ids).toHaveLength(30);
    for (const id of f.ids) expect(ids).toContain(id);
    expect(ids).not.toContain(s.ids[0]);
    expect(ids).toContain(s.ids[1]);
    expect(w.files.has(`style-refs/${WS}/${BRAND}/${s.src.id}-0.jpg`)).toBe(false);
  });

  it('sem nenhuma da Seleção, a própria nova tira a própria de pasta mais antiga, como antes', async () => {
    const w = await world(KEY, 0, 0);
    const f = await folder(w, feed(w, 'o'), 'own', 30);
    await w.svc.upload(OWNER, WS, BRAND, { bytes: w.img, mime: 'image/png' });
    const ids = w.t.style_references.rows.map((r) => r.id);
    expect(ids).not.toContain(f.ids[0]);
    expect(ids).toContain(f.ids[1]);
    expect(ids).toHaveLength(30);
  });

  it('pasta apagada no meio do sync (updateMany → 0): as referências e os arquivos criados na rodada somem e a cota não conta', async () => {
    const w = await world(KEY, 1, 0);
    const a = await folder(w, feed(w, 'a'), 'selection');
    const orig = w.t.style_ref_sources.updateMany.bind(w.t.style_ref_sources);
    w.t.style_ref_sources.updateMany = async (args: any) => {
      if (args?.data?.seen_pin_ids) await w.t.style_ref_sources.deleteMany({ where: { id: a.src.id } });
      return orig(args);
    };
    expect(await (w.svc as any).sync(a.src)).toBe(0);
    expect(w.t.style_references.rows.filter((r) => r.origin === 'selection')).toEqual([]);
    expect([...w.files.keys()]).toEqual([]);
    expect(w.t.brands.rows[0]!.style_selection_reads).toBe(0);
  });

  it('processPending(10) com 12 da Seleção pendentes (mais antigas) e 1 própria nova: a própria é lida nesta rodada; a da Seleção vai com ownKeysOnly', async () => {
    const w = await world(KEY, 0, 0);
    const sel = await pending(w, 'selection', 12, 'sel');
    const [own] = await pending(w, 'own', 1, 'own');
    expect(await w.svc.processPending(10)).toBe(10);
    expect(w.t.style_references.rows.find((r) => r.id === own)!.status).toBe('ready');
    const reqs = w.ai.json.mock.calls.map((c: any) => c[1]);
    expect(reqs).toHaveLength(10);
    expect(reqs[0].ownKeysOnly).toBeFalsy();
    expect(reqs.slice(1).every((r: any) => r.ownKeysOnly === true)).toBe(true);
    expect(w.t.style_references.rows.filter((r) => sel.includes(r.id) && r.status === 'ready')).toHaveLength(9);
  });

  it('processPending com a Seleção desligada: nenhuma da Seleção é lida', async () => {
    const w = await world({ env: { STYLE_REFS_PINTEREST_ENABLED: true, STYLE_LIBRARY_ENABLED: false }, aiKey: 'sk' }, 0, 0);
    await pending(w, 'selection', 3, 'sel');
    const [own] = await pending(w, 'own', 1, 'own');
    expect(await w.svc.processPending(10)).toBe(1);
    expect(w.ai.json).toHaveBeenCalledTimes(1);
    expect(w.t.style_references.rows.filter((r) => r.status === 'ready').map((r) => r.id)).toEqual([own]);
  });

  it('refreshDueSources(5) com 200 pastas em dia e 1 vencida: renova a vencida; a nunca sincronizada vem antes', async () => {
    const w = await world({ env: ON }, 0, 0);
    for (let i = 0; i < 200; i++) await w.t.style_ref_sources.create({ data: { workspace_id: WS, brand_id: BRAND, url: `https://www.pinterest.com/e${i}/p${i}/`, rss_url: `https://www.pinterest.com/e${i}/p${i}.rss`, origin: 'own', last_synced_at: new Date() } });
    const old = await folder(w, 'https://www.pinterest.com/velha/p/', 'own', 0, { last_synced_at: hours(25) });
    expect(await w.svc.refreshDueSources(5)).toBe(1);
    expect(rssCalls(w)).toEqual([old.src.rss_url]);
    const nova = await folder(w, 'https://www.pinterest.com/nova/p/', 'own');
    w.t.style_ref_sources.rows.find((r) => r.id === old.src.id)!.last_synced_at = hours(25);
    w.fetched.length = 0;
    expect(await w.svc.refreshDueSources(5)).toBe(2);
    expect(rssCalls(w)).toEqual([nova.src.rss_url, old.src.rss_url]);
  });
});
