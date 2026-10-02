import { Injectable, OnModuleInit } from '@nestjs/common';
import { Body, Controller, Headers, HttpCode, HttpException, Post, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../common/database/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { CronAuthService } from '../scheduler/cron-auth.service';
import { JOB_SCHEDULES } from '../scheduler/job-schedules';
import { SchedulerService } from '../scheduler/scheduler.service';
import { CadenceService } from './cadence.service';
import { errText } from './channel-common';
import { LeadgenService } from './leadgen.service';

/** Crons do CRM (server.md §5.4): `crm-cadences` (5 min) e `crm-daily` (custos da Meta). Iguais pelo agendador e pelas rotas HTTP. */
@Injectable()
export class CrmCronService implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly cadences: CadenceService,
    private readonly leadgen: LeadgenService,
    private readonly prisma: PrismaService,
  ) {}

  async runCadences() {
    const triggered = await this.cadences.applyStageAndTagTriggers();
    const result = await this.cadences.runDue(200);
    const slaTasks = await this.cadences.createSlaAlerts(500);
    return { ...result, triggered, sla_tasks: slaTasks };
  }

  async runDaily() {
    const results: { workspace_id: string; imported?: number; error?: string }[] = [];
    const integrations = await this.prisma.crm_integrations.findMany({ where: { kind: 'meta_lead_ads', status: 'connected' } });
    for (const i of integrations) {
      try {
        results.push({ workspace_id: i.workspace_id, imported: await this.leadgen.importCosts(i.workspace_id, i.config as Record<string, unknown>) });
      } catch (e) {
        results.push({ workspace_id: i.workspace_id, error: errText(e) });
      }
    }
    return { costs: results };
  }

  onModuleInit() {
    this.scheduler.register({ ...JOB_SCHEDULES['crm-cadences-5min'], heartbeat: 'crm-cadences', handler: async () => JSON.stringify(await this.runCadences()).slice(0, 300) });
    this.scheduler.register({
      ...JOB_SCHEDULES['crm-daily'], heartbeat: 'crm-daily',
      handler: async () => {
        const r = await this.runDaily();
        const bad = r.costs.find((c) => c.error);
        if (bad) throw new Error(bad.error);
        return JSON.stringify(r).slice(0, 300);
      },
    });
  }
}

/** `POST /api/public/cron/crm-cadences` e `/crm-daily` — `x-cron-secret` (`CRM_CRON_SECRET` ou `cron_tokens`). */
@Public()
@SkipThrottle()
@Controller('api/public/cron')
export class CrmCronController {
  constructor(private readonly auth: CronAuthService, private readonly cron: CrmCronService) {}

  @Post('crm-cadences') @HttpCode(200)
  async cadences(@Headers('x-cron-secret') secret: string | undefined, @Body() _b: unknown) {
    if (!(await this.auth.isAuthorized(secret, ['crm_cadences']))) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    try {
      const out = await this.cron.runCadences();
      await this.auth.heartbeat('crm-cadences');
      return out;
    } catch (e) {
      await this.auth.heartbeat('crm-cadences', 'error', errText(e));
      throw new HttpException('cadence run failed', 500);
    }
  }

  @Post('crm-daily') @HttpCode(200)
  async daily(@Headers('x-cron-secret') secret: string | undefined, @Body() _b: unknown) {
    if (!(await this.auth.isAuthorized(secret, ['crm_daily']))) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    const out = await this.cron.runDaily();
    const bad = out.costs.find((c) => c.error);
    await this.auth.heartbeat('crm-daily', bad ? 'error' : 'ok', bad?.error ?? null);
    return out;
  }
}
