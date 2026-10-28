jest.setTimeout(60_000);

import { igServices, seedPost, uuid } from '../../instagram/__tests__/harness';
import { OWNER, STRANGER, VIEWER, WS_A, WS_B, status } from '../../media/__tests__/mem';
import { VacancyActionsService } from '../vacancy-actions.service';
import { ArtAiError, type ArtResult, type VacancyGeneratorService } from '../vacancy-generator.service';
import { WAIT_CAP } from '../vacancy-reasons';
import { VacancyPreviewService } from '../vacancy-preview.service';
import { VacancySchedulerService } from '../vacancy-scheduler.service';
import { fingerprint } from '../vacancy-text';
import type { FreelaVacancy, VacancyFields } from '../vacancy-types';
import { vacancyWorld, type VacancyWorld } from './world';

const NOW = new Date('2026-10-29T13:00:00Z'); // quinta, 10h em Brasília
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const TOMORROW_8H = new Date('2026-10-30T11:00:00Z');
const NIGHT = new Date('2026-10-30T01:10:00Z'); // 22h10 de quinta
const DONT = 'Você escolheu não postar.';
const STALE = 'A situação deste story mudou. Atualize a tela e tente de novo.';
const TEST_SKIP = 'Parece vaga de teste: o nome da empresa tem “teste”.';

/** Sábado 31/10, 18h às 23h em Brasília, Coco Bambu em Campinas, R$ 150. */
const vac = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: uuid(), title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-10-31',
  startTime: '2026-10-31T21:00:00Z', endTime: '2026-11-01T02:00:00Z', amountInCents: 15000,
  contractorName: 'COCO BAMBU', publishedAt: '2026-10-29T10:00:00Z', ...o,
});

/** Arte que o gerador falso devolve (a geração de verdade é do generator.spec). */
const art = (over: Partial<ArtResult> = {}): ArtResult => ({
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  check: { ok: true, fields: [{ key: 'funcao', label: 'função', ok: true, read: 'GARÇOM', expected: 'Garçom' }], forbidden: [], hint: null },
  attempts: [{ n: 1, at: NOW.toISOString(), kind: 'ai', ok: true, wrong: [], forbidden: [] }],
  usedFallback: false,
  vendorLabel: 'ChatGPT (OpenAI)',
  origin: { source: 'chatgpt', provider: 'chatgpt' },
  ...over,
});

let w: VacancyWorld;
afterEach(() => w?.cleanup());

