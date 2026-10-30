import { Injectable, OnModuleInit } from '@nestjs/common';
import { JOB_SCHEDULES } from '../scheduler/job-schedules';
import { SchedulerService } from '../scheduler/scheduler.service';
import { StyleRefsService } from './style-refs.service';

/** Job `style-refs-15min`: lê o estilo das referências pendentes e renova as pastas do Pinterest com mais de 24 h. */
@Injectable()
export class StyleRefsCronService implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly refs: StyleRefsService,
  ) {}

  async tick() {
    const refreshed = await this.refs.refreshDueSources(3);
    const processed = await this.refs.processPending(10);
    return { refreshed, processed };
  }

  onModuleInit() {
    this.scheduler.register({ ...JOB_SCHEDULES['style-refs-15min'], handler: async () => JSON.stringify(await this.tick()) });
  }
}
