import { SchedulerRegistry } from '@nestjs/schedule';
import { WS_A } from '../../media/__tests__/mem';
import { uuid } from '../../instagram/__tests__/harness';
import { CronAuthService } from '../../scheduler/cron-auth.service';
import { JOB_SCHEDULES } from '../../scheduler/job-schedules';
import { SchedulerService } from '../../scheduler/scheduler.service';
import { VacancyPollService } from '../vacancy-poll.service';
import { VacancyStoriesCronController } from '../vacancy-stories-cron.controller';
import { VacancyStoriesCronService } from '../vacancy-stories-cron.service';
import { SKIP } from '../vacancy-triage';
import type { FreelaVacancy } from '../vacancy-types';
import { vacancyWorld } from './world';

const WS_B = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-29T15:00:00Z'); // 12h em Brasília
const ENABLED_AT = new Date('2026-10-29T09:00:00Z');
const vac = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: uuid(), title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-10-30',
  startTime: '2026-10-30T20:00:00Z', endTime: '2026-10-31T02:00:00Z', amountInCents: 15000,
  contractorName: 'Bar do Zé', publishedAt: '2026-10-29T10:00:00Z', ...o,
});

function setup(list?: string) {
  const w = vacancyWorld({ list });
  const poll = new VacancyPollService(w.prisma, w.feedClient, w.gate, w.settings);
  const settings = (ws = WS_A, over: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = { workspace_id: ws, enabled: true, enabled_at: ENABLED_AT, template_asset_id: uuid(), cities: [], min_lead_minutes: 120, daily_cap: 10, window_start: '08:00', window_end: '21:00', ...over };
    w.t['vacancy_story_settings']!.rows.push(row);
    return row;
  };
  const stories = () => w.t['vacancy_stories']!.rows;
  const story = (over: Record<string, unknown> = {}) => {
    const r = { id: uuid(), workspace_id: WS_A, source: 'freela', external_id: uuid(), status: 'new', skip_reason: null, wait_reason: null, snapshot: {}, fingerprint: 'f', starts_at: new Date(NOW.getTime() + 90 * 60_000), lease_until: null, ig_post_id: null, ...over };
    stories().push(r);
    return r;
  };
  return { w, poll, settings, stories, story };
}

