import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';

/** Chave de desenvolvimento (só vale com NODE_ENV=development/test), como a do cofre. */
export const DEV_UNSUBSCRIBE_SECRET = 'meu-funil-dev-unsubscribe-secret-not-for-production';

/**
 * Link de descadastro dos e-mails do CRM. Diferente do protótipo (HMAC truncado em 32 hex, comparação comum, segredo com
 * fallback fixo e compartilhado com o cron, sem vínculo com a empresa):
 *  - HMAC-SHA256 completo (64 hex) sobre `unsubscribe:v1:{workspaceId}:{leadId}` — preso ao lead E à empresa dele;
 *  - comparação em tempo constante;
 *  - segredo próprio `UNSUBSCRIBE_SECRET` (obrigatório fora de dev/test);
 *  - base do link = `APP_URL` (não mais o domínio fixo).
 * A Task 8 (envio de e-mail) monta o link com `link(workspaceId, leadId)`.
 */
@Injectable()
export class UnsubscribeLinkService {
  constructor(@Inject(ENV) private readonly env: Pick<Env, 'UNSUBSCRIBE_SECRET' | 'NODE_ENV' | 'APP_URL'>) {}

  private secret(): string {
    const s = this.env.UNSUBSCRIBE_SECRET || (this.env.NODE_ENV === 'development' || this.env.NODE_ENV === 'test' ? DEV_UNSUBSCRIBE_SECRET : '');
    if (!s) throw new Error('UNSUBSCRIBE_SECRET é obrigatória (o segredo de dev só vale com NODE_ENV=development/test).');
    return s;
  }

  /** Assinatura (64 hex) do par empresa+lead. */
  sign(workspaceId: string, leadId: string): string {
    return createHmac('sha256', this.secret()).update(`unsubscribe:v1:${workspaceId}:${leadId}`).digest('hex');
  }

  /** URL completa do link de descadastro (`{APP_URL}/api/public/unsubscribe/{leadId}?t={assinatura}`). */
  link(workspaceId: string, leadId: string): string {
    const base = this.env.APP_URL.replace(/\/+$/, '');
    return `${base}/api/public/unsubscribe/${leadId}?t=${this.sign(workspaceId, leadId)}`;
  }

  /** Confere (tempo constante) a assinatura recebida contra o par empresa+lead REAIS do lead. */
  verify(workspaceId: string, leadId: string, token: string | undefined | null): boolean {
    if (!token || typeof token !== 'string') return false;
    const given = Buffer.from(token.toLowerCase());
    const expected = Buffer.from(this.sign(workspaceId, leadId));
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