async function setup(o: { settings?: Record<string, unknown>; ig?: boolean; list?: string } = {}) {
  w = vacancyWorld({ list: o.list });
  const s = igServices(w, { guards: w.guard });
  const makeArt = jest.fn(async (..._a: Parameters<VacancyGeneratorService['makeArt']>): Promise<ArtResult> => art());
  const generator = { hooks: {}, makeArt } as unknown as VacancyGeneratorService;
  const sched = new VacancySchedulerService(w.prisma, w.store, s.publishing, w.guard, generator, w.gate);
  const clock = { t: NOW.getTime() };
  sched.now = () => clock.t;
  sched.onModuleInit();
  const actions = new VacancyActionsService(w.prisma, w.access, w.activity, w.gate, w.feedClient, w.settings, sched);
  actions.now = () => clock.t;
  const preview = new VacancyPreviewService(w.prisma, w.access, w.gate, w.feedClient, w.settings, generator, s.assets);
  preview.now = () => clock.t;
  await w.prisma.vacancy_story_settings.create({
    data: { workspace_id: WS_A, enabled: true, enabled_at: new Date('2026-10-29T09:00:00Z'), template_asset_id: uuid(), auto_publish: true, ...o.settings },
  });
  if (o.ig !== false) w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, status: 'connected', ig_user_id: '17841', username: 'freela' });
  const row = (id: string) => w.t['vacancy_stories']!.rows.find((r) => r.id === id)!;
  const posts = () => w.t['ig_posts']!.rows;
  const jobsOf = (postId: string) => w.t['publishing_jobs']!.rows.filter((j) => j.ig_post_id === postId);
  const settingsRow = () => w.t['vacancy_story_settings']!.rows.find((r) => r.workspace_id === WS_A)!;
  /** Linha da fila (antes da entrega) para a vaga `v`; a vitrine responde `v`. */
  const queued = async (v: FreelaVacancy, over: Record<string, unknown> = {}, ws = WS_A) => {
    w.feed.state.byId.set(v.id, v);
    return w.prisma.vacancy_stories.create({
      data: { workspace_id: ws, external_id: v.id, snapshot: v, fingerprint: fingerprint(v), starts_at: new Date(v.startTime), status: 'new', ...over },
    });
  };
  /** Story entregue como o gerador deixa: post de vaga + linha `handed_off`. */
  const delivered = async (v: FreelaVacancy, over: Record<string, unknown> = {}, rowOver: Record<string, unknown> = {}) => {
    const post = seedPost(w, {
      source: 'vacancy', format: 'story_image', status: 'pending_approval', automation: null, plan_id: null, run_id: null, approved_at: null,
      caption: null, hashtags: [], cta: null, created_at: NOW, theme: 'Vaga · Garçom · Coco Bambu · Sáb 31/10',
      creative_brief: { compose: false, vacancy: { external_id: v.id, fingerprint: fingerprint(v), requires_approval: false, starts_at: v.startTime, checked_fields: [], used_fallback: false } },
      ...over,
    });
    const r = await queued(v, { status: 'handed_off', ig_post_id: post.id, ...rowOver });
    return { post, row: r };
  };
  const job = (postId: string, runAt: Date) => {
    const j = { id: uuid(), workspace_id: WS_A, channel: 'instagram_organic', ig_post_id: postId, target: 'instagram', status: 'pending', mode: 'live', run_at: runAt, attempts: 0, locked_at: null, log: null };
    w.t['publishing_jobs']!.rows.push(j);
    return j;
  };
  return { s, generator, makeArt, sched, clock, actions, preview, row, posts, jobsOf, settingsRow, queued, delivered, job };
}

describe('VacancyActionsService — Não postar', () => {
  it('antes da entrega: a linha vira "cancelada" com "Você escolheu não postar."; feedback repetido só grava o feedback', async () => {
    const t = await setup();
    const r = await t.queued(vac());
    expect(await t.actions.dontPost(OWNER, WS_A, r.id)).toEqual({ ok: true });
    expect(t.row(r.id)).toMatchObject({ status: 'cancelled', skip_reason: DONT, feedback: null });

    expect(await t.actions.dontPost(OWNER, WS_A, r.id, 'texto_errado')).toEqual({ ok: true });
    expect(await t.actions.dontPost(OWNER, WS_A, r.id)).toEqual({ ok: true });
    expect(t.row(r.id)).toMatchObject({ status: 'cancelled', skip_reason: DONT, feedback: 'texto_errado' });
    expect((await t.actions.detail(WS_A, r.id))).toMatchObject({ display: 'cancelled', label: 'Não foi ao ar', reason: DONT, can: { create_anyway: true } });

    // Gerando também (a geração perde o lease e não entrega).
    const g = await t.queued(vac(), { status: 'generating', lease_until: at(10 * MIN) });
    await t.actions.dontPost(OWNER, WS_A, g.id, 'foto_estranha');
    expect(t.row(g.id)).toMatchObject({ status: 'cancelled', skip_reason: DONT, feedback: 'foto_estranha', lease_until: null });
    expect(w.t['activity_logs']!.rows.filter((a) => a.action === 'vacancy_stories.dont_post')).toHaveLength(2);
  });

  it('depois da entrega: post cancelado (+ job), rejection_reason e o motivo na linha; conta como "não postado"; publicado → 400', async () => {
    const t = await setup();
    const { post, row } = await t.delivered(vac(), { status: 'scheduled', scheduled_at: at(HOUR) });
    const j = t.job(post.id, at(HOUR));
    expect(await t.actions.dontPost(OWNER, WS_A, row.id)).toEqual({ ok: true });
    expect(post).toMatchObject({ status: 'cancelled', rejection_reason: DONT });
    expect(j.status).toBe('cancelled');
    expect(t.row(row.id)).toMatchObject({ status: 'handed_off', skip_reason: DONT, ig_post_id: post.id });
    expect(await t.actions.detail(WS_A, row.id)).toMatchObject({ display: 'cancelled', reason: DONT, can: { create_anyway: true, dont_post: false } });

    await t.actions.dontPost(OWNER, WS_A, row.id, 'nao_divulgar');
    expect(t.row(row.id).feedback).toBe('nao_divulgar');
    expect(post.status).toBe('cancelled');
    expect((await w.settings.view(WS_A, NOW)).recent_outcomes).toMatchObject({ n: 1, not_posted: 1 });

    const live = await t.delivered(vac(), { status: 'published', published_at: at(-HOUR) });
    expect(await status(t.actions.dontPost(OWNER, WS_A, live.row.id))).toBe(`400:${STALE}`);
    expect(live.post.status).toBe('published');
    // Leitor não age.
    expect(await status(t.actions.dontPost(VIEWER, WS_A, row.id))).toMatch(/^403:/);
  });
});

