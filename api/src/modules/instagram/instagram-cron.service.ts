import { Injectable, OnModuleInit } from '@nestjs/common';
import { SchedulerService } from '../scheduler/scheduler.service';
import { JOB_SCHEDULES } from '../scheduler/job-schedules';
import { AccountService } from './account.service';
import { AutoCalendarService } from './auto-calendar.service';
import { AutopilotService } from './autopilot.service';
import { errText } from './ig-store.service';
import { MediaGenerationService } from './media-generation.service';
import { MetricsService } from './metrics.service';
import { PublishingService } from './publishing.service';

export const CRON_TASKS = ['queue', 'publish', 'media', 'metrics', 'weekly', 'optimize', 'account'] as const;
export type CronTask = (typeof CRON_TASKS)[number];

/**
 * Tarefas do cron do Instagram (server.md §5.2) — as mesmas pela rota `POST /api/public/cron/instagram` e pelos jobs do agendador.
 * `pollPendingCreatives` NÃO é chamado aqui: o Creative Studio já tem o job `creative-poll-5min` (Task 4); o protótipo o chamava
 * dentro do `queue` do Instagram, e chamar de novo duplicaria a consulta aos provedores.
 */
@Injectable()
export class InstagramCronService implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly mediaGen: MediaGenerationService,
    private readonly publishing: PublishingService,
    private readonly autoCalendar: AutoCalendarService,
    private readonly autopilot: AutopilotService,
    private readonly metrics: MetricsService,
    private readonly account: AccountService,
  ) {}

  /** `queue`: conclui mídias assíncronas pendentes + fila de publicação. `publish` = alias de `queue`. */
  private async queue() {
    return {
      pendingMedia: await this.mediaGen.pollPendingMedia().catch((e) => ({ error: errText(e) })),
      queue: await this.publishing.runPublishingQueue(),
    };
  }

  /** `media`: calendário automático + piloto (gera mídia, agenda, regra das 2h). */
  private async media() {
    return {
      autoCalendar: await this.autoCalendar.autoCalendarTick().catch((e) => ({ error: errText(e) })),
      autopilot: await this.autopilot.autopilotTick().catch((e) => ({ error: errText(e) })),
    };
  }

  private async metricsTask() {
    return { metrics: await this.metrics.collectDueMetrics(), learning: await this.metrics.learnFromTopPosts().catch((e) => ({ error: errText(e) })) };
  }

  /** Nomes dos jobs agendados (`JOB_SCHEDULES`) que esta tarefa ocupa — a trava é a mesma dos ticks. */
  static lockNames(task?: CronTask): string[] {
    switch (task) {
      case 'weekly': return ['instagram-autopilot-weekly'];
      case 'optimize': return ['instagram-optimizer-monday'];
      case 'account': return ['instagram-account-daily'];
      case 'queue':
      case 'publish': return ['instagram-queue-5min'];
      case 'media': return ['instagram-media-5min'];
      case 'metrics': return ['instagram-metrics-5min'];
      default: return ['instagram-queue-5min', 'instagram-media-5min', 'instagram-metrics-5min'];
    }
  }

  /** Execução por HTTP: respeita a trava por job do agendador (`{ skipped }` se já está rodando). */
  runExclusive(task?: CronTask) {
    return this.scheduler.runExclusive(InstagramCronService.lockNames(task), () => this.run(task));
  }

  /** Sem `task`: queue + media + metrics (compatibilidade). */
  async run(task?: CronTask): Promise<Record<string, unknown>> {
    switch (task) {
      case 'weekly': return { weekly: await this.autopilot.runWeeklyAutopilot() };
      case 'optimize': return { optimize: await this.autopilot.runOptimizer() };
      case 'account': return { account: await this.metrics.collectAllAccountInsights() };
      case 'queue':
      case 'publish': return this.queue();
      case 'media': return this.media();
      case 'metrics': return this.metricsTask();
      default: return { ...(await this.queue()), ...(await this.media()), ...(await this.metricsTask()) };
    }
  }

  /** Jobs do `pg_cron` (db.md §6), mesmos horários UTC; heartbeats com as chaves que "o que falta configurar" lê. */
  onModuleInit() {
    const job = (key: keyof typeof JOB_SCHEDULES, task: CronTask) =>
      this.scheduler.register({ ...JOB_SCHEDULES[key], handler: async () => JSON.stringify(await this.run(task)).slice(0, 300) });
    job('instagram-queue-5min', 'queue');
    job('instagram-media-5min', 'media');
    job('instagram-metrics-5min', 'metrics');
    job('instagram-autopilot-weekly', 'weekly');
    job('instagram-optimizer-monday', 'optimize');
    job('instagram-account-daily', 'account');
  }
}
