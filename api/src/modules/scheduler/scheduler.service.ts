import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';

export interface JobDefinition {
  name: string;
  /** Expressão cron (UTC), 5 campos. */
  cron: string;
  /** Nome na tabela `cron_heartbeats` (o painel "o que falta configurar" lê). Padrão: o próprio `name`. */
  heartbeat?: string;
  /** Devolve um detalhe curto para o heartbeat. */
  handler: () => Promise<string | void>;
}

/**
 * Agendador em processo (substitui pg_cron + pg_net). Os módulos registram jobs no `onModuleInit`;
 * só roda com `SCHEDULER_ENABLED=true` — UMA instância da API por vez, senão cada job duplica.
 * Cada execução grava `cron_heartbeats` e não se sobrepõe a si mesma.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly jobs = new Map<string, JobDefinition>();
  private readonly running = new Set<string>();

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Pick<Env, 'SCHEDULER_ENABLED'>,
  ) {}

  get enabled(): boolean {
    return this.env.SCHEDULER_ENABLED;
  }

  register(job: JobDefinition): void {
    if (this.jobs.has(job.name)) throw new Error(`Job já registrado: ${job.name}`);
    this.jobs.set(job.name, job);
  }

  list(): { name: string; cron: string; running: boolean }[] {
    return [...this.jobs.values()].map((j) => ({ name: j.name, cron: j.cron, running: this.running.has(j.name) }));
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      if (this.jobs.size) this.logger.log(`Agendador DESLIGADO (SCHEDULER_ENABLED=false): ${this.jobs.size} job(s) registrados não rodam.`);
      return;
    }
    for (const job of this.jobs.values()) {
      const cj = new CronJob(job.cron, () => void this.run(job.name), null, false, 'UTC');
      this.registry.addCronJob(job.name, cj);
      cj.start();
    }
    this.logger.log(`Agendador LIGADO: ${this.jobs.size} job(s).`);
  }

  onApplicationShutdown(): void {
    for (const name of this.registry.getCronJobs().keys()) this.registry.deleteCronJob(name);
  }

  /** Executa um job agora (também usado pelas rotas `/api/public/cron/*`). Devolve false se já estava rodando. */
  async run(name: string): Promise<boolean> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job desconhecido: ${name}`);
    if (this.running.has(name)) return false;
    this.running.add(name);
    let status = 'ok';
    let detail: string | null = null;
    try {
      detail = (await job.handler()) ?? null;
    } catch (e) {
      status = 'error';
      detail = e instanceof Error ? e.message : String(e);
      this.logger.error(`job ${name}: ${detail}`);
    } finally {
      this.running.delete(name);
    }
    await this.heartbeat(job.heartbeat ?? job.name, status, detail);
    return true;
  }

  private async heartbeat(name: string, status: string, detail: string | null): Promise<void> {
    try {
      await this.prisma.cron_heartbeats.upsert({
        where: { name },
        create: { name, last_status: status, last_detail: detail?.slice(0, 500) ?? null },
        update: { last_run_at: new Date(), last_status: status, last_detail: detail?.slice(0, 500) ?? null },
      });
    } catch (e) {
      this.logger.warn(`heartbeat ${name}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
