import { Inject, Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Autenticação das rotas de cron (`/api/public/cron/*`): o cabeçalho `x-cron-secret` precisa bater (tempo constante) com
 * `CRM_CRON_SECRET` do ambiente OU com algum `cron_tokens.token` cujo `name` esteja na lista da rota (`ads`, `crm_cadences`,
 * `crm_daily`, `instagram`). Sem cabeçalho = não autorizado.
 */
@Injectable()
export class CronAuthService {
  private readonly logger = new Logger(CronAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Pick<Env, 'CRM_CRON_SECRET'>,
  ) {}

  async isAuthorized(provided: string | string[] | undefined, tokenNames: string[]): Promise<boolean> {
    const secret = Array.isArray(provided) ? provided[0] : provided;
    if (!secret) return false;
    if (this.env.CRM_CRON_SECRET && safeEqual(secret, this.env.CRM_CRON_SECRET)) return true;
    const rows = await this.prisma.cron_tokens.findMany({ where: { name: { in: tokenNames } }, select: { token: true } });
    return rows.some((r) => !!r.token && safeEqual(secret, r.token));
  }

  /** Registra que o agendador rodou (alimenta "o que falta configurar"); nunca derruba o agendador. */
  async heartbeat(name: string, status: 'ok' | 'error' = 'ok', detail: string | null = null): Promise<void> {
    try {
      await this.prisma.cron_heartbeats.upsert({
        where: { name },
        create: { name, last_status: status, last_detail: detail?.slice(0, 300) ?? null },
        update: { last_run_at: new Date(), last_status: status, last_detail: detail?.slice(0, 300) ?? null },
      });
    } catch (e) {
      this.logger.warn(`heartbeat ${name}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
