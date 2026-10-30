import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import type { Env } from '../../common/config/env.validation';
import { JOB_SCHEDULES } from '../scheduler/job-schedules';
import { SchedulerService } from '../scheduler/scheduler.service';
import { PilotRunnerService } from './pilot-runner.service';

/** Job `campaign-pilot-5min`: uma ação por execução devida (até `CAMPAIGN_PILOT_PER_TICK`). Só existe com `CAMPAIGN_PILOT_ENABLED`. */
@Injectable()
export class PilotCronService implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly runner: PilotRunnerService,
    @Inject(ENV) private readonly env: Pick<Env, 'CAMPAIGN_PILOT_ENABLED'>,
  ) {}

  onModuleInit() {
    if (!this.env.CAMPAIGN_PILOT_ENABLED) return;
    this.scheduler.register({ ...JOB_SCHEDULES['campaign-pilot-5min'], handler: async () => JSON.stringify({ ran: await this.runner.tick() }) });
  }
}
