import { AdsCronService } from '../../ads/ads-cron.service';
import { CreativePollJob } from '../../creative/creative.controller';
import { CrmCronService } from '../../crm-channels/crm-cron.service';
import { InstagramCronService } from '../../instagram/instagram-cron.service';
import { ExportsCleanupService } from '../../integrations/exports-cleanup.service';
import { JobDefinition } from '../scheduler.service';

/** Auditoria do agendador: todos os jobs registrados (nome, cron, heartbeat) — db.md §6 + 2 extras do port. */
const collect = (): JobDefinition[] => {
  const jobs: JobDefinition[] = [];
  const scheduler = { register: (j: JobDefinition) => void jobs.push(j) } as any;
  new InstagramCronService(scheduler, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any).onModuleInit();
  new AdsCronService(scheduler, {} as any).onModuleInit();
  new CrmCronService(scheduler, {} as any, {} as any, {} as any).onModuleInit();
  new CreativePollJob(scheduler, {} as any).onModuleInit();
  new ExportsCleanupService({} as any, scheduler, { EXPORTS_TTL_HOURS: 24 }).onModuleInit();
  return jobs;
};

describe('agenda completa do agendador em processo', () => {
  const jobs = collect();

  it('registra exatamente os 10 jobs do pg_cron + 2 extras, com os crons em UTC', () => {
    expect(jobs.map((j) => [j.name, j.cron]).sort()).toEqual(
      [
        ['ads-insights-3h', '17 */3 * * *'],
        ['ads-rules-daily', '40 12 * * *'],
        ['creative-poll-5min', '*/5 * * * *'],
        ['crm-cadences-5min', '*/5 * * * *'],
        ['crm-daily', '10 9 * * *'],
        ['exports-cleanup-hourly', '47 * * * *'],
        ['instagram-account-daily', '25 10 * * *'],
        ['instagram-autopilot-weekly', '0 21 * * 0'],
        ['instagram-media-5min', '*/5 * * * *'],
        ['instagram-metrics-5min', '*/5 * * * *'],
        ['instagram-optimizer-monday', '0 12 * * 1'],
        ['instagram-queue-5min', '*/5 * * * *'],
      ].sort(),
    );
  });

  it('heartbeats: as 4 chaves que o "o que falta configurar" confere + demais nomes do protótipo', () => {
    const hb = Object.fromEntries(jobs.map((j) => [j.name, j.heartbeat]));
    expect(hb['crm-cadences-5min']).toBe('crm-cadences');
    expect(hb['instagram-queue-5min']).toBe('instagram-queue');
    expect(hb['ads-insights-3h']).toBe('ads-sync');
    expect(hb['crm-daily']).toBe('crm-daily');
    expect(hb['instagram-media-5min']).toBe('instagram-media');
    expect(hb['instagram-metrics-5min']).toBe('instagram-metrics');
    expect(hb['instagram-autopilot-weekly']).toBe('instagram-weekly');
    expect(hb['instagram-optimizer-monday']).toBe('instagram-optimize');
    expect(hb['instagram-account-daily']).toBe('instagram-account');
    expect(hb['ads-rules-daily']).toBe('ads-rules');
    expect(new Set(jobs.map((j) => j.heartbeat)).size).toBe(jobs.length);
  });
});