describe('VacancyActionsService — Postar agora', () => {
  it('fora do horário (22h10): o post agendado para as 8h vai em agora + 1 min', async () => {
    const t = await setup();
    t.clock.t = NIGHT.getTime();
    const { post, row } = await t.delivered(vac(), { status: 'scheduled', scheduled_at: TOMORROW_8H });
    const old = t.job(post.id, TOMORROW_8H);
    expect(await t.actions.detail(WS_A, row.id)).toMatchObject({ display: 'waiting_window', support: 'Vai ao ar amanhã às 8h', can: { post_now: true } });
    expect(await t.actions.postNow(OWNER, WS_A, row.id)).toEqual({ ok: true });
    const soon = new Date(NIGHT.getTime() + MIN);
    expect(post).toMatchObject({ status: 'scheduled', scheduled_at: soon });
    expect(old.status).toBe('cancelled');
    expect(t.jobsOf(post.id).filter((j) => j.status === 'pending')).toEqual([expect.objectContaining({ run_at: soon })]);
  });

  it('acima do limite: post empurrado para amanhã vai agora; linha esperando a vez volta para a fila com post_now', async () => {
    const t = await setup({ settings: { daily_cap: 1 } });
    await t.delivered(vac(), { status: 'published', published_at: at(-HOUR), scheduled_at: at(-HOUR) });
    const { post, row } = await t.delivered(vac(), { status: 'scheduled', scheduled_at: TOMORROW_8H });
    t.job(post.id, TOMORROW_8H);
    expect(await t.actions.detail(WS_A, row.id)).toMatchObject({
      display: 'waiting_cap', support: 'Hoje já foi 1 (o máximo por dia). Vai ao ar amanhã às 8h, se a vaga ainda não tiver começado.',
    });
    await t.actions.postNow(OWNER, WS_A, row.id);
    expect(post).toMatchObject({ status: 'scheduled', scheduled_at: at(MIN) });

    const waiting = await t.queued(vac(), { status: 'waiting', wait_reason: WAIT_CAP, not_before: TOMORROW_8H });
    expect(await t.actions.postNow(OWNER, WS_A, waiting.id)).toEqual({ ok: true });
    expect(t.row(waiting.id)).toMatchObject({ status: 'new', post_now: true, not_before: null, wait_reason: null });
    // Já na fila de novo: "Postar agora" não vale mais.
    expect(await status(t.actions.postNow(OWNER, WS_A, waiting.id))).toBe(`400:${STALE}`);
  });

  it('pronto para daqui a pouco: "Postar agora" não vale (400)', async () => {
    const t = await setup();
    const { row } = await t.delivered(vac(), { status: 'scheduled', scheduled_at: at(30 * MIN) });
    expect(await status(t.actions.postNow(OWNER, WS_A, row.id))).toBe(`400:${STALE}`);
  });
});

