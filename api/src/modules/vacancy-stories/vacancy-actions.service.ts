import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { todaySp } from '../../common/time/dates';
import { WorkspaceAccessService } from '../access/access.service';
import { ActivityService } from '../activity/activity.service';
import { ORIGIN_UNAVAILABLE_MSG } from '../instagram/instagram-actions.service';
import { bad, notFound } from '../media/user-error';
import { canRevive, displayOf, POST_UNPUBLISHED, ROW_QUEUED, storyDetail, storyView, type DisplayContext, type StoryDetail, type StoryPost, type StoryView } from './vacancy-display';
import { FeedDownError, VacancyFeedClient } from './vacancy-feed';
import { NO_ACCOUNT_WAIT } from './vacancy-generator.service';
import { VacancyGate } from './vacancy-gate.service';
import { DONT_POST_REASON, MAX_REDOS, tooCloseReason, VACANCY_STARTED_REASON, WAIT_CAP } from './vacancy-reasons';
import { VacancySchedulerService } from './vacancy-scheduler.service';
import { VacancySettingsService } from './vacancy-settings.service';
import { PUBLISH_SLACK_MS } from './vacancy-slots';
import type { StoryFeedback, StoryFilter } from './vacancy-stories.dto';
import { fingerprint } from './vacancy-text';
import { SKIP } from './vacancy-triage';
import type { FreelaVacancy, SettingsRow, StoryRow } from './vacancy-types';
import { countVacancyStoriesOnDay } from './vacancy-usage';

const LIST_SIZE = 100;
const NOT_POSTED = new Set(['skipped', 'cancelled', 'failed']);

const MSG = {
  notFound: 'Story não encontrado.',
  /** A tela estava velha: o story mudou de situação entre a lista e o toque (ou a ação não vale para ela). */
  stale: 'A situação deste story mudou. Atualize a tela e tente de novo.',
  off: 'Ligue os stories das vagas para usar esta ação.',
  closed: 'A vaga não está mais aberta no Freela.',
  redoCap: `Esta vaga já foi refeita ${MAX_REDOS} vezes.`,
};

/** Volta para a fila do zero (o gerador confere a vaga na vitrine de novo antes de gerar). */
const REQUEUE = {
  status: 'new',
  ig_post_id: null,
  skip_reason: null,
  wait_reason: null,
  next_attempt_at: null,
  not_before: null,
  lease_until: null,
  mismatch_attempts: 0,
  ai_error_count: 0,
  attempts_log: [] as Prisma.InputJsonValue,
  used_fallback: false,
  post_now: false,
} satisfies Prisma.vacancy_storiesUncheckedUpdateManyInput;

const json = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * Lista, detalhe e ações dos stories das vagas (UI §4): Não postar, Postar agora, Criar story mesmo assim, Refazer a arte / Tentar de
 * novo. Toda entrada confere o portão antes do acesso (R20) e toda id é buscada com `workspace_id` (id de outra empresa = 404). Toda
 * mudança é condicional ao estado lido: se o story mudou entre a leitura e a escrita (o job pegou, publicou), responde "a situação mudou".
 */
