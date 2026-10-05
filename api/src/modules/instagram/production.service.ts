import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { OVERDUE_MS, SKIP_PREFIX } from './ig-types';
import { IgStore, errText, leaseFree } from './ig-store.service';
import { MediaGenerationService } from './media-generation.service';
import { PublishingService } from './publishing.service';

export type ProductionCandidate = { id: string; workspace_id: string; plan_id: string | null; scheduled_at: Date; late: boolean };
const OVERDUE_REASON = 'o horário passou há mais de 12 h sem o criativo pronto.';

/**
 * Ordem da produção (a mesma da SQL de `candidates`, usada nos testes): no máximo 1 post por empresa — o mais próximo dela —;
 * quem já está dentro da meta (`targetHours` antes do horário) passa à frente; depois, pelo horário.
 */
export function rankProductionCandidates<T extends { id: string; workspace_id: string; scheduled_at: Date }>(
  rows: T[],
  o: { now: Date; perTick: number; targetHours: number },
): (T & { late: boolean })[] {
  const first = new Map<string, T>();
  for (const r of [...rows].sort((a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime() || a.id.localeCompare(b.id))) {
    if (!first.has(r.workspace_id)) first.set(r.workspace_id, r);
  }
  const limit = o.now.getTime() + o.targetHours * 3600e3;
  return [...first.values()]
    .map((r) => ({ ...r, late: r.scheduled_at.getTime() <= limit }))
    .sort((a, b) => Number(b.late) - Number(a.late) || a.scheduled_at.getTime() - b.scheduled_at.getTime())
    .slice(0, o.perTick);
}

/**
 * Produção antecipada do "Programar com IA" (job `instagram-media-5min`): posts de programação em `idea` com horário dentro da janela
 * (agora + 48 h; até 12 h de atraso) ganham o criativo, no máximo 1 por empresa por rodada (rodízio na própria consulta), e são
 * agendados no horário do cronograma. Vídeo é assíncrono (espera curta; o poller conclui). Post do modo "publish" que passou mais de
 * 12 h do horário sem criativo é pulado — o cronograma é respeitado.
 */
@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);
  private readonly perTick: number;
  private readonly windowHours: number;
  private readonly targetHours: number;

  constructor(
    private readonly store: IgStore,
    private readonly mediaGen: MediaGenerationService,
    private readonly publishing: PublishingService,
    @Inject(ENV) env: Pick<Env, 'IG_PRODUCTION_PER_TICK' | 'IG_PRODUCTION_WINDOW_HOURS' | 'IG_PRODUCTION_TARGET_HOURS'>,
  ) {
    this.perTick = env.IG_PRODUCTION_PER_TICK;
    this.windowHours = env.IG_PRODUCTION_WINDOW_HOURS;
    this.targetHours = env.IG_PRODUCTION_TARGET_HOURS;
  }

  /** Rodízio NA consulta: ROW_NUMBER() por empresa (1 post cada, o mais próximo); atrasados para a meta primeiro; lease livre. */
  async candidates(now = new Date()): Promise<ProductionCandidate[]> {
    const target = new Date(now.getTime() + this.targetHours * 3600e3).toISOString();
    const since = new Date(now.getTime() - OVERDUE_MS).toISOString();
    const until = new Date(now.getTime() + this.windowHours * 3600e3).toISOString();
    return this.store.prisma.$queryRaw<ProductionCandidate[]>`
      SELECT x.id, x.workspace_id, x.plan_id, x.scheduled_at, (x.scheduled_at <= ${target}::timestamptz) AS late
        FROM (
          SELECT p.id, p.workspace_id, p.plan_id, p.scheduled_at,
                 ROW_NUMBER() OVER (PARTITION BY p.workspace_id ORDER BY p.scheduled_at ASC, p.id ASC) AS rn
            FROM ig_posts p
           WHERE p.run_id IS NOT NULL
             AND p.status = 'idea'
             AND p.scheduled_at > ${since}::timestamptz
             AND p.scheduled_at <= ${until}::timestamptz
             AND (p.lease_until IS NULL OR p.lease_until < ${now.toISOString()}::timestamptz)
        ) x
       WHERE x.rn = 1
       ORDER BY late DESC, x.scheduled_at ASC
       LIMIT ${this.perTick}`;
  }

  /** Modo "publish": post ainda sem criativo (ideia ou em reescrita) mais de 12 h depois do horário é pulado, uma única vez. */
  async skipOverdue(now = new Date()): Promise<number> {
    const prisma = this.store.prisma;
    const late = await prisma.ig_posts.findMany({
      where: { automation: 'publish', run_id: { not: null }, status: { in: ['idea', 'needs_review'] }, scheduled_at: { lt: new Date(now.getTime() - OVERDUE_MS) }, ...leaseFree(now) },
      orderBy: { scheduled_at: 'asc' },
      take: 50,
      select: { id: true, workspace_id: true, plan_id: true, status: true },
    });
    let n = 0;
    for (const p of late) {
      const got = await prisma.ig_posts.updateMany({ where: { id: p.id, status: p.status, AND: [leaseFree(now)] }, data: { status: 'cancelled', last_error: `${SKIP_PREFIX}${OVERDUE_REASON}` } });
      if (!got.count) continue;
      n++;
      await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'post_skipped', level: 'warn', message: `Horário pulado: ${OVERDUE_REASON}` });
    }
    return n;
  }

  async productionTick(): Promise<{ skipped: number; started: number; ready: number; pending: number; failed: number }> {
    const out = { skipped: await this.skipOverdue(), started: 0, ready: 0, pending: 0, failed: 0 };
    for (const c of await this.candidates()) {
      out.started++;
      const ev = { workspace_id: c.workspace_id, plan_id: c.plan_id, post_id: c.id };
      const r = await this.mediaGen.generatePostAssets(c.workspace_id, c.id, 'auto').catch((e) => ({ ok: false as const, error: errText(e) }));
      if (!r.ok) {
        out.failed++;
        await this.store.logEvent({ ...ev, kind: 'failure', level: 'error', message: `Falha ao gerar a mídia: ${r.error}` });
        continue;
      }
      if (r.pending) {
        out.pending++;
        await this.store.logEvent({ ...ev, kind: 'media', message: `Mídia em produção (${r.provider}); fica pronta sozinha${c.late ? ` — já dentro das ${this.targetHours} h antes do horário` : ''}.` });
        continue;
      }
      out.ready++;
      await this.store.logEvent({ ...ev, kind: 'media', message: `Mídia produzida (${r.provider})${c.late ? ` — dentro das ${this.targetHours} h antes do horário` : ' com antecedência'}.` });
      await this.publishing.scheduleAutomated(c.id).catch((e) => this.store.logEvent({ ...ev, kind: 'failure', level: 'error', message: `Falha ao agendar: ${errText(e)}` }));
    }
    if (out.started || out.skipped) this.logger.log(`[produção] ${JSON.stringify(out)}`);
    return out;
  }
}
