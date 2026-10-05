import { SchedulerRegistry } from '@nestjs/schedule';
import { JOB_SCHEDULES } from '../job-schedules';
import { SchedulerService } from '../scheduler.service';

const mk = (enabled: boolean) => {
  const beats: any[] = [];
  const prisma = { cron_heartbeats: { upsert: async (a: any) => { beats.push(a); } } } as any;
  const registry = new SchedulerRegistry();
  return { svc: new SchedulerService(registry, prisma, { SCHEDULER_ENABLED: enabled }), registry, beats };
};

describe('SchedulerService', () => {
  it('SCHEDULER_ENABLED=false: registra mas não agenda nada', () => {
    const { svc, registry } = mk(false);
    svc.register({ name: 'x', cron: '*/5 * * * *', handler: async () => {} });
    svc.onApplicationBootstrap();
    expect(registry.getCronJobs().size).toBe(0);
    expect(svc.list()).toEqual([{ name: 'x', cron: '*/5 * * * *', running: false }]);
  });

  it('SCHEDULER_ENABLED=true: agenda os jobs registrados (e desliga no shutdown)', () => {
    const { svc, registry } = mk(true);
    svc.register({ name: 'x', cron: '*/5 * * * *', handler: async () => {} });
    svc.onApplicationBootstrap();
    expect(registry.getCronJobs().size).toBe(1);
    svc.onApplicationShutdown();
    expect(registry.getCronJobs().size).toBe(0);
  });

  it('não aceita job duplicado; run grava heartbeat ok/erro e não se sobrepõe', async () => {
    const { svc, beats } = mk(false);
    let release!: () => void;
    svc.register({ name: 'lento', cron: '* * * * *', heartbeat: 'crm_daily', handler: () => new Promise<void>((r) => (release = r)) });
    svc.register({ name: 'quebra', cron: '* * * * *', handler: async () => { throw new Error('boom'); } });
    expect(() => svc.register({ name: 'lento', cron: '* * * * *', handler: async () => {} })).toThrow(/já registrado/);

    const first = svc.run('lento');
    expect(await svc.run('lento')).toBe(false); // ainda rodando
    release();
    expect(await first).toBe(true);
    expect(beats[0].where.name).toBe('crm_daily');
    expect(beats[0].update.last_status).toBe('ok');

    await svc.run('quebra');
    expect(beats[1].where.name).toBe('quebra');
    expect(beats[1].update).toMatchObject({ last_status: 'error', last_detail: 'boom' });
    await expect(svc.run('nao-existe')).rejects.toThrow(/desconhecido/);
  });

  it('JOB_SCHEDULES tem os 10 jobs do pg_cron + 2 extras', () => {
    expect(Object.keys(JOB_SCHEDULES)).toHaveLength(12);
    expect(JOB_SCHEDULES['crm-daily'].cron).toBe('10 9 * * *');
  });

  it('runExclusive: usa a mesma trava dos ticks; chamada sobreposta devolve { skipped } e libera ao terminar', async () => {
    const { svc } = mk(false);
    let release!: () => void;
    svc.register({ name: 'j1', cron: '* * * * *', handler: () => new Promise<void>((r) => (release = r)) });
    svc.register({ name: 'j2', cron: '* * * * *', handler: async () => {} });
    const tick = svc.run('j1');
    expect(await svc.runExclusive(['j1', 'j2'], async () => 'x')).toEqual({ skipped: 'em execução' });
    release();
    await tick;
    let inside!: () => void;
    const http = svc.runExclusive(['j1', 'j2'], () => new Promise<string>((r) => (inside = () => r('ok'))));
    expect(await svc.run('j2')).toBe(false); // tick de j2 pula enquanto o HTTP roda
    expect(await svc.runExclusive(['j1'], async () => 'y')).toEqual({ skipped: 'em execução' });
    inside();
    expect(await http).toEqual({ value: 'ok' });
    expect(await svc.runExclusive(['j1', 'j2'], async () => 'z')).toEqual({ value: 'z' });
  });
});
