import { SchedulerRegistry } from '@nestjs/schedule';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CronAuthService } from '../../scheduler/cron-auth.service';
import { JOB_SCHEDULES } from '../../scheduler/job-schedules';
import { SchedulerService } from '../../scheduler/scheduler.service';
import { InstagramCronController, InstagramCronDto } from '../instagram-cron.controller';
import { InstagramCronService } from '../instagram-cron.service';
import { igWorld, uuid } from './harness';

const status = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return e.getStatus ? `${e.getStatus()}:${e.getResponse().message}` : `erro:${e.message}`; } };

function auth(env: { CRM_CRON_SECRET?: string } = {}) {
  const w = igWorld();
  return { w, svc: new CronAuthService(w.prisma, env) };
}

describe('CronAuthService (x-cron-secret)', () => {
  it('sem cabeçalho = não autorizado; CRM_CRON_SECRET do ambiente vale; token do banco só pelo nome permitido', async () => {
    const { w, svc } = auth({ CRM_CRON_SECRET: 'segredo-env' });
    w.t['cron_tokens']!.rows.push({ name: 'instagram', token: 'tok-ig' }, { name: 'ads', token: 'tok-ads' });
    expect(await svc.isAuthorized(undefined, ['instagram'])).toBe(false);
    expect(await svc.isAuthorized('', ['instagram'])).toBe(false);
    expect(await svc.isAuthorized('segredo-env', ['instagram'])).toBe(true);
    expect(await svc.isAuthorized('tok-ig', ['instagram'])).toBe(true);
    expect(await svc.isAuthorized(['tok-ig'], ['instagram'])).toBe(true);
    expect(await svc.isAuthorized('tok-ads', ['instagram'])).toBe(false); // token de outro cron
    expect(await svc.isAuthorized('errado', ['instagram'])).toBe(false);
    expect(await svc.isAuthorized('tok-i', ['instagram'])).toBe(false); // tamanho diferente não derruba
  });

  it('sem CRM_CRON_SECRET configurado, só vale o token do banco', async () => {
    const { w, svc } = auth({});
    w.t['cron_tokens']!.rows.push({ name: 'instagram', token: 'tok-ig' });
    expect(await svc.isAuthorized('undefined', ['instagram'])).toBe(false);
    expect(await svc.isAuthorized('tok-ig', ['instagram'])).toBe(true);
  });

  it('heartbeat grava/atualiza cron_heartbeats com status e detalhe (limitado)', async () => {
    const { w, svc } = auth();
    await svc.heartbeat('instagram-queue', 'ok');
    await svc.heartbeat('instagram-queue', 'error', 'x'.repeat(500));
    expect(w.t['cron_heartbeats']!.rows).toHaveLength(1);
    expect(w.t['cron_heartbeats']!.rows[0]).toMatchObject({ name: 'instagram-queue', last_status: 'error' });
    expect(w.t['cron_heartbeats']!.rows[0].last_detail).toHaveLength(300);
  });
});

function cronParts() {
  const calls: string[] = [];
  const fn = (name: string, ret: unknown = []) => jest.fn(async () => { calls.push(name); return ret; });
  const mediaGen = { pollPendingMedia: fn('pollPendingMedia') };
  const publishing = { runPublishingQueue: fn('runPublishingQueue', [{ job: '1', status: 'done' }]) };
  const autoCalendar = { autoCalendarTick: fn('autoCalendarTick', { filled: 0 }) };
  const autopilot = { autopilotTick: fn('autopilotTick', { media: 0 }), runWeeklyAutopilot: fn('runWeeklyAutopilot'), runOptimizer: fn('runOptimizer') };
  const metrics = { collectDueMetrics: fn('collectDueMetrics', 3), learnFromTopPosts: fn('learnFromTopPosts', { added: 0 }), collectAllAccountInsights: fn('collectAllAccountInsights') };
  const production = { productionTick: fn('productionTick', { started: 0 }) };
  const w = igWorld();
  const registry = new SchedulerRegistry();
  const scheduler = new SchedulerService(registry, w.prisma, { SCHEDULER_ENABLED: false });
  const svc = new InstagramCronService(scheduler, mediaGen as any, publishing as any, autoCalendar as any, autopilot as any, metrics as any, {} as any, production as any);
  return { svc, calls, w, scheduler, mediaGen, publishing, autopilot, metrics, production };
}

