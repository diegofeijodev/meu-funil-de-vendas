import { Body, Controller, HttpCode, Post, Headers, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsIn, IsOptional } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CronAuthService } from '../scheduler/cron-auth.service';
import { errText } from './ig-store.service';
import { CRON_TASKS, CronTask, InstagramCronService } from './instagram-cron.service';

export class InstagramCronDto {
  @IsOptional() @IsIn(CRON_TASKS) task?: CronTask;
}

/**
 * `POST /api/public/cron/instagram` — protegido por `x-cron-secret` (`CRM_CRON_SECRET` ou `cron_tokens.name = 'instagram'`).
 * Corpo `{ task?: queue|publish|media|metrics|weekly|optimize|account }`; sem `task` roda queue + media + metrics.
 */
@Public()
@SkipThrottle()
@Controller('api/public/cron')
export class InstagramCronController {
  constructor(
    private readonly auth: CronAuthService,
    private readonly cron: InstagramCronService,
  ) {}

  @Post('instagram') @HttpCode(200)
  async run(@Headers('x-cron-secret') secret: string | undefined, @Body() body: InstagramCronDto) {
    if (!(await this.auth.isAuthorized(secret, ['instagram']))) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    const name = `instagram-${body.task === 'publish' ? 'queue' : (body.task ?? 'all')}`;
    try {
      const out = await this.cron.run(body.task);
      await this.auth.heartbeat(name, 'ok', null);
      return out;
    } catch (e) {
      await this.auth.heartbeat(name, 'error', errText(e));
      throw e;
    }
  }
}
