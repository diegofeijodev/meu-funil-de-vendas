import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { OriginUnavailable } from '../instagram/ig-store.service';
import { PUBLISH_BLOCKED_MSG, type PostRow } from '../instagram/ig-types';
import type { PublishOriginGuard } from '../instagram/origin-guards';
import { FeedDownError, VacancyFeedClient } from './vacancy-feed';
import { leadDeadline, MAX_REDOS, VACANCY_CHANGED_REASON, VACANCY_CHANGED_TOO_OFTEN, VACANCY_UNVERIFIABLE } from './vacancy-reasons';
import { sourceOf, sourceOfPost, type SourceItem } from './vacancy-sources';

const MIN = 60_000;

/**
 * Guarda de origem dos stories das vagas (`PUBLISH_ORIGIN_GUARDS`), no núcleo (D10: sem `PublishingService`, sem ciclo). Logo antes
 * de criar o container (e no `catch` da fila) consulta a vitrine: fechada, mudou (refaz), começou ou perto demais do início → o post é
 * cancelado com o motivo, que fica também na LINHA (`skip_reason`, a tela lê de lá). Vitrine fora → pela data guardada, começou ou em
 * cima da hora cancela; senão `OriginUnavailable` (a fila tenta de novo sem gastar tentativa). O `VacancySchedulerService` registra
 * `onApproved` no `onModuleInit` para agendar logo depois da aprovação.
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
    // Porta por fonte: diária (vitrine de vagas) ou vaga fixa (vitrine de vagas fixas, V9) — pela linha, senão pelo `kind` do post.
    const src = row ? sourceOf(row.source) : sourceOfPost(post);
    // Grava o motivo na linha só se ela ainda é a deste post (condicional: duas checagens ao mesmo tempo não se atropelam).
    const ours = row ? { id: row.id, workspace_id: ws, ig_post_id: post.id, status: 'handed_off' } : null;
    const block = async (reason: string) => {
      if (ours) await this.prisma.vacancy_stories.updateMany({ where: ours, data: { skip_reason: reason } });
      return reason;
    };
    const s = await this.prisma.vacancy_story_settings.findUnique({ where: { workspace_id: ws }, select: { min_lead_minutes: true } });
    const lead = src.lead(s);
    // R5: post parado pelo bloqueio de publicação que perdeu o prazo → o motivo diz que o Instagram recusava (desde o início do bloqueio).
    const blockedSince = post.last_error === PUBLISH_BLOCKED_MSG
      ? (await this.prisma.instagram_accounts.findFirst({ where: { workspace_id: ws }, select: { publish_blocked_at: true } }))?.publish_blocked_at ?? null
      : null;
    const timing = (startsAt: Date): string | null => {
      const late = startsAt.getTime() <= at.getTime() || startsAt.getTime() - at.getTime() < lead * MIN;
      if (late && blockedSince) return src.reasons.blockedExpire(startsAt, blockedSince);
      if (startsAt.getTime() <= at.getTime()) return src.reasons.started;
      if (startsAt.getTime() - at.getTime() < lead * MIN) return src.reasons.tooClose(startsAt, leadDeadline(startsAt, lead));
      return null;
    };

    // Data guardada: só vale com a vitrine fora (R27) — encerra a repetição sem fim depois do início; vaga adiada no Freela é refeita.
    const stored = row?.starts_at ?? (brief?.starts_at ? new Date(brief.starts_at) : null);
    const known = stored && !Number.isNaN(stored.getTime()) ? stored : null;

    let v: SourceItem | null;
    try {
      v = await src.byId(this.feed, externalId);
    } catch (e) {
      if (!(e instanceof FeedDownError)) throw e;
      const early = known ? timing(known) : null;
      if (early) return block(early);
      throw new OriginUnavailable(e.message);
    }
    if (!v) return block(src.reasons.closed);

    const fp = src.fingerprint(v);
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
          status: 'new', ig_post_id: null, snapshot: v as unknown as Prisma.InputJsonValue, fingerprint: fp, starts_at: src.startsAt(v),
          redo_count: { increment: 1 }, mismatch_attempts: 0, skip_reason: null, wait_reason: null, next_attempt_at: null, not_before: null,
          lease_until: null,
        },
      });
      return VACANCY_CHANGED_REASON;
    }

    // Começou ou em cima da hora (CLT: prazo para divulgar passado), pela data VIVA da vitrine.
    const late = timing(src.startsAt(v));
    return late ? block(late) : null;
  }

  async afterApproval(workspaceId: string, postId: string): Promise<void> {
    await this.onApproved?.(workspaceId, postId);
  }
}