describe('VacancyActionsService — Criar story mesmo assim', () => {
  it('vaga de teste aberta → volta para a fila com forced; vaga fechada → 400; vitrine fora → 400', async () => {
    const t = await setup();
    const v = vac({ contractorName: 'Bar Teste' });
    const r = await t.queued(v, { status: 'skipped', skip_reason: TEST_SKIP });
    expect(await t.actions.detail(WS_A, r.id)).toMatchObject({ display: 'skipped', is_test: true, can: { create_anyway: true } });
    expect(await t.actions.createAnyway(OWNER, WS_A, r.id)).toEqual({ ok: true });
    expect(t.row(r.id)).toMatchObject({ status: 'new', forced: true, ig_post_id: null, skip_reason: null });

    const closed = vac();
    const c = await t.queued(closed, { status: 'expired', skip_reason: 'Começa às 15h, em menos de 2 h. Não dá tempo de divulgar.' });
    w.feed.state.closed.add(closed.id);
    expect(await status(t.actions.createAnyway(OWNER, WS_A, c.id))).toBe('400:A vaga não está mais aberta no Freela.');
    expect(t.row(c.id).status).toBe('expired');

    const other = await t.queued(vac(), { status: 'cancelled', skip_reason: 'Os stories das vagas foram desligados.' });
    w.feed.state.down = true;
    expect(await status(t.actions.createAnyway(OWNER, WS_A, other.id))).toBe(
      '400:Não conseguimos consultar a vaga no Freela agora. Tente de novo em alguns minutos.',
    );
    expect(t.row(other.id).status).toBe('cancelled');
  });

  it('R30: confere a vaga VIVA — sem valor, sem cidade, já começou ou dentro da antecedência + 15 min → 400 e nada muda', async () => {
    const t = await setup();
    const off = 'Os stories das vagas foram desligados.';
    const cases: [Partial<FreelaVacancy>, string][] = [
      [{ amountInCents: null }, 'A vaga não tem valor informado.'],
      [{ amountInCents: 0 }, 'A vaga não tem valor informado.'],
      [{ city: '  ' }, 'A vaga não tem cidade informada.'],
      [{ startTime: at(-HOUR).toISOString(), endTime: at(3 * HOUR).toISOString() }, 'A vaga começou antes de ir ao ar.'],
      [{ startTime: at(2 * HOUR + 10 * MIN).toISOString(), endTime: at(6 * HOUR).toISOString() }, 'Começa às 12h10, em menos de 2 h. Não dá tempo de divulgar.'],
    ];
    for (const [live, msg] of cases) {
      const v = vac();
      const r = await t.queued(v, { status: 'cancelled', skip_reason: off });
      w.feed.state.byId.set(v.id, { ...v, ...live });
      expect(await status(t.actions.createAnyway(OWNER, WS_A, r.id))).toBe(`400:${msg}`);
      expect(t.row(r.id)).toMatchObject({ status: 'cancelled', skip_reason: off, forced: false });
    }
    // Com folga (2 h 20 min antes): volta para a fila.
    const v = vac();
    const r = await t.queued(v, { status: 'cancelled', skip_reason: off });
    w.feed.state.byId.set(v.id, { ...v, startTime: at(2 * HOUR + 20 * MIN).toISOString(), endTime: at(6 * HOUR).toISOString() });
    expect(await t.actions.createAnyway(OWNER, WS_A, r.id)).toEqual({ ok: true });
    expect(t.row(r.id)).toMatchObject({ status: 'new', forced: true, starts_at: at(2 * HOUR + 20 * MIN) });
  });

  it('depois de "Não postar" na entrega: a linha solta o post cancelado e volta para a fila com os dados vivos da vaga', async () => {
    const t = await setup();
    const v = vac();
    const { post, row } = await t.delivered(v);
    await t.actions.dontPost(OWNER, WS_A, row.id);
    const moved = { ...v, amountInCents: 18000 };
    w.feed.state.byId.set(v.id, moved);
    await t.actions.createAnyway(OWNER, WS_A, row.id);
    expect(t.row(row.id)).toMatchObject({ status: 'new', forced: true, ig_post_id: null, skip_reason: null, fingerprint: fingerprint(moved) });
    expect(post.status).toBe('cancelled');
    // Na fila: não dá para criar de novo.
    expect(await status(t.actions.createAnyway(OWNER, WS_A, row.id))).toBe(`400:${STALE}`);
  });
});