describe('VacancyPollService.pollAll', () => {
  it('sem retroativo: vaga publicada antes de enabled_at não vira linha', async () => {
    const { w, poll, settings, stories } = setup();
    settings();
    w.feed.state.vacancies = [vac({ publishedAt: '2026-10-29T08:59:00Z' })];
    const r = await poll.pollAll(NOW);
    expect(stories()).toHaveLength(0);
    expect(r).toMatchObject({ workspaces: 1, inserted: 0, skipped: 0 });
  });

  it('teste e valor nulo viram skipped com o texto; válida vira new; segunda rodada não repete', async () => {
    const { w, poll, settings, stories } = setup();
    settings();
    w.feed.state.vacancies = [vac({ contractorName: 'Bar teste' }), vac({ amountInCents: null }), vac()];
    const r = await poll.pollAll(NOW);
    expect(r).toMatchObject({ workspaces: 1, inserted: 1, skipped: 2 });
    const by = (s: string) => stories().filter((x) => x.status === s);
    expect(by('skipped').map((x) => x.skip_reason).sort()).toEqual([SKIP.test, SKIP.noValue].sort());
    expect(by('new')).toHaveLength(1);
    expect(by('new')[0]).toMatchObject({ source: 'freela', starts_at: new Date('2026-10-30T20:00:00Z') });
    expect(by('new')[0].fingerprint).toMatch(/^[0-9a-f]{40}$/);
    expect(by('new')[0].snapshot).toMatchObject({ title: 'Garçom' });
    const again = await poll.pollAll(NOW);
    expect(again).toMatchObject({ inserted: 0, skipped: 0 });
    expect(stories()).toHaveLength(3);
  });

  it('duas empresas ligadas: uma consulta só; desligada ou fora da lista não ganha linha', async () => {
    const { w, poll, settings, stories } = setup(`${WS_A},${WS_B}`);
    settings(WS_A);
    settings(WS_B);
    settings('33333333-3333-4333-8333-333333333333'); // ligada mas fora da lista
    settings('44444444-4444-4444-8444-444444444444', { enabled: false });
    w.feed.state.vacancies = [vac()];
    const r = await poll.pollAll(NOW);
    expect(w.feed.state.urls.filter((u) => u.includes('/recent'))).toHaveLength(1);
    expect(r.workspaces).toBe(2);
    expect(stories().map((x) => x.workspace_id).sort()).toEqual([WS_A, WS_B].sort());
  });

  it('vitrine fora do ar: grava o erro, mantém last_poll_ok_at, não lança; no sucesso limpa o erro', async () => {
    const { w, poll, settings } = setup();
    const okAt = new Date('2026-10-29T14:50:00Z');
    const s = settings(WS_A, { last_poll_ok_at: okAt });
    w.feed.state.down = true;
    const r = await poll.pollAll(NOW);
    expect(r.error).toBe('Não conseguimos consultar as vagas do Freela.');
    expect(s.last_poll_error).toBe('Não conseguimos consultar as vagas do Freela.');
    expect(s.last_poll_at).toEqual(NOW);
    expect(s.last_poll_ok_at).toEqual(okAt);
    w.feed.state.down = false;
    const later = new Date(NOW.getTime() + 600_000);
    const r2 = await poll.pollAll(later);
    expect(r2.error).toBeUndefined();
    expect(s.last_poll_error).toBeNull();
    expect(s.last_poll_ok_at).toEqual(later);
  });

  it('erro inesperado da vitrine também é gravado, sem exceção', async () => {
    const { w, poll, settings } = setup();
    const s = settings();
    jest.spyOn(w.feedClient, 'recent').mockRejectedValueOnce(new Error('x'));
    const r = await poll.pollAll(NOW);
    expect(r.error).toBe('Não conseguimos consultar as vagas do Freela.');
    expect(s.last_poll_error).toBe('Não conseguimos consultar as vagas do Freela.');
    expect(s.last_poll_at).toEqual(NOW);
  });

  it('recent_cities: contagem das cidades da resposta, maior primeiro', async () => {
    const { w, poll, settings } = setup();
    const s = settings();
    w.feed.state.vacancies = [vac({ city: 'Jundiaí' }), vac({ city: 'Campinas' }), vac({ city: 'Campinas' }), vac({ city: null })];
    await poll.pollAll(NOW);
    expect(s.recent_cities).toEqual([{ city: 'Campinas', count: 2 }, { city: 'Jundiaí', count: 1 }]);
  });

  it('sem empresa ligada não consulta a vitrine', async () => {
    const { w, poll } = setup();
    expect(await poll.pollAll(NOW)).toEqual({ workspaces: 0, inserted: 0, skipped: 0 });
    expect(w.feed.state.urls).toHaveLength(0);
  });
});

describe('VacancyPollService.expireDue', () => {
  it('new começando em 90 min com antecedência de 120 -> expired com o texto', async () => {
    const { poll, settings, story } = setup();
    settings();
    const near = story({ status: 'new', starts_at: new Date('2026-10-29T16:30:00Z') }); // 13h30
    const far = story({ status: 'waiting', starts_at: new Date(NOW.getTime() + 180 * 60_000) });
    expect(await poll.expireDue(NOW)).toBe(1);
    expect(near).toMatchObject({ status: 'expired', skip_reason: 'A vaga começa Qui, 29/10 às 13h30. Para dar tempo de divulgar, o story teria de ir ao ar até as 11h30.' });
    expect(far.status).toBe('waiting');
  });

  it('esperando pelo limite do dia: texto próprio', async () => {
    const { poll, settings, story } = setup();
    settings(WS_A, { daily_cap: 7 });
    const r = story({ status: 'waiting', wait_reason: 'cap', starts_at: new Date(NOW.getTime() + 30 * 60_000) });
    await poll.expireDue(NOW);
    expect(r).toMatchObject({ status: 'expired', skip_reason: 'Não coube no máximo de 7 stories de vagas por dia antes do início da vaga (Qui, 29/10 às 12h30).' });
  });

  it('generating com lease vivo não expira; com lease livre expira', async () => {
    const { poll, settings, story } = setup();
    settings();
    const live = story({ status: 'generating', lease_until: new Date(NOW.getTime() + 60_000) });
    const dead = story({ status: 'generating', lease_until: new Date(NOW.getTime() - 60_000) });
    await poll.expireDue(NOW);
    expect(live.status).toBe('generating');
    expect(dead.status).toBe('expired');
  });
});

