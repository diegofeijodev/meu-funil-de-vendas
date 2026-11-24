jest.setTimeout(120_000);

import { igServices, seedPost, uuid } from '../../instagram/__tests__/harness';
import { AssetsService } from '../../media/assets.service';
import { RefsService } from '../../creative/refs.service';
import { WS_A, status } from '../../media/__tests__/mem';
import { cltDeadline, cltFingerprint } from '../vacancy-clt';
import { VacancyGeneratorService } from '../vacancy-generator.service';
import { VacancyPollService } from '../vacancy-poll.service';
import {
  CLT_CLOSED_REASON, CLT_STARTED_REASON, cltBlockedExpireReason, cltCapWaitReason, cltDeadlineReason, cltNoApprovalReason, PUBLISH_BLOCKED_WAIT, WAIT_CAP,
} from '../vacancy-reasons';
import { VacancySchedulerService } from '../vacancy-scheduler.service';
import { fingerprint } from '../vacancy-text';
import type { FreelaFixedJob, FreelaVacancy, SettingsRow } from '../vacancy-types';
import { countVacancyStoriesOnDay } from '../vacancy-usage';
import { fixedJob, vacancyWorld, type VacancyWorld } from './world';

const NOW = new Date('2026-11-25T13:00:00Z'); // quarta, 10h em Brasília
const DAY = 86_400_000;
const MIN = 60_000;
/** Publicada há 2 dias: divulgar até 22/12 (sexta 13h UTC). */
const job = (o: Partial<FreelaFixedJob> = {}) => fixedJob({ publishedAt: new Date(NOW.getTime() - 2 * DAY).toISOString(), ...o });
const diaria = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: uuid(), title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-11-28', startTime: '2026-11-28T21:00:00Z',
  endTime: '2026-11-29T02:00:00Z', amountInCents: 15000, contractorName: 'COCO BAMBU', publishedAt: '2026-11-25T10:00:00Z', ...o,
});

let w: VacancyWorld;
afterEach(() => w?.cleanup());

async function setup(o: { settings?: Record<string, unknown>; ig?: boolean } = {}) {
  w = vacancyWorld();
  const s = igServices(w, { guards: w.guard });
  const generator = { hooks: {} } as VacancyGeneratorService;
  const sched = new VacancySchedulerService(w.prisma, w.store, s.publishing, w.guard, generator, w.gate);
  sched.now = () => NOW.getTime();
  sched.onModuleInit();
  await w.prisma.vacancy_story_settings.create({
    data: { workspace_id: WS_A, enabled: false, clt_enabled: true, clt_enabled_at: new Date(NOW.getTime() - DAY), auto_publish: true, ...o.settings },
  });
  if (o.ig !== false) w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, status: 'connected', ig_user_id: '17841', username: 'freela' });
  const settings = () => w.t['vacancy_story_settings']!.rows.find((r) => r.workspace_id === WS_A) as SettingsRow;
  /** Post de vaga fixa entregue como o gerador deixa (linha `freela_clt` + `creative_brief.vacancy.kind = 'clt'`). */
  const deliveredClt = async (v: FreelaFixedJob, over: Record<string, unknown> = {}, row: Record<string, unknown> = {}) => {
    w.feed.state.clt.push(v);
    const post = seedPost(w, {
      source: 'vacancy', format: 'story_image', status: 'ready', approved_at: null, caption: null, hashtags: [], cta: null, created_at: NOW,
      theme: 'Vaga fixa · Atendente · Spoleto', creative_brief: { compose: false, vacancy: { external_id: v.id, fingerprint: cltFingerprint(v), requires_approval: false, starts_at: cltDeadline(v).toISOString(), kind: 'clt' } },
      ...over,
    });
    await w.prisma.vacancy_stories.create({
      data: { workspace_id: WS_A, source: 'freela_clt', external_id: v.id, snapshot: v, fingerprint: cltFingerprint(v), starts_at: cltDeadline(v), status: 'handed_off', ig_post_id: post.id, ...row },
    });
    return post;
  };
  const deliveredDiaria = async (v: FreelaVacancy, over: Record<string, unknown> = {}) => {
    w.feed.state.byId.set(v.id, v);
    const post = seedPost(w, {
      source: 'vacancy', format: 'story_image', status: 'ready', approved_at: null, created_at: NOW,
      creative_brief: { compose: false, vacancy: { external_id: v.id, fingerprint: fingerprint(v), requires_approval: false, starts_at: v.startTime } }, ...over,
    });
    await w.prisma.vacancy_stories.create({ data: { workspace_id: WS_A, external_id: v.id, snapshot: v, fingerprint: fingerprint(v), starts_at: new Date(v.startTime), status: 'handed_off', ig_post_id: post.id } });
    return post;
  };
  return { s, sched, settings, deliveredClt, deliveredDiaria };
}

