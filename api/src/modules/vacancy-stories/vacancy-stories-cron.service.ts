import { Injectable, OnModuleInit } from '@nestjs/common';
import { errText } from '../instagram/ig-store.service';
import { JOB_SCHEDULES } from '../scheduler/job-schedules';
import { SchedulerService } from '../scheduler/scheduler.service';
import { VacancyGeneratorService } from './vacancy-generator.service';
import { VacancyPollService } from './vacancy-poll.service';
import { VacancySchedulerService } from './vacancy-scheduler.service';

/** Etapas da rodada que falharam (`{ error }` — inclusive a consulta com a vitrine fora). */
export function failedSteps(out: Record<string, unknown>): string[] {
  return Object.entries(out)
    .filter(([, v]) => !!v && typeof v === 'object' && 'error' in v)
    .map(([k]) => k);
}

/**
 * Rodada de 10 minutos dos stories das vagas: consulta → desliga órfãs → expira → varre leases → agenda → geração.
 * Cada etapa falha sozinha: o erro vira `{ error }` no resultado e as demais seguem.
 */
@Injectable()
export class VacancyStoriesCronService implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly poll: VacancyPollService,
    private readonly generator: VacancyGeneratorService,
    private readonly agenda: VacancySchedulerService,
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
    // Aprovados e posts sem job vão para o próximo horário livre antes de a geração entregar os novos.
    out['scheduler'] = await this.step(() => this.agenda.tick());
    out['generator'] = await this.step(() => this.generator.generateDue());
    return out;
  }

  /** Mesma trava do tick agendado (`{ skipped }` se já está rodando). */
  runExclusive() {
    return this.scheduler.runExclusive([JOB_SCHEDULES['vacancy-stories-10min'].name], () => this.tick());
  }

  onModuleInit() {
    this.scheduler.register({
      ...JOB_SCHEDULES['vacancy-stories-10min'],
      handler: async () => {
        const out = await this.tick();
        const detail = JSON.stringify(out).slice(0, 300);
        // M10: etapa com erro não aparece como "ok" — o agendador grava o heartbeat "error" com o resultado.
        if (failedSteps(out).length) throw new Error(detail);
        return detail;
      },
    });
  }
}
