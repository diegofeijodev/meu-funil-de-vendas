jest.setTimeout(120_000);

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { igServices, seedPost, uuid } from '../../instagram/__tests__/harness';
import { RefsService } from '../../creative/refs.service';
import { MARKETING, OWNER, STRANGER, VIEWER, WS_A, WS_B, status } from '../../media/__tests__/mem';
import { cltDeadline, cltFingerprint } from '../vacancy-clt';
import { VacancyActionsService } from '../vacancy-actions.service';
import { VacancyGeneratorService } from '../vacancy-generator.service';
import { VacancyPollService } from '../vacancy-poll.service';
import { VacancyPreviewService } from '../vacancy-preview.service';
import { CLT_DISABLED_REASON, DISABLED_REASON, DONT_POST_REASON } from '../vacancy-reasons';
import { VacancySchedulerService } from '../vacancy-scheduler.service';
import { ListStoriesQuery, StartPreviewDto, UpdateVacancySettingsDto } from '../vacancy-stories.dto';
import { VacancyStoriesController } from '../vacancy-stories.controller';
import { ACCESS_LEVEL_KEY } from '../../access/workspace-access.guard';
import { fingerprint } from '../vacancy-text';
import type { FreelaFixedJob, FreelaVacancy } from '../vacancy-types';
import { fixedJob, vacancyWorld, type VacancyWorld } from './world';

const NOW = new Date('2026-11-25T13:00:00Z');
const DAY = 86_400_000;
const FORBIDDEN = '403:Seu perfil não tem permissão para esta ação.';
const NOT_MEMBER = '403:Você não tem acesso a esta empresa.';
const job = (o: Partial<FreelaFixedJob> = {}) => fixedJob({ publishedAt: new Date(NOW.getTime() - DAY).toISOString(), ...o });
const diaria = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: uuid(), title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-11-28', startTime: '2026-11-28T21:00:00Z',
  endTime: '2026-11-29T02:00:00Z', amountInCents: 15000, contractorName: 'COCO BAMBU', publishedAt: '2026-11-25T10:00:00Z', ...o,
});

let w: VacancyWorld;
afterEach(() => w?.cleanup());

async function setup(o: { settings?: Record<string, unknown>; list?: string; page?: string } = {}) {
  w = vacancyWorld({ list: o.list });
  if (o.page) Object.assign(w.feedClient, { fixedJobPageBase: o.page });
  const s = igServices(w, { guards: w.guard });
  const refs = new RefsService(w.prisma, w.files, s.assets as never, w.images);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generator = new VacancyGeneratorService(w.prisma, w.ai as any, w.images, w.files, s.assets as never, refs, w.store, w.feedClient, w.gate);
  const sched = new VacancySchedulerService(w.prisma, w.store, s.publishing, w.guard, generator, w.gate);
  sched.now = () => NOW.getTime();
  sched.onModuleInit();
  const actions = new VacancyActionsService(w.prisma, w.access, w.activity, w.gate, w.feedClient, w.settings, sched);
  actions.now = () => NOW.getTime();
  const preview = new VacancyPreviewService(w.prisma, w.access, w.gate, w.feedClient, w.settings, generator, s.assets);
  preview.now = () => NOW.getTime();
  await w.prisma.vacancy_story_settings.create({ data: { workspace_id: WS_A, enabled: true, enabled_at: new Date(NOW.getTime() - DAY), template_asset_id: uuid(), auto_publish: true, ...o.settings } });
  w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, status: 'connected', ig_user_id: '17841', username: 'freela' });
  const row = () => w.t['vacancy_story_settings']!.rows.find((r) => r.workspace_id === WS_A)!;
  const cltRow = (v: FreelaFixedJob, over: Record<string, unknown> = {}, ws = WS_A) =>
    w.prisma.vacancy_stories.create({ data: { workspace_id: ws, source: 'freela_clt', external_id: v.id, snapshot: v, fingerprint: cltFingerprint(v), starts_at: cltDeadline(v), status: 'new', ...over } });
  const diariaRow = (v: FreelaVacancy, over: Record<string, unknown> = {}) =>
    w.prisma.vacancy_stories.create({ data: { workspace_id: WS_A, external_id: v.id, snapshot: v, fingerprint: fingerprint(v), starts_at: new Date(v.startTime), status: 'new', ...over } });
  const post = (kind: 'clt' | 'diaria', status = 'ready') =>
    seedPost(w, { source: 'vacancy', format: 'story_image', status, approved_at: null, created_at: NOW, creative_brief: { compose: false, vacancy: { ...(kind === 'clt' ? { kind: 'clt' } : {}) } } });
  return { s, sched, actions, preview, generator, row, cltRow, diariaRow, post };
}