describe('contagem do dia por tipo (M17)', () => {
  it('diária = sem linha CLT (posts antigos sem linha contam como diária); CLT = linha freela_clt', async () => {
    const t = await setup();
    await t.deliveredDiaria(diaria());
    await t.deliveredClt(job());
    seedPost(w, { source: 'vacancy', status: 'published', published_at: NOW, created_at: NOW }); // post antigo, sem linha
    expect(await countVacancyStoriesOnDay(w.prisma, WS_A, '2026-11-25')).toEqual({ posted: 1, scheduled: 1 });
    expect(await countVacancyStoriesOnDay(w.prisma, WS_A, '2026-11-25', undefined, 'freela_clt')).toEqual({ posted: 0, scheduled: 1 });
  });

  it('limite próprio: 10 diárias hoje não seguram a vaga fixa; 2 vagas fixas hoje seguram (clt_daily_cap 2)', async () => {
    const t = await setup({ settings: { enabled: true, daily_cap: 10 } });
    for (let i = 0; i < 10; i++) await t.deliveredDiaria(diaria());
    const row = { workspace_id: WS_A, source: 'freela_clt', starts_at: cltDeadline(job()), post_now: false } as never;
    expect(await t.sched.capacityFor(WS_A, t.settings(), '2026-11-25', undefined, 'freela_clt')).toEqual({ used: 0, cap: 2 });
    expect(await t.sched.capacityWait(row, t.settings(), NOW)).toBeNull();
    await t.deliveredClt(job());
    await t.deliveredClt(job());
    expect(await t.sched.capacityWait(row, t.settings(), NOW)).toEqual(new Date('2026-11-26T11:00:00Z'));
  });
});