describe('VacancyActionsService — Refazer a arte / Tentar de novo', () => {
  it('refaz até o teto (D11): a 4ª vez → 400 "Esta vaga já foi refeita 3 vezes."', async () => {
    const t = await setup();
    const v = vac();
    let { post, row } = await t.delivered(v);
    const j = t.job(post.id, at(HOUR));
    for (let i = 1; i <= 3; i++) {
      expect(await t.actions.redo(OWNER, WS_A, row.id)).toEqual({ ok: true });
      expect(post.status).toBe('cancelled');
      expect(t.row(row.id)).toMatchObject({ status: 'new', ig_post_id: null, redo_count: i });
      // O gerador entrega de novo.
      post = seedPost(w, { source: 'vacancy', format: 'story_image', status: 'pending_approval', creative_brief: { vacancy: { external_id: v.id } } });
      Object.assign(t.row(row.id), { status: 'handed_off', ig_post_id: post.id });
    }
    expect(j.status).toBe('cancelled');
    expect(await t.actions.detail(WS_A, row.id)).toMatchObject({ redo_count: 3, can: { redo: false } });
    expect(await status(t.actions.redo(OWNER, WS_A, row.id))).toBe('400:Esta vaga já foi refeita 3 vezes.');
    expect(post.status).toBe('pending_approval');
    row = t.row(row.id) as typeof row;
    expect(row.status).toBe('handed_off');
  });

  it('falhou (linha ou post recusado) → "Tentar de novo" volta para a fila sem contar refação', async () => {
    const t = await setup();
    const many = 'A vaga mudou muitas vezes no Freela. Crie o story de novo quando ela estiver definida.';
    const f = await t.queued(vac(), { status: 'failed', skip_reason: many, redo_count: 3 });
    expect(await t.actions.redo(OWNER, WS_A, f.id)).toEqual({ ok: true });
    expect(t.row(f.id)).toMatchObject({ status: 'new', skip_reason: null, redo_count: 3 });

    const { post, row } = await t.delivered(vac(), { status: 'failed', last_error: 'Mídia inválida.' });
    expect(await t.actions.detail(WS_A, row.id)).toMatchObject({ display: 'failed', can: { retry: true } });
    await t.actions.redo(OWNER, WS_A, row.id);
    expect(post.status).toBe('cancelled');
    expect(t.row(row.id)).toMatchObject({ status: 'new', ig_post_id: null, redo_count: 0 });

    const live = await t.delivered(vac(), { status: 'published', published_at: at(-HOUR) });
    expect(await status(t.actions.redo(OWNER, WS_A, live.row.id))).toBe(`400:${STALE}`);
  });

  it('com a função desligada, refazer e criar mesmo assim recusam', async () => {
    const t = await setup({ settings: { enabled: false } });
    const { row } = await t.delivered(vac());
    const off = '400:Ligue os stories das vagas para usar esta ação.';
    expect(await status(t.actions.redo(OWNER, WS_A, row.id))).toBe(off);
    const skipped = await t.queued(vac(), { status: 'skipped', skip_reason: TEST_SKIP });
    expect(await status(t.actions.createAnyway(OWNER, WS_A, skipped.id))).toBe(off);
    expect(t.row(skipped.id).status).toBe('skipped');
  });
});

