import { Injectable, OnModuleInit } from '@nestjs/common';
import { JOB_SCHEDULES } from '../scheduler/job-schedules';
import { SchedulerService } from '../scheduler/scheduler.service';
import { AdsOpsService } from './ads-ops.service';

/**
 * Cron do gestor de tráfego (server.md §5.3), igual pela rota `POST /api/public/cron/ads` e pelos jobs do agendador:
 * `sync` (a cada 3 h) traz 3 dias de resultados de cada empresa; `rules` (1x/dia) sincroniza e roda as regras automáticas.
 */
@Injectable()
export class AdsCronService implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly ops: AdsOpsService,
  ) {}

  async run(task?: 'sync' | 'rules'): Promise<{ sync: Awaited<ReturnType<AdsOpsService['syncAllInsights']>>; rules?: Awaited<ReturnType<AdsOpsService['runAllRules']>> }> {
    const out: { sync: Awaited<ReturnType<AdsOpsService['syncAllInsights']>>; rules?: Awaited<ReturnType<AdsOpsService['runAllRules']>> } = { sync: await this.ops.syncAllInsights() };
    if (task === 'rules') out.rules = await this.ops.runAllRules();
    return out;
  }

  /** Jobs do `pg_cron` (db.md §6): `ads-insights-3h` e `ads-rules-daily`, com os heartbeats que "o que falta configurar" lê. */
  onModuleInit() {
    this.scheduler.register({ ...JOB_SCHEDULES['ads-insights-3h'], heartbeat: 'ads-sync', handler: async () => JSON.stringify(await this.run('sync')).slice(0, 300) });
    this.scheduler.register({ ...JOB_SCHEDULES['ads-rules-daily'], heartbeat: 'ads-rules', handler: async () => JSON.stringify(await this.run('rules')).slice(0, 300) });
  }
}
