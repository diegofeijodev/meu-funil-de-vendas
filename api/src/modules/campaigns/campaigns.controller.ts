import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { CampaignsService } from './campaigns.service';
import { CampaignIntakeService } from './campaign-intake.service';
import { CreateCampaignDto, CreateCopyDto, IntakeDto, SetBudgetDto, SetLandingUrlDto, SetLocationDto } from './dto/campaigns.dto';

/** GET = read, o resto = write (viewer só lê). Rotas estáticas antes das `:id`. */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly intakeSvc: CampaignIntakeService,
  ) {}

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

  /** "Conte o que você quer": rascunho + até 3 perguntas, nada gravado (Fatia 1; só empresas da lista). */
  @Post('intake') @HttpCode(200)
  intake(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: IntakeDto) {
    return this.intakeSvc.intake(user.id, ws, dto);
  }

  @Get(':id')
  get(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.campaigns.get(ws, id);
  }

  @Get(':id/detail')
  detail(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.campaigns.detail(ws, id);
  }

  @Patch(':id/landing-url')
  setLandingUrl(
    @CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string,
    @Param('id', ParseUuidPipe) id: string, @Body() dto: SetLandingUrlDto,
  ) {
    return this.campaigns.setLandingUrl(user.id, ws, id, dto.landing_url);
  }

  @Patch(':id/budget')
  setBudget(
    @CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string,
    @Param('id', ParseUuidPipe) id: string, @Body() dto: SetBudgetDto,
  ) {
    return this.campaigns.setBudget(user.id, ws, id, dto);
  }

  @Patch(':id/location')
  setLocation(
    @CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string,
    @Param('id', ParseUuidPipe) id: string, @Body() dto: SetLocationDto,
  ) {
    return this.campaigns.setLocation(user.id, ws, id, dto.location);
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