describe('VacancyActionsService — lista, detalhe e isolamento', () => {
  it('lista com filtros: todas (mais novas primeiro), no ar e não postadas', async () => {
    const t = await setup();
    const live = await t.delivered(vac(), { status: 'published', published_at: at(-HOUR) });
    const old = await t.delivered(vac(), { status: 'published', published_at: at(-30 * HOUR) });
    const skipped = await t.queued(vac(), { status: 'skipped', skip_reason: 'Cidade fora da sua lista: Jundiaí.' });
    const mine = await t.delivered(vac(), { status: 'cancelled', rejection_reason: DONT });
    const failed = await t.queued(vac(), { status: 'failed', skip_reason: 'x' });
    const q = await t.queued(vac());

    const all = await t.actions.list(WS_A, 'all');
    expect(all.map((x) => x.id)).toEqual([q.id, failed.id, mine.row.id, skipped.id, old.row.id, live.row.id]);
    expect((await t.actions.list(WS_A, 'live')).map((x) => x.id)).toEqual([live.row.id]);
    expect((await t.actions.list(WS_A, 'not_posted')).map((x) => [x.id, x.display])).toEqual([
      [failed.id, 'failed'], [mine.row.id, 'cancelled'], [skipped.id, 'skipped'],
    ]);
    expect(all.find((x) => x.id === live.row.id)).toMatchObject({ display: 'live', label: 'No ar até amanhã às 9h', freela_url: `https://www.freelaservicosapp.com.br/vagas/${live.row.external_id}` });
  });

  it('id de story de outra empresa → 404 em toda rota', async () => {
    const t = await setup({ list: `${WS_A},${WS_B}` });
    await w.prisma.vacancy_story_settings.create({ data: { workspace_id: WS_B, enabled: true, template_asset_id: uuid() } });
    const a = await t.queued(vac());
    const b = await t.queued(vac(), {}, WS_B);
    const nf = '404:Story não encontrado.';
    expect(await status(t.actions.detail(WS_B, a.id))).toBe(nf);
    expect(await status(t.actions.dontPost(STRANGER, WS_B, a.id))).toBe(nf);
    expect(await status(t.actions.postNow(STRANGER, WS_B, a.id))).toBe(nf);
    expect(await status(t.actions.createAnyway(STRANGER, WS_B, a.id))).toBe(nf);
    expect(await status(t.actions.redo(STRANGER, WS_B, a.id))).toBe(nf);
    expect(await status(t.actions.detail(WS_A, b.id))).toBe(nf);
    expect(await status(t.actions.dontPost(OWNER, WS_A, b.id))).toBe(nf);
    expect((await t.actions.list(WS_B, 'all')).map((x) => x.id)).toEqual([b.id]);
    expect(t.row(a.id).status).toBe('new');
  });

  it('empresa fora da lista → 404 antes do acesso', async () => {
    const t = await setup();
    const r = await t.queued(vac());
    expect(await status(t.actions.list(WS_B, 'all'))).toBe('404:Página não encontrada.');
    expect(await status(t.actions.dontPost(STRANGER, WS_B, r.id))).toBe('404:Página não encontrada.');
  });
});

