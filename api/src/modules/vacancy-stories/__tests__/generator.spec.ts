jest.setTimeout(120_000);

import { VendorKeyError, vendorMessage } from '../../ai/ai.service';
import { RefsService } from '../../creative/refs.service';
import { uuid } from '../../instagram/__tests__/harness';
import { AssetsService } from '../../media/assets.service';
import { WS_A } from '../../media/__tests__/mem';
import { VacancyGeneratorService, photoTexts } from '../vacancy-generator.service';
import { photoPrompt, readPrompt } from '../vacancy-prompts';
import { DISABLED_REASON, WAIT_CAP } from '../vacancy-reasons';
import { SKIP } from '../vacancy-triage';
import { fingerprint, vacancyFields } from '../vacancy-text';
import type { ArtRead, FreelaVacancy, SettingsRow, StoryRow } from '../vacancy-types';
import { vacancyWorld, type VacancyWorld } from './world';

const NOW = new Date('2026-10-29T13:00:00Z'); // quinta, 10h em Brasília
const MIN = 60_000;
const NO_IG = 'Esperando o Instagram ser reconectado para criar a arte.';
const CLOSED = 'A vaga não está mais aberta no Freela (preenchida ou cancelada).';
const NO_CREDIT = vendorMessage('openai', 'noCredit');
/** Textos lidos da arte modelo do dono (endereço, região e valores de outra vaga). */
const TEMPLATE_TEXTS = ['VAGA FREELA', 'Frutá', 'Rio abaixo', 'Itupeva/SP', 'R$ 95,95', 'Estrada Joaquim Bueno Neto, 1000', 'Baixe nosso app'];
const ALL_KEYS = ['cidade', 'data', 'estabelecimento', 'fim', 'funcao', 'inicio', 'valor'];

/** Sábado 31/10, 18h às 23h em Brasília, Coco Bambu em Campinas, R$ 150. */
const vac = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: uuid(), title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-10-31',
  startTime: '2026-10-31T21:00:00Z', endTime: '2026-11-01T02:00:00Z', amountInCents: 15000,
  contractorName: 'COCO BAMBU', publishedAt: '2026-10-29T10:00:00Z', ...o,
});

/** Leitura às cegas da foto da IA: limpa (sem texto) ou com os textos de `extra` (placa, fachada, logo). */
function readFor(_v: FreelaVacancy, extra: string[] = []): ArtRead {
  return { textos: [...extra], funcao: null, estabelecimento: null, data: null, inicio: null, fim: null, valor: null, cidade: null };
}
const SIGN = 'Estrada Joaquim Bueno Neto, 9999';

let w: VacancyWorld;
afterEach(() => w?.cleanup());

async function setup(o: { settings?: Record<string, unknown>; ig?: boolean } = {}) {
  w = vacancyWorld();
  const assets = new AssetsService(w.prisma, w.files, w.images, jest.fn() as never, w.env);
  const refs = new RefsService(w.prisma, w.files, assets, w.images);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gen = new VacancyGeneratorService(w.prisma, w.ai as any, w.images, w.files, assets, refs, w.store, w.feedClient, w.gate);
  /** Relógio dos leases (a IA falsa pode avançá-lo no meio da geração). */
  const clock = { t: NOW.getTime() };
  gen.now = () => clock.t;
  const brand = w.brand({ primary_color: '#c2410c' });
  const key = `brands/${WS_A}/${uuid()}.png`;
  await w.files.put('creative-assets', key, await w.images.encode(w.images.blank(600, 900, 0xffd400ff), true));
  const template = { id: uuid(), workspace_id: WS_A, brand_id: brand.id, kind: 'vacancy_template', name: 'modelo.png', url: 'https://cdn.test/modelo.png', storage_path: key, created_at: new Date() };
  w.t['brand_assets']!.rows.push(template);
  await w.prisma.vacancy_story_settings.create({
    data: {
      workspace_id: WS_A, enabled: true, enabled_at: new Date('2026-10-29T09:00:00Z'), brand_id: brand.id, template_asset_id: template.id,
      template_texts: TEMPLATE_TEXTS, template_bg: '#ffd400', vendor: 'openai', ...o.settings,
    },
  });
  if (o.ig !== false) w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, status: 'connected', ig_user_id: '17841', username: 'freela' });
  /** Linha na fila para a vaga `v` (a vitrine responde `v` no `byId`). */
  const story = async (v: FreelaVacancy, over: Record<string, unknown> = {}) => {
    w.feed.state.byId.set(v.id, v);
    return w.prisma.vacancy_stories.create({
      data: { workspace_id: WS_A, external_id: v.id, snapshot: v, fingerprint: fingerprint(v), starts_at: new Date(v.startTime), status: 'new', ...over },
    });
  };
  const settings = () => w.t['vacancy_story_settings']!.rows.find((r) => r.workspace_id === WS_A) as SettingsRow;
  const row = (id: string) => w.t['vacancy_stories']!.rows.find((r) => r.id === id)!;
  const posts = () => w.t['ig_posts']!.rows;
  const mediaRows = () => w.t['media_assets']!.rows;
  const imageCalls = () => w.ai.image.mock.calls.map((c) => c[1]);
  const readCalls = () => w.ai.json.mock.calls.map((c) => c[1]).filter((r) => r.name === 'vacancy_art_read');
  return { gen, clock, assets, template, story, settings, row, posts, mediaRows, imageCalls, readCalls };
}

