import { Body, Controller, Get, HttpCode, Injectable, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { OnModuleInit } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/database/prisma.service';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessService } from '../access/access.service';
import { ActivityService } from '../activity/activity.service';
import { AiKeysService } from '../ai/ai-keys.service';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { SchedulerService } from '../scheduler/scheduler.service';
import { notFound } from '../media/user-error';
import { CreativeIdDto, GenerateCreativeDto, JobsQueryDto, RetryCreativeJobDto, SetCreativeStatusDto, WorkspaceIdDto } from './creative.dto';
import { CreativeService } from './creative.service';

/** Server fns de `creative.functions.ts`: `POST /v1/creative/<nome-em-kebab>` (`generateBrandGuide` mora no módulo de marcas). */
@ApiTags('Creative')
@ApiBearerAuth()
@Controller('v1/creative')
export class CreativeController {
  constructor(private readonly creative: CreativeService) {}

  @Post('generate-creative') @HttpCode(200)
  generate(@CurrentUser() u: AuthUser, @Body() d: GenerateCreativeDto) {
    return this.creative.generate(u.id, d);
  }

  @Post('preview-visual-prompt') @HttpCode(200)
  preview(@CurrentUser() u: AuthUser, @Body() d: GenerateCreativeDto) {
    return this.creative.preview(u.id, d);
  }

  @Post('retry-creative-job') @HttpCode(200)
  retry(@CurrentUser() u: AuthUser, @Body() d: RetryCreativeJobDto) {
    return this.creative.retry(u.id, d.jobId);
  }

  @Post('new-creative-version') @HttpCode(200)
  newVersion(@CurrentUser() u: AuthUser, @Body() d: CreativeIdDto) {
    return this.creative.newVersion(u.id, d.creativeId);
  }

  @Post('capcut-package') @HttpCode(200)
  capcut(@CurrentUser() u: AuthUser, @Body() d: CreativeIdDto) {
    return this.creative.capcutPackage(u.id, d.creativeId);
  }
}

/** Leituras/escritas diretas do Studio (`creatives`, `creative_generation_jobs`, estratégia/copy da campanha). */
@Injectable()
export class CreativeResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /** `creatives select *, campaigns(name)` order created_at desc. */
  async listCreatives(workspaceId: string) {
    const rows = await this.prisma.creatives.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'desc' }, include: { campaign: { select: { name: true } } } });
    return rows.map(({ campaign, ...c }) => ({ ...c, campaigns: campaign }));
  }

  /** `update({status}).eq(id)` + `logActivity('creative.<status>')`. */
  async setStatus(userId: string, workspaceId: string, id: string, status: string) {
    const cr = await this.prisma.creatives.findFirst({ where: { id, workspace_id: workspaceId }, select: { id: true } });
    if (!cr) throw notFound('Criativo não encontrado.');
    const row = await this.prisma.creatives.update({ where: { id }, data: { status } });
    await this.activity.log(workspaceId, userId, `creative.${status}`, 'creative', { creative_id: id });
    return row;
  }

  /** `creative_generation_jobs select *` order created_at desc limit 12. */
  listJobs(workspaceId: string, limit = 12) {
    return this.prisma.creative_generation_jobs.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'desc' }, take: limit });
  }

  /** `["studio-brief", campaignId]`: últimas 10 versões de estratégia e de copy (a tela escolhe a aprovada, senão a primeira). */
  async campaignBrief(workspaceId: string, campaignId: string) {
    const camp = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: workspaceId }, select: { id: true } });
    if (!camp) throw notFound('Campanha não encontrada.');
    const [strategies, copies] = await Promise.all([
      this.prisma.campaign_strategies.findMany({ where: { campaign_id: campaignId, workspace_id: workspaceId }, orderBy: { version: 'desc' }, take: 10, select: { content: true, status: true, version: true } }),
      this.prisma.copies.findMany({ where: { campaign_id: campaignId, workspace_id: workspaceId }, orderBy: { version: 'desc' }, take: 10, select: { content: true, status: true, version: true } }),
    ]);
    return { strategies, copies };
  }
}

@ApiTags('Creative')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId')
export class CreativeResourceController {
  constructor(private readonly res: CreativeResourcesService) {}

  @Get('creatives')
  list(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.res.listCreatives(ws);
  }

  @Patch('creatives/:id')
  setStatus(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() d: SetCreativeStatusDto) {
    return this.res.setStatus(u.id, ws, id, d.status);
  }

  @Get('creative-generation-jobs')
  jobs(@Param('workspaceId', ParseUuidPipe) ws: string, @Query() q: JobsQueryDto) {
    return this.res.listJobs(ws, q.limit);
  }

  @Get('campaigns/:campaignId/brief')
  brief(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('campaignId', ParseUuidPipe) campaignId: string) {
    return this.res.campaignBrief(ws, campaignId);
  }
}

/**
 * `aiKeysHealth` (`ai-keys.functions.ts`): quais chaves próprias estão sem crédito (aviso no Studio).
 * Só esta ação mora aqui; o resto das ações de chaves de IA fica na tarefa de Integrações.
 */
@ApiTags('Creative')
@ApiBearerAuth()
@Controller('v1/ai-keys')
export class AiKeysHealthController {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly keys: AiKeysService,
  ) {}

  @Post('ai-keys-health') @HttpCode(200)
  async health(@CurrentUser() u: AuthUser, @Body() d: WorkspaceIdDto) {
    await this.access.require(u.id, d.workspaceId, 'read');
    const out: { vendor: 'openai' | 'gemini'; error: string }[] = [];
    for (const v of ['openai', 'gemini'] as const) {
      const k = await this.keys.get(d.workspaceId, v);
      if (!k) continue;
      const t = await this.keys.test(v, k);
      if (!t.ok && /saldo|cota|limite|cr[ée]dito|quota/i.test(t.error ?? '')) out.push({ vendor: v, error: t.error ?? '' });
    }
    return { outOfCredit: out };
  }
}

/** Registra no agendador o poller dos vídeos que passaram do prazo da requisição (`pollPendingCreatives`). */
@Injectable()
export class CreativePollJob implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly creative: CreativeService,
  ) {}

  onModuleInit() {
    this.scheduler.register({
      name: 'creative-poll-5min',
      cron: '*/5 * * * *',
      heartbeat: 'creative',
      handler: async () => {
        const r = await this.creative.pollPendingCreatives();
        return `${r.length} job(s) de criativo verificados`;
      },
    });
  }
}
