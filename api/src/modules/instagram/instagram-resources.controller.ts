import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { CreateIgPlanDto, IgEventsQueryDto, IgInsightsQueryDto, IgPlansQueryDto, PatchIgPlanDto, PatchIgPostDto } from './instagram.dto';
import { InstagramResourcesService } from './instagram-resources.service';

/**
 * Tabelas do Instagram que o navegador lia/gravava direto (`instagram_accounts`, `ig_posts`, `ig_content_plans`,
 * `ig_post_metrics`, `ig_account_insights`, `ig_autopilot_events`, `ig_auto_runs`). GET = read; POST/PATCH = write (viewer só lê).
 * Rotas estáticas antes das `:id`.
 */
@ApiTags('Instagram')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId')
export class InstagramResourcesController {
  constructor(private readonly res: InstagramResourcesService) {}

  @Get('instagram-account')
  account(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.res.account(ws).then((a) => a ?? {});
  }

  @Get('ig-posts')
  posts(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.res.listPosts(ws);
  }

  @Get('ig-posts/pending-count')
  pending(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.res.pendingCount(ws);
  }

  @Patch('ig-posts/:id')
  patchPost(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: PatchIgPostDto) {
    return this.res.patchPost(ws, id, dto);
  }

  @Get('ig-post-metrics')
  metrics(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.res.listMetrics(ws);
  }

  @Get('ig-content-plans')
  plans(@Param('workspaceId', ParseUuidPipe) ws: string, @Query() q: IgPlansQueryDto) {
    return this.res.listPlans(ws, q.exclude_archived === 'true');
  }

  @Post('ig-content-plans')
  createPlan(@Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: CreateIgPlanDto) {
    return this.res.createPlan(ws, dto);
  }

  @Patch('ig-content-plans/:id')
  patchPlan(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: PatchIgPlanDto) {
    return this.res.patchPlan(ws, id, dto);
  }

  @Get('ig-autopilot-events')
  events(@Param('workspaceId', ParseUuidPipe) ws: string, @Query() q: IgEventsQueryDto) {
    return this.res.listEvents(ws, q.limit ? Number(q.limit) : 20);
  }

  @Get('ig-auto-runs')
  runs(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.res.autoRuns(ws);
  }

  @Get('ig-account-insights')
  insights(@Param('workspaceId', ParseUuidPipe) ws: string, @Query() q: IgInsightsQueryDto) {
    return this.res.listAccountInsights(ws, q.since);
  }
}