describe('VacancyPreviewService', () => {
  /** Estado da prévia gravado nos ajustes. */
  const previewOf = () => w.t['vacancy_story_settings']!.rows.find((r) => r.workspace_id === WS_A)!.preview;

  it('sem vaga na vitrine usa o exemplo (sábado 18h–23h), mostra as etapas (reserva = "fallback", tentativa 3), vai para a Biblioteca e não cria post', async () => {
    const t = await setup({ ig: false });
    const steps: unknown[] = [];
    t.makeArt.mockImplementation(async (_ws, _s, _f, onStep) => {
      for (const [step, n] of [['art', 1], ['check', 1], ['art', 2], ['check', 2], ['art', 4], ['check', 5]] as const) {
        await onStep!(step, n);
        const p = previewOf();
        steps.push([p.status, p.step, p.attempt]);
      }
      return art({ usedFallback: true });
    });
    expect(await t.preview.start(OWNER, WS_A)).toEqual({ ok: true });
    await t.preview.wait(WS_A);

    const fields = t.makeArt.mock.calls[0]![2] as VacancyFields;
    expect(fields).toMatchObject({ funcao: 'Garçom', estabelecimento: null, valor: 'R$ 150', data: 'Sáb, 31/10', horario: '18h às 23h', cidade: 'Campinas' });
    expect(steps).toEqual([
      ['running', 'art', 1], ['running', 'check', 1], ['running', 'art', 2], ['running', 'check', 2], ['running', 'fallback', 3], ['running', 'fallback', 3],
    ]);
    const p = previewOf();
    expect(p).toMatchObject({
      status: 'done', sample: true, used_fallback: true, error: null, media_url: expect.stringMatching(/^https:\/\/cdn\.test\//),
      checks: art().check.fields, attempts: art().attempts, started_at: NOW.toISOString(), finished_at: NOW.toISOString(),
      vacancy: { funcao: 'Garçom', valor: 'R$ 150', dia: 'Sáb 31/10', horario: '18h às 23h', cidade: 'Campinas', estabelecimento: null },
    });
    expect(t.s.assets.ingest).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WS_A, kind: 'image', targetFormat: 'ig_story', normalize: false, source: 'chatgpt', provider: 'chatgpt', title: 'Prévia · story de vaga', createdBy: OWNER,
    }));
    expect(w.t['media_assets']!.rows.find((a) => a.id === p.asset_id)).toMatchObject({ title: 'Prévia · story de vaga', ig_post_id: null });
    expect(t.posts()).toHaveLength(0);
    expect(w.t['vacancy_stories']!.rows).toHaveLength(0);
    // A tela lê o estado pela configuração.
    expect((await w.settings.view(WS_A, NOW)).preview).toMatchObject({ status: 'done', sample: true });
  });

  it('usa a vaga mais recente da vitrine que ainda vai acontecer e tem valor', async () => {
    const t = await setup();
    w.feed.state.vacancies = [
      vac({ title: 'Cozinheiro', isUpcoming: true, publishedAt: '2026-10-29T12:00:00Z', amountInCents: null }),
      vac({ title: 'Barman', isUpcoming: false, publishedAt: '2026-10-29T11:00:00Z' }),
      vac({ title: 'Copeiro', isUpcoming: true, publishedAt: '2026-10-29T10:30:00Z' }),
      vac({ title: 'Hostess', isUpcoming: true, publishedAt: '2026-10-29T09:00:00Z' }),
    ];
    await t.preview.start(OWNER, WS_A);
    await t.preview.wait(WS_A);
    expect((t.makeArt.mock.calls[0]![2] as VacancyFields).funcao).toBe('Copeiro');
    expect(previewOf()).toMatchObject({ status: 'done', sample: false });
  });

  it('segunda prévia em andamento → 409; travada há mais de 10 min → começa outra; falha da IA fica no estado', async () => {
    const t = await setup();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    t.makeArt.mockImplementationOnce(async (_ws, _s, _f, onStep) => {
      await onStep!('art', 1);
      entered();
      await held;
      return art();
    });
    await t.preview.start(OWNER, WS_A);
    expect(await status(t.preview.start(OWNER, WS_A))).toBe('409:Já existe uma prévia sendo criada.');
    await inside;
    expect(previewOf()).toMatchObject({ status: 'running', step: 'art', attempt: 1 });
    expect(await status(t.preview.start(OWNER, WS_A))).toBe('409:Já existe uma prévia sendo criada.');
    release();
    await t.preview.wait(WS_A);
    expect(previewOf().status).toBe('done');

    // Estado "running" de antes de a API reiniciar: recente → 409; há mais de 10 min → sobrescreve.
    t.settingsRow().preview = { status: 'running', step: 'art', attempt: 1, started_at: at(-2 * MIN).toISOString() };
    expect(await status(t.preview.start(OWNER, WS_A))).toBe('409:Já existe uma prévia sendo criada.');
    t.settingsRow().preview = { status: 'running', step: 'art', attempt: 1, started_at: at(-11 * MIN).toISOString() };
    t.makeArt.mockImplementationOnce(async () => {
      throw new ArtAiError('Sua conta OpenAI está sem créditos.', [{ n: 1, at: NOW.toISOString(), kind: 'ai', ok: false, wrong: [], forbidden: [], error: 'x' }]);
    });
    expect(await t.preview.start(OWNER, WS_A)).toEqual({ ok: true });
    await t.preview.wait(WS_A);
    expect(previewOf()).toMatchObject({ status: 'failed', error: 'Sua conta OpenAI está sem créditos.', attempts: [expect.objectContaining({ n: 1 })] });
    expect(t.posts()).toHaveLength(0);
  });

  it('sem arte modelo → 400', async () => {
    const t = await setup({ settings: { template_asset_id: null } });
    expect(await status(t.preview.start(OWNER, WS_A))).toBe('400:Envie a arte modelo antes de gerar a prévia.');
    expect(t.makeArt).not.toHaveBeenCalled();
  });
});
