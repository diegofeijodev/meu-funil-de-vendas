import { Injectable, OnModuleInit } from '@nestjs/common';
import { errText } from '../instagram/ig-store.service';
import { JOB_SCHEDULES } from '../scheduler/job-schedules';
import { SchedulerService } from '../scheduler/scheduler.service';
import { VacancyPollService } from './vacancy-poll.service';

/** Etapas que as próximas tarefas ligam (agenda: Task 10; geração: Task 9). Ausente = a etapa não entra no resultado. */
export type VacancyTickHooks = {
  scheduleTick?: () => Promise<unknown>;
  generateDue?: () => Promise<unknown>;
};

/**
 * Rodada de 10 minutos dos stories das vagas: consulta → desliga órfãs → expira → varre leases → (agenda) → (geração).
 * Cada etapa falha sozinha: o erro vira `{ error }` no resultado e as demais seguem.
 */
@Injectable()
export class VacancyStoriesCronService implements OnModuleInit {
  /** Ganchos das Tasks 9 e 10 (trocados por injeção quando os serviços existirem). */
  readonly hooks: VacancyTickHooks = {};

  constructor(
    private readonly scheduler: SchedulerService,
    private readonly poll: VacancyPollService,
  ) {}

  private step<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
    return fn().catch((e) => ({ error: errText(e) }));
  }

  async tick(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    out['poll'] = await this.step(() => this.poll.pollAll());
    out['orphans'] = await this.step(() => this.poll.disableOrphans());
    out['expired'] = await this.step(() => this.poll.expireDue());
    out['swept'] = await this.step(() => this.poll.sweepLeases());
    // Task 10: a agenda (capacidade do dia, janela) vem antes da geração.
    if (this.hooks.scheduleTick) out['scheduler'] = await this.step(this.hooks.scheduleTick);
    // Task 9: gera as artes devidas.
    if (this.hooks.generateDue) out['generator'] = await this.step(this.hooks.generateDue);
    return out;
  }

  /** Mesma trava do tick agendado (`{ skipped }` se já está rodando). */
  runExclusive() {
    return this.scheduler.runExclusive([JOB_SCHEDULES['vacancy-stories-10min'].name], () => this.tick());
  }

  onModuleInit() {
    this.scheduler.register({ ...JOB_SCHEDULES['vacancy-stories-10min'], handler: async () => JSON.stringify(await this.tick()).slice(0, 300) });
  }
}
