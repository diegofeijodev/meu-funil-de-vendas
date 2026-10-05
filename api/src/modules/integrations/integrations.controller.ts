import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/database/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { AiDiagnosticsService } from './ai-diagnostics.service';
import { AiKeysActionsService } from './ai-keys-actions.service';
import { AiKeySaveDto, AiKeyVendorDto, AiKeysWorkspaceDto, DiagnoseAiDto, PublishingJobsQueryDto } from './integrations.dto';

/** `ai-keys.functions.ts`: `POST /v1/ai-keys/ai-keys-{status,save,test,remove}` (a `ai-keys-health` mora no módulo do Studio). */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('v1/ai-keys')
export class AiKeysController {
  constructor(private readonly svc: AiKeysActionsService) {}

  @Post('ai-keys-status') @HttpCode(200)
  status(@CurrentUser() u: AuthUser, @Body() d: AiKeysWorkspaceDto) {
    return this.svc.status(u.id, d.workspaceId);
  }

  @Post('ai-keys-save') @HttpCode(200)
  save(@CurrentUser() u: AuthUser, @Body() d: AiKeySaveDto) {
    return this.svc.save(u.id, d.workspaceId, d.vendor, d.apiKey);
  }

  @Post('ai-keys-test') @HttpCode(200)
  test(@CurrentUser() u: AuthUser, @Body() d: AiKeyVendorDto) {
    return this.svc.test(u.id, d.workspaceId, d.vendor);
  }

  @Post('ai-keys-remove') @HttpCode(200)
  remove(@CurrentUser() u: AuthUser, @Body() d: AiKeyVendorDto) {
    return this.svc.remove(u.id, d.workspaceId, d.vendor);
  }
}

/** `ai-diagnostics.functions.ts`: `POST /v1/ai-diagnostics/diagnose-ai` (qualquer membro). */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('v1/ai-diagnostics')
export class AiDiagnosticsController {
  constructor(private readonly svc: AiDiagnosticsService) {}

  @Post('diagnose-ai') @HttpCode(200)
  diagnose(@CurrentUser() u: AuthUser, @Body() d: DiagnoseAiDto) {
    return this.svc.diagnose(u.id, d.workspaceId, d.withImage ?? false);
  }
}

/** "Histórico de publicações" de Integrações: `publishing_jobs` do workspace (leitura, qualquer membro). */
@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/publishing-jobs')
export class PublishingJobsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Param('workspaceId', ParseUuidPipe) ws: string, @Query() q: PublishingJobsQueryDto) {
    return this.prisma.publishing_jobs.findMany({ where: { workspace_id: ws }, orderBy: { created_at: 'desc' }, take: q.limit ?? 15 });
  }
}
