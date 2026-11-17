import { Injectable, OnModuleInit } from '@nestjs/common';
import { JOB_SCHEDULES } from '../scheduler/job-schedules';
import { SchedulerService } from '../scheduler/scheduler.service';
import { StyleRefsService } from './style-refs.service';

/** Job `style-refs-15min`: ajusta a Seleção das marcas vencidas, renova as pastas do Pinterest com mais de 24 h e lê o estilo das pendentes. */
@Injectable()
export class StyleRefsCronService implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly refs: StyleRefsService,
  ) {}

  async tick() {
    const reconciled = await this.refs.reconcileDueBrands(10);
    const refreshed = await this.refs.refreshDueSources(3);
    const processed = await this.refs.processPending(10);
    return { reconciled, refreshed, processed };
  }

  onModuleInit() {
    this.scheduler.register({ ...JOB_SCHEDULES['style-refs-15min'], handler: async () => JSON.stringify(await this.tick()) });
  }
}