describe('agenda das vagas fixas (M17)', () => {
  it('retroativo em gotas: 6 vagas fixas prontas → 2 hoje, 2 amanhã, 2 depois de amanhã (V8)', async () => {
    const t = await setup();
    // Como na entrega do gerador: cada story é agendado logo depois de entregue (o pronto conta no dia em que foi criado).
    const posts = [];
    for (let i = 0; i < 6; i++) {
      const p = await t.deliveredClt(job());
      expect(await t.sched.scheduleVacancyPost(WS_A, p.id)).toBe('scheduled');
      posts.push(p);
    }
    const days = posts.map((p) => w.t['ig_posts']!.rows.find((x) => x.id === p.id)!.scheduled_at.toISOString().slice(0, 10));
    expect(days).toEqual(['2026-11-25', '2026-11-25', '2026-11-26', '2026-11-26', '2026-11-27', '2026-11-27']);
  });

  it('prazo curto e o limite cheio: cancela com o motivo CLT do limite', async () => {
    const t = await setup({ settings: { clt_daily_cap: 1 } });
    await t.deliveredClt(job());
    const v = job({ expiresAt: new Date(NOW.getTime() + 20 * 60 * MIN).toISOString() }); // vence amanhã antes das 8h
    const p = await t.deliveredClt(v);
    expect(await t.sched.scheduleVacancyPost(WS_A, p.id)).toBe('cancelled');
    expect(w.t['vacancy_stories']!.rows.find((r) => r.ig_post_id === p.id)!.skip_reason).toBe(cltCapWaitReason(1, cltDeadline(v)));
  });

  it('interruptor por tipo: CLT desligada → recusa com o texto das vagas fixas; diárias desligadas e CLT ligada → agenda', async () => {
    const t = await setup({ settings: { enabled: false, clt_enabled: false } });
    const p = await t.deliveredClt(job());
    expect(await status(t.sched.scheduleVacancyPost(WS_A, p.id))).toBe('400:Os stories das vagas fixas estão desligados nesta empresa.');
    t.settings().clt_enabled = true;
    expect(await t.sched.scheduleVacancyPost(WS_A, p.id)).toBe('scheduled');
  });

  it('rodada da agenda: com só a CLT ligada, agenda o post CLT e deixa o de diária como está', async () => {
    const t = await setup({ settings: { enabled: false } });
    const c = await t.deliveredClt(job());
    const d = await t.deliveredDiaria(diaria());
    await t.sched.tick(NOW);
    const post = (id: string) => w.t['ig_posts']!.rows.find((x) => x.id === id)!;
    expect(post(c.id).status).toBe('scheduled');
    expect(post(d.id).status).toBe('ready');
  });

  it('o bloqueio de publicação vale para a CLT: o post fica pronto com o aviso, sem agenda', async () => {
    const t = await setup();
    w.t['instagram_accounts']!.rows[0]!.publish_block_reason = 'permission';
    const p = await t.deliveredClt(job());
    expect(await t.sched.scheduleVacancyPost(WS_A, p.id)).toBe('no_account');
    expect(w.t['ig_posts']!.rows.find((x) => x.id === p.id)!.status).toBe('ready');
  });
});

describe('guarda das vagas fixas (M17; V9)', () => {
  it('fechada ou vencida no Freela (404) → cancela com o motivo CLT, gravado na linha', async () => {
    const t = await setup();
    const v = job();
    const p = await t.deliveredClt(v);
    w.feed.state.cltClosed.add(v.id);
    expect(await w.guard.blockReason(p, NOW)).toBe(CLT_CLOSED_REASON);
    expect(w.t['vacancy_stories']!.rows.find((r) => r.ig_post_id === p.id)!.skip_reason).toBe(CLT_CLOSED_REASON);
    expect(w.feed.state.urls.at(-1)).toContain(`/v1/fixed-jobs/public/${v.id}`);
  });

  it('aberta e igual → sai; prazo passado → motivo CLT; mudou o salário → refaz com os dados novos', async () => {
    const t = await setup();
    const v = job();
    const p = await t.deliveredClt(v);
    expect(await w.guard.blockReason(p, NOW)).toBeNull();
    expect(await w.guard.blockReason(p, new Date(cltDeadline(v).getTime() + MIN))).toBe(CLT_STARTED_REASON);
    w.feed.state.clt = [{ ...v, salary: { minInCents: 200000, maxInCents: 200000 } }];
    expect(await w.guard.blockReason(p, NOW)).toBe('A vaga mudou no Freela (valor ou horário). Vamos criar o story de novo.');
    expect(w.t['vacancy_stories']!.rows.find((r) => r.external_id === v.id)).toMatchObject({ status: 'new', ig_post_id: null, redo_count: 1 });
  });

  it('vitrine CLT fora e o prazo guardado já passou → cancela; com prazo → tenta de novo depois (OriginUnavailable)', async () => {
    const t = await setup();
    const p = await t.deliveredClt(job());
    w.feed.state.cltDown = true;
    await expect(w.guard.blockReason(p, NOW)).rejects.toThrow();
    const late = await t.deliveredClt(job({ publishedAt: new Date(NOW.getTime() - 31 * DAY).toISOString() }));
    expect(await w.guard.blockReason(late, NOW)).toBe(CLT_STARTED_REASON);
  });
});

