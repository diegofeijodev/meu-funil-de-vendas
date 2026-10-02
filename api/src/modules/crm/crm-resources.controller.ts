import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUuid, ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { CrmConfigService } from './crm-config.service';
import { badRequest } from './crm-errors';
import { CrmLeadsService } from './crm-leads.service';
import { CrmReportsService } from './crm-reports.service';
import {
  AddNoteDto, AiToggleDto, BulkLeadsDto, CreateLeadDto, CreateNamedDto, CreateStageDto, CreateTagDto, CreateTaskDto, ImportLeadsDto, MoveLeadDto,
  SaveSettingsDto, UpdateLeadDto, UpdateStageDto, UpdateTaskDto,
} from './dto/crm.dto';

const pipelineFilter = (v: string | undefined) => {
  if (v === undefined || v === '') return undefined;
  if (!isUuid(v)) throw badRequest('Funil inválido.');
  return v;
};

/**
 * Tabelas `crm_*` que o navegador lia/escrevia direto (Task 7): funis, etapas, leads, interações, tarefas, histórico,
 * usuários, distribuição, motivos de perda, tags e as leituras de cadência dos Indicadores.
 * GET = read; o resto = write (viewer só lê). Rotas estáticas ANTES das `:id`.
 */
@ApiTags('CRM')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/crm')
export class CrmResourcesController {
  constructor(
    private readonly leads: CrmLeadsService,
    private readonly config: CrmConfigService,
    private readonly reports: CrmReportsService,
  ) {}

  // ---- funis e etapas
  @Get('pipelines')
  pipelines(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.config.pipelines(ws);
  }

  @Get('stages')
  stages(@Param('workspaceId', ParseUuidPipe) ws: string, @Query('pipeline_id') pipelineId?: string) {
    return this.config.stages(ws, pipelineFilter(pipelineId));
  }

  @Post('stages')
  createStage(@Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: CreateStageDto) {
    return this.config.createStage(ws, dto);
  }

  @Patch('stages/:id')
  updateStage(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateStageDto) {
    return this.config.updateStage(ws, id, dto);
  }

  @Delete('stages/:id') @HttpCode(204)
  deleteStage(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.config.deleteStage(ws, id);
  }

  // ---- leads
  @Get('leads')
  listLeads(@Param('workspaceId', ParseUuidPipe) ws: string, @Query('pipeline_id') pipelineId?: string) {
    return this.leads.list(ws, pipelineFilter(pipelineId));
  }

  @Post('leads')
  createLead(@Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: CreateLeadDto) {
    return this.leads.create(ws, dto);
  }

  @Post('leads/import') @HttpCode(200)
  importLeads(@Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: ImportLeadsDto) {
    return this.leads.import(ws, dto);
  }

  @Post('leads/bulk') @HttpCode(200)
  bulkLeads(@Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: BulkLeadsDto) {
    return this.leads.bulk(ws, dto);
  }

  @Get('leads/:id')
  getLead(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.leads.get(ws, id);
  }

  @Patch('leads/:id')
  updateLead(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(ws, id, dto);
  }

  @Post('leads/:id/move') @HttpCode(200)
  moveLead(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: MoveLeadDto) {
    return this.leads.move(user.id, ws, id, dto.stage_id);
  }

  @Get('leads/:id/interactions')
  leadInteractions(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.leads.interactions(ws, id);
  }

  @Post('leads/:id/interactions')
  addNote(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: AddNoteDto) {
    return this.leads.addNote(user.id, ws, id, dto);
  }

  @Post('leads/:id/ai') @HttpCode(200)
  setAi(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: AiToggleDto) {
    return this.leads.setAi(user.id, ws, id, dto.active);
  }

  @Get('leads/:id/tasks')
  leadTasks(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.leads.leadTasks(ws, id);
  }

  @Post('leads/:id/tasks')
  createTask(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: CreateTaskDto) {
    return this.leads.createTask(ws, id, dto);
  }

  // ---- tarefas
  @Get('tasks')
  tasks(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.leads.tasks(ws);
  }

  @Patch('tasks/:id')
  updateTask(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.leads.updateTask(ws, id, dto);
  }

  // ---- leituras dos Indicadores
  @Get('stage-history')
  stageHistory(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.reports.stageHistory(ws);
  }

  @Get('interactions')
  interactions(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.reports.interactions(ws);
  }

  @Get('cadence-options')
  cadenceOptions(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.reports.cadenceOptions(ws);
  }

  @Get('cadence-metrics')
  cadenceMetrics(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.reports.cadenceMetrics(ws);
  }

  // ---- usuários, distribuição, motivos de perda, tags
  @Get('members')
  members(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.config.members(ws);
  }

  @Get('settings')
  settings(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.config.settings(ws);
  }

  @Put('settings')
  saveSettings(@Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: SaveSettingsDto) {
    return this.config.saveSettings(ws, dto);
  }

  @Get('loss-reasons')
  lossReasons(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.config.lossReasons(ws);
  }

  @Post('loss-reasons')
  createLossReason(@Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: CreateNamedDto) {
    return this.config.createLossReason(ws, dto);
  }

  @Delete('loss-reasons/:id') @HttpCode(204)
  deleteLossReason(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.config.deleteLossReason(ws, id);
  }

  @Get('tags')
  tags(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.config.tags(ws);
  }

  @Post('tags')
  createTag(@Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: CreateTagDto) {
    return this.config.createTag(ws, dto);
  }

  @Delete('tags/:id') @HttpCode(204)
  deleteTag(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.config.deleteTag(ws, id);
  }
}
