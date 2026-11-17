import { Logger } from '@nestjs/common';
import { todaySp } from '../../../common/time/dates';
import { SELECTION_OPTIONS } from '../selection-catalog';
import { BRAND, OWNER, setup, status, VIEWER, WS } from './style-world';

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
