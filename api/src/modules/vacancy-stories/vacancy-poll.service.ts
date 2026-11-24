import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { leaseFree } from '../instagram/ig-store.service';
import { CLT_FEED_DOWN, countCities, FeedDownError, VacancyFeedClient } from './vacancy-feed';
import { VacancyGate } from './vacancy-gate.service';
import { VacancySettingsService } from './vacancy-settings.service';
import { cltWatermark } from './vacancy-clt';
import { PUBLISH_BLOCKED_MSG } from '../instagram/ig-types';
import { leadDeadline, PUBLISH_BLOCKED_WAIT, WAIT_CAP } from './vacancy-reasons';
import { approveUntil } from './vacancy-slots';
import { SOURCES, sourceOf, timingOf } from './vacancy-sources';
import { fingerprint } from './vacancy-text';
import { isAfterWatermark, triage } from './vacancy-triage';
import type { FreelaFixedJob, FreelaVacancy, SettingsRow } from './vacancy-types';

type PollResult = { workspaces: number; inserted: number; skipped: number; error?: string };

const MIN = 60_000;
/** Prazo de aprovação de uma empresa sem configuração (não deveria acontecer: post de vaga só existe com ela). */
const DEFAULT_TIMING = { min_lead_minutes: 120, window_start: '08:00', window_end: '21:00' };
/** Posts de vaga entregues que ainda vão ao ar sem esperar aprovação. */
const LATER = ['ready', 'approved', 'scheduled'];

/**
 * Consulta da vitrine (uma chamada por rodada para todas as empresas), triagem gravada na linha, expiração por antecedência e
 * limpeza de leases. Só Prisma — nada de SQL cru.
 */
@Injectable()
export class VacancyPollService {
  private readonly logger = new Logger(VacancyPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: VacancyFeedClient,
    private readonly gate: VacancyGate,
    private readonly settings: VacancySettingsService,
  ) {}

  /** Empresas ligadas E na lista de liberadas. */
  private async activeSettings(): Promise<SettingsRow[]> {
    const rows = await this.prisma.vacancy_story_settings.findMany({ where: { enabled: true } });
    return rows.filter((s) => this.gate.allowed(s.workspace_id));
  }

  /**
   * Rodada da consulta: as diárias (como sempre) e, com alguma empresa com as vagas fixas ligadas, a vitrine CLT — chamadas e erros
   * separados (fora do ar uma, a outra segue). Sem vaga fixa ligada, o resultado é o de antes; com, ganha `clt`.
   */
  async pollAll(now = new Date()): Promise<PollResult & { clt?: PollResult }> {
    const daily = await this.pollDaily(now);
    const clt = await this.pollClt(now);
    return clt.workspaces ? { ...daily, clt } : daily;
  }

