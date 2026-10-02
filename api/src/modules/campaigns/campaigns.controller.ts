import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, CreateCopyDto } from './dto/campaigns.dto';

/** GET = read, o resto = write (viewer só lê). Rotas estáticas antes das `:id`. */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.campaigns.list(ws);
  }

  @Get('performance')
  performance(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.campaigns.performance(ws);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(user.id, ws, dto);
  }

  @Get(':id')
  get(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.campaigns.get(ws, id);
  }

  @Get(':id/detail')
  detail(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.campaigns.detail(ws, id);
  }

  @Post(':id/copies')
  createCopy(
    @CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string,
    @Param('id', ParseUuidPipe) id: string, @Body() dto: CreateCopyDto,
  ) {
    return this.campaigns.createCopy(user.id, ws, id, dto);
  }

  @Post(':id/request-approval')
  requestApproval(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.campaigns.requestApproval(user.id, ws, id);
  }
}
