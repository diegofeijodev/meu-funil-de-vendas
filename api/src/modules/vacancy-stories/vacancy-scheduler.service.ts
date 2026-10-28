import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { addDays } from '../../common/time/dates';
import { UserError } from '../media/user-error';
import { IgStore, errText } from '../instagram/ig-store.service';
import { NO_ACCOUNT_MSG, TOKEN_EXPIRED_POST_MSG } from '../instagram/ig-types';
import { PublishingService } from '../instagram/publishing.service';
import { VacancyGate } from './vacancy-gate.service';
import { VacancyGeneratorService } from './vacancy-generator.service';
import { VacancyGuardService } from './vacancy-guard.service';
import { capWaitReason, igLimitReason, leadDeadline, spacingReason, tooCloseReason, windowReason } from './vacancy-reasons';
import { nextWindowSlot, PUBLISH_SLACK_MS, spDay, windowStartOn } from './vacancy-slots';
import type { SettingsRow, StoryRow } from './vacancy-types';
import { countVacancyStoriesOnDay } from './vacancy-usage';

const MIN = 60_000;
const DAY_MS = 24 * 60 * MIN;
/** Espaço mínimo entre stories de vaga da empresa (§6.6: a fila pega 4 jobs por rodada de 5 min). */
const SPACING_MIN = 15;
/** Limite de publicações da Meta em 24 h e a folga deixada para os posts normais (§6.6). */
const IG_DAILY_LIMIT = 25;
const IG_RESERVE = 5;
/** Dias que o limite do dia pode empurrar um story para a frente (a vaga começa antes disso). */
const MAX_DAYS = 14;
/** Mesmos status que o `PublishingService.schedulePost` aceita. */
const SCHEDULABLE = ['approved', 'ready', 'scheduled', 'failed'];

export type SlotPlan = { at: Date; waitingFor: 'none' | 'window' | 'cap' | 'ig_limit' } | { expire: string };
export type ScheduleOutcome = 'scheduled' | 'cancelled' | 'no_account';

type VacancyBrief = { requires_approval?: boolean; starts_at?: string } | undefined;
const briefOf = (p: { creative_brief: unknown }) => (p.creative_brief as { vacancy?: VacancyBrief } | null)?.vacancy;
/** O post ainda espera aprovação (R22: decide pelo próprio post, não pelo modo da empresa). */
const needsApproval = (p: { creative_brief: unknown; approved_at: Date | null; status: string }) =>
  briefOf(p)?.requires_approval === true && !p.approved_at && p.status !== 'approved';

/**
 * Agenda dos stories das vagas: próximo horário livre na janela (Brasília), 15 min entre stories de vaga, limite do dia
 * (`settings.daily_cap`, contado por `countVacancyStoriesOnDay` — R3) e espaço no limite de 25 publicações em 24 h da Meta. Liga os
 * ganchos do gerador (limite antes de gerar; agenda depois da entrega) e o callback da guarda (agenda logo depois da aprovação), e na
 * rodada do job agenda aprovados sem job e reconcilia os de vaga que ficaram sem job (token vencido, "Publicar agora" com a vitrine fora).
 */
