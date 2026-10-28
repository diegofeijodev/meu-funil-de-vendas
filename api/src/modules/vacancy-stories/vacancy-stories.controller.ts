import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { RequireAccess, WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { resolveUploadMime } from '../files/files.service';
import { bad } from '../media/user-error';
import { VacancyActionsService } from './vacancy-actions.service';
import { VacancyGateGuard } from './vacancy-gate.service';
import { VacancyPreviewService } from './vacancy-preview.service';
import { VacancySettingsService } from './vacancy-settings.service';
import { AutoPublishDto, DontPostDto, ListStoriesQuery, UpdateVacancySettingsDto } from './vacancy-stories.dto';

type FilePart = { file: AsyncIterable<Buffer> & { truncated?: boolean }; mimetype: string; filename: string };

/**
 * Stories das vagas do Freela (contrato §26). Toda rota: primeiro a empresa na lista `VACANCY_STORIES_WORKSPACE_IDS` (fora = 404
 * "Página não encontrada.", para qualquer usuário — R20), depois membro da empresa (GET = read, resto = write; ligar/desligar/postar
 * sozinho = manage). Estáticas antes das `:id`.
 */
@ApiTags('Stories das vagas')
@ApiBearerAuth()
@UseGuards(VacancyGateGuard, WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/vacancy-stories')
export class VacancyStoriesController {
  constructor(
    private readonly settings: VacancySettingsService,
    private readonly actions: VacancyActionsService,
    private readonly preview: VacancyPreviewService,
  ) {}

  @Get('settings')
  view(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.settings.view(ws);
  }

  @Patch('settings')
  update(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: UpdateVacancySettingsDto) {
    return this.settings.update(u.id, ws, dto);
  }

  @Post('enable') @HttpCode(200) @RequireAccess('manage')
  enable(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.settings.enable(u.id, ws);
  }

  @Post('disable') @HttpCode(200) @RequireAccess('manage')
  disable(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.settings.disable(u.id, ws);
  }

  @Post('auto-publish') @HttpCode(200) @RequireAccess('manage')
  autoPublish(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: AutoPublishDto) {
    return this.settings.setAutoPublish(u.id, ws, dto.auto_publish);
  }

  /** Multipart (campo `file`): PNG/JPG até 10 MB. O tipo é conferido pelo conteúdo no serviço. */
  @Post('template') @HttpCode(200)
  async template(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw bad('Envie o arquivo como multipart/form-data.');
    const part = await (req as unknown as { file: () => Promise<FilePart | undefined> }).file();
    if (!part) throw bad('Nenhum arquivo enviado.');
    const chunks: Buffer[] = [];
    for await (const c of part.file) chunks.push(c);
    if (part.file.truncated) throw bad('A imagem tem mais de 100 MB e o máximo é 10 MB. Envie uma menor.');
    const bytes = Buffer.concat(chunks);
    if (bytes.length === 0) throw bad('Arquivo vazio.');
    return this.settings.uploadTemplate(u.id, ws, { bytes, mime: resolveUploadMime(part.filename, part.mimetype), filename: part.filename });
  }

  /** Prévia em segundo plano (o andamento fica em `settings.preview`); 409 se outra está em andamento. */
  @Post('preview') @HttpCode(200)
  startPreview(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.preview.start(u.id, ws);
  }

  @Get('stories')
  list(@Param('workspaceId', ParseUuidPipe) ws: string, @Query() q: ListStoriesQuery) {
    return this.actions.list(ws, q.filter ?? 'all');
  }

  @Get('stories/:id')
  detail(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.actions.detail(ws, id);
  }

  @Post('stories/:id/dont-post') @HttpCode(200)
  dontPost(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: DontPostDto) {
    return this.actions.dontPost(u.id, ws, id, dto.feedback);
  }

  @Post('stories/:id/post-now') @HttpCode(200)
  postNow(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.actions.postNow(u.id, ws, id);
  }

  @Post('stories/:id/create-anyway') @HttpCode(200)
  createAnyway(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.actions.createAnyway(u.id, ws, id);
  }

  @Post('stories/:id/redo') @HttpCode(200)
  redo(@CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.actions.redo(u.id, ws, id);
  }
}