@Injectable()
export class VacancyActionsService {
  /** Relógio (os testes trocam). */
  now: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly activity: ActivityService,
    private readonly gate: VacancyGate,
    private readonly feed: VacancyFeedClient,
    private readonly settings: VacancySettingsService,
    private readonly scheduler: VacancySchedulerService,
  ) {}

  /** As 100 linhas mais novas (filtro aplicado depois: `live` = no ar agora; `not_posted` = pulada, cancelada ou falhou). */
  async list(ws: string, filter: StoryFilter = 'all'): Promise<StoryView[]> {
    this.gate.assert(ws);
    const now = new Date(this.now());
    const s = await this.settings.get(ws);
    const rows = await this.prisma.vacancy_stories.findMany({ where: { workspace_id: ws }, orderBy: { created_at: 'desc' }, take: LIST_SIZE });
    const ids = rows.map((r) => r.ig_post_id).filter((x): x is string => !!x);
    const posts = new Map<string, StoryPost>(
      ids.length ? (await this.prisma.ig_posts.findMany({ where: { id: { in: ids }, workspace_id: ws } })).map((p): [string, StoryPost] => [p.id, p]) : [],
    );
    const ctx = await this.context(ws, s, now);
    return rows
      .map((r) => storyView(r, r.ig_post_id ? (posts.get(r.ig_post_id) ?? null) : null, s, now, ctx))
      .filter((v) => filter === 'all' || (filter === 'live' ? v.display === 'live' : NOT_POSTED.has(v.display)));
  }

  async detail(ws: string, id: string): Promise<StoryDetail> {
    this.gate.assert(ws);
    const now = new Date(this.now());
    const { row, post } = await this.load(ws, id);
    const s = await this.settings.get(ws);
    return storyDetail(row, post, s, now, await this.context(ws, s, now));
  }

  /**
   * "Não postar": antes da entrega a linha vira `cancelled`; entregue e não publicado → post `cancelled` (+ jobs pendentes),
   * `rejection_reason` e o motivo na LINHA (`skip_reason`, que a tela e o `recent_outcomes` leem). Já não postado por você → só grava o
   * feedback (os chips depois do toast chamam de novo — idempotente).
   */
  async dontPost(userId: string, ws: string, id: string, feedback?: StoryFeedback): Promise<{ ok: true }> {
    this.gate.assert(ws);
    await this.access.require(userId, ws, 'write');
    const { row, post } = await this.load(ws, id);
    const fb = feedback ? { feedback } : {};
    if (row.skip_reason === DONT_POST_REASON) {
      if (feedback) await this.prisma.vacancy_stories.updateMany({ where: { id, workspace_id: ws }, data: fb });
      return { ok: true };
    }
    let done = false;
    if (ROW_QUEUED.includes(row.status)) {
      // Gerando também: o lease do gerador deixa de valer e a entrega não acontece.
      const r = await this.prisma.vacancy_stories.updateMany({
        where: { id, workspace_id: ws, status: { in: ROW_QUEUED } },
        data: { status: 'cancelled', skip_reason: DONT_POST_REASON, lease_until: null, ...fb },
      });
      done = r.count > 0;
    } else if (row.status === 'handed_off' && post && POST_UNPUBLISHED.includes(post.status)) {
      done = await this.prisma.$transaction(async (tx) => {
        const got = await tx.ig_posts.updateMany({
          where: { id: post.id, workspace_id: ws, status: { in: POST_UNPUBLISHED } },
          data: { status: 'cancelled', rejection_reason: DONT_POST_REASON },
        });
        if (!got.count) return false;
        await tx.publishing_jobs.updateMany({ where: { ig_post_id: post.id, workspace_id: ws, status: 'pending' }, data: { status: 'cancelled', locked_at: null } });
        await tx.vacancy_stories.updateMany({ where: { id, workspace_id: ws, ig_post_id: post.id }, data: { skip_reason: DONT_POST_REASON, ...fb } });
        return true;
      });
    }
    if (!done) throw bad(MSG.stale);
    await this.activity.log(ws, userId, 'vacancy_stories.dont_post', 'vacancy_stories', { story_id: id, post_id: row.ig_post_id, feedback: feedback ?? null });
    return { ok: true };
  }

  /**
   * "Postar agora" — só esperando o horário ou a vez. Post → agenda em agora + 1 min (`force`: fura janela, limite e espaço; a
   * guarda ainda confere a vaga na hora). Linha esperando o limite → volta para a fila com `post_now` (gera na próxima rodada e agenda
   * com `force`).
   */
  async postNow(userId: string, ws: string, id: string): Promise<{ ok: true }> {
    this.gate.assert(ws);
    await this.access.require(userId, ws, 'write');
    const now = new Date(this.now());
    const { row, post } = await this.load(ws, id);
    const s = await this.settings.get(ws);
    if (!s.enabled) throw bad(MSG.off);
    const d = displayOf(row, post, s, now, await this.context(ws, s, now));
    if (d.display !== 'waiting_window' && d.display !== 'waiting_cap') throw bad(MSG.stale);
    if (post) {
      const r = await this.scheduler.scheduleVacancyPost(ws, post.id, { force: true });
      if (r === 'no_account') throw bad(NO_ACCOUNT_WAIT);
    } else {
      const r = await this.prisma.vacancy_stories.updateMany({
        where: { id, workspace_id: ws, status: 'waiting', wait_reason: WAIT_CAP },
        data: { status: 'new', post_now: true, not_before: null, wait_reason: null, next_attempt_at: null },
      });
      if (!r.count) throw bad(MSG.stale);
    }
    await this.activity.log(ws, userId, 'vacancy_stories.post_now', 'vacancy_stories', { story_id: id, post_id: row.ig_post_id });
    return { ok: true };
  }

  /**
   * "Criar story mesmo assim" — pulada, cancelada, expirada, ou entregue com o post cancelado: confere a vaga VIVA na vitrine (R30:
   * aberta, com valor e cidade, fora da antecedência + 15 min de folga — a triagem não roda de novo) e a linha volta para a fila com
   * `forced` e os dados vivos (solta o post cancelado).
   */
  async createAnyway(userId: string, ws: string, id: string): Promise<{ ok: true }> {
    this.gate.assert(ws);
    await this.access.require(userId, ws, 'write');
    const now = new Date(this.now());
    const { row, post } = await this.load(ws, id);
    const s = await this.settings.get(ws);
    if (!s.enabled) throw bad(MSG.off);
    if (!canRevive(row, post)) throw bad(MSG.stale);
    let v: FreelaVacancy | null;
    try {
      v = await this.feed.byId(row.external_id);
    } catch (e) {
      if (e instanceof FeedDownError) throw bad(ORIGIN_UNAVAILABLE_MSG);
      throw e;
    }
    if (!v) throw bad(MSG.closed);
    if (!v.amountInCents) throw bad(SKIP.noValue);
    if (!(v.city ?? '').trim()) throw bad(SKIP.noCity);
    const startsAt = new Date(v.startTime);
    if (startsAt.getTime() <= now.getTime()) throw bad(VACANCY_STARTED_REASON);
    if (startsAt.getTime() - now.getTime() < s.min_lead_minutes * 60_000 + PUBLISH_SLACK_MS) throw bad(tooCloseReason(startsAt, s.min_lead_minutes));
    const r = await this.prisma.vacancy_stories.updateMany({
      where: { id, workspace_id: ws, status: row.status, ig_post_id: row.ig_post_id },
      data: { ...REQUEUE, forced: true, snapshot: json(v), fingerprint: fingerprint(v), starts_at: startsAt },
    });
    if (!r.count) throw bad(MSG.stale);
    await this.activity.log(ws, userId, 'vacancy_stories.create_anyway', 'vacancy_stories', { story_id: id, external_id: row.external_id });
    return { ok: true };
  }

  /**
   * "Refazer a arte" (entregue e não publicado): cancela o post (+ jobs) e a linha volta para a fila com `redo_count + 1` — teto D11.
   * "Tentar de novo" (linha `failed`, ou post recusado pelo Instagram): volta para a fila sem contar refação.
   */
  async redo(userId: string, ws: string, id: string): Promise<{ ok: true }> {
    this.gate.assert(ws);
    await this.access.require(userId, ws, 'write');
    const { row, post } = await this.load(ws, id);
    const s = await this.settings.get(ws);
    if (!s.enabled) throw bad(MSG.off);
    let ok: boolean;
    if (row.status === 'failed') {
      ok = (await this.prisma.vacancy_stories.updateMany({ where: { id, workspace_id: ws, status: 'failed' }, data: REQUEUE })).count > 0;
    } else if (row.status === 'handed_off' && post && post.status === 'failed') {
      ok = await this.dropPostAndRequeue(ws, row, post, ['failed'], false);
    } else if (row.status === 'handed_off' && post && POST_UNPUBLISHED.includes(post.status)) {
      if (row.redo_count >= MAX_REDOS) throw bad(MSG.redoCap);
      ok = await this.dropPostAndRequeue(ws, row, post, POST_UNPUBLISHED, true);
    } else {
      ok = false;
    }
    if (!ok) throw bad(MSG.stale);
    await this.activity.log(ws, userId, 'vacancy_stories.redo', 'vacancy_stories', { story_id: id, post_id: row.ig_post_id });
    return { ok: true };
  }

  // ------------------------------------------------------------------ helpers

  /** Post cancelado (só se ainda está num de `from`) + jobs pendentes; a linha solta o post e volta para a fila. */
  private dropPostAndRequeue(ws: string, row: StoryRow, post: StoryPost, from: string[], countRedo: boolean): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const got = await tx.ig_posts.updateMany({ where: { id: post.id, workspace_id: ws, status: { in: from } }, data: { status: 'cancelled' } });
      if (!got.count) return false;
      await tx.publishing_jobs.updateMany({ where: { ig_post_id: post.id, workspace_id: ws, status: 'pending' }, data: { status: 'cancelled', locked_at: null } });
      const moved = await tx.vacancy_stories.updateMany({
        where: { id: row.id, workspace_id: ws, status: 'handed_off', ig_post_id: post.id },
        data: { ...REQUEUE, ...(countRedo ? { redo_count: { increment: 1 } } : {}) },
      });
      // A linha mudou no meio (a guarda refez): desfaz o cancelamento do post.
      if (!moved.count) throw new StaleRow();
      return true;
    }).catch((e) => {
      if (e instanceof StaleRow) return false;
      throw e;
    });
  }

  /** Linha da empresa (id de outra empresa = 404) e o post dela, se houver. */
  private async load(ws: string, id: string): Promise<{ row: StoryRow; post: StoryPost | null }> {
    const row = await this.prisma.vacancy_stories.findFirst({ where: { id, workspace_id: ws } });
    if (!row) throw notFound(MSG.notFound);
    const post = row.ig_post_id ? await this.prisma.ig_posts.findFirst({ where: { id: row.ig_post_id, workspace_id: ws } }) : null;
    return { row, post };
  }

  /**
   * Stories de vaga de hoje (R3) e se o limite do dia / o limite da Meta estão cheios — separa "esperando a vez" de "esperando o
   * horário" num post empurrado para outro dia e põe o número real em "Hoje já foram {n}".
   */
  private async context(ws: string, s: SettingsRow, now: Date): Promise<DisplayContext> {
    const c = await countVacancyStoriesOnDay(this.prisma, ws, todaySp(now));
    const today = c.posted + c.scheduled;
    const ig = await this.scheduler.igRoom(ws, now);
    return { capFull: today >= s.daily_cap, todayCount: today, igFull: ig.room <= 0 };
  }
}

class StaleRow extends Error {}
