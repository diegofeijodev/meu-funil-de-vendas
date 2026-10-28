import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { OriginUnavailable } from '../instagram/ig-store.service';
import type { PostRow } from '../instagram/ig-types';
import type { PublishOriginGuard } from '../instagram/origin-guards';
import { FeedDownError, VacancyFeedClient } from './vacancy-feed';
import { VACANCY_CLOSED_REASON } from './vacancy-generator.service';
import { fingerprint, hourLabel, leadLabel, spParts } from './vacancy-text';
import type { FreelaVacancy } from './vacancy-types';

const MIN = 60_000;
/** D11: refações por mudança da vaga (e "Refazer a arte") por linha. */
export const MAX_REDOS = 3;
export const VACANCY_CHANGED_REASON = 'A vaga mudou no Freela (valor ou horário). Vamos criar o story de novo.';
export const VACANCY_CHANGED_TOO_OFTEN = 'A vaga mudou muitas vezes no Freela. Crie o story de novo quando ela estiver definida.';
export const VACANCY_STARTED_REASON = 'A vaga começou antes de ir ao ar.';

/** Mesmo texto do `expireDue` para a vaga que entrou na antecedência mínima. */
export const tooCloseReason = (startsAt: Date, leadMinutes: number) =>
  `Começa às ${hourLabel(spParts(startsAt.toISOString()).minutes)}, em menos de ${leadLabel(leadMinutes)}. Não dá tempo de divulgar.`;
/** Mesmo texto do `expireDue` para a linha que esperou a vez (limite do dia). */
export const capWaitReason = (cap: number) => `Ficou esperando a vez (máximo de ${cap} por dia) e a vaga começou antes.`;

/**
 * Guarda de origem dos stories das vagas (`PUBLISH_ORIGIN_GUARDS`), no núcleo (D10: sem `PublishingService`, sem ciclo). Logo antes
 * de criar o container (e no `catch` da fila) confere a vaga na vitrine: fechada, mudou, começou ou perto demais do início → o post é
 * cancelado com o motivo, que fica também na LINHA (`skip_reason`, a tela lê de lá). Vitrine fora → `OriginUnavailable` (a fila tenta
 * de novo sem gastar tentativa). O `VacancySchedulerService` registra `onApproved` no `onModuleInit` para agendar logo depois da
 * aprovação.
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
    // Sem linha (refeita no meio do caminho): confere pela vaga do próprio post, sem gravar nada.
    const externalId: string | undefined = row?.external_id ?? post.creative_brief?.vacancy?.external_id;
    if (!externalId) return null;
    let v: FreelaVacancy | null;
    try {
      v = await this.feed.byId(externalId);
    } catch (e) {
      if (e instanceof FeedDownError) throw new OriginUnavailable(e.message);
      throw e;
    }
    // Grava o motivo na linha só se ela ainda é a deste post (condicional: duas checagens ao mesmo tempo não se atropelam).
    const ours = row ? { id: row.id, workspace_id: ws, ig_post_id: post.id, status: 'handed_off' } : null;
    const block = async (reason: string) => {
      if (ours) await this.prisma.vacancy_stories.updateMany({ where: ours, data: { skip_reason: reason } });
      return reason;
    };
    if (!v) return block(VACANCY_CLOSED_REASON);

    const fp = fingerprint(v);
    if (fp !== (post.creative_brief?.vacancy?.fingerprint ?? row?.fingerprint)) {
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

    const startsAt = new Date(v.startTime);
    if (startsAt.getTime() <= at.getTime()) return block(VACANCY_STARTED_REASON);
    const s = await this.prisma.vacancy_story_settings.findUnique({ where: { workspace_id: ws }, select: { min_lead_minutes: true } });
    const lead = s?.min_lead_minutes ?? 120;
    if (startsAt.getTime() - at.getTime() < lead * MIN) return block(tooCloseReason(startsAt, lead));
    return null;
  }

  async afterApproval(workspaceId: string, postId: string): Promise<void> {
    await this.onApproved?.(workspaceId, postId);
  }
}
