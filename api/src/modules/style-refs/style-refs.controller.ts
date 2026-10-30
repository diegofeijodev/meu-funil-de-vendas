import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUuid, ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { resolveUploadMime } from '../files/files.service';
import { bad } from '../media/user-error';
import { StyleRefsService } from './style-refs.service';

type FilePart = { file: AsyncIterable<Buffer> & { truncated?: boolean }; mimetype: string; filename: string };

class PinterestDto {
  @IsString() @MaxLength(500) url!: string;
  @IsOptional() @IsUUID() campaign_id?: string | null;
}

const campaignParam = (v: string | undefined) => {
  if (!v) return null;
  if (!isUuid(v)) throw bad('Campanha inválida.');
  return v;
};

/** Estilo das artes (Fatias 5/6, contrato §28). GET = qualquer membro; o resto = write. */
@ApiTags('Style references')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/brands/:brandId/style-refs')
export class StyleRefsController {
  constructor(private readonly refs: StyleRefsService) {}

  @Get()
  list(
    @CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string,
    @Param('brandId', ParseUuidPipe) brandId: string, @Query('campaign_id') campaignId?: string,
  ) {
    return this.refs.list(u.id, ws, brandId, campaignParam(campaignId));
  }

  /** Multipart (campo `file`): JPG/PNG/WEBP até 15 MB; `?campaign_id=` liga à campanha. */
  @Post('upload') @HttpCode(200)
  async upload(
    @CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string,
    @Param('brandId', ParseUuidPipe) brandId: string, @Query('campaign_id') campaignId: string | undefined, @Req() req: FastifyRequest,
  ) {
    if (!req.isMultipart()) throw bad('Envie o arquivo como multipart/form-data.');
    const part = await (req as unknown as { file: () => Promise<FilePart | undefined> }).file();
    if (!part) throw bad('Nenhum arquivo enviado.');
    const chunks: Buffer[] = [];
    for await (const c of part.file) chunks.push(c);
    if (part.file.truncated) throw bad('A imagem passa de 15 MB.');
    const bytes = Buffer.concat(chunks);
    if (bytes.length === 0) throw bad('Arquivo vazio.');
    return this.refs.upload(u.id, ws, brandId, { bytes, mime: resolveUploadMime(part.filename, part.mimetype) }, campaignParam(campaignId));
  }

  @Post('pinterest') @HttpCode(200)
  pinterest(
    @CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string,
    @Param('brandId', ParseUuidPipe) brandId: string, @Body() dto: PinterestDto,
  ) {
    return this.refs.addPinterest(u.id, ws, brandId, dto.url, dto.campaign_id ?? null);
  }

  @Delete('sources/:sourceId')
  removeSource(
    @CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string,
    @Param('brandId', ParseUuidPipe) brandId: string, @Param('sourceId', ParseUuidPipe) sourceId: string,
  ) {
    return this.refs.removeSource(u.id, ws, brandId, sourceId);
  }

  @Delete(':id')
  remove(
    @CurrentUser() u: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string,
    @Param('brandId', ParseUuidPipe) brandId: string, @Param('id', ParseUuidPipe) id: string,
  ) {
    return this.refs.remove(u.id, ws, brandId, id);
  }
}
