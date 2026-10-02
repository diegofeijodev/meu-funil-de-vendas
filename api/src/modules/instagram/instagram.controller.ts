import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUuid } from '../../common/ids/uuid';
import { bad, UserError } from '../media/user-error';
import { InstagramActionsService } from './instagram-actions.service';
import {
  ConnectInstagramDto, CreateAutoCalendarDto, GenerateContentCalendarDto, GenerateNextAutoMediaDto, GeneratePostAssetsDto, PostRefDto,
  PreviewAutoCalendarDto, RegenerateCaptionDto, RegenerateMediaDto, RejectPostDto, RunRefDto, SchedulePostDto, SuggestPillarsDto, WorkspaceDto,
} from './instagram.dto';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Server functions de `instagram/instagram.functions.ts` e `instagram/auto-calendar.functions.ts`:
 * `POST /v1/instagram/<nome-em-kebab>` com o mesmo corpo (`data`) e o mesmo retorno. Funções que devolviam
 * `{ ok:false, error }` continuam devolvendo isso (HTTP 200).
 */
@ApiTags('Instagram')
@ApiBearerAuth()
@Controller('v1/instagram')
export class InstagramController {
  constructor(private readonly svc: InstagramActionsService) {}

  @Post('connect-instagram-account') @HttpCode(200)
  connect(@CurrentUser() u: AuthUser, @Body() d: ConnectInstagramDto) {
    return this.svc.connect(u.id, d.workspaceId, d.pageId);
  }

  @Post('list-instagram-options') @HttpCode(200)
  options(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) {
    return this.svc.listOptions(u.id, d.workspaceId);
  }

  @Post('sync-instagram-history') @HttpCode(200)
  sync(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) {
    return this.svc.syncHistory(u.id, d.workspaceId);
  }

  @Post('disconnect-instagram-account') @HttpCode(200)
  disconnect(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) {
    return this.svc.disconnect(u.id, d.workspaceId);
  }

  @Post('generate-content-calendar') @HttpCode(200)
  calendar(@CurrentUser() u: AuthUser, @Body() d: GenerateContentCalendarDto) {
    return this.svc.generateContentCalendar(u.id, d.workspaceId, d.planId, d.weeks, d.engine);
  }

  @Post('generate-post-assets') @HttpCode(200)
  assets(@CurrentUser() u: AuthUser, @Body() d: GeneratePostAssetsDto) {
    return this.svc.generatePostAssets(u.id, d.workspaceId, d.postId, d.provider, d.adjust);
  }

  @Post('regenerate-caption') @HttpCode(200)
  caption(@CurrentUser() u: AuthUser, @Body() d: RegenerateCaptionDto) {
    return this.svc.regenerateCaption(u.id, d.workspaceId, d.postId, d.instructions, d.engine);
  }

  @Post('regenerate-media') @HttpCode(200)
  media(@CurrentUser() u: AuthUser, @Body() d: RegenerateMediaDto) {
    return this.svc.generatePostAssets(u.id, d.workspaceId, d.postId, d.provider, d.instructions);
  }

  @Post('approve-post') @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Body() d: PostRefDto) {
    return this.svc.approvePost(u.id, d.workspaceId, d.postId);
  }

  @Post('reject-post') @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Body() d: RejectPostDto) {
    return this.svc.rejectPost(u.id, d.workspaceId, d.postId, d.reason);
  }

  @Post('schedule-post') @HttpCode(200)
  schedule(@CurrentUser() u: AuthUser, @Body() d: SchedulePostDto) {
    return this.svc.schedulePost(u.id, d.workspaceId, d.postId, d.scheduledAt);
  }

  @Post('publish-instagram-post') @HttpCode(200)
  publish(@CurrentUser() u: AuthUser, @Body() d: PostRefDto) {
    return this.svc.publishInstagramPost(u.id, d.workspaceId, d.postId);
  }

  @Post('collect-post-metrics') @HttpCode(200)
  metrics(@CurrentUser() u: AuthUser, @Body() d: PostRefDto) {
    return this.svc.collectPostMetrics(u.id, d.workspaceId, d.postId);
  }

  @Post('suggest-pillars') @HttpCode(200)
  pillars(@CurrentUser() u: AuthUser, @Body() d: SuggestPillarsDto) {
    return this.svc.suggestPillars(u.id, d.workspaceId, { brandId: d.brandId, objective: d.objective, tone: d.tone, audience: d.audience });
  }

  /** Multipart (`workspaceId`, `postId`, `file`): imagem ou vídeo, até 100 MB. */
  @Post('upload-post-media') @HttpCode(200)
  async upload(@CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw bad('Envio inválido.');
    const fields: Record<string, string> = {};
    let file: { filename: string; mimetype: string; bytes: Buffer } | null = null;
    let truncated = false;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const c of part.file) chunks.push(c as Buffer);
        truncated = truncated || !!(part.file as { truncated?: boolean }).truncated;
        file = { filename: part.filename || 'arquivo', mimetype: (part.mimetype || '').toLowerCase(), bytes: Buffer.concat(chunks) };
      } else {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }
    if (!file || file.bytes.length === 0) throw bad('Arquivo ausente.');
    if (truncated) throw new UserError('Arquivo acima de 100 MB.');
    const { workspaceId, postId } = fields;
    if (!workspaceId || !isUuid(workspaceId) || !postId || !isUuid(postId)) throw bad('Envio inválido.');
    if (file.bytes.length > MAX_UPLOAD_BYTES) throw new UserError('Arquivo acima de 100 MB.');
    return this.svc.uploadPostMedia(u.id, workspaceId, postId, file);
  }

  @Post('collect-account-insights-now') @HttpCode(200)
  insights(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) {
    return this.svc.collectAccountInsightsNow(u.id, d.workspaceId);
  }

  // ---- auto-calendar.functions

  @Post('create-auto-calendar') @HttpCode(200)
  createAuto(@CurrentUser() u: AuthUser, @Body() d: CreateAutoCalendarDto) {
    return this.svc.createAutoCalendar(u.id, d);
  }

  @Post('fill-auto-calendar') @HttpCode(200)
  fillAuto(@CurrentUser() u: AuthUser, @Body() d: RunRefDto) {
    return this.svc.fillAutoCalendar(u.id, d.runId);
  }

  @Post('generate-next-auto-media') @HttpCode(200)
  nextAuto(@CurrentUser() u: AuthUser, @Body() d: GenerateNextAutoMediaDto) {
    return this.svc.generateNextAutoMedia(u.id, d);
  }

  @Post('cancel-auto-calendar') @HttpCode(200)
  cancelAuto(@CurrentUser() u: AuthUser, @Body() d: RunRefDto) {
    return this.svc.cancelAutoCalendar(u.id, d.runId);
  }

  @Post('preview-auto-calendar') @HttpCode(200)
  previewAuto(@Body() d: PreviewAutoCalendarDto) {
    return this.svc.previewAutoCalendar(d);
  }
}
