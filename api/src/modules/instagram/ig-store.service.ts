import { Injectable, Logger } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { notFound } from '../media/user-error';
import { AutopilotEventKind, PostRow, QUEUE_PER_ROUND, QUEUE_ROUND_MS, TOKEN_EXPIRED_POST_MSG } from './ig-types';
import { nextCheckDelay, type PublishBlockReason } from './publish-block';

/** Limite de publicações em 24 h quando a Meta não informou o dela (`publish_quota_total` nulo). */
export const DEFAULT_PUBLISH_QUOTA = 25;
/** Como o bloqueio fechou: só `publish` e `reconnect` são prova real (zeram as falhas). */
export type PublishUnblockHow = 'publish' | 'reconnect' | 'probe' | 'button';
const UNBLOCK_TEXT: Record<PublishUnblockHow, string> = {
  publish: 'uma publicação deu certo',
  reconnect: 'o Instagram foi reconectado',
  probe: 'a conferência automática conseguiu preparar um story de teste',
  button: 'o teste pelo botão conseguiu preparar um story de teste',
};
export const PUBLISH_BLOCK_OPENED: Record<PublishBlockReason, string> = {
  permission: 'Publicação parada: a Meta recusou por falta de permissão.',
  token: 'Publicação parada: o acesso da Meta venceu ou foi trocado.',
};
export const publishUnblockedMessage = (how: PublishUnblockHow) => `A Meta voltou a aceitar publicações (${UNBLOCK_TEXT[how]}).`;

/** Erros de regra (nunca repetidos pela fila). */
export class Guardrail extends Error {}
export class RateLimited extends Error {}
/** Outro processo (fila ou "publicar agora") já pegou o post: não é falha do post. */
export class PublishClaimLost extends Error {}
/** Container ainda em processamento na Meta: a fila tenta de novo em 2 min sem contar tentativa. */
export class ContainerPending extends Error {}
/** A fonte da origem do post (ex.: vitrine do Freela) está fora do ar: não publica agora; a fila tenta de novo em 10 min sem contar tentativa. */
export class OriginUnavailable extends Error {}
/** O post não pôde ser pego para publicar (não aprovado): nada mudou nele. A fila trata como guardrail. */
export class ClaimRefused extends Guardrail {}

/**
 * Mensagem para o usuário/log (o `errMsg` do protótipo). Passam: erros HTTP de domínio, as classes acima, `MetaError`
 * e `Error` comuns; erros do Prisma viram texto genérico (o detalhe fica no log do servidor).
 */
