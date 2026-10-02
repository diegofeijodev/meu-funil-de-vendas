import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { errMessage } from '../media/user-error';
import { CanvaCreateFromBriefDto, CanvaImportDesignDto, CanvaListDesignsDto, CanvaSaveAppDto, CanvaSendAssetDto, WorkspaceIdDto } from '../creative/creative.dto';
import { CanvaService } from './canva.service';

/** Server fns de `creative/canva.functions.ts`: `POST /v1/creative/canva-*` (workspace no corpo). */
@ApiTags('Canva')
@ApiBearerAuth()
@Controller('v1/creative')
export class CanvaController {
  constructor(private readonly canva: CanvaService) {}

  @Post('canva-get-status') @HttpCode(200)
  status(@CurrentUser() u: AuthUser, @Body() d: WorkspaceIdDto) {
    return this.canva.status(u.id, d.workspaceId);
  }

  @Post('canva-save-app') @HttpCode(200)
  saveApp(@CurrentUser() u: AuthUser, @Body() d: CanvaSaveAppDto) {
    return this.canva.saveApp(u.id, d.workspaceId, d.clientId, d.clientSecret ?? null);
  }

  @Post('canva-o-auth-start') @HttpCode(200)
  oauthStart(@CurrentUser() u: AuthUser, @Body() d: WorkspaceIdDto) {
    return this.canva.oauthStart(u.id, d.workspaceId);
  }

  @Post('canva-test') @HttpCode(200)
  test(@CurrentUser() u: AuthUser, @Body() d: WorkspaceIdDto) {
    return this.canva.test(u.id, d.workspaceId);
  }

  @Post('canva-disconnect') @HttpCode(200)
  disconnect(@CurrentUser() u: AuthUser, @Body() d: WorkspaceIdDto) {
    return this.canva.disconnect(u.id, d.workspaceId);
  }

  @Post('canva-send-asset') @HttpCode(200)
  sendAsset(@CurrentUser() u: AuthUser, @Body() d: CanvaSendAssetDto) {
    return this.canva.sendAsset(u.id, d.workspaceId, d.assetId);
  }

  @Post('canva-create-from-brief') @HttpCode(200)
  createFromBrief(@CurrentUser() u: AuthUser, @Body() d: CanvaCreateFromBriefDto) {
    return this.canva.createFromBrief(u.id, d.workspaceId, { title: d.title, size: d.size ?? 'portrait', assetId: d.assetId });
  }

  @Post('canva-list-designs') @HttpCode(200)
  listDesigns(@CurrentUser() u: AuthUser, @Body() d: CanvaListDesignsDto) {
    return this.canva.listDesigns(u.id, d.workspaceId, d.query ?? null);
  }

  @Post('canva-import-design') @HttpCode(200)
  async importDesign(@CurrentUser() u: AuthUser, @Body() d: CanvaImportDesignDto) {
    const a = await this.canva.importDesign(u.id, d.workspaceId, d);
    return { id: a.id, url: a.url };
  }
}

/** `GET /api/public/canva/oauth/callback` — retorno do login do Canva (pública: o `state` guardado no cofre é a credencial). */
@ApiTags('Canva')
@Controller('api/public/canva/oauth')
export class CanvaCallbackController {
  constructor(private readonly canva: CanvaService) {}

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const back = (status: 'ok' | 'error', msg?: string) => reply.status(302).header('Location', this.canva.backUrl(status, msg)).send();
    if (error) return back('error', 'O Canva recusou a autorização.');
    if (!code || !state) return back('error', 'Retorno do Canva incompleto.');
    try {
      await this.canva.finishOAuth(state, code);
      return back('ok');
    } catch (e) {
      return back('error', errMessage(e, 'Não foi possível concluir o login.'));
    }
  }
}
