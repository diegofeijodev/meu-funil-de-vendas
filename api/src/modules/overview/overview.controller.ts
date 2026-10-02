import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { OverviewService } from './overview.service';

@ApiTags('Overview')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/overview')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get()
  get(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.overview.get(ws);
  }
}