describe('VacancyPollService.expireDue (aprovação)', () => {
  it('A4/A5: cancelado no prazo de aprovação, com o prazo e o início no motivo', async () => {
    const { w, poll, settings, story } = setup();
    settings();
    const post = { id: uuid(), workspace_id: WS_A, source: 'vacancy', status: 'pending_approval' };
    w.t['ig_posts']!.rows.push(post);
    const job = { id: uuid(), workspace_id: WS_A, ig_post_id: post.id, status: 'pending' };
    w.t['publishing_jobs']!.rows.push(job);
    const row = story({ status: 'handed_off', ig_post_id: post.id, starts_at: new Date('2026-10-29T21:00:00Z') });
    expect(await poll.expireDue(new Date('2026-10-29T19:30:00Z'))).toBe(1); // 90 min antes
    expect(post.status).toBe('cancelled');
    expect(job.status).toBe('cancelled');
    expect(row.skip_reason).toBe('Ninguém aprovou a tempo. O prazo era Qui, 29/10 às 15h45; a vaga começa às 18h.');
    expect(row.status).toBe('handed_off');
  });

  it('A4: cancela no prazo de aprovação, antes da antecedência (15h50 com a vaga às 18h); prazo na véspera às 21h', async () => {
    const { w, poll, settings, story } = setup();
    settings();
    const mk = (startsAt: string) => {
      const post = { id: uuid(), workspace_id: WS_A, source: 'vacancy', status: 'pending_approval' };
      w.t['ig_posts']!.rows.push(post);
      return { post, row: story({ status: 'handed_off', ig_post_id: post.id, starts_at: new Date(startsAt) }) };
    };
    const today = mk('2026-10-29T21:00:00Z'); // 18h → prazo 15h45
    const tomorrow = mk('2026-10-30T12:00:00Z'); // sexta 9h → prazo quinta 21h
    expect(await poll.expireDue(new Date('2026-10-29T18:40:00Z'))).toBe(0); // 15h40
    expect(await poll.expireDue(new Date('2026-10-29T18:50:00Z'))).toBe(1); // 15h50 (antes, a antecedência só cancelava às 16h)
    expect(today.post.status).toBe('cancelled');
    expect(tomorrow.post.status).toBe('pending_approval');
    expect(await poll.expireDue(new Date('2026-10-30T00:05:00Z'))).toBe(1); // 21h05
    expect(tomorrow.post.status).toBe('cancelled');
    expect(tomorrow.row.skip_reason).toBe('Ninguém aprovou a tempo. O prazo era Qui, 29/10 às 21h; a vaga começa Sex, 30/10 às 9h.');
  });

  it('post pendente que ainda tem tempo não é tocado', async () => {
    const { w, poll, settings, story } = setup();
    settings();
    const post = { id: uuid(), workspace_id: WS_A, source: 'vacancy', status: 'pending_approval' };
    w.t['ig_posts']!.rows.push(post);
    const row = story({ status: 'handed_off', ig_post_id: post.id, starts_at: new Date('2026-10-29T21:00:00Z') });
    expect(await poll.expireDue(NOW)).toBe(0);
    expect(post.status).toBe('pending_approval');
    expect(row.skip_reason).toBeNull();
  });
});

describe('sweepLeases e disableOrphans', () => {
  it('generating com lease vencido volta a waiting', async () => {
    const { poll, story } = setup();
    const dead = story({ status: 'generating', lease_until: new Date(NOW.getTime() - 1000) });
    const live = story({ status: 'generating', lease_until: new Date(NOW.getTime() + 60_000) });
    expect(await poll.sweepLeases(NOW)).toBe(1);
    expect(dead).toMatchObject({ status: 'waiting', lease_until: null });
    expect(live.status).toBe('generating');
  });

  it('empresa ligada sem arte modelo é desligada e registrada', async () => {
    const { w, poll, settings, story } = setup();
    const orphan = settings(WS_A, { template_asset_id: null });
    const fine = settings(WS_B);
    const queued = story({ workspace_id: WS_A, status: 'new' });
    const post = { id: uuid(), workspace_id: WS_A, source: 'vacancy', status: 'scheduled' };
    w.t['ig_posts']!.rows.push(post);
    const job = { id: uuid(), workspace_id: WS_A, ig_post_id: post.id, status: 'pending' };
    w.t['publishing_jobs']!.rows.push(job);
    const row = story({ workspace_id: WS_A, status: 'handed_off', ig_post_id: post.id });
    expect(await poll.disableOrphans()).toBe(1);
    expect(queued).toMatchObject({ status: 'cancelled', skip_reason: 'Os stories das vagas foram desligados.' });
    expect(post.status).toBe('cancelled');
    expect(job.status).toBe('cancelled');
    expect(row.skip_reason).toBe('Os stories das vagas foram desligados.');
    expect(orphan.enabled).toBe(false);
    expect(fine.enabled).toBe(true);
    expect(w.t['activity_logs']!.rows[0]).toMatchObject({ workspace_id: WS_A, action: 'vacancy_stories.disable', metadata: { cancelled: 2, reason: 'arte modelo apagada' } });
  });
});