describe('Ajustes das vagas fixas (M18)', () => {
  it('view: bloco clt com os padrões (desligada, 2 por dia, retroativo 14, 30 dias), contagem própria; sem página → sem QR', async () => {
    await setup();
    w.brand();
    const view = await w.settings.view(WS_A, NOW);
    expect(view.clt).toMatchObject({
      enabled: false, enabled_at: null, daily_cap: 2, backlog_days: 14, since: null, promo_days: 30, last_poll_error: null,
      today: { posted: 0, scheduled: 0, cap: 2 }, counts: { ready: 0, to_approve: 0 }, has_brand: true, qr_available: false,
    });
  });

  it('PATCH: clt_daily_cap 1–10 e clt_backlog_days 0/7/14/30 (DTO sem padrão); viewer não muda', async () => {
    const t = await setup();
    const dto = (b: object) => validate(plainToInstance(UpdateVacancySettingsDto, b), { whitelist: true, forbidNonWhitelisted: true });
    expect(await dto({ clt_daily_cap: 11 })).toHaveLength(1);
    expect(await dto({ clt_daily_cap: 0 })).toHaveLength(1);
    expect(await dto({ clt_backlog_days: 5 })).toHaveLength(1);
    expect(await dto({ clt_daily_cap: 3, clt_backlog_days: 30 })).toHaveLength(0);
    expect(plainToInstance(UpdateVacancySettingsDto, {}).clt_daily_cap).toBeUndefined();
    const view = await w.settings.update(OWNER, WS_A, { clt_daily_cap: 3, clt_backlog_days: 7 });
    expect(view.clt).toMatchObject({ daily_cap: 3, backlog_days: 7 });
    expect(t.row()).toMatchObject({ clt_daily_cap: 3, clt_backlog_days: 7, daily_cap: 10 });
    expect(await status(w.settings.update(VIEWER, WS_A, { clt_daily_cap: 4 }))).toBe(FORBIDDEN);
  });

  it('ligar: só dono/admin; sem marca → 400; com marca grava a marca, a marca d\'água e a atividade; não exige arte modelo', async () => {
    const t = await setup({ settings: { template_asset_id: null, enabled: false } });
    expect(await status(w.settings.cltEnable(MARKETING, WS_A))).toBe(FORBIDDEN);
    expect(await status(w.settings.cltEnable(OWNER, WS_A))).toBe('400:Cadastre uma marca em Marcas antes de ligar.');
    const b = w.brand();
    const view = await w.settings.cltEnable(OWNER, WS_A);
    expect(view.clt).toMatchObject({ enabled: true, has_brand: true });
    expect(t.row()).toMatchObject({ clt_enabled: true, clt_enabled_by: OWNER, brand_id: b.id, enabled: false });
    expect(view.clt.since).toEqual(new Date(t.row().clt_enabled_at.getTime() - 14 * DAY));
    expect(w.t['activity_logs']!.rows.map((r) => r.action)).toEqual(['vacancy_stories.clt_enable']);
    // já ligada: nada muda
    await w.settings.cltEnable(OWNER, WS_A);
    expect(w.t['activity_logs']!.rows).toHaveLength(1);
  });

  it('desligar a CLT cancela só linhas e posts CLT; desligar as diárias não toca a CLT', async () => {
    const t = await setup({ settings: { clt_enabled: true, clt_enabled_at: NOW } });
    const c = await t.cltRow(job());
    const d = await t.diariaRow(diaria());
    const pc = t.post('clt');
    const pd = t.post('diaria');
    await w.prisma.vacancy_stories.create({ data: { workspace_id: WS_A, source: 'freela_clt', external_id: 'x1', snapshot: {}, fingerprint: 'f', starts_at: NOW, status: 'handed_off', ig_post_id: pc.id } });
    await w.prisma.vacancy_stories.create({ data: { workspace_id: WS_A, external_id: 'x2', snapshot: {}, fingerprint: 'f', starts_at: NOW, status: 'handed_off', ig_post_id: pd.id } });
    expect(await status(w.settings.cltDisable(VIEWER, WS_A))).toBe(FORBIDDEN);
    expect(await w.settings.cltDisable(OWNER, WS_A)).toEqual({ ok: true, cancelled: 2 });
    const r = (id: string) => w.t['vacancy_stories']!.rows.find((x) => x.id === id)!;
    const p = (id: string) => w.t['ig_posts']!.rows.find((x) => x.id === id)!;
    expect(r(c.id)).toMatchObject({ status: 'cancelled', skip_reason: CLT_DISABLED_REASON });
    expect(p(pc.id).status).toBe('cancelled');
    expect(r(d.id).status).toBe('new');
    expect(p(pd.id).status).toBe('ready');
    expect(t.row()).toMatchObject({ clt_enabled: false, enabled: true });
    // agora o contrário: diárias desligadas, a CLT (religada) fica
    await w.settings.cltEnable(OWNER, WS_A).catch(() => undefined);
    w.brand();
    await w.settings.cltEnable(OWNER, WS_A);
    const c2 = await t.cltRow(job());
    await w.settings.disable(OWNER, WS_A);
    expect(r(d.id)).toMatchObject({ status: 'cancelled', skip_reason: DISABLED_REASON });
    expect(p(pd.id).status).toBe('cancelled');
    expect(r(c2.id).status).toBe('new');
    expect(t.row()).toMatchObject({ clt_enabled: true, enabled: false });
  });

  it('desligar e religar: a vaga fixa que saiu da fila sem virar story (e ainda no prazo) volta; a que virou post não', async () => {
    const t = await setup({ settings: { clt_enabled: true, clt_enabled_at: NOW } });
    w.brand();
    const queued = await t.cltRow(job());
    const late = await t.cltRow(job({ publishedAt: new Date(NOW.getTime() - 40 * DAY).toISOString() }));
    const pc = t.post('clt');
    const delivered = await w.prisma.vacancy_stories.create({ data: { workspace_id: WS_A, source: 'freela_clt', external_id: 'x9', snapshot: {}, fingerprint: 'f', starts_at: new Date(NOW.getTime() + DAY), status: 'handed_off', ig_post_id: pc.id } });
    await w.settings.cltDisable(OWNER, WS_A);
    await w.settings.cltEnable(OWNER, WS_A);
    const r = (id: string) => w.t['vacancy_stories']!.rows.find((x) => x.id === id)!;
    expect(r(queued.id)).toMatchObject({ status: 'new', skip_reason: null });
    expect(r(late.id)).toMatchObject({ status: 'cancelled', skip_reason: CLT_DISABLED_REASON });
    expect(r(delivered.id).status).toBe('handed_off');
    expect(w.t['ig_posts']!.rows.find((x) => x.id === pc.id)!.status).toBe('cancelled');
    expect(w.t['activity_logs']!.rows.find((x) => x.action === 'vacancy_stories.clt_enable')!.metadata).toMatchObject({ revived: 1 });
  });

  it('arte modelo apagada desliga só as diárias (a CLT não usa a arte modelo)', async () => {
    const t = await setup({ settings: { template_asset_id: null, clt_enabled: true, clt_enabled_at: NOW } });
    const poll = new VacancyPollService(w.prisma, w.feedClient, w.gate, w.settings);
    const c = await t.cltRow(job());
    expect(await poll.disableOrphans()).toBe(1);
    expect(t.row()).toMatchObject({ enabled: false, clt_enabled: true });
    expect(w.t['vacancy_stories']!.rows.find((x) => x.id === c.id)!.status).toBe('new');
  });

  it('A×B: ligar a CLT de A não liga a de B; membro de B não liga a de A; fora da lista = 404', async () => {
    await setup({ list: `${WS_A},${WS_B}` });
    w.brand();
    await w.prisma.vacancy_story_settings.create({ data: { workspace_id: WS_B } });
    expect(await status(w.settings.cltEnable(STRANGER, WS_A))).toBe(NOT_MEMBER);
    await w.settings.cltEnable(OWNER, WS_A);
    expect(w.t['vacancy_story_settings']!.rows.find((r) => r.workspace_id === WS_B)!.clt_enabled).toBe(false);
    expect(await status(w.settings.cltDisable(OWNER, WS_B))).toBe(NOT_MEMBER);
    const other = uuid();
    expect(await status(w.settings.cltEnable(OWNER, other))).toBe('404:Página não encontrada.');
  });
});

