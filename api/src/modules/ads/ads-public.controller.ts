import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/decorators/public.decorator';
import { CronAuthService } from '../scheduler/cron-auth.service';
import { errMsg } from './ads-errors';
import { AdsChannelsService } from './ads-channels.service';
import { AdsCronDto } from './ads.dto';
import { AdsCronService } from './ads-cron.service';
import { MetaOAuthService } from './meta-oauth.service';

const text = (e: unknown, fb: string) => {
  const m = errMsg(e, fb);
  return m || fb;
};

/** Rotas públicas (sem JWT): o retorno do login é protegido pelo `state` de uso único; o cron, por `x-cron-secret`. */
@Public()
@Controller('api/public')
export class AdsPublicController {
  constructor(
    private readonly metaOauth: MetaOAuthService,
    private readonly channels: AdsChannelsService,
    private readonly cron: AdsCronService,
    private readonly auth: CronAuthService,
  ) {}

  /** `GET /api/public/meta/oauth/callback` → 302 para `/integrations?meta=conectado` ou `?meta_erro=…`. */
  @Get('meta/oauth/callback')
  async metaCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const back = (q: { meta?: string; meta_erro?: string }) => reply.status(302).header('Location', this.metaOauth.backUrl(q)).send();
    const err = errorDescription ?? error;
    if (err) return back({ meta_erro: String(err) });
    if (!code || !state) return back({ meta_erro: 'retorno_incompleto' });
    try {
      await this.metaOauth.handleCallback(code, state);
      return back({ meta: 'conectado' });
    } catch (e) {
      return back({ meta_erro: text(e, 'falhou') });
    }
  }

  /** `GET /api/public/ads/oauth/:channel` (`google` → `?code`; `tiktok` → `?auth_code`). */
  @Get('ads/oauth/:channel')
  async adsCallback(
    @Param('channel') channelParam: string,
    @Query() q: Record<string, string | undefined>,
    @Res() reply: FastifyReply,
  ) {
    const back = (x: { ads?: string; ads_erro?: string }) => reply.status(302).header('Location', this.channels.backUrl(x)).send();
    const channel = channelParam === 'google' ? 'google' : channelParam === 'tiktok' ? 'tiktok' : null;
    if (!channel) return back({ ads_erro: 'canal_invalido' });
    const err = q['error_description'] ?? q['error'];
    if (err) return back({ ads_erro: String(err) });
    const code = q[channel === 'google' ? 'code' : 'auth_code'];
    const state = q['state'] ?? '';
    if (!code) return back({ ads_erro: 'retorno_incompleto' });
    try {
      await this.channels.finishLogin(channel, code, state);
      return back({ ads: channel });
    } catch (e) {
      return back({ ads_erro: text(e, 'falhou') });
    }
  }

  /** `POST /api/public/cron/ads` — corpo `{ task?: 'sync'|'rules' }`; `x-cron-secret` = `CRM_CRON_SECRET` ou `cron_tokens.name = 'ads'`. */
  @SkipThrottle()
  @Post('cron/ads') @HttpCode(200)
  async cronAds(@Headers('x-cron-secret') secret: string | undefined, @Body() body: AdsCronDto) {
    if (!(await this.auth.isAuthorized(secret, ['ads']))) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    const name = `ads-${body.task ?? 'sync'}`;
    try {
      const out = await this.cron.run(body.task);
      await this.auth.heartbeat(name, 'ok', null);
      return out;
    } catch (e) {
      await this.auth.heartbeat(name, 'error', errMsg(e));
      throw e;
    }
  }
}
