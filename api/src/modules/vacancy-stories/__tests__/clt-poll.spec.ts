import { WS_A } from '../../media/__tests__/mem';
import { uuid } from '../../instagram/__tests__/harness';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SchedulerService } from '../../scheduler/scheduler.service';
import { cltDeadline, cltFingerprint, CLT_SKIP } from '../vacancy-clt';
import { CLT_FEED_DOWN } from '../vacancy-feed';
import { VacancyPollService } from '../vacancy-poll.service';
import { failedSteps, VacancyStoriesCronService } from '../vacancy-stories-cron.service';
import type { FreelaVacancy } from '../vacancy-types';
import { fixedJob, vacancyWorld } from './world';

const WS_B = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-25T15:00:00Z'); // 12h em Brasília
const ENABLED_AT = new Date('2026-11-25T13:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(ENABLED_AT.getTime() - n * DAY).toISOString();
const vac = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: uuid(), title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-11-27',
  startTime: '2026-11-27T20:00:00Z', endTime: '2026-11-28T02:00:00Z', amountInCents: 15000,
  contractorName: 'Bar do Zé', publishedAt: '2026-11-25T14:00:00Z', ...o,
});

function setup(list?: string) {
  const w = vacancyWorld({ list });
  const poll = new VacancyPollService(w.prisma, w.feedClient, w.gate, w.settings);
  const settings = (ws = WS_A, over: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      workspace_id: ws, enabled: false, enabled_at: null, template_asset_id: null, cities: [], min_lead_minutes: 120, daily_cap: 10,
      window_start: '08:00', window_end: '21:00', clt_enabled: true, clt_enabled_at: ENABLED_AT, clt_daily_cap: 2, clt_backlog_days: 14,
      clt_last_poll_at: null, clt_last_poll_ok_at: null, clt_last_poll_error: null, last_poll_error: null, ...over,
    };
    w.t['vacancy_story_settings']!.rows.push(row);
    return row;
  };
  const stories = () => w.t['vacancy_stories']!.rows;
  return { w, poll, settings, stories };
}