  /** Vitrine das diárias (uma chamada para todas as empresas com as diárias ligadas). */
  private async pollDaily(now: Date): Promise<PollResult> {
    const active = await this.activeSettings();
    if (!active.length) return { workspaces: 0, inserted: 0, skipped: 0 };
    let list: FreelaVacancy[];
    try {
      list = await this.feed.recent();
    } catch (e) {
      // Erro inesperado também aparece na tela (texto genérico; o detalhe vai para o log). `last_poll_ok_at` fica como está.
      let message = new FeedDownError().message;
      if (e instanceof FeedDownError) message = e.message;
      else this.logger.error(`[vagas] consulta da vitrine falhou: ${e instanceof Error ? e.message : String(e)}`);
      await this.prisma.vacancy_story_settings.updateMany({
        where: { workspace_id: { in: active.map((s) => s.workspace_id) } },
        data: { last_poll_at: now, last_poll_error: message },
      });
      return { workspaces: active.length, inserted: 0, skipped: 0, error: message };
    }
    const cities = countCities(list);
    let inserted = 0;
    let skipped = 0;
    for (const s of active) {
      try {
        const fresh: Record<string, unknown>[] = [];
        const skips: Record<string, unknown>[] = [];
        for (const v of list) {
          if (!s.enabled_at || !isAfterWatermark(v, s.enabled_at)) continue;
          const t = triage(v, s, now);
          const base = {
            workspace_id: s.workspace_id, source: 'freela', external_id: v.id, snapshot: v as object,
            fingerprint: fingerprint(v), starts_at: new Date(v.startTime),
          };
          if (t.status === 'new') fresh.push({ ...base, status: 'new' });
          else skips.push({ ...base, status: 'skipped', skip_reason: t.reason });
        }
        // Duplicata (mesma vaga numa rodada anterior) é ignorada pelo índice único: a triagem de hoje não reescreve a de ontem.
        if (fresh.length) inserted += (await this.prisma.vacancy_stories.createMany({ data: fresh as never, skipDuplicates: true })).count;
        if (skips.length) skipped += (await this.prisma.vacancy_stories.createMany({ data: skips as never, skipDuplicates: true })).count;
        await this.prisma.vacancy_story_settings.update({
          where: { workspace_id: s.workspace_id },
          data: { last_poll_at: now, last_poll_ok_at: now, last_poll_error: null, recent_cities: cities },
        });
      } catch (e) {
        // Uma empresa com erro (ex.: apagada durante a consulta: FK/linha sumida) não derruba as outras desta rodada.
        this.logger.error(`[vagas] ${s.workspace_id}: gravar a consulta falhou: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { workspaces: active.length, inserted, skipped };
  }

  /**
   * Vagas fixas (CLT): uma chamada à vitrine CLT para as empresas com `clt_enabled` (e na lista). Entram as publicadas depois da marca
   * d'água (`clt_enabled_at − clt_backlog_days`, retroativo em gotas: o limite por dia espalha); a linha guarda o "divulgar até" em
   * `starts_at`. Erro só em `clt_last_poll_error` (o das diárias fica limpo).
   */
  async pollClt(now = new Date()): Promise<PollResult> {
    const active = (await this.prisma.vacancy_story_settings.findMany({ where: { clt_enabled: true } })).filter((s) => this.gate.allowed(s.workspace_id));
    if (!active.length) return { workspaces: 0, inserted: 0, skipped: 0 };
    let list: FreelaFixedJob[];
    try {
      list = await this.feed.recentClt();
    } catch (e) {
      if (!(e instanceof FeedDownError)) this.logger.error(`[vagas] consulta da vitrine CLT falhou: ${e instanceof Error ? e.message : String(e)}`);
      await this.prisma.vacancy_story_settings.updateMany({
        where: { workspace_id: { in: active.map((s) => s.workspace_id) } },
        data: { clt_last_poll_at: now, clt_last_poll_error: CLT_FEED_DOWN },
      });
      return { workspaces: active.length, inserted: 0, skipped: 0, error: CLT_FEED_DOWN };
    }
    const src = SOURCES.freela_clt;
    let inserted = 0;
    let skipped = 0;
    for (const s of active) {
      try {
        const mark = cltWatermark(s);
        const fresh: Record<string, unknown>[] = [];
        const skips: Record<string, unknown>[] = [];
        for (const v of list) {
          if (!mark || !(Date.parse(v.publishedAt) > mark.getTime())) continue;
          const t = src.triage(v, s, now);
          const base = {
            workspace_id: s.workspace_id, source: src.id, external_id: v.id, snapshot: v as object, fingerprint: src.fingerprint(v), starts_at: src.startsAt(v),
          };
          if (t.status === 'new') fresh.push({ ...base, status: 'new' });
          else skips.push({ ...base, status: 'skipped', skip_reason: t.reason });
        }
        // Duplicata (mesma vaga fixa numa rodada anterior) é ignorada pelo índice único (empresa, fonte, id).
        if (fresh.length) inserted += (await this.prisma.vacancy_stories.createMany({ data: fresh as never, skipDuplicates: true })).count;
        if (skips.length) skipped += (await this.prisma.vacancy_stories.createMany({ data: skips as never, skipDuplicates: true })).count;
        await this.prisma.vacancy_story_settings.update({
          where: { workspace_id: s.workspace_id },
          data: { clt_last_poll_at: now, clt_last_poll_ok_at: now, clt_last_poll_error: null },
        });
      } catch (e) {
        this.logger.error(`[vagas] ${s.workspace_id}: gravar a consulta CLT falhou: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { workspaces: active.length, inserted, skipped };
  }

  /**
   * Quem não tem mais como ir ao ar: linhas da fila que entraram na antecedência mínima viram `expired`; posts de vaga ainda
   * `pending_approval` são cancelados no PRAZO DE APROVAÇÃO (`approveUntil`, A4 — não só na antecedência); prontos/aprovados/agendados
   * cuja vaga já começou são cancelados (T10). O motivo vai na LINHA (a tela lê `skip_reason`). Devolve quantas linhas + posts mudaram.
   */
  async expireDue(now = new Date()): Promise<number> {
    const settings = new Map((await this.prisma.vacancy_story_settings.findMany({})).map((s) => [s.workspace_id, s]));
    // R5: início do bloqueio de publicação (aberto ou o último) de cada empresa, para o motivo "recusava desde…".
    const since = new Map(
      (await this.prisma.instagram_accounts.findMany({ where: { publish_blocked_at: { not: null } }, select: { workspace_id: true, publish_blocked_at: true } }))
        .map((a) => [a.workspace_id, a.publish_blocked_at as Date]),
    );
    let n = 0;

    const queued = await this.prisma.vacancy_stories.findMany({
      where: { OR: [{ status: { in: ['new', 'waiting'] } }, { status: 'generating', ...leaseFree(now) }] },
    });
    for (const r of queued) {
      // Por tipo (porta): antecedência, limite e textos da diária ou da vaga fixa (CLT: antecedência 0, o prazo é o "divulgar até").
      const src = sourceOf(r.source);
      const s = settings.get(r.workspace_id);
      if (r.starts_at.getTime() - now.getTime() >= src.lead(s) * MIN) continue;
      const blockedSince = r.wait_reason === PUBLISH_BLOCKED_WAIT ? since.get(r.workspace_id) : undefined;
      const reason = blockedSince
        ? src.reasons.blockedExpire(r.starts_at, blockedSince)
        : r.wait_reason === WAIT_CAP
          ? src.reasons.capWait(src.cap(s), r.starts_at)
          : src.reasons.tooClose(r.starts_at, leadDeadline(r.starts_at, src.lead(s)));
      // Condicional ao estado lido: se o gerador pegou a linha entre a leitura e aqui, ela segue.
      const got = await this.prisma.vacancy_stories.updateMany({
        where: { id: r.id, AND: [{ OR: [{ status: { in: ['new', 'waiting'] } }, { status: 'generating', ...leaseFree(now) }] }] },
        data: { status: 'expired', skip_reason: reason, lease_until: null },
      });
      n += got.count;
    }

    const pending = await this.prisma.ig_posts.findMany({ where: { source: 'vacancy', status: 'pending_approval' }, select: { id: true } });
    if (pending.length) {
      const rows = await this.prisma.vacancy_stories.findMany({ where: { ig_post_id: { in: pending.map((p) => p.id) } } });
      for (const r of rows) {
        if (!r.ig_post_id) continue;
        const src = sourceOf(r.source);
        const until = approveUntil(r.starts_at, timingOf(src, settings.get(r.workspace_id) ?? DEFAULT_TIMING));
        if (until.getTime() > now.getTime()) continue;
        n += await this.cancelPost(r.workspace_id, r.ig_post_id, r.id, ['pending_approval'], src.reasons.noApproval(until, r.starts_at));
      }
    }

    // T10: pronto/aprovado/agendado cuja vaga já começou (Instagram desconectado: sem job, a guarda nunca roda) não fica pendurado.
    const open = await this.prisma.ig_posts.findMany({ where: { source: 'vacancy', status: { in: LATER } }, select: { id: true, last_error: true } });
    if (open.length) {
      const blockedPost = new Set(open.filter((p) => p.last_error === PUBLISH_BLOCKED_MSG).map((p) => p.id));
      const rows = await this.prisma.vacancy_stories.findMany({ where: { ig_post_id: { in: open.map((p) => p.id) }, starts_at: { lte: now } } });
      for (const r of rows) {
        if (!r.ig_post_id) continue;
        // R5: parado pelo bloqueio → o motivo diz que o Instagram recusava, não só que a vaga começou.
        const blockedSince = blockedPost.has(r.ig_post_id) ? since.get(r.workspace_id) : undefined;
        const src = sourceOf(r.source);
        n += await this.cancelPost(r.workspace_id, r.ig_post_id, r.id, LATER, blockedSince ? src.reasons.blockedExpire(r.starts_at, blockedSince) : src.reasons.started);
      }
    }
    return n;
  }

  /** Post cancelado (só se ainda está num de `from`) + jobs pendentes, e o motivo na linha. Devolve 1 se cancelou. */
  private cancelPost(ws: string, postId: string, rowId: string, from: string[], reason: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const got = await tx.ig_posts.updateMany({ where: { id: postId, workspace_id: ws, status: { in: from } }, data: { status: 'cancelled' } });
      if (!got.count) return 0;
      await tx.publishing_jobs.updateMany({ where: { ig_post_id: postId, workspace_id: ws, status: 'pending' }, data: { status: 'cancelled', locked_at: null } });
      await tx.vacancy_stories.updateMany({ where: { id: rowId }, data: { skip_reason: reason } });
      return 1;
    });
  }

  /** `generating` com lease vencido (a geração morreu no meio) volta para `waiting`. */
  async sweepLeases(now = new Date()): Promise<number> {
    const r = await this.prisma.vacancy_stories.updateMany({
      where: { status: 'generating', lease_until: { lt: now } },
      data: { status: 'waiting', lease_until: null },
    });
    return r.count;
  }

  /**
   * Ligada mas sem arte modelo (a marca apagou o arquivo): desliga as DIÁRIAS como o botão (cancela fila, posts não publicados e jobs) e
   * registra a atividade. As vagas fixas não usam a arte modelo e seguem como estão.
   */
  async disableOrphans(): Promise<number> {
    const orphans = await this.prisma.vacancy_story_settings.findMany({ where: { enabled: true, template_asset_id: null } });
    let n = 0;
    for (const s of orphans) {
      try {
        await this.settings.turnOff(s.workspace_id, null, { reason: 'arte modelo apagada' }, 'freela');
      } catch (e) {
        this.logger.error(`[vagas] ${s.workspace_id}: desligar falhou: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      n++;
      this.logger.warn(`[vagas] ${s.workspace_id}: desligado, arte modelo apagada`);
    }
    return n;
  }
}