export function errText(e: unknown): string {
  if (e instanceof HttpException) {
    const body = e.getResponse() as { message?: unknown } | string;
    if (typeof body === 'string') return body;
    if (typeof body?.message === 'string') return body.message;
    if (Array.isArray(body?.message)) return (body.message as string[]).join(' | ');
  }
  if (e instanceof Error) {
    if (/^Prisma/.test(e.name) || /Invalid `prisma\./.test(e.message)) return 'Erro interno ao salvar. Tente de novo.';
    return e.message.slice(0, 500);
  }
  return 'erro desconhecido';
}

/** Condição Prisma "lease livre": nunca pego ou vencido. */
export const leaseFree = (now = new Date()) => ({ OR: [{ lease_until: null }, { lease_until: { lt: now } }] });

/**
 * Lease de trabalho sobre um post (`ig_posts.lease_until`). Pego por UPDATE condicional (livre = NULL ou vencido), renovado
 * enquanto o trabalho anda (`renew`, só se o lease ainda é o nosso — senão `PublishClaimLost`) e solto no fim (`release`).
 */
export class PostLease {
  constructor(
    private readonly prisma: PrismaService,
    readonly postId: string,
    private until: Date,
    private readonly ttlMs: number,
  ) {}

  /** Chamado depois de cada renovação (a fila renova junto o `locked_at` do job, para a trava não vencer no meio). */
  afterRenew: (() => Promise<unknown>) | null = null;

  async renew() {
    const next = new Date(Date.now() + this.ttlMs);
    const got = await this.prisma.ig_posts.updateMany({ where: { id: this.postId, lease_until: this.until }, data: { lease_until: next } });
    if (!got.count) throw new PublishClaimLost('O trabalho neste post foi assumido por outro processo (lease vencido).');
    this.until = next;
    await this.afterRenew?.();
  }

  async release() {
    await this.prisma.ig_posts.updateMany({ where: { id: this.postId, lease_until: this.until }, data: { lease_until: null } }).catch(() => undefined);
  }

  /** Em vez de soltar, segura o post por `ms` (espera antes da próxima tentativa); só se o lease ainda for deste processo. */
  async holdFor(ms: number) {
    await this.prisma.ig_posts.updateMany({ where: { id: this.postId, lease_until: this.until }, data: { lease_until: new Date(Date.now() + ms) } }).catch(() => undefined);
  }
}

/** Acesso às linhas de `ig_posts` e ao registro do piloto automático (sempre com id + workspace). */
@Injectable()
export class IgStore {
  private readonly logger = new Logger(IgStore.name);

  constructor(readonly prisma: PrismaService) {}

  /** Post do workspace; id de outra empresa = "Post não encontrado." (404). */
  async getPost(id: string, workspaceId?: string): Promise<PostRow> {
    const post = await this.prisma.ig_posts.findFirst({ where: { id, ...(workspaceId ? { workspace_id: workspaceId } : {}) } });
    if (!post) throw notFound('Post não encontrado.');
    return post;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // updateMany: post que sumiu no meio (empresa apagada, cascata) não derruba o job que o processava — a escrita vira no-op.
  patchPost(id: string, patch: Record<string, any>) {
    return this.prisma.ig_posts.updateMany({ where: { id }, data: patch });
  }

  /** Pega o lease do post junto com `data` se `where` (status etc.) e "lease livre" valem; null = perdeu. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async claimLease(postId: string, workspaceId: string | null, where: Record<string, any>, data: Record<string, any>, ttlMs: number): Promise<PostLease | null> {
    const until = new Date(Date.now() + ttlMs);
    const got = await this.prisma.ig_posts.updateMany({
      where: { id: postId, ...(workspaceId ? { workspace_id: workspaceId } : {}), AND: [where, leaseFree()] },
      data: { ...data, lease_until: until },
    });
    return got.count ? new PostLease(this.prisma, postId, until, ttlMs) : null;
  }

  appendLog(post: PostRow, entry: Record<string, unknown>) {
    const log = Array.isArray(post.ai_generation_log) ? post.ai_generation_log : [];
    return [...log, { at: new Date().toISOString(), ...entry }].slice(-50);
  }

  /**
   * Exigência de aprovação do post: a programação automática decide pelo próprio modo
   * ("publish" publica sozinho, "approval" espera aprovação); sem ela, vale o plano. Story de vaga: o modo gravado no post
   * (`creative_brief.vacancy.requires_approval`).
   */
  async approvalRequired(post: PostRow): Promise<boolean | null> {
    if (post.source === 'vacancy') return post.creative_brief?.vacancy?.requires_approval === true;
    if (post.automation === 'publish') return false;
    if (post.automation === 'approval') return true;
    if (!post.plan_id) return null;
    const plan = await this.prisma.ig_content_plans.findUnique({ where: { id: post.plan_id }, select: { requires_approval: true } });
    return plan?.requires_approval ?? null;
  }

  async liveAccount(workspaceId: string) {
    const a = await this.prisma.instagram_accounts.findFirst({ where: { workspace_id: workspaceId, status: 'connected' } });
    return a?.ig_user_id ? a : null;
  }

  /** R5: conta conectada E sem bloqueio de publicação aberto (o gerador das vagas e a agenda só seguem com ela). */
  async publishAccount(workspaceId: string) {
    const a = await this.liveAccount(workspaceId);
    return a && !a.publish_block_reason ? a : null;
  }

  /** Bloqueio aberto da empresa (`null` = publicando normalmente). */
  async publishBlock(workspaceId: string) {
    const a = await this.prisma.instagram_accounts.findFirst({
      where: { workspace_id: workspaceId, publish_block_reason: { not: null } },
      select: { publish_block_reason: true, publish_block_message: true, publish_blocked_at: true, publish_block_last_at: true, publish_block_failures: true, publish_next_check_at: true, username: true },
    });
    return a?.publish_block_reason ? { ...a, publish_block_reason: a.publish_block_reason as PublishBlockReason } : null;
  }

  /** P1: grava o limite que a Meta informou (já validado por `quotaFrom`; `null` = volta ao padrão de 25); muda só quando o número muda. */
  async savePublishQuota(workspaceId: string, total: number | null, now = new Date()) {
    await this.prisma.instagram_accounts.updateMany({ where: { workspace_id: workspaceId }, data: { publish_quota_total: total, publish_quota_checked_at: now } });
  }

  /** P1: limite de publicações em 24 h que a Meta informou para a conta (ou 25). */
  async publishQuota(workspaceId: string): Promise<number> {
    const a = await this.prisma.instagram_accounts.findFirst({ where: { workspace_id: workspaceId }, select: { publish_quota_total: true } });
    return a?.publish_quota_total ?? DEFAULT_PUBLISH_QUOTA;
  }

  /**
   * R2 — abre (ou mantém) o bloqueio: grava motivo e mensagem, mantém o `publish_blocked_at` do bloqueio aberto, soma 1 falha e marca a
   * próxima conferência pela escada de esperas (só `permission`; `token` não tem sonda). Um evento por ABERTURA (não por falha): a
   * transição "sem bloqueio → bloqueado" é um UPDATE condicional, então duas falhas ao mesmo tempo não registram duas aberturas.
   * `silent`: quem chama já registra o próprio evento (token vencido). `attemptStartedAt`: início da tentativa recusada — se o bloqueio fechou
   * DEPOIS disso (`publish_unblocked_at` posterior), a recusa é de antes do conserto e é ignorada (não reabre nem soma falha).
   */
  async openPublishBlock(
    workspaceId: string,
    reason: PublishBlockReason,
    message: string,
    o: { now?: Date; silent?: boolean; attemptStartedAt?: Date } = {},
  ): Promise<{ opened: boolean }> {
    const now = o.now ?? new Date();
    const msg = message.slice(0, 300);
    const fresh = o.attemptStartedAt ? { OR: [{ publish_unblocked_at: null }, { publish_unblocked_at: { lte: o.attemptStartedAt } }] } : {};
    const opened = await this.prisma.instagram_accounts.updateMany({
      where: { workspace_id: workspaceId, publish_block_reason: null, ...fresh },
      data: { publish_block_reason: reason, publish_block_message: msg, publish_blocked_at: now, publish_block_last_at: now, publish_block_failures: { increment: 1 } },
    });
    if (!opened.count) {
      const kept = await this.prisma.instagram_accounts.updateMany({
        where: { workspace_id: workspaceId, publish_block_reason: { not: null }, ...fresh },
        // 'token' prevalece sobre 'permission' (só a reconexão resolve); a recusa por permissão não rebaixa um bloqueio de token.
        data: { ...(reason === 'token' ? { publish_block_reason: 'token' } : {}), publish_block_message: msg, publish_block_last_at: now, publish_block_failures: { increment: 1 } },
      });
      if (!kept.count) return { opened: false }; // empresa sem linha de conta, ou recusa de antes do último fechamento
    }
    const cur = await this.prisma.instagram_accounts.findFirst({ where: { workspace_id: workspaceId }, select: { publish_block_failures: true, publish_block_reason: true } });
    await this.prisma.instagram_accounts.updateMany({
      where: { workspace_id: workspaceId },
      data: { publish_next_check_at: cur?.publish_block_reason === 'permission' ? new Date(now.getTime() + nextCheckDelay(cur.publish_block_failures)) : null },
    });
    if (opened.count && !o.silent) await this.logEvent({ workspace_id: workspaceId, kind: 'guardrail', level: 'error', message: PUBLISH_BLOCK_OPENED[reason] });
    return { opened: opened.count > 0 };
  }

  /**
   * R9 — fecha o bloqueio: zera motivo, mensagem e próxima conferência e grava `publish_unblocked_at`. As falhas só zeram com prova real
   * (`publish` ou `reconnect`); fechado pela sonda/botão, um novo bloqueio continua a escada de esperas. Registra o evento e antecipa os jobs
   * pendentes da empresa que o bloqueio adiou (post agendado para um horário que já passou), em escalonamento na ordem do horário do post: 4
   * agora, os 4 seguintes na próxima rodada da fila e assim por diante (a vazão da fila; a empresa não toma a vez das outras de uma vez).
   * `false` = não havia bloqueio.
   */
  async closePublishBlock(workspaceId: string, how: PublishUnblockHow, now = new Date()): Promise<boolean> {
    const proof = how === 'publish' || how === 'reconnect';
    const got = await this.prisma.instagram_accounts.updateMany({
      where: { workspace_id: workspaceId, publish_block_reason: { not: null } },
      data: { publish_block_reason: null, publish_block_message: null, publish_next_check_at: null, publish_unblocked_at: now, ...(proof ? { publish_block_failures: 0 } : {}) },
    });
    if (!got.count) {
      // Sem bloqueio aberto: a prova real ainda zera as falhas que um fechamento pela sonda deixou.
      if (proof) await this.prisma.instagram_accounts.updateMany({ where: { workspace_id: workspaceId, publish_block_failures: { gt: 0 } }, data: { publish_block_failures: 0 } });
      return false;
    }
    await this.logEvent({ workspace_id: workspaceId, kind: 'guardrail', message: publishUnblockedMessage(how) });
    const due = await this.prisma.ig_posts.findMany({
      where: { workspace_id: workspaceId, status: 'scheduled', scheduled_at: { lte: now } },
      orderBy: { scheduled_at: 'asc' },
      select: { id: true },
    });
    if (!due.length) return true;
    const jobs = await this.prisma.publishing_jobs.findMany({
      where: { workspace_id: workspaceId, channel: 'instagram_organic', status: 'pending', run_at: { gt: now }, ig_post_id: { in: due.map((p) => p.id) } },
      select: { id: true, ig_post_id: true },
    });
    const order = new Map(due.map((p, i) => [p.id, i]));
    jobs.sort((a, b) => (order.get(a.ig_post_id!) ?? 0) - (order.get(b.ig_post_id!) ?? 0));
    for (const [i, j] of jobs.entries()) {
      const runAt = new Date(now.getTime() + Math.floor(i / QUEUE_PER_ROUND) * QUEUE_ROUND_MS);
      await this.prisma.publishing_jobs.updateMany({ where: { id: j.id, status: 'pending' }, data: { run_at: runAt } });
    }
    return true;
  }

  async logEvent(ev: { workspace_id: string; plan_id?: string | null; post_id?: string | null; kind: AutopilotEventKind; level?: 'info' | 'warn' | 'error'; message: string }) {
    try {
      await this.prisma.ig_autopilot_events.create({
        data: { workspace_id: ev.workspace_id, plan_id: ev.plan_id ?? null, post_id: ev.post_id ?? null, kind: ev.kind, level: ev.level ?? 'info', message: ev.message },
      });
    } catch (e) {
      this.logger.error(`[autopilot] log falhou: ${errText(e)}`);
    }
  }

  /** Token expirado: pausa planos, marca a conta com erro, suspende a fila e avisa. */
  async handleTokenExpired(workspaceId: string, message: string) {
    await this.prisma.instagram_accounts.updateMany({ where: { workspace_id: workspaceId }, data: { status: 'error', last_error: message } });
    // R2: o bloqueio guarda o motivo `token` (a faixa vermelha diz "reconecte"); só a reconexão fecha. O evento é o de baixo.
    await this.openPublishBlock(workspaceId, 'token', message, { silent: true });
    await this.prisma.ig_content_plans.updateMany({ where: { workspace_id: workspaceId, status: 'active' }, data: { status: 'paused' } });
    await this.prisma.publishing_jobs.updateMany({
      where: { workspace_id: workspaceId, channel: 'instagram_organic', status: 'pending' },
      data: { status: 'cancelled', locked_at: null },
    });
    // Posts da programação e stories de vaga que já estavam na fila voltam para "pronto" (com o motivo): reagendados sozinhos quando o
    // token for renovado.
    await this.prisma.ig_posts.updateMany({
      where: { workspace_id: workspaceId, status: 'scheduled', OR: [{ run_id: { not: null } }, { source: 'vacancy' }] },
      data: { status: 'ready', last_error: TOKEN_EXPIRED_POST_MSG },
    });
    await this.logEvent({
      workspace_id: workspaceId,
      kind: 'guardrail',
      level: 'error',
      message: `Token da Meta expirado: planos pausados e publicações suspensas. ${message}`,
    });
  }
}
