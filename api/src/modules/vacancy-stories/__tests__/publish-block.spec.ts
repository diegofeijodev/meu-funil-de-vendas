jest.setTimeout(60_000);

import { PUBLISH_BLOCKED_MSG } from '../../instagram/ig-types';
import { igServices, seedPost, uuid } from '../../instagram/__tests__/harness';
import { RefsService } from '../../creative/refs.service';
import { AssetsService } from '../../media/assets.service';
import { WS_A, WS_B } from '../../media/__tests__/mem';
import { storyView } from '../vacancy-display';
import { VacancyGeneratorService } from '../vacancy-generator.service';
import { VacancyPollService } from '../vacancy-poll.service';
import { blockedExpireReason, PUBLISH_BLOCKED_WAIT } from '../vacancy-reasons';
import { VacancySchedulerService } from '../vacancy-scheduler.service';
import { fingerprint } from '../vacancy-text';
import type { FreelaVacancy, SettingsRow, StoryRow } from '../vacancy-types';
import { vacancyWorld, type VacancyWorld } from './world';

const NOW = new Date('2026-10-29T13:00:00Z'); // quinta, 10h em Brasília
const SINCE = new Date('2026-10-29T11:30:00Z'); // 8h30
const MIN = 60_000;
const HOUR = 60 * MIN;
const vac = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: uuid(), title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-10-31',
  startTime: '2026-10-31T21:00:00Z', endTime: '2026-11-01T02:00:00Z', amountInCents: 15000,
  contractorName: 'COCO BAMBU', publishedAt: '2026-10-29T10:00:00Z', ...o,
});

let w: VacancyWorld;
afterEach(() => w?.cleanup());

async function setup(o: { list?: string } = {}) {
  w = vacancyWorld({ list: o.list ?? `${WS_A},${WS_B}` });
  const s = igServices(w, { guards: w.guard });
  const assets = new AssetsService(w.prisma, w.files, w.images, jest.fn() as never, w.env);
  const refs = new RefsService(w.prisma, w.files, assets, w.images);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gen = new VacancyGeneratorService(w.prisma, w.ai as any, w.images, w.files, assets, refs, w.store, w.feedClient, w.gate);
  gen.now = () => NOW.getTime();
  const sched = new VacancySchedulerService(w.prisma, w.store, s.publishing, w.guard, gen, w.gate);
  sched.now = () => NOW.getTime();
  sched.onModuleInit();
  const poll = new VacancyPollService(w.prisma, w.feedClient, w.gate, w.settings);
  for (const ws of [WS_A, WS_B]) {
    await w.prisma.vacancy_story_settings.create({ data: { workspace_id: ws, enabled: true, enabled_at: new Date('2026-10-29T09:00:00Z'), template_asset_id: uuid(), auto_publish: true } });
    w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: ws, status: 'connected', ig_user_id: `ig-${ws}`, username: 'freela', publish_block_reason: null, publish_block_failures: 0 });
  }
  const settings = (ws = WS_A) => w.t['vacancy_story_settings']!.rows.find((r) => r.workspace_id === ws) as SettingsRow;
  const row = (id: string) => w.t['vacancy_stories']!.rows.find((r) => r.id === id)!;
  const story = async (v: FreelaVacancy, over: Record<string, unknown> = {}, ws = WS_A) => {
    w.feed.state.byId.set(v.id, v);
    return w.prisma.vacancy_stories.create({ data: { workspace_id: ws, external_id: v.id, snapshot: v, fingerprint: fingerprint(v), starts_at: new Date(v.startTime), status: 'new', ...over } });
  };
  const delivered = async (v: FreelaVacancy, over: Record<string, unknown> = {}, ws = WS_A) => {
    w.feed.state.byId.set(v.id, v);
    const post = seedPost(w, {
      workspace_id: ws, source: 'vacancy', format: 'story_image', status: 'ready', approved_at: null, created_at: NOW,
      creative_brief: { compose: false, vacancy: { external_id: v.id, fingerprint: fingerprint(v), requires_approval: false, starts_at: v.startTime } }, ...over,
    });
    const r = await w.prisma.vacancy_stories.create({ data: { workspace_id: ws, external_id: v.id, snapshot: v, fingerprint: fingerprint(v), starts_at: new Date(v.startTime), status: 'handed_off', ig_post_id: post.id } });
    return { post, row: r };
  };
  const block = (ws = WS_A) => w.store.openPublishBlock(ws, 'permission', '(#10) sem permissão', { now: SINCE });
  return { s, gen, sched, poll, settings, row, story, delivered, block };
}

describe('gerador com a publicação bloqueada (R5, V1)', () => {
  it('nenhuma chamada à IA e a linha espera com o motivo; a empresa B segue', async () => {
    const x = await setup();
    await x.block(WS_A);
    const a = await x.story(vac());
    const b = await x.story(vac(), {}, WS_B);
    // B gera (falha na arte modelo de mentira, mas PEGOU a linha); A nem é pega.
    await x.gen.generateDue(NOW);
    expect(x.row(a.id)).toMatchObject({ status: 'new', wait_reason: PUBLISH_BLOCKED_WAIT });
    expect(x.row(b.id).wait_reason).not.toBe(PUBLISH_BLOCKED_WAIT);
    expect(w.ai.image.mock.calls.every((c) => c[0] !== WS_A)).toBe(true);
    expect(w.ai.json.mock.calls.every((c) => c[0] !== WS_A)).toBe(true);
  });
});

