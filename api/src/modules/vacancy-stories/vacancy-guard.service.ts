import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { OriginUnavailable } from '../instagram/ig-store.service';
import type { PostRow } from '../instagram/ig-types';
import type { PublishOriginGuard } from '../instagram/origin-guards';
import { FeedDownError, VacancyFeedClient } from './vacancy-feed';
import {
  MAX_REDOS,
  tooCloseReason,
  VACANCY_CHANGED_REASON,
  VACANCY_CHANGED_TOO_OFTEN,
  VACANCY_CLOSED_REASON,
  VACANCY_STARTED_REASON,
  VACANCY_UNVERIFIABLE,
} from './vacancy-reasons';
import { fingerprint } from './vacancy-text';
import type { FreelaVacancy } from './vacancy-types';

const MIN = 60_000;

/**
 * Guarda de origem dos stories das vagas (`PUBLISH_ORIGIN_GUARDS`), no núcleo (D10: sem `PublishingService`, sem ciclo). Logo antes
 * de criar o container (e no `catch` da fila): começou ou perto demais do início (pela data guardada, sem rede), fechada ou mudou (pela
 * vitrine) → o post é cancelado com o motivo, que fica também na LINHA (`skip_reason`, a tela lê de lá). Vitrine fora → `OriginUnavailable`
 * (a fila tenta de novo sem gastar tentativa). O `VacancySchedulerService` registra `onApproved` no `onModuleInit` para agendar logo
 * depois da aprovação.
 */
@Injectable()
export class VacancyGuardService implements PublishOriginGuard {
  onApproved: ((workspaceId: string, postId: string) => Promise<unknown>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: VacancyFeedClient,
  ) {}

  async blockReason(post: PostRow, at: Date): Promise<string | null> {
    if (post?.source !== 'vacancy') return null;
    const ws: string = post.workspace_id;
    const row = await this.prisma.vacancy_stories.findFirst({ where: { ig_post_id: post.id, workspace_id: ws } });
    // Sem linha (refeita no meio do caminho): confere pela vaga do próprio post, sem gravar nada. Sem vaga nenhuma: não sai.
    const brief = post.creative_brief?.vacancy as { external_id?: string; starts_at?: string; fingerprint?: string } | undefined;
    const externalId = row?.external_id ?? brief?.external_id;
    if (!externalId) return VACANCY_UNVERIFIABLE;
    // Grava o motivo na linha só se ela ainda é a deste post (condicional: duas checagens ao mesmo tempo não se atropelam).
    const ours = row ? { id: row.id, workspace_id: ws, ig_post_id: post.id, status: 'handed_off' } : null;
    const block = async (reason: string) => {
      if (ours) await this.prisma.vacancy_stories.updateMany({ where: ours, data: { skip_reason: reason } });
      return reason;
    };
    const s = await this.prisma.vacancy_story_settings.findUnique({ where: { workspace_id: ws }, select: { min_lead_minutes: true } });
    const lead = s?.min_lead_minutes ?? 120;
    const timing = (startsAt: Date): string | null => {
      if (startsAt.getTime() <= at.getTime()) return VACANCY_STARTED_REASON;
      if (startsAt.getTime() - at.getTime() < lead * MIN) return tooCloseReason(startsAt, lead);
      return null;
    };

    // Primeiro o que não depende da vitrine: com ela fora depois do início, a fila tentaria a cada 10 min sem fim.
    const stored = row?.starts_at ?? (brief?.starts_at ? new Date(brief.starts_at) : null);
    const known = stored && !Number.isNaN(stored.getTime()) ? stored : null;
    const early = known ? timing(known) : null;
    if (early) return block(early);

    let v: FreelaVacancy | null;
    try {
      v = await this.feed.byId(externalId);
    } catch (e) {
      if (e instanceof FeedDownError) throw new OriginUnavailable(e.message);
      throw e;
    }
    if (!v) return block(VACANCY_CLOSED_REASON);

    const fp = fingerprint(v);
    if (fp !== (brief?.fingerprint ?? row?.fingerprint)) {
      if (!ours || !row) return VACANCY_CHANGED_REASON;
      if (row.redo_count >= MAX_REDOS) {
        await this.prisma.vacancy_stories.updateMany({ where: ours, data: { status: 'failed', skip_reason: VACANCY_CHANGED_TOO_OFTEN } });
        return VACANCY_CHANGED_TOO_OFTEN;
      }
      // A arte saiu com dados velhos: a linha volta para a fila com os dados novos e o gerador faz outro story.
      await this.prisma.vacancy_stories.updateMany({
        where: ours,
        data: {
          status: 'new', ig_post_id: null, snapshot: v as unknown as Prisma.InputJsonValue, fingerprint: fp, starts_at: new Date(v.startTime),
          redo_count: { increment: 1 }, mismatch_attempts: 0, skip_reason: null, wait_reason: null, next_attempt_at: null, not_before: null,
          lease_until: null,
        },
      });
      return VACANCY_CHANGED_REASON;
    }

    // Mesma assinatura = mesmo início; só falta conferir quando a data guardada não existia.
    const late = known ? null : timing(new Date(v.startTime));
    return late ? block(late) : null;
  }

  async afterApproval(workspaceId: string, postId: string): Promise<void> {
    await this.onApproved?.(workspaceId, postId);
  }
}
