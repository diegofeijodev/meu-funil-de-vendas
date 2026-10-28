import { Injectable } from '@nestjs/common';
import type { PostRow } from '../instagram/ig-types';
import type { PublishOriginGuard } from '../instagram/origin-guards';

/**
 * Guarda de origem dos stories das vagas (`PUBLISH_ORIGIN_GUARDS`), no núcleo (D10: sem `PublishingService`, sem ciclo).
 * Esqueleto: libera tudo. A Task 10 completa o `blockReason` (vaga fechada, mudou, começou) e o `VacancySchedulerService`
 * registra `onApproved` no `onModuleInit` para agendar o story logo depois da aprovação.
 */
@Injectable()
export class VacancyGuardService implements PublishOriginGuard {
  onApproved: ((workspaceId: string, postId: string) => Promise<unknown>) | null = null;

  async blockReason(_post: PostRow, _at: Date): Promise<string | null> {
    return null;
  }

  async afterApproval(workspaceId: string, postId: string): Promise<void> {
    await this.onApproved?.(workspaceId, postId);
  }
}
