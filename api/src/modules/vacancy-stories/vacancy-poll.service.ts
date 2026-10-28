import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { leaseFree } from '../instagram/ig-store.service';
import { FeedDownError, VacancyFeedClient } from './vacancy-feed';
import { VacancyGate } from './vacancy-gate.service';
import { fingerprint, hourLabel, leadLabel, spParts } from './vacancy-text';
import { isAfterWatermark, triage } from './vacancy-triage';
import type { FreelaVacancy, SettingsRow } from './vacancy-types';

export const WAIT_CAP = 'cap';
const MIN = 60_000;

const startLabel = (startsAt: Date) => hourLabel(spParts(startsAt.toISOString()).minutes);

/** Cidades da resposta com a contagem, as mais frequentes primeiro (empate: ordem de chegada). */
function countCities(list: FreelaVacancy[]): { city: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of list) {
    const c = (v.city ?? '').trim();
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count);
}

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
    private readonly activity: ActivityService,
  ) {}

  /** Empresas ligadas E na lista de liberadas. */
  private async activeSettings(): Promise<SettingsRow[]> {
    const rows = await this.prisma.vacancy_story_settings.findMany({ where: { enabled: true } });
    return rows.filter((s) => this.gate.allowed(s.workspace_id));
  }

  async pollAll(now = new Date()): Promise<{ workspaces: number; inserted: number; skipped: number; error?: string }> {
    const active = await this.activeSettings();
    if (!active.length) return { workspaces: 0, inserted: 0, skipped: 0 };
    let list: FreelaVacancy[];
    try {
      list = await this.feed.recent();
    } catch (e) {
      if (!(e instanceof FeedDownError)) throw e;
      // `last_poll_ok_at` fica como está: a tela mostra "última consulta que deu certo".
      await this.prisma.vacancy_story_settings.updateMany({
        where: { workspace_id: { in: active.map((s) => s.workspace_id) } },
        data: { last_poll_at: now, last_poll_error: e.message },
      });
      return { workspaces: active.length, inserted: 0, skipped: 0, error: e.message };
    }
    const cities = countCities(list);
    let inserted = 0;
    let skipped = 0;
    for (const s of active) {
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
    }
    return { workspaces: active.length, inserted, skipped };
  }

  /**
   * Quem entrou na antecedência mínima sem ser publicado: linhas da fila viram `expired`; posts de vaga ainda `pending_approval`
   * são cancelados e o motivo vai na LINHA (a tela lê `skip_reason`). Devolve quantas linhas + posts mudaram.
   */
  async expireDue(now = new Date()): Promise<number> {
    const settings = new Map((await this.prisma.vacancy_story_settings.findMany({})).map((s) => [s.workspace_id, s]));
    const lead = (ws: string) => (settings.get(ws)?.min_lead_minutes ?? 120) * MIN;
    let n = 0;

    const queued = await this.prisma.vacancy_stories.findMany({
      where: { OR: [{ status: { in: ['new', 'waiting'] } }, { status: 'generating', ...leaseFree(now) }] },
    });
    for (const r of queued) {
      if (r.starts_at.getTime() - now.getTime() >= lead(r.workspace_id)) continue;
      const s = settings.get(r.workspace_id);
      const reason = r.wait_reason === WAIT_CAP
        ? `Ficou esperando a vez (máximo de ${s?.daily_cap ?? 10} por dia) e a vaga começou antes.`
        : `Começa às ${startLabel(r.starts_at)}, em menos de ${leadLabel(s?.min_lead_minutes ?? 120)}. Não dá tempo de divulgar.`;
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
        if (!r.ig_post_id || r.starts_at.getTime() - now.getTime() >= lead(r.workspace_id)) continue;
        const postId = r.ig_post_id;
        const done = await this.prisma.$transaction(async (tx) => {
          const got = await tx.ig_posts.updateMany({ where: { id: postId, workspace_id: r.workspace_id, status: 'pending_approval' }, data: { status: 'cancelled' } });
          if (!got.count) return 0;
          await tx.publishing_jobs.updateMany({ where: { ig_post_id: postId, workspace_id: r.workspace_id, status: 'pending' }, data: { status: 'cancelled', locked_at: null } });
          await tx.vacancy_stories.updateMany({
            where: { id: r.id },
            data: { skip_reason: `Ninguém aprovou a tempo: a vaga começou às ${startLabel(r.starts_at)}.` },
          });
          return 1;
        });
        n += done;
      }
    }
    return n;
  }

  /** `generating` com lease vencido (a geração morreu no meio) volta para `waiting`. */
  async sweepLeases(now = new Date()): Promise<number> {
    const r = await this.prisma.vacancy_stories.updateMany({
      where: { status: 'generating', lease_until: { lt: now } },
      data: { status: 'waiting', lease_until: null },
    });
    return r.count;
  }

  /** Ligada mas sem arte modelo (a marca apagou o arquivo): desliga e deixa no registro de atividade. */
  async disableOrphans(): Promise<number> {
    const orphans = await this.prisma.vacancy_story_settings.findMany({ where: { enabled: true, template_asset_id: null } });
    let n = 0;
    for (const s of orphans) {
      const got = await this.prisma.vacancy_story_settings.updateMany({ where: { workspace_id: s.workspace_id, enabled: true, template_asset_id: null }, data: { enabled: false } });
      if (!got.count) continue;
      n++;
      await this.activity.log(s.workspace_id, null, 'vacancy_stories.disable', 'vacancy_stories', { reason: 'arte modelo apagada' });
      this.logger.warn(`[vagas] ${s.workspace_id}: desligado, arte modelo apagada`);
    }
    return n;
  }
}