@Injectable()
export class VacancySchedulerService implements OnModuleInit {
  private readonly logger = new Logger(VacancySchedulerService.name);
  /** Relógio de quem não recebe `now` (agenda depois da entrega/aprovação); os testes trocam. */
  now: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: IgStore,
    private readonly publishing: PublishingService,
    private readonly guard: VacancyGuardService,
    private readonly generator: VacancyGeneratorService,
    private readonly gate: VacancyGate,
  ) {}

  onModuleInit() {
    this.guard.onApproved = (ws, id) => this.scheduleVacancyPost(ws, id);
    this.generator.hooks.capacityWait = (row, s, now) => this.capacityWait(row, s, now);
    this.generator.hooks.afterHandOff = (ws, id) => this.afterHandOff(ws, id);
  }

  /** Stories de vaga do dia `day` (Brasília) contra o limite do dia; `exceptPostId` = o post que está sendo agendado. */
  async capacityFor(ws: string, s: SettingsRow, day: string, exceptPostId?: string): Promise<{ used: number; cap: number }> {
    const c = await countVacancyStoriesOnDay(this.prisma, ws, day, exceptPostId);
    return { used: c.posted + c.scheduled, cap: s.daily_cap };
  }

  /**
   * Espaço no limite da Meta: 25 − 5 de folga − publicados em 24 h − posts normais agendados nas próximas 24 h − stories de vaga
   * agendados nas próximas 24 h. `freesAt` = quando a publicação mais antiga das últimas 24 h sai da conta.
   */
  async igRoom(ws: string, now: Date, exceptPostId?: string): Promise<{ room: number; freesAt: Date | null }> {
    const since = new Date(now.getTime() - DAY_MS);
    const until = new Date(now.getTime() + DAY_MS);
    const published = await this.prisma.ig_posts.findMany({
      where: { workspace_id: ws, status: 'published', published_at: { gte: since } },
      orderBy: { published_at: 'asc' },
      select: { published_at: true },
    });
    const others = await this.prisma.ig_posts.count({ where: { workspace_id: ws, status: 'scheduled', source: { not: 'vacancy' }, scheduled_at: { lt: until } } });
    const vacancies = await this.prisma.ig_posts.count({
      where: { workspace_id: ws, status: 'scheduled', source: 'vacancy', scheduled_at: { lt: until }, ...(exceptPostId ? { id: { not: exceptPostId } } : {}) },
    });
    const oldest = published[0]?.published_at;
    return { room: IG_DAILY_LIMIT - IG_RESERVE - published.length - others - vacancies, freesAt: oldest ? new Date(oldest.getTime() + DAY_MS) : null };
  }

  /**
   * Horários que os stories de vaga da empresa ocupam a partir de `since` (agendados/publicando pelo `scheduled_at`, publicados pelo
   * `published_at`), sem o post que está sendo agendado.
   */
  private async vacancyTimes(ws: string, since: Date, exceptPostId?: string): Promise<number[]> {
    const rows = await this.prisma.ig_posts.findMany({
      where: {
        workspace_id: ws,
        source: 'vacancy',
        ...(exceptPostId ? { id: { not: exceptPostId } } : {}),
        OR: [
          { status: { in: ['scheduled', 'publishing'] }, scheduled_at: { gte: since } },
          { status: 'published', published_at: { gte: since } },
        ],
      },
      select: { status: true, scheduled_at: true, published_at: true },
    });
    return rows.map((r) => (r.status === 'published' ? r.published_at : r.scheduled_at)?.getTime()).filter((t): t is number => t != null);
  }

  /**
   * R24 — busca de folga: o 1º instante ≥ `from` + 1 min, dentro da janela, sem story de vaga a menos de 15 min (antes ou depois).
   * Esbarrou → 15 min depois do story do caminho (o mais tarde deles) e confere de novo pela janela. Sempre anda para a frente.
   */
  private freeSlot(s: SettingsRow, from: Date, taken: number[]): Date {
    const win = { windowStart: s.window_start, windowEnd: s.window_end, spacingMin: SPACING_MIN };
    let at = nextWindowSlot({ ...win, now: from, after: null });
    for (;;) {
      const t = at.getTime();
      const near = taken.filter((x) => Math.abs(x - t) < SPACING_MIN * MIN);
      if (!near.length) return at;
      at = nextWindowSlot({ ...win, now: new Date(t - MIN), after: new Date(Math.max(...near)) });
    }
  }

  /**
   * Horário do story de uma vaga que começa em `startsAt`: janela + folga de 15 min → espaço da Meta → limite do dia (dia do horário
   * cheio → janela do dia seguinte). `force` ("Postar agora") ignora janela, limite e espaço: agora + 1 min (a guarda ainda confere a
   * vaga na hora de publicar). Não dá mais tempo (`at` + antecedência + 15 min de folga da fila > início, R26) → `{ expire }` com o
   * motivo verdadeiro (A5/R23): já não daria tempo nem agora, a janela só abre depois do prazo, o espaço da Meta só libera depois,
   * os 15 min entre stories empurraram para depois, ou o limite do dia. `postId` = o post sendo agendado (não conta contra ele mesmo).
   */
  async planSlot(ws: string, s: SettingsRow, startsAt: Date, now: Date, o: { force?: boolean; postId?: string } = {}): Promise<SlotPlan> {
    if (o.force) return { at: new Date(now.getTime() + MIN), waitingFor: 'none' };
    const taken = await this.vacancyTimes(ws, new Date(now.getTime() - SPACING_MIN * MIN), o.postId);
    const free = (from: Date) => this.freeSlot(s, from, taken);
    const opens = nextWindowSlot({ now, windowStart: s.window_start, windowEnd: s.window_end, after: null, spacingMin: SPACING_MIN });
    let waitingFor: 'none' | 'window' | 'cap' | 'ig_limit' = opens.getTime() > now.getTime() + MIN ? 'window' : 'none';
    let at = free(now);

    const ig = await this.igRoom(ws, now, o.postId);
    if (ig.room <= 0 && ig.freesAt && ig.freesAt.getTime() > at.getTime()) {
      at = free(new Date(ig.freesAt.getTime() - MIN));
      waitingFor = 'ig_limit';
    }

    // Antecedência + folga da fila (R26): o story precisa sair com a antecedência medida na hora REAL da publicação.
    const lead = s.min_lead_minutes * MIN + PUBLISH_SLACK_MS;
    const late = (t: Date) => t.getTime() + lead > startsAt.getTime();
    const capFull = { expire: capWaitReason(s.daily_cap, startsAt) };
    for (let i = 0; ; i++) {
      const { used, cap } = await this.capacityFor(ws, s, spDay(at), o.postId);
      if (used < cap) break;
      if (i >= MAX_DAYS) return capFull;
      // Dia cheio: a folga a partir do início da janela do dia seguinte.
      at = free(new Date(windowStartOn(addDays(spDay(at), 1), s.window_start).getTime() - MIN));
      waitingFor = 'cap';
      if (late(at)) return capFull;
    }
    if (!late(at)) return { at, waitingFor };
    const deadline = leadDeadline(startsAt, s.min_lead_minutes, true);
    if (late(new Date(now.getTime() + MIN))) return { expire: tooCloseReason(startsAt, deadline) };
    if (late(opens)) return { expire: windowReason(startsAt, deadline, s.window_start, s.window_end) };
    if (waitingFor === 'ig_limit' && ig.freesAt) return { expire: igLimitReason(startsAt, deadline, ig.freesAt) };
    return { expire: spacingReason(startsAt, deadline) };
  }

  /**
   * Gancho do gerador (antes de gerar): a empresa já tem o limite do dia em que o story iria ao ar → a linha espera até o início da
   * janela do 1º dia com vaga (o `expireDue` cancela se a vaga começar antes). "Postar agora" (`post_now`) não espera.
   */
  async capacityWait(row: StoryRow, s: SettingsRow, now: Date): Promise<Date | null> {
    if (row.post_now) return null;
    let at = nextWindowSlot({ now, windowStart: s.window_start, windowEnd: s.window_end, after: null, spacingMin: SPACING_MIN });
    for (let i = 0; i <= MAX_DAYS; i++) {
      const { used, cap } = await this.capacityFor(row.workspace_id, s, spDay(at));
      if (used < cap) return i === 0 ? null : at;
      at = windowStartOn(addDays(spDay(at), 1), s.window_start);
      if (at.getTime() + s.min_lead_minutes * MIN + PUBLISH_SLACK_MS > row.starts_at.getTime()) return at;
    }
    return at;
  }

  /**
   * Agenda um story de vaga no próximo horário livre (com `force`, ou se a linha pediu "Postar agora", em agora + 1 min). Sem conta
   * conectada → `'no_account'` (o post fica, com o aviso). Não dá mais tempo → post cancelado e o motivo na linha → `'cancelled'`.
   */
  async scheduleVacancyPost(ws: string, postId: string, o: { force?: boolean } = {}): Promise<ScheduleOutcome> {
    return this.schedule(ws, postId, o, new Date(this.now()));
  }

  private async schedule(ws: string, postId: string, o: { force?: boolean }, now: Date): Promise<ScheduleOutcome> {
    const post = await this.store.getPost(postId, ws);
    if (post.source !== 'vacancy') throw new UserError('Este post não é um story de vaga.');
    // Mesmas mensagens do `schedulePost`, antes de qualquer escrita (o cancelamento por prazo também só vale para post agendável).
    if (!SCHEDULABLE.includes(post.status)) throw new UserError('O post precisa estar aprovado para ser agendado.');
    if (needsApproval(post)) throw new UserError('Este post exige aprovação antes de agendar.');
    if (!(await this.store.liveAccount(ws))) {
      if (post.last_error !== NO_ACCOUNT_MSG && post.last_error !== TOKEN_EXPIRED_POST_MSG) {
        await this.prisma.ig_posts.updateMany({ where: { id: postId, workspace_id: ws, status: post.status }, data: { last_error: NO_ACCOUNT_MSG } });
      }
      return 'no_account';
    }
    const s = await this.prisma.vacancy_story_settings.findUnique({ where: { workspace_id: ws } });
    if (!s) throw new UserError('Os stories das vagas não estão configurados nesta empresa.');
    const row = await this.prisma.vacancy_stories.findFirst({ where: { ig_post_id: postId, workspace_id: ws } });
    const startsAt = row?.starts_at ?? new Date(briefOf(post)?.starts_at ?? NaN);
    if (Number.isNaN(startsAt.getTime())) throw new Error(`story de vaga ${postId} sem início da vaga`);
    const plan = await this.planSlot(ws, s, startsAt, now, { force: o.force || !!row?.post_now, postId });
    if ('expire' in plan) {
      await this.prisma.$transaction(async (tx) => {
        const got = await tx.ig_posts.updateMany({ where: { id: postId, workspace_id: ws, status: { in: SCHEDULABLE } }, data: { status: 'cancelled' } });
        if (!got.count) return;
        await tx.publishing_jobs.updateMany({ where: { ig_post_id: postId, workspace_id: ws, status: 'pending' }, data: { status: 'cancelled', locked_at: null } });
        await tx.vacancy_stories.updateMany({ where: { ig_post_id: postId, workspace_id: ws }, data: { skip_reason: plan.expire } });
      });
      await this.store.logEvent({ workspace_id: ws, plan_id: null, post_id: postId, kind: 'post_skipped', level: 'warn', message: `Story de vaga cancelado: ${plan.expire}` });
      return 'cancelled';
    }
    await this.publishing.schedulePost(ws, postId, plan.at);
    return 'scheduled';
  }

  /**
   * Gancho do gerador (depois da entrega): decide pelo PRÓPRIO post (R22) — pronto e sem aprovação pendente → agenda; esperando
   * aprovação → nada (agenda o callback da guarda, quando aprovarem). Devolve `null` quando não agenda.
   */
  async afterHandOff(ws: string, postId: string): Promise<ScheduleOutcome | null> {
    const post = await this.prisma.ig_posts.findFirst({ where: { id: postId, workspace_id: ws, source: 'vacancy' }, select: { status: true, creative_brief: true, approved_at: true } });
    if (!post || post.status !== 'ready' || needsApproval(post)) return null;
    return this.scheduleVacancyPost(ws, postId);
  }

  /**
   * Rodada do job (antes da geração): stories de vaga sem job pendente/rodando — aprovados (`approved`) e os que perderam o job
   * (`scheduled`; `ready` que não espera aprovação: token vencido ou entrega cuja agenda falhou, R16) — vão para o próximo horário
   * livre. Nunca agenda post que ainda precisa de aprovação. Só empresas ligadas e liberadas.
   */
  async tick(now = new Date(this.now())): Promise<{ approved: number; reconciled: number }> {
    const out = { approved: 0, reconciled: 0 };
    const active = (await this.prisma.vacancy_story_settings.findMany({ where: { enabled: true }, select: { workspace_id: true } }))
      .map((s) => s.workspace_id)
      .filter((ws) => this.gate.allowed(ws));
    if (!active.length) return out;
    const posts = await this.prisma.ig_posts.findMany({
      where: {
        workspace_id: { in: active },
        source: 'vacancy',
        status: { in: ['approved', 'ready', 'scheduled'] },
        publishing_jobs: { none: { status: { in: ['pending', 'running'] } } },
      },
      orderBy: { created_at: 'asc' },
      take: 100,
      select: { id: true, workspace_id: true, status: true, creative_brief: true, approved_at: true },
    });
    // Início mais próximo primeiro (a vez do dia vai para quem começa antes).
    const startOf = (p: (typeof posts)[number]) => Date.parse(briefOf(p)?.starts_at ?? '') || Infinity;
    for (const p of [...posts].sort((a, b) => startOf(a) - startOf(b))) {
      if (needsApproval(p)) continue;
      try {
        const r = await this.schedule(p.workspace_id, p.id, {}, now);
        if (r === 'scheduled') out[p.status === 'approved' ? 'approved' : 'reconciled']++;
      } catch (e) {
        this.logger.warn(`[vagas] ${p.workspace_id}: agenda do post ${p.id} falhou: ${errText(e)}`);
      }
    }
    return out;
  }
}
