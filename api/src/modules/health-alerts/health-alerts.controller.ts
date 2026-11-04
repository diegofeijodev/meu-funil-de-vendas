import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { HealthAlertsService } from './health-alerts.service';

/** `GET /v1/workspaces/:workspaceId/health-alerts` (read: qualquer membro) — contrato §30. */
@ApiTags('Health alerts')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/health-alerts')
export class HealthAlertsController {
  constructor(private readonly alerts: HealthAlertsService) {}

  @Get()
  get(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.alerts.get(ws);
  }
}