describe('Ajustes: números só das diárias (revisão 24/11)', () => {
  it('resultados dos últimos stories e da semana são só das diárias: vaga fixa entregue, na reserva ou não postada não entra', async () => {
    const t = await setup({ settings: { clt_enabled: true, clt_enabled_at: NOW } });
    const cltPost = seedPost(w, { source: 'vacancy', format: 'story_image', status: 'published', created_at: NOW, creative_brief: { compose: false, vacancy: { kind: 'clt', used_fallback: true } } });
    await t.cltRow(job(), { status: 'handed_off', ig_post_id: cltPost.id, used_fallback: true });
    await t.cltRow(job(), { status: 'cancelled', skip_reason: DONT_POST_REASON });
    const dailyPost = t.post('diaria', 'published');
    await t.diariaRow(diaria(), { status: 'handed_off', ig_post_id: dailyPost.id });
    const view = await w.settings.view(WS_A, NOW);
    expect(view.recent_outcomes).toEqual({ n: 1, first_try: 1, redone: 0, fallback: 0, not_posted: 0 });
    expect(view.week).toEqual({ total: 1, fallback: 0 });
  });
});

describe('rotas das vagas fixas (M18)', () => {
  it('clt/enable e clt/disable exigem dono/admin (manage); passam a kind da lista e da prévia', async () => {
    const proto = VacancyStoriesController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(ACCESS_LEVEL_KEY, proto['cltEnable']!)).toBe('manage');
    expect(Reflect.getMetadata(ACCESS_LEVEL_KEY, proto['cltDisable']!)).toBe('manage');
    expect(Reflect.getMetadata('path', proto['cltEnable']!)).toBe('clt/enable');
    expect(Reflect.getMetadata('path', proto['cltDisable']!)).toBe('clt/disable');
    const calls: unknown[][] = [];
    const ctl = new VacancyStoriesController(
      {} as never,
      { list: async (...a: unknown[]) => calls.push(['list', ...a]) } as never,
      { start: async (...a: unknown[]) => calls.push(['start', ...a]) } as never,
    );
    await ctl.list(WS_A, { filter: 'live', kind: 'clt' });
    await ctl.startPreview({ id: OWNER } as never, WS_A, { kind: 'clt' });
    expect(calls).toEqual([['list', WS_A, 'live', 'clt'], ['start', OWNER, WS_A, { qr: undefined, kind: 'clt' }]]);
  });
});

