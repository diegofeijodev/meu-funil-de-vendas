import { ConflictException, Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { IgStore, PublishUnblockHow, errText } from './ig-store.service';
import { MetaGraphClient } from './meta-graph';
import { classifyPublishError, nextCheckDelay } from './publish-block';

const MIN = 60e3;
/** O botão "Já corrigi — testar agora" aceita uma conferência por minuto por empresa. */
export const PUBLISH_CHECK_COOLDOWN_MS = MIN;
/** Erro de rede (ou outro erro que não diz nada da permissão) na sonda: tenta de novo em 1 h sem contar falha. */
const NETWORK_RETRY_MS = 60 * MIN;
const PERMISSION = 'instagram_content_publish';

export type ProbeMode = 'active' | 'log_only';
type Outcome = 'unblocked' | 'denied' | 'log_only' | 'error' | 'token';

export const PUBLISH_CHECK_MSG = {
  working: 'A publicação está funcionando.',
  unblocked: 'Tudo certo: a Meta voltou a aceitar publicações. Os posts que esperavam saem nos próximos minutos.',
  denied: 'A Meta ainda não deu a permissão de publicar. Confira o passo acima e tente de novo.',
  logOnly: 'A conferência foi registrada. Para voltar a publicar agora, reconecte o Instagram em Instagram → Visão geral.',
  error: 'Não conseguimos falar com a Meta agora. Tente de novo em alguns minutos.',
  reconnect: 'Reconecte o Instagram em Instagram → Visão geral.',
  tooSoon: 'Espere um minuto para testar de novo.',
} as const;
const MESSAGE: Record<Outcome, string> = {
  unblocked: PUBLISH_CHECK_MSG.unblocked,
  denied: PUBLISH_CHECK_MSG.denied,
  log_only: PUBLISH_CHECK_MSG.logOnly,
  error: PUBLISH_CHECK_MSG.error,
  token: PUBLISH_CHECK_MSG.reconnect,
};

/**
 * Sonda do bloqueio de publicação (R8) e botão "Já corrigi — testar agora" (R9). Só lê (`GET /me/permissions` e o limite de publicações):
 * nada é publicado e nenhuma cota é gasta. O que a Meta devolveu vai para o log do servidor (sem token). Com `IG_PUBLISH_PROBE_CLOSES`
 * desligada (padrão, "modo só registro") a sonda nunca fecha o bloqueio: só a publicação que deu certo e a reconexão fecham.
 */
@Injectable()
export class PublishBlockService {
  private readonly logger = new Logger(PublishBlockService.name);
  readonly mode: ProbeMode;

  constructor(
    private readonly store: IgStore,
    private readonly graph: MetaGraphClient,
    @Inject(ENV) env: Pick<Env, 'IG_PUBLISH_PROBE_CLOSES'>,
  ) {
    this.mode = env.IG_PUBLISH_PROBE_CLOSES === true ? 'active' : 'log_only';
  }

  private get prisma() {
    return this.store.prisma;
  }

  /** Job `instagram-queue-5min` (antes da fila): confere as empresas bloqueadas por permissão cuja próxima conferência venceu. */
  async checkDue(now = new Date()): Promise<{ checked: number; unblocked: number }> {
    const due = await this.prisma.instagram_accounts.findMany({
      where: { publish_block_reason: 'permission', publish_next_check_at: { lte: now } },
      orderBy: { publish_next_check_at: 'asc' },
      take: 20,
      select: { workspace_id: true },
    });
    const out = { checked: 0, unblocked: 0 };
    for (const a of due) {
      try {
        const r = await this.check(a.workspace_id, 'probe', now);
        out.checked++;
        if (r === 'unblocked') out.unblocked++;
      } catch (e) {
        this.logger.error(`[instagram] sonda de publicação falhou (${a.workspace_id}): ${errText(e)}`);
      }
    }
    return out;
  }

  /**
   * Botão "Já corrigi — testar agora" (`POST …/instagram-account/publish-check`, escrita). Sem bloqueio → "funcionando" sem chamar a Meta;
   * motivo `token` → 422 (só a reconexão resolve); mais de uma por minuto → 409.
   */
  async checkNow(workspaceId: string, now = new Date()): Promise<{ ok: true; unblocked: boolean; probe: ProbeMode; message: string }> {
    const acc = await this.prisma.instagram_accounts.findFirst({
      where: { workspace_id: workspaceId },
      select: { publish_block_reason: true, publish_checked_at: true },
    });
    if (!acc?.publish_block_reason) return { ok: true, unblocked: true, probe: this.mode, message: PUBLISH_CHECK_MSG.working };
    if (acc.publish_block_reason === 'token') throw new UnprocessableEntityException({ code: 'PUBLISH_NEEDS_RECONNECT', message: PUBLISH_CHECK_MSG.reconnect });
    const last = acc.publish_checked_at;
    const tooSoon = () => new ConflictException({ code: 'PUBLISH_CHECK_TOO_SOON', message: PUBLISH_CHECK_MSG.tooSoon });
    if (last && now.getTime() - last.getTime() < PUBLISH_CHECK_COOLDOWN_MS) throw tooSoon();
    // Reserva a vez (condicional ao valor lido): dois cliques ao mesmo tempo não fazem duas sondas.
    const got = await this.prisma.instagram_accounts.updateMany({ where: { workspace_id: workspaceId, publish_checked_at: last }, data: { publish_checked_at: now } });
    if (!got.count) throw tooSoon();
    const r = await this.check(workspaceId, 'button', now);
    return { ok: true, unblocked: r === 'unblocked', probe: this.mode, message: MESSAGE[r] };
  }

  /** Uma conferência: lê, registra e aplica o resultado no bloqueio (sempre condicional a ele ainda estar aberto). */
  private async check(workspaceId: string, how: Extract<PublishUnblockHow, 'probe' | 'button'>, now: Date): Promise<Outcome> {
    const r = await this.probe(workspaceId);
    const open = { workspace_id: workspaceId, publish_block_reason: 'permission' };
    await this.prisma.instagram_accounts.updateMany({ where: { workspace_id: workspaceId }, data: { publish_checked_at: now } });
    if (r.kind === 'token') {
      // Token morto descoberto pela sonda: a fila adiada nunca o descobriria (R4).
      await this.store.handleTokenExpired(workspaceId, r.message);
      return 'token';
    }
    if (r.kind === 'error') {
      await this.prisma.instagram_accounts.updateMany({ where: open, data: { publish_next_check_at: new Date(now.getTime() + NETWORK_RETRY_MS) } });
      return 'error';
    }
    const acc = await this.prisma.instagram_accounts.findFirst({ where: open, select: { publish_block_failures: true } });
    if (!acc) return 'unblocked'; // fechou no meio (publicação ou reconexão)
    if (r.granted && this.mode === 'active') {
      await this.store.closePublishBlock(workspaceId, how, now);
      return 'unblocked';
    }
    if (r.granted) {
      // Modo só registro: a sonda diria "liberado", mas não fecha; a cadência continua sem contar falha.
      await this.prisma.instagram_accounts.updateMany({ where: open, data: { publish_next_check_at: new Date(now.getTime() + nextCheckDelay(acc.publish_block_failures)) } });
      return 'log_only';
    }
    const failures = acc.publish_block_failures + 1;
    await this.prisma.instagram_accounts.updateMany({ where: open, data: { publish_block_failures: failures, publish_next_check_at: new Date(now.getTime() + nextCheckDelay(failures)) } });
    return 'denied';
  }

  /**
   * As duas leituras da F0-5: as permissões do token e o limite de publicações da conta. Vão para o log como vieram (a Graph nunca devolve o
   * token nelas). Só a das permissões decide; a do limite é só registro.
   */
  private async probe(workspaceId: string): Promise<{ kind: 'ok'; granted: boolean } | { kind: 'token' | 'error'; message: string }> {
    const acc = await this.prisma.instagram_accounts.findFirst({ where: { workspace_id: workspaceId }, select: { ig_user_id: true } });
    let perms: { data?: { permission?: string; status?: string }[] };
    try {
      perms = await this.graph.graph(workspaceId, '/me/permissions');
    } catch (e) {
      this.logger.warn(`[instagram] sonda de publicação ${workspaceId} (${this.mode}): /me/permissions falhou: ${errText(e)}`);
      return classifyPublishError(e) === 'token' ? { kind: 'token', message: errText(e) } : { kind: 'error', message: errText(e) };
    }
    const limit = acc?.ig_user_id
      ? await this.graph
          .graph(workspaceId, `/${acc.ig_user_id}/content_publishing_limit`, { params: { fields: 'config,quota_usage' } })
          .catch((e: unknown) => ({ error: errText(e) }))
      : null;
    const list = (perms.data ?? []).map((p) => ({ permission: p.permission, status: p.status }));
    const granted = list.some((p) => p.permission === PERMISSION && p.status === 'granted');
    this.logger.log(`[instagram] sonda de publicação ${workspaceId} (${this.mode}): ${PERMISSION}=${granted ? 'granted' : 'não'} permissões=${JSON.stringify(list).slice(0, 1500)} limite=${JSON.stringify(limit).slice(0, 500)}`);
    return { kind: 'ok', granted };
  }
}