describe('VacancyGeneratorService.generateDue', () => {
  it('aprovada de primeira, modo "aprovar": post pending_approval de vaga, mídia 1080×1920, linha entregue', async () => {
    const t = await setup({ settings: { ai_error: 'Sua conta OpenAI está sem créditos.', ai_error_at: new Date('2026-10-29T12:00:00Z') } });
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v)] });
    const after = jest.fn(async () => undefined);
    t.gen.hooks.afterHandOff = after;

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 1, handed: 1, waiting: 0, cancelled: 0 });

    expect(t.posts()).toHaveLength(1);
    const post = t.posts()[0]!;
    expect(post).toMatchObject({
      workspace_id: WS_A, format: 'story_image', source: 'vacancy', status: 'pending_approval', automation: null, plan_id: null, run_id: null,
      theme: 'Vaga · Garçom · Coco Bambu · Sáb 31/10', caption: null, hashtags: [], ai_provider: 'chatgpt',
    });
    expect(post.creative_brief.compose).toBe(false);
    expect(post.creative_brief.vacancy).toMatchObject({
      story_id: r0.id, external_id: v.id, fingerprint: fingerprint(v), requires_approval: true, attempts: 1, used_fallback: false, starts_at: v.startTime,
      check_alert: null, check_unread: false,
    });
    expect([...post.creative_brief.vacancy.checked_fields].sort()).toEqual(ALL_KEYS);
    expect(post.ai_generation_log).toEqual([{ at: expect.any(String), step: 'vacancy_art', attempt: 1, ok: true, wrong: [], fallback: false }]);

    expect(post.media).toHaveLength(1);
    expect(post.media[0]).toMatchObject({ type: 'image', order: 0, width: 1080, height: 1920, ig_ready: true });
    const asset = t.mediaRows().find((a) => a.id === post.media[0].asset_id)!;
    expect(asset).toMatchObject({ source: 'chatgpt', target_format: 'ig_story', width: 1080, height: 1920, ig_ready: true, ig_post_id: post.id, title: post.theme });

    expect(t.row(r0.id)).toMatchObject({
      status: 'handed_off', ig_post_id: post.id, lease_until: null, used_fallback: false, mismatch_attempts: 0, template_asset_id: t.template.id,
    });
    expect(t.row(r0.id).attempts_log).toEqual([{ n: 1, at: expect.any(String), kind: 'ai', ok: true, wrong: [], forbidden: [] }]);
    expect(t.settings()).toMatchObject({ ai_error: null, ai_error_at: null });
    expect(after).toHaveBeenCalledWith(WS_A, post.id);

    // A IA só faz a foto (quadrada, sem referência, sem dado da vaga além da função); todo texto é do sistema.
    expect(t.imageCalls()).toHaveLength(1);
    const img = t.imageCalls()[0];
    expect(img).toMatchObject({ aspectRatio: '1:1', vendor: 'openai', strict: true, prompt: photoPrompt('Garçom') });
    expect(img.referenceImages).toBeUndefined();
    // Leitura às cegas da foto: nenhum valor esperado no prompt.
    expect(t.readCalls()).toHaveLength(1);
    const read = t.readCalls()[0];
    expect(read.prompt).toBe(readPrompt());
    for (const value of ['Garçom', 'R$ 150', '150', 'Coco Bambu', 'Campinas', '31/10', '18h', '23h']) expect(read.prompt).not.toContain(value);
  });

  it('foto com placa na 1ª e limpa na 2ª: 2 fotos, 2 leituras, arte com foto', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v, [SIGN]), readFor(v)] });

    expect(await t.gen.generateDue(NOW)).toMatchObject({ started: 1, handed: 1 });

    expect(t.imageCalls()).toHaveLength(2);
    expect(t.readCalls()).toHaveLength(2);
    const row = t.row(r0.id);
    expect(row.attempts_log).toHaveLength(2);
    expect(row.attempts_log[0]).toMatchObject({ n: 1, kind: 'ai', ok: false, wrong: [], forbidden: [SIGN] });
    expect(row.attempts_log[1]).toMatchObject({ n: 2, kind: 'ai', ok: true });
    expect(row).toMatchObject({ status: 'handed_off', mismatch_attempts: 1, used_fallback: false });
    const post = t.posts()[0]!;
    expect(post.creative_brief.vacancy).toMatchObject({ attempts: 2, used_fallback: false });
    expect(post.ai_generation_log.map((x: { ok: boolean }) => x.ok)).toEqual([false, true]);
  });

  it('R28: mismatch_attempts é o contador ao vivo — zera ao pegar a linha, anda 0→1 e a entrega grava o final', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v, { status: 'waiting', mismatch_attempts: 2 });
    await w.programArt({ reads: [readFor(v, [SIGN])] });
    const seen: number[] = [];
    const draw = w.ai.image.getMockImplementation()!;
    w.ai.image.mockImplementation(async (...a) => {
      seen.push(t.row(r0.id).mismatch_attempts);
      return draw(...a);
    });

    expect(await t.gen.generateDue(NOW)).toMatchObject({ started: 1, handed: 1 });
    expect(seen).toEqual([0, 1]);
    expect(t.row(r0.id)).toMatchObject({ status: 'handed_off', used_fallback: true, mismatch_attempts: 2 });
  });

  it('foto com texto nas 2 tentativas → a mesma arte sem foto; no modo sozinho vai a ready (todo texto é do sistema)', async () => {
    const t = await setup({ settings: { auto_publish: true } });
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v, [SIGN])] });

    expect(await t.gen.generateDue(NOW)).toMatchObject({ started: 1, handed: 1 });

    expect(t.imageCalls()).toHaveLength(2);
    expect(t.readCalls()).toHaveLength(2);
    const row = t.row(r0.id);
    expect(row).toMatchObject({ status: 'handed_off', used_fallback: true, mismatch_attempts: 2 });
    expect(row.attempts_log.map((a: { kind: string }) => a.kind)).toEqual(['ai', 'ai', 'fallback_plain']);
    expect(row.attempts_log[0].forbidden).toEqual([SIGN]);
    expect(row.attempts_log[2]).toMatchObject({ n: 3, ok: true, forbidden: [] });
    const post = t.posts()[0]!;
    expect(post).toMatchObject({ status: 'ready', ai_provider: 'sistema' });
    expect(post.creative_brief.vacancy).toMatchObject({ used_fallback: true, attempts: 2, requires_approval: false, check_alert: null, check_unread: false });
    expect(post.ai_generation_log.map((x: { fallback: boolean }) => x.fallback)).toEqual([false, false, true]);
    expect(post.media[0]).toMatchObject({ width: 1080, height: 1920, ig_ready: true });
    expect(t.mediaRows()[0]).toMatchObject({ source: 'other', provider: 'sistema', ig_post_id: post.id });
  });

  it('erro de IA na foto (sem créditos): o story sai sem foto na hora e o aviso da IA fica gravado', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ images: [new VendorKeyError(NO_CREDIT, 'openai', 'noCredit')], reads: [readFor(v)] });

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 1, handed: 1, waiting: 0, cancelled: 0 });
    const row = t.row(r0.id);
    expect(row).toMatchObject({ status: 'handed_off', used_fallback: true, ai_error_count: 0, mismatch_attempts: 0 });
    expect(row.attempts_log).toEqual([
      { n: 1, at: expect.any(String), kind: 'ai', ok: false, wrong: [], forbidden: [], error: NO_CREDIT },
      { n: 3, at: expect.any(String), kind: 'fallback_plain', ok: true, wrong: [], forbidden: [] },
    ]);
    expect(t.settings()).toMatchObject({ ai_error: NO_CREDIT, ai_error_at: NOW });
    expect(t.imageCalls()).toHaveLength(1);
    expect(t.readCalls()).toHaveLength(0);
    expect(t.posts()[0]).toMatchObject({ status: 'pending_approval', ai_provider: 'sistema' });
  });

  it('leitura da foto falhou: a foto não é usada (não foi conferida) e o story sai sem foto', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [new Error('leitura caiu')] });

    expect(await t.gen.generateDue(NOW)).toMatchObject({ started: 1, handed: 1 });
    expect(t.row(r0.id).attempts_log.map((a: { kind: string; ok: boolean }) => [a.kind, a.ok])).toEqual([['ai', false], ['fallback_plain', true]]);
    expect(t.row(r0.id)).toMatchObject({ used_fallback: true });
  });

  it('vaga fechada no Freela (byId → null): linha cancelada com o motivo, nenhuma chamada de IA', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    w.feed.state.closed.add(v.id);
    await w.programArt({ reads: [readFor(v)] });

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 1, handed: 0, waiting: 0, cancelled: 1 });
    expect(t.row(r0.id)).toMatchObject({ status: 'cancelled', skip_reason: CLOSED, lease_until: null });
    expect(w.ai.image).not.toHaveBeenCalled();
    expect(w.ai.json).not.toHaveBeenCalled();
    expect(t.posts()).toHaveLength(0);
  });

  it('vitrine fora do ar ao conferir a vaga: volta a esperar 10 min, sem IA', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    w.feed.state.down = true;
    expect(await t.gen.generateDue(NOW)).toEqual({ started: 1, handed: 0, waiting: 1, cancelled: 0 });
    expect(t.row(r0.id)).toMatchObject({ status: 'waiting', lease_until: null, next_attempt_at: new Date(NOW.getTime() + 10 * MIN), ai_error_count: 0 });
    expect(w.ai.image).not.toHaveBeenCalled();
  });

  it('a vaga mudou no Freela: linha atualizada e a arte sai com o valor novo', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    const changed = { ...v, amountInCents: 18000 };
    w.feed.state.byId.set(v.id, changed);
    await w.programArt({ reads: [readFor(changed)] });

    expect(await t.gen.generateDue(NOW)).toMatchObject({ started: 1, handed: 1 });
    expect(t.row(r0.id)).toMatchObject({ status: 'handed_off', fingerprint: fingerprint(changed) });
    expect(t.row(r0.id).snapshot).toMatchObject({ amountInCents: 18000 });
    expect(t.posts()[0]!.creative_brief.vacancy.fingerprint).toBe(fingerprint(changed));
  });

  it('C1: a vaga perdeu o valor no Freela (assinatura velha) → triagem na vaga viva: linha pulada, nenhuma IA, nenhum post', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    w.feed.state.byId.set(v.id, { ...v, amountInCents: null });
    await w.programArt({ reads: [readFor(v)] });
    const after = jest.fn(async () => undefined);
    t.gen.hooks.afterHandOff = after;

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 1, handed: 0, waiting: 0, cancelled: 1 });
    expect(t.row(r0.id)).toMatchObject({ status: 'skipped', skip_reason: SKIP.noValue, lease_until: null, ig_post_id: null });
    expect(w.ai.image).not.toHaveBeenCalled();
    expect(w.ai.json).not.toHaveBeenCalled();
    expect(t.posts()).toHaveLength(0);
    expect(after).not.toHaveBeenCalled();
  });

  it('C1: a vaga mudou para uma cidade fora da lista → pulada com o motivo; "teste" no nome também', async () => {
    const t = await setup({ settings: { cities: ['Campinas'] } });
    const v = vac();
    const r0 = await t.story(v);
    w.feed.state.byId.set(v.id, { ...v, city: 'Sorocaba' });
    const u = vac();
    const r1 = await t.story(u);
    w.feed.state.byId.set(u.id, { ...u, contractorName: 'Bar Teste' });
    await w.programArt({ reads: [readFor(v)] });

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 2, handed: 0, waiting: 0, cancelled: 2 });
    expect(t.row(r0.id)).toMatchObject({ status: 'skipped', skip_reason: 'Cidade fora da sua lista: Sorocaba.' });
    expect(t.row(r1.id)).toMatchObject({ status: 'skipped', skip_reason: SKIP.test });
    expect(w.ai.image).not.toHaveBeenCalled();
    expect(t.posts()).toHaveLength(0);
  });

  it('C1/R30: linha "forced" de vaga de teste fora da lista continua gerando (só valor, cidade e antecedência valem)', async () => {
    const t = await setup({ settings: { cities: ['Jundiaí'] } });
    const v = vac({ contractorName: 'Bar Teste' });
    const r0 = await t.story(v, { forced: true });
    await w.programArt({ reads: [readFor(v)] });

    expect(await t.gen.generateDue(NOW)).toMatchObject({ started: 1, handed: 1 });
    expect(t.row(r0.id).status).toBe('handed_off');
    // Sem valor, nem a forçada gera.
    const u = vac({ contractorName: 'Bar Teste' });
    const r1 = await t.story(u, { forced: true });
    w.feed.state.byId.set(u.id, { ...u, amountInCents: 0 });
    expect(await t.gen.generateDue(NOW)).toMatchObject({ started: 1, handed: 0, cancelled: 1 });
    expect(t.row(r1.id)).toMatchObject({ status: 'skipped', skip_reason: SKIP.noValue });
  });

  it('A4: sem como ir ao ar (gancho da agenda devolve o motivo) → linha expirada, nenhuma IA; o gancho vê a data viva', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    const moved = { ...v, startTime: '2026-11-01T21:00:00Z', endTime: '2026-11-02T02:00:00Z' };
    w.feed.state.byId.set(v.id, moved);
    await w.programArt({ reads: [readFor(moved)] });
    const reason = 'A vaga começa Dom, 01/11 às 18h. Para dar tempo de divulgar, o story teria de ir ao ar até as 15h45.';
    const seen: Date[] = [];
    t.gen.hooks.beforeGenerate = jest.fn(async (row) => {
      seen.push(row.starts_at);
      return reason;
    });

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 1, handed: 0, waiting: 0, cancelled: 1 });
    expect(seen).toEqual([new Date(moved.startTime)]);
    expect(t.row(r0.id)).toMatchObject({ status: 'expired', skip_reason: reason, lease_until: null });
    expect(w.ai.image).not.toHaveBeenCalled();
    expect(t.posts()).toHaveLength(0);
  });

  it('sem Instagram conectado: nada é gerado e a linha diz por quê', async () => {
    const t = await setup({ ig: false });
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v)] });

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 0, handed: 0, waiting: 0, cancelled: 0 });
    expect(t.row(r0.id)).toMatchObject({ status: 'new', wait_reason: NO_IG, lease_until: null });
    expect(w.ai.image).not.toHaveBeenCalled();
    expect(w.feed.state.urls).toHaveLength(0);
  });

  it('lote de 10 linhas: só 2 por rodada, as de início mais próximo', async () => {
    const t = await setup();
    const days = [5, 9, 2, 7, 1, 10, 3, 8, 4, 6];
    const list = days.map((d) =>
      vac({ startTime: `2026-11-${String(d).padStart(2, '0')}T21:00:00Z`, endTime: `2026-11-${String(d + 1).padStart(2, '0')}T02:00:00Z` }),
    );
    for (const v of list) await t.story(v);
    const byDay = (d: number) => list[days.indexOf(d)]!;
    await w.programArt({ reads: [readFor(byDay(1)), readFor(byDay(2))] });

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 2, handed: 2, waiting: 0, cancelled: 0 });
    const handed = w.t['vacancy_stories']!.rows.filter((r) => r.status === 'handed_off').map((r) => r.external_id);
    expect(handed.sort()).toEqual([byDay(1).id, byDay(2).id].sort());
    expect(w.t['vacancy_stories']!.rows.filter((r) => r.status === 'new')).toHaveLength(8);
    expect(t.posts()).toHaveLength(2);
  });

  it('limite do dia (gancho da Task 10): a linha espera a vez sem gerar', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v)] });
    const tomorrow8 = new Date('2026-10-30T11:00:00Z');
    t.gen.hooks.capacityWait = jest.fn(async () => tomorrow8);

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 0, handed: 0, waiting: 1, cancelled: 0 });
    expect(t.row(r0.id)).toMatchObject({ status: 'waiting', wait_reason: WAIT_CAP, not_before: tomorrow8, lease_until: null });
    expect(w.ai.image).not.toHaveBeenCalled();
    // Antes do `not_before` a linha nem é candidata.
    t.gen.hooks.capacityWait = undefined;
    expect(await t.gen.generateDue(new Date(NOW.getTime() + 60 * MIN))).toMatchObject({ started: 0 });
  });

  it('desligaram durante a geração (antes da entrega): nenhum post nem mídia sobra', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v)] });
    const base = w.ai.image.getMockImplementation()!;
    w.ai.image.mockImplementationOnce(async (ws: string, req: unknown) => {
      await w.settings.turnOff(WS_A, null);
      return base(ws, req);
    });

    expect(await t.gen.generateDue(NOW)).toMatchObject({ started: 1, handed: 0 });
    expect(t.posts()).toHaveLength(0);
    expect(t.mediaRows()).toHaveLength(0);
    expect(t.row(r0.id)).toMatchObject({ status: 'cancelled', skip_reason: DISABLED_REASON, ig_post_id: null });
  });

  it('desligaram no meio da entrega (depois de salvar a mídia): o post é desfeito e a mídia apagada', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v)] });
    const real = t.assets.ingest.bind(t.assets);
    jest.spyOn(t.assets, 'ingest').mockImplementation(async (i) => {
      const a = await real(i);
      await w.settings.turnOff(WS_A, null);
      return a;
    });

    const s = t.settings();
    const leased = { ...t.row(r0.id), status: 'generating', lease_until: new Date(NOW.getTime() + 15 * MIN) } as StoryRow;
    Object.assign(t.row(r0.id), { status: 'generating', lease_until: leased.lease_until });
    const art = await t.gen.makeArt(WS_A, s, vacancyFields(v));
    expect(await t.gen.handOff(leased, s, art, v)).toBe('lost');

    expect(t.posts()).toHaveLength(0);
    expect(t.mediaRows()).toHaveLength(0);
    expect(w.storedFiles().filter((f) => f.includes('media'))).toEqual([]);
    expect(w.t['vacancy_stories']!.rows.find((r) => r.id === r0.id)).toMatchObject({ status: 'cancelled', ig_post_id: null });
  });

  it('lease renovado antes de cada chamada da IA e antes da entrega (o relógio anda durante a geração)', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v)] });
    const seen: Record<string, number> = {};
    const lease = () => (t.row(r0.id).lease_until as Date).getTime();
    const baseImage = w.ai.image.getMockImplementation()!;
    w.ai.image.mockImplementation(async (ws: string, req: unknown) => {
      seen['image'] = lease();
      t.clock.t += 10 * MIN;
      return baseImage(ws, req);
    });
    const baseRead = w.jsonBy['vacancy_art_read']!;
    w.jsonBy['vacancy_art_read'] = (req) => {
      seen['read'] = lease();
      t.clock.t += 5 * MIN;
      return baseRead(req);
    };
    const real = t.assets.ingest.bind(t.assets);
    jest.spyOn(t.assets, 'ingest').mockImplementation(async (i) => {
      seen['handOff'] = lease();
      return real(i);
    });

    expect(await t.gen.generateDue(NOW)).toMatchObject({ started: 1, handed: 1 });
    const at = (m: number) => NOW.getTime() + m * MIN;
    // Pego às 10h00 (até 10h15); renovado na leitura (10h10 → 10h25) e antes da entrega (10h15 → 10h30).
    expect(seen).toEqual({ image: at(15), read: at(25), handOff: at(30) });
    expect(t.row(r0.id)).toMatchObject({ status: 'handed_off', lease_until: null });
  });

  it('renovação do lease perdida (outro processo pegou a linha): para sem gravar nada e sem post', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v)] });
    const foreign = new Date(NOW.getTime() + 99 * MIN);
    const base = w.ai.image.getMockImplementation()!;
    w.ai.image.mockImplementationOnce(async (ws: string, req: unknown) => {
      Object.assign(t.row(r0.id), { lease_until: foreign });
      return base(ws, req);
    });

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 1, handed: 0, waiting: 0, cancelled: 0 });
    expect(w.ai.json).not.toHaveBeenCalled();
    expect(t.posts()).toHaveLength(0);
    expect(t.mediaRows()).toHaveLength(0);
    expect(t.row(r0.id)).toMatchObject({ status: 'generating', lease_until: foreign, attempts_log: [], wait_reason: null, ai_error_count: 0 });
  });

  it('arquivo da arte modelo sumiu: a arte sai mesmo assim (a logo vem da marca; o modelo não é mais exigido)', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v)] });
    await w.files.delete('creative-assets', t.template.storage_path);

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 1, handed: 1, waiting: 0, cancelled: 0 });
    expect(t.row(r0.id)).toMatchObject({ status: 'handed_off', used_fallback: false });
  });

  it('erro de IA depois de desligarem no meio: a linha fica cancelada e o aviso da IA não é gravado', async () => {
    const t = await setup();
    const v = vac();
    const r0 = await t.story(v);
    await w.programArt({ reads: [readFor(v)] });
    w.ai.image.mockImplementationOnce(async () => {
      await w.settings.turnOff(WS_A, null);
      throw new VendorKeyError(NO_CREDIT, 'openai', 'noCredit');
    });

    expect(await t.gen.generateDue(NOW)).toEqual({ started: 1, handed: 0, waiting: 0, cancelled: 0 });
    expect(t.settings()).toMatchObject({ ai_error: null, ai_error_at: null });
    expect(t.row(r0.id)).toMatchObject({ status: 'cancelled', skip_reason: DISABLED_REASON, ai_error_count: 0 });
  });

  it('modo "postar sozinho": post ready, sem exigir aprovação', async () => {
    const t = await setup({ settings: { auto_publish: true } });
    const v = vac();
    await t.story(v);
    await w.programArt({ reads: [readFor(v)] });
    const after = jest.fn(async () => undefined);
    t.gen.hooks.afterHandOff = after;

    expect(await t.gen.generateDue(NOW)).toMatchObject({ handed: 1 });
    const post = t.posts()[0]!;
    expect(post.status).toBe('ready');
    expect(post.creative_brief.vacancy.requires_approval).toBe(false);
    expect(after).toHaveBeenCalledWith(WS_A, post.id);
  });
});