describe('agenda com a publicação bloqueada (R6)', () => {
  it('post pronto não é agendado (fica pronto com o aviso, sem job); ao fechar, a rodada agenda', async () => {
    const x = await setup();
    await x.block();
    const { post } = await x.delivered(vac());
    expect(await x.sched.scheduleVacancyPost(WS_A, post.id)).toBe('no_account');
    expect(post).toMatchObject({ status: 'ready', last_error: PUBLISH_BLOCKED_MSG });
    expect(w.t['publishing_jobs']!.rows).toHaveLength(0);
    await x.sched.tick(NOW);
    expect(w.t['publishing_jobs']!.rows).toHaveLength(0);
    await w.store.closePublishBlock(WS_A, 'reconnect', NOW);
    expect(await x.sched.tick(NOW)).toMatchObject({ reconciled: 1 });
    expect(post.status).toBe('scheduled');
    expect(w.t['publishing_jobs']!.rows.filter((j) => j.status === 'pending')).toHaveLength(1);
  });
});

describe('motivo claro ao expirar durante o bloqueio (R5: nunca o tooCloseReason genérico)', () => {
  const close = vac({ startTime: new Date(NOW.getTime() + HOUR).toISOString(), endTime: new Date(NOW.getTime() + 6 * HOUR).toISOString(), date: '2026-10-29' });
  const REASON = 'Não foi ao ar: o Instagram recusava as publicações desta empresa desde Qui, 29/10 às 8h30, e a vaga começa às 11h.';

  it('texto', () => {
    expect(blockedExpireReason(new Date(close.startTime), SINCE)).toBe(REASON);
    expect(blockedExpireReason(new Date('2026-10-31T21:00:00Z'), SINCE)).toBe('Não foi ao ar: o Instagram recusava as publicações desta empresa desde Qui, 29/10 às 8h30, e a vaga começa Sáb, 31/10 às 18h.');
  });

  it('linha esperando o bloqueio que entrou na antecedência', async () => {
    const x = await setup();
    await x.block();
    const r = await x.story(close, { status: 'waiting', wait_reason: PUBLISH_BLOCKED_WAIT });
    const other = await x.story(vac({ startTime: close.startTime }), { status: 'waiting', wait_reason: null }, WS_B);
    await x.poll.expireDue(NOW);
    expect(x.row(r.id)).toMatchObject({ status: 'expired', skip_reason: REASON });
    // B (sem bloqueio) recebe o motivo de sempre
    expect(x.row(other.id).skip_reason).toMatch(/^A vaga começa/);
  });

  it('post parado pelo bloqueio que a expiração (T10) cancelou porque a vaga começou', async () => {
    const x = await setup();
    await x.block();
    const started = vac({ startTime: new Date(NOW.getTime() - MIN).toISOString(), date: '2026-10-29' });
    const { post, row } = await x.delivered(started, { last_error: PUBLISH_BLOCKED_MSG });
    await x.poll.expireDue(NOW);
    expect(post.status).toBe('cancelled');
    expect(x.row(row.id).skip_reason).toBe(blockedExpireReason(new Date(started.startTime), SINCE));
  });

  it('post parado pelo bloqueio que a guarda cancela logo depois do fechamento (o início do bloqueio fica guardado)', async () => {
    const x = await setup();
    await x.block();
    await w.store.closePublishBlock(WS_A, 'reconnect', NOW);
    const { post, row } = await x.delivered(close, { last_error: PUBLISH_BLOCKED_MSG, status: 'scheduled' });
    expect(await w.guard.blockReason(post, NOW)).toBe(REASON);
    expect(x.row(row.id).skip_reason).toBe(REASON);
    // sem o aviso do bloqueio, o motivo de sempre
    const plain = await x.delivered(vac({ startTime: close.startTime, date: '2026-10-29' }), { status: 'scheduled' });
    expect(await w.guard.blockReason(plain.post, NOW)).toMatch(/^A vaga começa/);
  });
});

describe('aba Vagas durante o bloqueio (P7)', () => {
  it('linha e post parados ganham a situação própria e "Postar agora" some; sem bloqueio, nada muda', async () => {
    const x = await setup();
    const s = x.settings();
    const r = { ...(await x.story(vac(), { status: 'waiting', wait_reason: PUBLISH_BLOCKED_WAIT })) } as StoryRow;
    expect(storyView(r, null, s, NOW, { publishBlocked: true })).toMatchObject({ display: 'paused', label: 'Esperando o Instagram voltar' });
    expect(storyView(r, null, s, NOW, {}).display).toBe('queued');
    const { post, row } = await x.delivered(vac(), { last_error: PUBLISH_BLOCKED_MSG, status: 'scheduled', scheduled_at: new Date(NOW.getTime() + 26 * HOUR) });
    const v = storyView(row as StoryRow, post, s, NOW, { publishBlocked: true });
    expect(v).toMatchObject({ display: 'paused_ready', label: 'Pronto, esperando o Instagram voltar' });
    expect(v.support).toBe('Vai ao ar quando a Meta voltar a aceitar publicações, se ainda der tempo: até dia 31/10 às 15h45.');
    expect(v.can.post_now).toBe(false);
    expect(storyView(row as StoryRow, post, s, NOW, { capFull: true }).can.post_now).toBe(true);
  });
});

describe('produção automática (R7): conta bloqueada conta como não conectada', () => {
  it('post da programação a 30 h só entra sem bloqueio; a 20 h entra mesmo bloqueada', async () => {
    const x = await setup();
    const post = (h: number) => seedPost(w, { status: 'idea', run_id: uuid(), scheduled_at: new Date(Date.now() + h * HOUR), media: [] });
    const far = post(30);
    expect((await x.s.production.candidates()).map((c) => c.id)).toEqual([far.id]);
    await w.store.openPublishBlock(WS_A, 'permission', '(#10)');
    expect(await x.s.production.candidates()).toEqual([]);
    const near = post(20);
    expect((await x.s.production.candidates()).map((c) => c.id)).toEqual([near.id]);
  });
});
