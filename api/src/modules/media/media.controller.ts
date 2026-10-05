import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUuid, ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { TargetFormat } from './formats';
import { LibraryService, MAX_UPLOAD_BYTES } from './library.service';
import {
  AssetIdsDto, AttachMediaToPostDto, BulkMediaUpdateDto, DeleteMediaAssetsDto, DownloadAssetDto, ExportPdfDto, MediaAdResultsDto,
  MediaListQueryDto, ReformatMediaDto, RenameMediaFolderDto, RenameMediaTagDto, TARGETS, UpdateMediaTagsDto, UseMediaInCampaignDto,
} from './media.dto';
import { MediaQueryService } from './media-query.service';
import { bad, UserError } from './user-error';

/** Leituras/escritas diretas da biblioteca. GET = read, o resto = write (viewer só lê). Estáticas antes de `:id`. */
@ApiTags('Media')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId')
export class MediaResourceController {
  constructor(private readonly query: MediaQueryService) {}

  @Get('media-assets')
  list(@Param('workspaceId', ParseUuidPipe) ws: string, @Query() q: MediaListQueryDto) {
    return this.query.list(ws, q);
  }

  @Get('media-assets/facets')
  facets(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.query.facets(ws);
  }

  @Patch('media-assets/bulk')
  bulk(@Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: BulkMediaUpdateDto) {
    return this.query.bulkUpdate(ws, dto.ids, { status: dto.status, folder: dto.folder });
  }

  @Patch('media-assets/:id')
  tags(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateMediaTagsDto) {
    return this.query.setTags(ws, id, dto.tags);
  }

  /** Aba "Textos" da biblioteca. */
  @Get('copies')
  copies(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.query.copies(ws);
  }
}

/** Server fns de `media/export.functions.ts` e `media/manage.functions.ts`: `POST /v1/media/<nome-em-kebab>` (workspace no corpo). */
@ApiTags('Media')
@ApiBearerAuth()
@Controller('v1/media')
export class MediaActionsController {
  constructor(private readonly lib: LibraryService) {}

  @Post('download-asset') @HttpCode(200)
  download(@CurrentUser() u: AuthUser, @Body() d: DownloadAssetDto) {
    return this.lib.downloadAsset(u.id, d.workspaceId, d.assetId, d.format);
  }

  @Post('export-pdf') @HttpCode(200)
  pdf(@CurrentUser() u: AuthUser, @Body() d: ExportPdfDto) {
    return this.lib.exportPdf(u.id, d.workspaceId, d.assetIds, d.layout);
  }

  @Post('export-zip') @HttpCode(200)
  zip(@CurrentUser() u: AuthUser, @Body() d: AssetIdsDto) {
    return this.lib.exportZip(u.id, d.workspaceId, d.assetIds);
  }

  /** Multipart (`workspaceId`, `target`, `brandId?`, `file`): um arquivo por requisição. */
  @Post('upload-media') @HttpCode(200)
  async upload(@CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw bad('Envio inválido.');
    const fields: Record<string, string> = {};
    let file: { filename: string; mimetype: string; bytes: Buffer } | null = null;
    let truncated = false;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        // O arquivo só é lido depois de conferir que quem envia pode editar esta empresa (campos vêm antes do arquivo).
        const wsField = fields['workspaceId'];
        if (!wsField || !isUuid(wsField)) throw bad('Envio inválido.');
        await this.lib.assertEdit(u.id, wsField);
        const chunks: Buffer[] = [];
        for await (const c of part.file) chunks.push(c as Buffer);
        truncated = truncated || !!(part.file as { truncated?: boolean }).truncated;
        file = { filename: part.filename || 'arquivo', mimetype: (part.mimetype || '').toLowerCase(), bytes: Buffer.concat(chunks) };
      } else {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }
    if (!file || file.bytes.length === 0) throw bad('Arquivo ausente.');
    if (truncated) throw new UserError(`${file.filename}: arquivo maior que ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
    const workspaceId = fields['workspaceId'];
    if (!workspaceId || !isUuid(workspaceId)) throw bad('Envio inválido.');
    const target = (fields['target'] || 'other') as TargetFormat;
    if (!(TARGETS as readonly string[]).includes(target)) throw bad('Formato de destino inválido.');
    const brandId = fields['brandId'] || null;
    if (brandId && !isUuid(brandId)) throw bad('Marca inválida.');
    return this.lib.upload(u.id, workspaceId, file, { target, brandId });
  }

  @Post('reformat-media') @HttpCode(200)
  reformat(@CurrentUser() u: AuthUser, @Body() d: ReformatMediaDto) {
    return this.lib.reformat(u.id, d.workspaceId, d.assetId, d.targets);
  }

  @Post('use-media-in-instagram') @HttpCode(200)
  inInstagram(@CurrentUser() u: AuthUser, @Body() d: AssetIdsDto) {
    return this.lib.useInInstagram(u.id, d.workspaceId, d.assetIds);
  }

  @Post('use-media-in-campaign') @HttpCode(200)
  inCampaign(@CurrentUser() u: AuthUser, @Body() d: UseMediaInCampaignDto) {
    return this.lib.useInCampaign(u.id, d.workspaceId, d.assetIds, d.campaignId);
  }

  @Post('attach-media-to-post') @HttpCode(200)
  attach(@CurrentUser() u: AuthUser, @Body() d: AttachMediaToPostDto) {
    return this.lib.attachToPost(u.id, d.workspaceId, d.postId, d.assetIds);
  }

  @Post('revalidate-assets') @HttpCode(200)
  revalidate(@CurrentUser() u: AuthUser, @Body() d: AssetIdsDto) {
    return this.lib.revalidate(u.id, d.workspaceId, d.assetIds);
  }

  @Post('delete-media-assets') @HttpCode(200)
  remove(@CurrentUser() u: AuthUser, @Body() d: DeleteMediaAssetsDto) {
    return this.lib.deleteAssets(u.id, d.workspaceId, d.assetIds);
  }

  @Post('rename-media-tag') @HttpCode(200)
  renameTag(@CurrentUser() u: AuthUser, @Body() d: RenameMediaTagDto) {
    return this.lib.renameTag(u.id, d.workspaceId, d.from, d.to);
  }

  @Post('rename-media-folder') @HttpCode(200)
  renameFolder(@CurrentUser() u: AuthUser, @Body() d: RenameMediaFolderDto) {
    return this.lib.renameFolder(u.id, d.workspaceId, d.from, d.to);
  }

  @Post('media-ad-results') @HttpCode(200)
  adResults(@CurrentUser() u: AuthUser, @Body() d: MediaAdResultsDto) {
    return this.lib.adResults(u.id, d.workspaceId, d.creativeId);
  }
}
