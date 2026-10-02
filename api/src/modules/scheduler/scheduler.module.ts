import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CronAuthService } from './cron-auth.service';
import { SchedulerService } from './scheduler.service';

@Global()
@Module({ imports: [ScheduleModule.forRoot()], providers: [SchedulerService, CronAuthService], exports: [SchedulerService, CronAuthService] })
export class SchedulerModule {}