describe('VacancyPollService.pollClt — vagas fixas (M16)', () => {
  it('ninguém com as vagas fixas ligadas: não consulta a vitrine CLT', async () => {
    const { w, poll, settings } = setup();
    settings(WS_A, { clt_enabled: false, enabled: true, enabled_at: ENABLED_AT });
    expect(await poll.pollClt(NOW)).toEqual({ workspaces: 0, inserted: 0, skipped: 0 });
    expect(w.feed.state.urls).toEqual([]);
    w.cleanup();
  });

  it('retroativo de 14 dias: entra a de 10 dias atrás, não a de 20; sem retroativo, só as publicadas depois de ligar', async () => {
    const { w, poll, settings, stories } = setup(`${WS_A},${WS_B}`);
    settings(WS_A);
    settings(WS_B, { clt_backlog_days: 0 });
    const recent = fixedJob({ publishedAt: daysAgo(-0.01) });
    const tenDays = fixedJob({ publishedAt: daysAgo(10) });
    const twenty = fixedJob({ publishedAt: daysAgo(20) });
    w.feed.state.clt = [recent, tenDays, twenty];
    const r = await poll.pollClt(NOW);
    expect(w.feed.state.urls.filter((u) => u.includes('/fixed-jobs/public/recent'))).toHaveLength(1);
    const of = (ws: string) => stories().filter((x) => x.workspace_id === ws).map((x) => x.external_id).sort();
    expect(of(WS_A)).toEqual([recent.id, tenDays.id].sort());
    expect(of(WS_B)).toEqual([recent.id]);
    expect(r).toMatchObject({ workspaces: 2, inserted: 3, skipped: 0 });
    w.cleanup();
  });

  it('linha CLT: source freela_clt, starts_at = divulgar até, assinatura CLT; sem salário vira skipped com o motivo; 2ª rodada não duplica', async () => {
    const { w, poll, settings, stories } = setup();
    settings();
    const ok = fixedJob({ publishedAt: daysAgo(1) });
    const noSalary = fixedJob({ publishedAt: daysAgo(1), salary: null });
    w.feed.state.clt = [ok, noSalary];
    expect(await poll.pollClt(NOW)).toMatchObject({ workspaces: 1, inserted: 1, skipped: 1 });
    const row = stories().find((x) => x.external_id === ok.id)!;
    expect(row).toMatchObject({ source: 'freela_clt', status: 'new', starts_at: cltDeadline(ok), fingerprint: cltFingerprint(ok) });
    expect(row.snapshot).toMatchObject({ role: 'atendente', companyName: 'Spoleto Shopping Anália Franco' });
    expect(stories().find((x) => x.external_id === noSalary.id)).toMatchObject({ status: 'skipped', skip_reason: CLT_SKIP.noSalary });
    expect(await poll.pollClt(NOW)).toMatchObject({ inserted: 0, skipped: 0 });
    expect(stories()).toHaveLength(2);
    w.cleanup();
  });

  it('mesma id na diária e na CLT não colide (a chave única tem a fonte)', async () => {
    const { w, poll, settings, stories } = setup();
    settings(WS_A, { enabled: true, enabled_at: ENABLED_AT });
    const id = uuid();
    w.feed.state.vacancies = [vac({ id })];
    w.feed.state.clt = [fixedJob({ id, publishedAt: daysAgo(1) })];
    await poll.pollAll(NOW);
    await poll.pollClt(NOW);
    expect(stories().map((x) => x.source).sort()).toEqual(['freela', 'freela_clt']);
    w.cleanup();
  });

  it('vitrine CLT fora: o erro vai só para clt_last_poll_error (as diárias seguem limpas); voltou → limpa e grava ok', async () => {
    const { w, poll, settings } = setup();
    const okAt = new Date('2026-11-25T14:50:00Z');
    const s = settings(WS_A, { enabled: true, enabled_at: ENABLED_AT, clt_last_poll_ok_at: okAt });
    w.feed.state.cltDown = true;
    w.feed.state.vacancies = [vac()];
    const d = await poll.pollAll(NOW);
    expect(d.error).toBeUndefined();
    expect(d.clt?.error).toBe(CLT_FEED_DOWN);
    expect(s).toMatchObject({ last_poll_error: null, clt_last_poll_error: CLT_FEED_DOWN, clt_last_poll_at: NOW, clt_last_poll_ok_at: okAt });
    w.feed.state.cltDown = false;
    const later = new Date(NOW.getTime() + 600_000);
    await poll.pollClt(later);
    expect(s).toMatchObject({ clt_last_poll_error: null, clt_last_poll_ok_at: later });
    w.cleanup();
  });

  it('diárias fora não mexem no estado da CLT', async () => {
    const { w, poll, settings } = setup();
    const s = settings(WS_A, { enabled: true, enabled_at: ENABLED_AT });
    w.feed.state.down = true;
    w.feed.state.clt = [fixedJob({ publishedAt: daysAgo(1) })];
    const d = await poll.pollAll(NOW);
    expect(d.error).toBe('Não conseguimos consultar as vagas do Freela.');
    expect(d.clt).toMatchObject({ inserted: 1 });
    expect(s.clt_last_poll_error).toBeNull();
    expect(s.last_poll_error).toBe('Não conseguimos consultar as vagas do Freela.');
    w.cleanup();
  });

  it('empresa fora da lista de liberadas não ganha linha CLT', async () => {
    const { w, poll, settings, stories } = setup(WS_A);
    settings(WS_B);
    w.feed.state.clt = [fixedJob({ publishedAt: daysAgo(1) })];
    expect(await poll.pollClt(NOW)).toEqual({ workspaces: 0, inserted: 0, skipped: 0 });
    expect(stories()).toHaveLength(0);
    w.cleanup();
  });
});

describe('cron dos stories das vagas com a CLT (M16)', () => {
  function cron() {
    const t = setup();
    const scheduler = new SchedulerService(new SchedulerRegistry(), t.w.prisma, { SCHEDULER_ENABLED: false });
    const noop = { tick: async () => ({ approved: 0, reconciled: 0 }) };
    const gen = { generateDue: async () => ({ started: 0, handed: 0, waiting: 0, cancelled: 0 }) };
    const svc = new VacancyStoriesCronService(scheduler, t.poll, gen as never, noop as never);
    return { ...t, svc };
  }

  it('as mesmas etapas de antes; a consulta CLT entra dentro de "poll" (pollAll) e a queda dela marca a rodada como falha', async () => {
    const { w, svc, settings } = cron();
    settings(WS_A, { enabled: true, enabled_at: ENABLED_AT });
    w.feed.state.clt = [fixedJob({ publishedAt: new Date().toISOString() })];
    const out = await svc.tick();
    expect(Object.keys(out)).toEqual(['poll', 'orphans', 'expired', 'swept', 'scheduler', 'generator']);
    expect(out['poll']).toMatchObject({ workspaces: 1, clt: { workspaces: 1 } });
    expect(failedSteps(out)).toEqual([]);
    w.feed.state.cltDown = true;
    const down = await svc.tick();
    expect(down['poll']).toMatchObject({ clt: { error: CLT_FEED_DOWN } });
    expect(failedSteps(down)).toEqual(['poll']);
    w.cleanup();
  });

  it('sem CLT ligada, o resultado da consulta é o de antes (sem a chave clt)', async () => {
    const { w, svc, settings } = cron();
    settings(WS_A, { enabled: true, enabled_at: ENABLED_AT, clt_enabled: false });
    const out = await svc.tick();
    expect(out['poll']).toEqual({ workspaces: 1, inserted: 0, skipped: 0 });
    w.cleanup();
  });
});
