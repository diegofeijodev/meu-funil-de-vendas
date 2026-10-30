import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { ApprovePilotDto, CancelPilotDto, CreatePilotDto, EstimatePilotDto, ResumePilotDto } from './pilot.dto';
import { PilotService } from './pilot.service';
import type { PilotOptions } from './pilot.types';

/**
 * Piloto do estrategista (Fatia 3, contrato §29). Sem `WorkspaceAccessGuard` de propósito: fora de `CAMPAIGN_PILOT_WORKSPACE_IDS` a rota
 * responde 404 ANTES de olhar o acesso (o serviço confere portão → papel → campanha da empresa). Estáticas antes de `:runId`.
 */
@ApiTags('Campaign pilot')
@ApiBearerAuth()
@Controller('v1/workspaces/:workspaceId/campaigns/:campaignId/pilot')
export class PilotController {
  constructor(private readonly pilot: PilotService) {}

  @Post() @HttpCode(200)
  create(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('campaignId', ParseUuidPipe) campaignId: string, @Body() dto: CreatePilotDto) {
    return this.pilot.create(u.id, ws, campaignId, dto.idempotency_key);
  }

  @Get()
  get(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('campaignId', ParseUuidPipe) campaignId: string) {
    return this.pilot.get(u.id, ws, campaignId);
  }

  @Post('estimate') @HttpCode(200)
  estimate(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('campaignId', ParseUuidPipe) campaignId: string, @Body() dto: EstimatePilotDto) {
    return this.pilot.estimate(u.id, ws, campaignId, dto.options as PilotOptions);
  }

  @Post(':runId/approve') @HttpCode(200)
  approve(
    @CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('campaignId', ParseUuidPipe) campaignId: string,
    @Param('runId', ParseUuidPipe) runId: string, @Body() dto: ApprovePilotDto,
  ) {
    return this.pilot.approve(u.id, ws, campaignId, runId, { strategy_version: dto.strategy_version, options: dto.options as PilotOptions });
  }

  @Post(':runId/resume') @HttpCode(200)
  resume(
    @CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('campaignId', ParseUuidPipe) campaignId: string,
    @Param('runId', ParseUuidPipe) runId: string, @Body() dto: ResumePilotDto,
  ) {
    return this.pilot.resume(u.id, ws, campaignId, runId, dto);
  }

  @Post(':runId/cancel') @HttpCode(200)
  cancel(
    @CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('campaignId', ParseUuidPipe) campaignId: string,
    @Param('runId', ParseUuidPipe) runId: string, @Body() dto: CancelPilotDto,
  ) {
    return this.pilot.cancel(u.id, ws, campaignId, runId, dto);
  }
}