describe('lista com as duas fontes (M18)', () => {
  it('kind filtra; lista misturada não quebra; linha CLT com cargo, empresa, salário, cidade, "divulgar até" e sem link sem a página', async () => {
    const t = await setup({ settings: { clt_enabled: true, clt_enabled_at: NOW } });
    const v = job({ title: 'Atendente CLT', city: null, uf: null });
    await t.cltRow(v);
    await t.diariaRow(diaria());
    const all = await t.actions.list(WS_A);
    expect(all.map((x) => x.kind).sort()).toEqual(['clt', 'diaria']);
    const [c] = await t.actions.list(WS_A, 'all', 'clt');
    expect(c).toMatchObject({
      kind: 'clt', funcao: 'Atendente', estabelecimento: 'Spoleto Shopping Anália Franco', valor: 'R$ 1.874,32', cidade: null,
      quando: 'divulgar até 24/12', freela_url: null, promote_until: cltDeadline(v), display: 'queued',
    });
    expect((await t.actions.list(WS_A, 'all', 'diaria')).map((x) => x.kind)).toEqual(['diaria']);
    expect(await validate(plainToInstance(ListStoriesQuery, { kind: 'xx' }))).toHaveLength(1);
  });

  it('sem kind: 100 de cada tipo (100 vagas fixas mais novas não empurram a diária para fora da lista), da mais nova para a mais velha', async () => {
    const t = await setup({ settings: { clt_enabled: true, clt_enabled_at: NOW } });
    await t.diariaRow(diaria());
    for (let i = 0; i < 100; i++) await t.cltRow(job());
    const all = await t.actions.list(WS_A);
    expect(all).toHaveLength(101);
    expect(all.filter((x) => x.kind === 'diaria')).toHaveLength(1);
    expect(all[all.length - 1]!.kind).toBe('diaria');
    expect(await t.actions.list(WS_A, 'all', 'clt')).toHaveLength(100);
  });

  it('com a página no ar, a linha CLT traz o link; a diária continua com o link da vaga', async () => {
    const t = await setup({ settings: { clt_enabled: true, clt_enabled_at: NOW }, page: 'https://freelaservicos.com.br/vagas-fixas/' });
    const v = job({ id: '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f' });
    await t.cltRow(v);
    const [c] = await t.actions.list(WS_A, 'all', 'clt');
    expect(c!.freela_url).toBe('https://freelaservicos.com.br/vagas-fixas/3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f');
  });

  it('ações por tipo: com a CLT desligada, "Criar story mesmo assim" na linha CLT responde o texto das vagas fixas', async () => {
    const t = await setup();
    const c = await t.cltRow(job(), { status: 'skipped', skip_reason: 'Cidade fora da sua lista: São Paulo.' });
    expect(await status(t.actions.createAnyway(OWNER, WS_A, c.id))).toBe('400:Ligue os stories das vagas fixas para usar esta ação.');
    t.row().clt_enabled = true;
    const v = w.t['vacancy_stories']!.rows.find((x) => x.id === c.id)!.snapshot as FreelaFixedJob;
    w.feed.state.clt.push(v);
    await t.actions.createAnyway(OWNER, WS_A, c.id);
    expect(w.t['vacancy_stories']!.rows.find((x) => x.id === c.id)).toMatchObject({ status: 'new', forced: true, starts_at: cltDeadline(v) });
  });
});