describe('expiração das linhas e posts CLT (M17)', () => {
  it('fila: prazo passado → texto CLT; esperando a vez → limite CLT; parada pelo bloqueio → P19', async () => {
    await setup();
    const poll = new VacancyPollService(w.prisma, w.feedClient, w.gate, w.settings);
    const past = new Date(NOW.getTime() - MIN);
    const base = { workspace_id: WS_A, source: 'freela_clt', snapshot: {}, fingerprint: 'f', starts_at: past };
    const a = await w.prisma.vacancy_stories.create({ data: { ...base, external_id: uuid(), status: 'new' } });
    const b = await w.prisma.vacancy_stories.create({ data: { ...base, external_id: uuid(), status: 'waiting', wait_reason: WAIT_CAP } });
    const c = await w.prisma.vacancy_stories.create({ data: { ...base, external_id: uuid(), status: 'waiting', wait_reason: PUBLISH_BLOCKED_WAIT } });
    const since = new Date(NOW.getTime() - 5 * DAY);
    w.t['instagram_accounts']!.rows[0]!.publish_blocked_at = since;
    const future = await w.prisma.vacancy_stories.create({ data: { ...base, external_id: uuid(), status: 'new', starts_at: new Date(NOW.getTime() + 10 * MIN) } });
    await poll.expireDue(NOW);
    const r = (id: string) => w.t['vacancy_stories']!.rows.find((x) => x.id === id)!;
    expect(r(a.id)).toMatchObject({ status: 'expired', skip_reason: cltDeadlineReason(past) });
    expect(r(b.id)).toMatchObject({ status: 'expired', skip_reason: cltCapWaitReason(2, past) });
    expect(r(c.id)).toMatchObject({ status: 'expired', skip_reason: cltBlockedExpireReason(past, since) });
    // Antecedência 0: o "divulgar até" ainda não chegou, a linha segue.
    expect(r(future.id).status).toBe('new');
  });

  it('esperando aprovação depois do prazo → "Ninguém aprovou a tempo. O prazo era …"; pronto com o prazo passado → texto CLT', async () => {
    const t = await setup({ settings: { auto_publish: false } });
    const poll = new VacancyPollService(w.prisma, w.feedClient, w.gate, w.settings);
    const v = job({ expiresAt: new Date(NOW.getTime() + 5 * MIN).toISOString() });
    const pending = await t.deliveredClt(v, { status: 'pending_approval' });
    const ready = await t.deliveredClt(job({ expiresAt: new Date(NOW.getTime() - MIN).toISOString() }));
    await poll.expireDue(NOW);
    const row = (id: string) => w.t['vacancy_stories']!.rows.find((x) => x.ig_post_id === id)!;
    expect(w.t['ig_posts']!.rows.find((x) => x.id === pending.id)!.status).toBe('cancelled');
    expect(row(pending.id).skip_reason).toMatch(/^Ninguém aprovou a tempo\. O prazo era \d{2}\/\d{2}\.$/);
    expect(row(pending.id).skip_reason).toBe(cltNoApprovalReason(new Date(NOW.getTime() - 10 * MIN)));
    expect(row(ready.id).skip_reason).toBe(CLT_STARTED_REASON);
  });
});