function cronSetup() {
  const w = vacancyWorld();
  const scheduler = new SchedulerService(new SchedulerRegistry(), w.prisma, { SCHEDULER_ENABLED: false });
  const auth = new CronAuthService(w.prisma, { CRM_CRON_SECRET: 'segredo' });
  const poll = {
    pollAll: jest.fn(async () => ({ workspaces: 1, inserted: 2, skipped: 0 })),
    disableOrphans: jest.fn(async () => 0),
    expireDue: jest.fn(async () => 1),
    sweepLeases: jest.fn(async () => 0),
  };
  const generator = { generateDue: jest.fn(async () => ({ started: 0, handed: 0, waiting: 0, cancelled: 0 })) };
  const agenda = { tick: jest.fn(async () => ({ approved: 0, reconciled: 0 })) };
  const svc = new VacancyStoriesCronService(scheduler, poll as never, generator as never, agenda as never);
  return { w, scheduler, auth, poll, generator, agenda, svc };
}

describe('cron dos stories das vagas', () => {
  it('tick devolve as chaves das etapas, na ordem, mesmo se uma falha', async () => {
    const { svc, poll } = cronSetup();
    poll.expireDue.mockRejectedValueOnce(new Error('banco caiu'));
    const out = await svc.tick();
    expect(Object.keys(out)).toEqual(['poll', 'orphans', 'expired', 'swept', 'scheduler', 'generator']);
    expect(out['expired']).toEqual({ error: 'banco caiu' });
    expect(out['swept']).toBe(0);
    expect(out['scheduler']).toEqual({ approved: 0, reconciled: 0 });
    expect(out['generator']).toEqual({ started: 0, handed: 0, waiting: 0, cancelled: 0 });
  });

  it('a agenda roda antes da geração; erro da geração vira { error }', async () => {
    const { svc, generator, agenda } = cronSetup();
    const calls: string[] = [];
    agenda.tick.mockImplementationOnce(async () => { calls.push('schedule'); return { approved: 1, reconciled: 0 }; });
    generator.generateDue.mockImplementationOnce(async () => { calls.push('generate'); throw new Error('IA caiu'); });
    const out = await svc.tick();
    expect(Object.keys(out)).toEqual(['poll', 'orphans', 'expired', 'swept', 'scheduler', 'generator']);
    expect(calls).toEqual(['schedule', 'generate']);
    expect(out['generator']).toEqual({ error: 'IA caiu' });
  });

  it('registra o job vacancy-stories-10min com o heartbeat vacancy-stories', async () => {
    const { svc, scheduler, w } = cronSetup();
    expect(JOB_SCHEDULES['vacancy-stories-10min']).toEqual({ name: 'vacancy-stories-10min', cron: '*/10 * * * *', heartbeat: 'vacancy-stories' });
    svc.onModuleInit();
    expect(scheduler.list()).toEqual([{ name: 'vacancy-stories-10min', cron: '*/10 * * * *', running: false }]);
    expect(await scheduler.run('vacancy-stories-10min')).toBe(true);
    expect(w.t['cron_heartbeats']!.rows[0]).toMatchObject({ name: 'vacancy-stories', last_status: 'ok' });
  });

  it('rota: sem segredo 401; com segredo roda; heartbeat gravado', async () => {
    const { svc, auth, w } = cronSetup();
    const ctl = new VacancyStoriesCronController(auth, svc);
    await expect(ctl.run(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(ctl.run('errado')).rejects.toMatchObject({ status: 401 });
    const out = await ctl.run('segredo');
    expect(Object.keys(out as object)).toEqual(['poll', 'orphans', 'expired', 'swept', 'scheduler', 'generator']);
    expect(w.t['cron_heartbeats']!.rows[0]).toMatchObject({ name: 'vacancy-stories', last_status: 'ok' });
    w.t['cron_tokens']!.rows.push({ name: 'vacancy-stories', token: 'tok-v' });
    await expect(ctl.run('tok-v')).resolves.toBeDefined();
  });
});
