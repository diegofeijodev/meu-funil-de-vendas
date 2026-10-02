import { BadRequestException, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { BRAND_ONLY_MIMES, contentMatchesMime, extFromMime, FilesService, isAllowedMime, mimeFromKey, resolveUploadMime } from './files.service';

const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;
const MAX_DOC = 10 * 1024 * 1024;

@ApiTags('Files')
@Controller('v1')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Download por URL assinada (pública: a assinatura é a credencial). */
  @Public()
  @Get('files/:bucket/*')
  async download(
    @Param('bucket') bucket: string,
    @Param('*') key: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Query('dl') dl: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    this.files.assertBucket(bucket);
    const decoded = key;
    this.files.verify(bucket, decoded, exp, sig);
    const bytes = await this.files.read(bucket, decoded);
    const mime = mimeFromKey(decoded);
    // SVG pode carregar script: servido isolado (sandbox, sem rede) mesmo se alguém abrir o link direto.
    if (mime === 'image/svg+xml') reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    // `?dl=<nome>` (exportações da biblioteca): força o download com esse nome. Não é parte da assinatura (só muda o cabeçalho).
    if (dl) {
      const safe = dl.replace(/[\u0000-\u001f\u007f"\\/]/g, '').slice(0, 150) || 'arquivo';
      reply.header('Content-Disposition', `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safe)}`);
    }
    return reply
      .header('Content-Type', mime)
      .header('Content-Length', bytes.length)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(bytes);
  }

  /** Upload multipart do navegador, escopado no workspace (campo `file`; query `kind`, padrão `media`). */
  @ApiBearerAuth()
  @UseGuards(WorkspaceAccessGuard)
  @Post('workspaces/:workspaceId/files')
  async upload(
    @Param('workspaceId', ParseUuidPipe) workspaceId: string,
    @Query('kind') kind: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    if (!req.isMultipart()) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Envie o arquivo como multipart/form-data.' });
    const part = await (req as unknown as { file: () => Promise<{ file: AsyncIterable<Buffer>; mimetype: string; filename: string; truncated?: boolean } | undefined> }).file();
    if (!part) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Nenhum arquivo enviado.' });
    const mime = resolveUploadMime(part.filename, part.mimetype);
    if (!isAllowedMime(mime) || (BRAND_ONLY_MIMES.includes(mime) && kind !== 'brands')) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Tipo de arquivo não suportado.' });
    const chunks: Buffer[] = [];
    for await (const c of part.file) chunks.push(c);
    if (part.truncated) throw new BadRequestException({ code: 'PAYLOAD_TOO_LARGE', message: 'Arquivo grande demais.' });
    const bytes = Buffer.concat(chunks);
    const max = mime.startsWith('video/') ? MAX_VIDEO : mime === 'application/pdf' ? MAX_DOC : MAX_IMAGE;
    if (bytes.length > max) throw new BadRequestException({ code: 'PAYLOAD_TOO_LARGE', message: 'Arquivo grande demais.' });
    if (bytes.length === 0) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Arquivo vazio.' });
    if (!contentMatchesMime(mime, bytes)) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'O conteúdo do arquivo não corresponde ao tipo.' });

    const bucket = 'creative-assets';
    const key = this.files.newUploadKey(kind ?? 'media', workspaceId, extFromMime(mime));
    await this.files.put(bucket, key, bytes);
    return { bucket, key, storage_path: key, url: this.files.signedUrl(bucket, key), mime, size_bytes: bytes.length };
  }

  /** Remove um arquivo do workspace (a chave precisa ser `<kind>/<workspaceId>/...`). */
  @ApiBearerAuth()
  @UseGuards(WorkspaceAccessGuard)
  @HttpCode(204)
  @Delete('workspaces/:workspaceId/files')
  async remove(@Param('workspaceId', ParseUuidPipe) workspaceId: string, @Query('key') key: string | undefined) {
    if (!key || !this.files.keyBelongsToWorkspace(key, workspaceId)) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Chave de arquivo inválida.' });
    }
    await this.files.delete('creative-assets', key);
  }
}
