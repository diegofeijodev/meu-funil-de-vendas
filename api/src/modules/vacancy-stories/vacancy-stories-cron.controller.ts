import { Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { errText } from '../instagram/ig-store.service';
import { CronAuthService } from '../scheduler/cron-auth.service';
import { VacancyStoriesCronService } from './vacancy-stories-cron.service';

/** `POST /api/public/cron/vacancy-stories` — `x-cron-secret` (`CRM_CRON_SECRET` ou `cron_tokens.name = 'vacancy-stories'`). */
@Public()
@SkipThrottle()
@Controller('api/public/cron')
export class VacancyStoriesCronController {
  constructor(
    private readonly auth: CronAuthService,
    private readonly cron: VacancyStoriesCronService,
  ) {}

  @Post('vacancy-stories') @HttpCode(200)
  async run(@Headers('x-cron-secret') secret: string | undefined) {
    if (!(await this.auth.isAuthorized(secret, ['vacancy-stories']))) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    try {
      const out = await this.cron.runExclusive();
      if ('skipped' in out) return out;
      await this.auth.heartbeat('vacancy-stories', 'ok', null);
      return out.value;
    } catch (e) {
      await this.auth.heartbeat('vacancy-stories', 'error', errText(e));
      throw e;
    }
  }
}