describe('VacancyGeneratorService.makeArt', () => {
  it('avisa cada etapa (foto, conferência) por tentativa e devolve a arte com todos os campos conferidos', async () => {
    const t = await setup();
    const v = vac();
    await w.programArt({ reads: [readFor(v, ['BAR DO ZÉ']), readFor(v)] });
    const steps: [string, number][] = [];
    const art = await t.gen.makeArt(WS_A, t.settings(), vacancyFields(v), async (step, n) => {
      steps.push([step, n]);
    });
    expect(steps).toEqual([['art', 1], ['check', 1], ['art', 2], ['check', 2]]);
    expect(art).toMatchObject({ usedFallback: false, vendorLabel: 'ChatGPT (OpenAI)', origin: { source: 'chatgpt', provider: 'chatgpt' } });
    expect(art.check.ok).toBe(true);
    expect(art.check.fields.map((x) => x.key).sort()).toEqual(ALL_KEYS);
    expect(art.check.fields.every((x) => x.ok)).toBe(true);
    expect(art.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect((await w.images.size(art.bytes))).toEqual({ width: 1080, height: 1920 });
  });

  it('erro de IA nunca derruba a arte: sai sem foto, com o erro no registro', async () => {
    const t = await setup();
    const v = vac();
    await w.programArt({ images: [null, new VendorKeyError(NO_CREDIT, 'openai', 'noCredit')], reads: [readFor(v, ['PLACA'])] });
    const art = await t.gen.makeArt(WS_A, t.settings(), vacancyFields(v));
    expect(art).toMatchObject({ usedFallback: true, vendorLabel: 'Sistema (sem IA)' });
    expect(art.attempts.map((a) => [a.kind, a.ok, a.error ?? null])).toEqual([['ai', false, null], ['ai', false, NO_CREDIT], ['fallback_plain', true, null]]);
    expect((await w.images.size(art.bytes))).toEqual({ width: 1080, height: 1920 });
  });

  it('photoTexts: só blocos com 3+ letras ou dígitos reprovam a foto', () => {
    const r = (textos: string[]) => ({ ...readFor(vac()), textos });
    expect(photoTexts(r([]))).toEqual([]);
    expect(photoTexts(r(['', ' - ', 'A1']))).toEqual([]);
    expect(photoTexts(r(['Bar do Zé', '24h']))).toEqual(['Bar do Zé', '24h']);
  });
});
