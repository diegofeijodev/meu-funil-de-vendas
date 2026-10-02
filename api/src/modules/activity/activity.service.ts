import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

/**
 * Auditoria server-side. No protótipo o navegador gravava `activity_logs` (`logActivity`);
 * aqui cada rota que muda algo chama `log` com as MESMAS strings de `action`/`entity_type`
 * (a tela de Aprovações imprime `action` + `JSON.stringify(metadata)`).
 * Falha de auditoria nunca derruba a operação principal.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(workspaceId: string, actorId: string | null, action: string, entityType: string, metadata: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.prisma.activity_logs.create({
        data: { workspace_id: workspaceId, actor_id: actorId, action, entity_type: entityType, metadata: metadata as object },
      });
    } catch (e) {
      this.logger.warn(`activity_logs: ${e instanceof Error ? e.message : e}`);
    }
  }
}
