import { ConflictException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { Jimp } from 'jimp';
import { FilesService } from '../files/files.service';
import { MEDIA_BUCKET } from '../media/assets.service';
import { IgStore, PublishUnblockHow, errText } from './ig-store.service';
import { MetaGraphClient } from './meta-graph';
import { classifyPublishError, nextCheckDelay } from './publish-block';

const MIN = 60e3;
/** O botão "Já corrigi — testar agora" e o "Publicar agora" com o bloqueio aberto dividem uma tentativa por minuto por empresa. */
export const PUBLISH_CHECK_COOLDOWN_MS = MIN;
/** Erro passageiro na sonda (rede, mídia que a Meta não baixou, credencial faltando): tenta de novo em 1 h sem contar falha. */
const RETRY_MS = 60 * MIN;
/**
 * Imagem da sonda: JPEG (o único formato de imagem que a Meta aceita em story) 1080 × 1920 de uma cor, gravada uma vez no bucket da mídia
 * publicada (a Meta já baixa as artes de lá) e entregue por URL assinada de 1 h.
 */
export const PROBE_IMAGE_KEY = 'system/publish-probe.jpg';
const PROBE_URL_TTL_S = 3600;

type Outcome = 'unblocked' | 'denied' | 'error' | 'token';
type Probe = { kind: 'ok'; containerId: string } | { kind: 'denied' | 'token' | 'error'; message: string };

export const PUBLISH_CHECK_MSG = {
  working: 'A publicação está funcionando.',
  unblocked: 'A permissão de publicar voltou: as publicações voltaram. Os posts que esperavam saem nos próximos minutos.',
  denied: 'A Meta ainda recusa as publicações desta empresa. Confira os passos 2 e 3.',
  error: 'Não conseguimos falar com a Meta agora.',
  reconnect: 'Reconecte o Instagram em Instagram → Visão geral.',
  tooSoon: 'Espere um minuto para testar de novo.',
} as const;
const MESSAGE: Record<Outcome, string> = {
  unblocked: PUBLISH_CHECK_MSG.unblocked,
  denied: PUBLISH_CHECK_MSG.denied,
  error: PUBLISH_CHECK_MSG.error,
  token: PUBLISH_CHECK_MSG.reconnect,
};

let probeBytes: Promise<Buffer> | null = null;
/** JPEG 1080 × 1920 de uma cor (cinza claro): a imagem do container de teste. Codificada uma vez por processo (o jimp leva segundos). */
export function probeImageBytes(): Promise<Buffer> {
  probeBytes ??= new Jimp({ width: 1080, height: 1920, color: 0xf2f2f2ff }).getBuffer('image/jpeg').then(
    (b) => Buffer.from(b),
    (e: unknown) => {
      probeBytes = null;
      throw e;
    },
  );
  return probeBytes;
}

/**
 * Sonda do bloqueio de publicação (R8) e botão "Já corrigi — testar agora" (R9). A sonda é real: cria um container de story na Meta
 * (`POST /{ig}/media`, `media_type=STORIES`) e NUNCA chama `media_publish` — nada vai ao ar e o limite de publicações não é gasto (criar
 * container tem limite próprio, 400 em 24 h; a escada de esperas gasta poucos). Criar container exige a permissão de publicar, então
 * container criado = a permissão voltou. O container sem publicar expira sozinho em 24 h.
 */
@Injectable()
export class PublishBlockService {
  private readonly logger = new Logger(PublishBlockService.name);

  constructor(
    private readonly store: IgStore,
    private readonly graph: MetaGraphClient,
    private readonly files: FilesService,
  ) {}

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
   * Reserva a vez de uma tentativa real com o bloqueio aberto (botão ou "Publicar agora"): no máximo uma por minuto por empresa. Condicional
   * ao valor lido: dois cliques ao mesmo tempo não fazem duas tentativas. `false` = cedo demais.
   */
  async reserveAttempt(workspaceId: string, now = new Date()): Promise<boolean> {
    const acc = await this.prisma.instagram_accounts.findFirst({ where: { workspace_id: workspaceId }, select: { publish_checked_at: true } });
    if (!acc) return false;
    const last = acc.publish_checked_at;
    if (last && now.getTime() - last.getTime() < PUBLISH_CHECK_COOLDOWN_MS) return false;
    const got = await this.prisma.instagram_accounts.updateMany({ where: { workspace_id: workspaceId, publish_checked_at: last }, data: { publish_checked_at: now } });
    return got.count > 0;
  }

  /** Marca uma tentativa real que a Meta recusou (conta para o minuto de espera do botão e do "Publicar agora"). */
  async noteAttempt(workspaceId: string, now = new Date()) {
    await this.prisma.instagram_accounts.updateMany({ where: { workspace_id: workspaceId }, data: { publish_checked_at: now } });
  }

  /**
   * Botão "Já corrigi — testar agora" (`POST …/instagram-account/publish-check`, escrita). Sem bloqueio → "funcionando" sem chamar a Meta;
   * motivo `token` → 422 (só a reconexão resolve); mais de uma tentativa por minuto → 409. Continua bloqueado → `next_check_at` diz a
   * próxima conferência automática.
   */
  async checkNow(workspaceId: string, now = new Date()): Promise<{ ok: true; unblocked: boolean; message: string; next_check_at: Date | null }> {
    const acc = await this.prisma.instagram_accounts.findFirst({ where: { workspace_id: workspaceId }, select: { publish_block_reason: true } });
    if (!acc?.publish_block_reason) return { ok: true, unblocked: true, message: PUBLISH_CHECK_MSG.working, next_check_at: null };
    if (acc.publish_block_reason === 'token') throw new UnprocessableEntityException({ code: 'PUBLISH_NEEDS_RECONNECT', message: PUBLISH_CHECK_MSG.reconnect });
    if (!(await this.reserveAttempt(workspaceId, now))) throw new ConflictException({ code: 'PUBLISH_CHECK_TOO_SOON', message: PUBLISH_CHECK_MSG.tooSoon });
    const r = await this.check(workspaceId, 'button', now);
    const next =
      r === 'unblocked'
        ? null
        : ((await this.prisma.instagram_accounts.findFirst({ where: { workspace_id: workspaceId, publish_block_reason: 'permission' }, select: { publish_next_check_at: true } }))
            ?.publish_next_check_at ?? null);
    return { ok: true, unblocked: r === 'unblocked', message: MESSAGE[r], next_check_at: next };
  }

  /** Uma conferência: cria o container de teste e aplica o resultado no bloqueio (sempre condicional a ele ainda estar aberto). */
  private async check(workspaceId: string, how: Extract<PublishUnblockHow, 'probe' | 'button'>, now: Date): Promise<Outcome> {
    const r = await this.probe(workspaceId);
    const open = { workspace_id: workspaceId, publish_block_reason: 'permission' };
    await this.noteAttempt(workspaceId, now);
    if (r.kind === 'ok') {
      await this.store.closePublishBlock(workspaceId, how, now);
      return 'unblocked';
    }
    if (r.kind === 'token') {
      // Token morto descoberto pela sonda: a fila adiada nunca o descobriria (R4).
      await this.store.handleTokenExpired(workspaceId, r.message);
      return 'token';
    }
    if (r.kind === 'error') {
      await this.prisma.instagram_accounts.updateMany({ where: open, data: { publish_next_check_at: new Date(now.getTime() + RETRY_MS) } });
      return 'error';
    }
    const acc = await this.prisma.instagram_accounts.findFirst({ where: open, select: { publish_block_failures: true } });
    if (!acc) return 'unblocked'; // fechou no meio (publicação ou reconexão)
    const failures = acc.publish_block_failures + 1;
    await this.prisma.instagram_accounts.updateMany({ where: open, data: { publish_block_failures: failures, publish_next_check_at: new Date(now.getTime() + nextCheckDelay(failures)) } });
    return 'denied';
  }

  /** Cria o container de story de teste (sem publicar). O resultado vai para o log do servidor (sem token). */
  private async probe(workspaceId: string): Promise<Probe> {
    const acc = await this.prisma.instagram_accounts.findFirst({ where: { workspace_id: workspaceId }, select: { ig_user_id: true } });
    if (!acc?.ig_user_id) return { kind: 'error', message: 'Conta do Instagram sem id.' };
    try {
      const imageUrl = await this.probeImageUrl();
      const c = await this.graph.graph<{ id?: string }>(workspaceId, `/${acc.ig_user_id}/media`, { method: 'POST', params: { media_type: 'STORIES', image_url: imageUrl } });
      if (!c?.id) return { kind: 'error', message: 'A Meta não devolveu o container.' };
      this.logger.log(`[instagram] sonda de publicação ${workspaceId}: container de story ${c.id} criado (sem publicar).`);
      return { kind: 'ok', containerId: c.id };
    } catch (e) {
      const kind = classifyPublishError(e);
      this.logger.warn(`[instagram] sonda de publicação ${workspaceId}: ${kind === 'permission' ? 'recusada por permissão' : kind === 'token' ? 'token vencido' : 'erro passageiro'}: ${errText(e)}`);
      return { kind: kind === 'permission' ? 'denied' : kind === 'token' ? 'token' : 'error', message: errText(e) };
    }
  }

  /** URL assinada (1 h) da imagem da sonda; grava o JPEG na primeira vez. */
  private async probeImageUrl(): Promise<string> {
    if (!(await this.files.exists(MEDIA_BUCKET, PROBE_IMAGE_KEY))) await this.files.put(MEDIA_BUCKET, PROBE_IMAGE_KEY, await probeImageBytes());
    return this.files.signedUrl(MEDIA_BUCKET, PROBE_IMAGE_KEY, PROBE_URL_TTL_S);
  }
}