describe('prévia da vaga fixa (M18)', () => {
  it('kind=clt: não exige arte modelo, usa a vaga fixa mais recente com salário e grava preview.kind = clt; não destrava o QR', async () => {
    const t = await setup({ settings: { template_asset_id: null } });
    w.brand();
    w.ai.image.mockRejectedValue(new Error('sem crédito'));
    w.feed.state.clt = [job({ salary: null, publishedAt: NOW.toISOString() }), job({ title: 'Cumim', role: 'cumim' })];
    expect(await validate(plainToInstance(StartPreviewDto, { kind: 'clt' }))).toHaveLength(0);
    expect(await validate(plainToInstance(StartPreviewDto, { kind: 'x' }))).toHaveLength(1);
    await t.preview.start(OWNER, WS_A, { kind: 'clt', qr: true });
    await t.preview.wait(WS_A);
    const p = t.row().preview as Record<string, unknown>;
    expect(p).toMatchObject({ status: 'done', kind: 'clt', sample: false, vacancy: { funcao: 'Cumim' } });
    expect(await status(w.settings.setQr(OWNER, WS_A, true))).toBe('422:Gere uma prévia com o QR para poder ligar.');
  });

  it('kind=clt sem vaga fixa na vitrine → vaga fixa de exemplo; diária sem arte modelo continua 400', async () => {
    const t = await setup({ settings: { template_asset_id: null } });
    w.ai.image.mockRejectedValue(new Error('sem crédito'));
    await t.preview.start(OWNER, WS_A, { kind: 'clt' });
    await t.preview.wait(WS_A);
    expect(t.row().preview).toMatchObject({ status: 'done', kind: 'clt', sample: true });
    expect(await status(t.preview.start(OWNER, WS_A))).toBe('400:Envie a arte modelo antes de gerar a prévia.');
  });
});
