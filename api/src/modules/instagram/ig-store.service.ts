import { Injectable, Logger } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { notFound } from '../media/user-error';
import { AutopilotEventKind, PostRow } from './ig-types';

/** Erros de regra (nunca repetidos pela fila). */
export class Guardrail extends Error {}
export class RateLimited extends Error {}
/** Container ainda em processamento na Meta: a fila tenta de novo em 2 min sem contar tentativa. */
export class ContainerPending extends Error {}

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
  patchPost(id: string, patch: Record<string, any>) {
    return this.prisma.ig_posts.update({ where: { id }, data: patch });
  }

  appendLog(post: PostRow, entry: Record<string, unknown>) {
    const log = Array.isArray(post.ai_generation_log) ? post.ai_generation_log : [];
    return [...log, { at: new Date().toISOString(), ...entry }].slice(-50);
  }

  /**
   * Exigência de aprovação do post: a programação automática decide pelo próprio modo
   * ("publish" publica sozinho, "approval" espera aprovação); sem ela, vale o plano.
   */
  async approvalRequired(post: PostRow): Promise<boolean | null> {
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
    await this.prisma.ig_content_plans.updateMany({ where: { workspace_id: workspaceId, status: 'active' }, data: { status: 'paused' } });
    await this.prisma.publishing_jobs.updateMany({
      where: { workspace_id: workspaceId, channel: 'instagram_organic', status: 'pending' },
      data: { status: 'cancelled', locked_at: null },
    });
    await this.logEvent({
      workspace_id: workspaceId,
      kind: 'guardrail',
      level: 'error',
      message: `Token da Meta expirado: planos pausados e publicações suspensas. ${message}`,
    });
  }
}