describe('geração com as vagas fixas (M17)', () => {
  async function gen(settings: Record<string, unknown> = {}) {
    const t = await setup({ settings });
    const assets = new AssetsService(w.prisma, w.files, w.images, jest.fn() as never, w.env);
    const refs = new RefsService(w.prisma, w.files, assets, w.images);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = new VacancyGeneratorService(w.prisma, w.ai as any, w.images, w.files, assets, refs, w.store, w.feedClient, w.gate);
    g.now = () => NOW.getTime();
    return { ...t, g };
  }

  it('diárias antes das vagas fixas na mesma rodada; entre as vagas fixas, as mais novas primeiro', async () => {
    const t = await gen({ enabled: true, enabled_at: new Date(NOW.getTime() - DAY) });
    const order: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(t.g as any, 'generateOne').mockImplementation(async (row: any) => { order.push(`${row.source}:${row.external_id}`); return 'handed'; });
    const older = job({ id: 'c-old', publishedAt: new Date(NOW.getTime() - 5 * DAY).toISOString() });
    const newer = job({ id: 'c-new', publishedAt: new Date(NOW.getTime() - DAY).toISOString() });
    // A vaga fixa mais velha tem o prazo mais curto (vem antes por starts_at); a ordem da rodada põe as diárias antes e a mais nova primeiro.
    for (const v of [older, newer]) await w.prisma.vacancy_stories.create({ data: { workspace_id: WS_A, source: 'freela_clt', external_id: v.id, snapshot: v, fingerprint: cltFingerprint(v), starts_at: cltDeadline(v), status: 'new' } });
    const d = diaria({ id: 'd-1', startTime: '2026-12-30T21:00:00Z' });
    await w.prisma.vacancy_stories.create({ data: { workspace_id: WS_A, external_id: d.id, snapshot: d, fingerprint: fingerprint(d), starts_at: new Date(d.startTime), status: 'new' } });
    await t.g.generateDue(NOW);
    expect(order).toEqual(['freela:d-1', 'freela_clt:c-new']);
  });

  it('o bloqueio de publicação vale para a CLT: a linha espera com o aviso e a IA não é chamada', async () => {
    const t = await gen();
    w.t['instagram_accounts']!.rows[0]!.publish_block_reason = 'permission';
    const v = job();
    w.feed.state.clt.push(v);
    const row = await w.prisma.vacancy_stories.create({ data: { workspace_id: WS_A, source: 'freela_clt', external_id: v.id, snapshot: v, fingerprint: cltFingerprint(v), starts_at: cltDeadline(v), status: 'new' } });
    await t.g.generateDue(NOW);
    expect(w.t['vacancy_stories']!.rows.find((r) => r.id === row.id)).toMatchObject({ status: 'new', wait_reason: PUBLISH_BLOCKED_WAIT });
    expect(w.ai.image).not.toHaveBeenCalled();
    expect(w.ai.json).not.toHaveBeenCalled();
  });

  it('linha CLT com a CLT desligada não gera (mesmo com as diárias ligadas)', async () => {
    const t = await gen({ enabled: true, enabled_at: NOW, clt_enabled: false });
    const spy = jest.spyOn(t.g as never, 'generateOne' as never);
    const v = job();
    await w.prisma.vacancy_stories.create({ data: { workspace_id: WS_A, source: 'freela_clt', external_id: v.id, snapshot: v, fingerprint: cltFingerprint(v), starts_at: cltDeadline(v), status: 'new' } });
    await t.g.generateDue(NOW);
    expect(spy).not.toHaveBeenCalled();
  });

  it('ponta a ponta: a vaga fixa vira post de vaga com kind clt, tema "Vaga fixa · …", prazo no starts_at e agenda pela CLT', async () => {
    const t = await gen();
    t.g.hooks.afterHandOff = (ws, id) => t.sched.afterHandOff(ws, id);
    t.g.hooks.capacityWait = (row, s, now) => t.sched.capacityWait(row, s, now);
    t.g.hooks.beforeGenerate = (row, s, now) => t.sched.generationBlock(row, s, now);
    w.brand();
    w.ai.image.mockRejectedValue(new Error('sem crédito')); // a arte sai sem foto (reserva do sistema)
    const v = job();
    w.feed.state.clt.push(v);
    await w.prisma.vacancy_stories.create({ data: { workspace_id: WS_A, source: 'freela_clt', external_id: v.id, snapshot: v, fingerprint: cltFingerprint(v), starts_at: cltDeadline(v), status: 'new' } });
    expect(await t.g.generateDue(NOW)).toMatchObject({ handed: 1 });
    const post = w.t['ig_posts']!.rows.find((p) => p.source === 'vacancy')!;
    expect(post.theme).toBe('Vaga fixa · Atendente · Spoleto Shopping Anália Franco');
    expect(post.creative_brief.vacancy).toMatchObject({ kind: 'clt', external_id: v.id, starts_at: cltDeadline(v).toISOString(), checked_fields: ['funcao', 'valor', 'cidade', 'estabelecimento'] });
    expect(post.status).toBe('scheduled');
  });
});