describe('InstagramCronService.run (tarefas do server.md §5.2)', () => {
  it('queue: mídias assíncronas + fila de publicação (e "publish" é o mesmo)', async () => {
    const { svc, calls } = cronParts();
    expect(await svc.run('queue')).toEqual({ pendingMedia: [], queue: [{ job: '1', status: 'done' }] });
    expect(calls).toEqual(['pollPendingMedia', 'runPublishingQueue']);
    calls.length = 0;
    await svc.run('publish');
    expect(calls).toEqual(['pollPendingMedia', 'runPublishingQueue']);
  });

  it('media: calendário automático e depois o piloto; metrics; weekly; optimize; account', async () => {
    const { svc, calls } = cronParts();
    expect(await svc.run('media')).toEqual({ autoCalendar: { filled: 0 }, production: { started: 0 }, autopilot: { media: 0 } });
    expect(await svc.run('metrics')).toEqual({ metrics: 3, learning: { added: 0 } });
    expect(await svc.run('weekly')).toEqual({ weekly: [] });
    expect(await svc.run('optimize')).toEqual({ optimize: [] });
    expect(await svc.run('account')).toEqual({ account: [] });
    expect(calls).toEqual(['autoCalendarTick', 'productionTick', 'autopilotTick', 'collectDueMetrics', 'learnFromTopPosts', 'runWeeklyAutopilot', 'runOptimizer', 'collectAllAccountInsights']);
  });

  it('sem tarefa: queue + media + metrics (compatibilidade)', async () => {
    const { svc, calls } = cronParts();
    const out = await svc.run();
    expect(Object.keys(out)).toEqual(['pendingMedia', 'queue', 'autoCalendar', 'production', 'autopilot', 'metrics', 'learning']);
    expect(calls).toHaveLength(7);
  });

  it('um passo que quebra não derruba a tarefa (erro vira { error } no resultado)', async () => {
    const { svc, mediaGen, autopilot } = cronParts();
    mediaGen.pollPendingMedia.mockRejectedValueOnce(new Error('provedor fora'));
    expect((await svc.run('queue')).pendingMedia).toEqual({ error: 'provedor fora' });
    autopilot.autopilotTick.mockRejectedValueOnce(new Error('falhou o piloto'));
    expect((await svc.run('media')).autopilot).toEqual({ error: 'falhou o piloto' });
  });

  it('NÃO consulta os criativos do Studio: o job creative-poll-5min (Task 4) já faz isso', () => {
    const src = InstagramCronService.prototype.run.toString() + (InstagramCronService.prototype as any).queue?.toString();
    expect(src).not.toMatch(/pollPendingCreatives/);
    expect(Object.getOwnPropertyNames(InstagramCronService.prototype).join()).not.toMatch(/Creative/);
  });
});

describe('jobs do agendador (db.md §6, em UTC, atrás de SCHEDULER_ENABLED)', () => {
  it('registra os 6 jobs do Instagram com os mesmos horários do pg_cron e os heartbeats que "o que falta configurar" lê', () => {
    const { svc, scheduler } = cronParts();
    svc.onModuleInit();
    const jobs = Object.fromEntries(scheduler.list().map((j) => [j.name, j.cron]));
    expect(jobs).toEqual({
      'instagram-queue-5min': '*/5 * * * *',
      'instagram-media-5min': '*/5 * * * *',
      'instagram-metrics-5min': '*/5 * * * *',
      'instagram-autopilot-weekly': '0 21 * * 0',
      'instagram-optimizer-monday': '0 12 * * 1',
      'instagram-account-daily': '25 10 * * *',
    });
    for (const k of Object.keys(jobs)) expect(JOB_SCHEDULES[k as keyof typeof JOB_SCHEDULES].cron).toBe(jobs[k]);
  });

  it('rodar o job executa a tarefa e grava o heartbeat da chave certa (instagram-queue)', async () => {
    const { svc, scheduler, w, calls } = cronParts();
    svc.onModuleInit();
    expect(await scheduler.run('instagram-queue-5min')).toBe(true);
    expect(calls).toEqual(['pollPendingMedia', 'runPublishingQueue']);
    expect(w.t['cron_heartbeats']!.rows[0]).toMatchObject({ name: 'instagram-queue', last_status: 'ok' });
    await scheduler.run('instagram-optimizer-monday');
    expect(w.t['cron_heartbeats']!.rows.map((r) => r.name)).toEqual(['instagram-queue', 'instagram-optimize']);
  });
});

describe('POST /api/public/cron/instagram', () => {
  function ctrl() {
    const p = cronParts();
    const { w } = p;
    w.t['cron_tokens']!.rows.push({ name: 'instagram', token: 'tok-ig' });
    const c = new InstagramCronController(new CronAuthService(w.prisma, { CRM_CRON_SECRET: undefined }), p.svc);
    return { ...p, c };
  }

  it('401 "Unauthorized" sem token válido (nada é executado)', async () => {
    const { c, calls } = ctrl();
    expect(await status(c.run(undefined, {}))).toBe('401:Unauthorized');
    expect(await status(c.run('errado', { task: 'queue' }))).toBe('401:Unauthorized');
    expect(calls).toEqual([]);
  });

  it('com o token: roda a tarefa e grava o heartbeat DEPOIS (ok); erro grava "error" e propaga', async () => {
    const { c, w, calls, mediaGen } = ctrl();
    expect(await c.run('tok-ig', { task: 'queue' })).toEqual({ pendingMedia: [], queue: [{ job: '1', status: 'done' }] });
    expect(calls).toEqual(['pollPendingMedia', 'runPublishingQueue']);
    expect(w.t['cron_heartbeats']!.rows[0]).toMatchObject({ name: 'instagram-queue', last_status: 'ok' });
    await c.run('tok-ig', { task: 'publish' });
    await c.run('tok-ig', {});
    expect(w.t['cron_heartbeats']!.rows.map((r) => r.name).sort()).toEqual(['instagram-all', 'instagram-queue']);
    (c as any).cron.run = jest.fn(async () => { throw new Error('quebrou'); });
    await expect(c.run('tok-ig', { task: 'media' })).rejects.toThrow('quebrou');
    expect(w.t['cron_heartbeats']!.rows.find((r) => r.name === 'instagram-media')).toMatchObject({ last_status: 'error', last_detail: 'quebrou' });
    void mediaGen;
  });

  it('corpo: só as tarefas conhecidas (validação do DTO)', async () => {
    for (const task of ['queue', 'publish', 'media', 'metrics', 'weekly', 'optimize', 'account', undefined]) expect(await validate(plainToInstance(InstagramCronDto, { task }))).toHaveLength(0);
    expect(await validate(plainToInstance(InstagramCronDto, { task: 'rm -rf' }))).toHaveLength(1);
    expect(uuid()).toBeTruthy();
  });
});
