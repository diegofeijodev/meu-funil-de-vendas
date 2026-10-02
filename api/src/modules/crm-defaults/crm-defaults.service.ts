import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import {
  DEFAULT_DISTRIBUTION, DEFAULT_LOSS_REASONS, DEFAULT_PIPELINE_NAME, DEFAULT_STAGES, DEFAULT_TAGS,
} from './crm-defaults.data';

/**
 * Cria, na 1ª leitura do CRM de um workspace, o que a migração do protótipo só inseriu para os
 * workspaces que já existiam: funil padrão com 8 etapas, motivos de perda, tags e `crm_settings`.
 *
 * Idempotente e seguro sob concorrência: a linha de `crm_settings` é o marcador de "já semeado"
 * (assim apagar todos os motivos de perda de propósito não os recria), e a criação acontece sob
 * um advisory lock por workspace. Chame `ensure(workspaceId)` no início de toda leitura de CRM.
 */
@Injectable()
export class CrmDefaultsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devolve true se criou os padrões agora, false se já existiam. */
  async ensure(workspaceId: string): Promise<boolean> {
    // Caminho rápido (a imensa maioria das chamadas): sem transação.
    if (await this.prisma.crm_settings.findUnique({ where: { workspace_id: workspaceId }, select: { workspace_id: true } })) return false;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'crm-defaults:' + workspaceId}))`;
      // Releitura sob o lock: outra requisição pode ter semeado enquanto esperávamos.
      if (await tx.crm_settings.findUnique({ where: { workspace_id: workspaceId }, select: { workspace_id: true } })) return false;

      if ((await tx.crm_pipelines.count({ where: { workspace_id: workspaceId } })) === 0) {
        const pipeline = await tx.crm_pipelines.create({ data: { workspace_id: workspaceId, name: DEFAULT_PIPELINE_NAME, is_default: true } });
        await tx.crm_stages.createMany({ data: DEFAULT_STAGES.map((s) => ({ ...s, workspace_id: workspaceId, pipeline_id: pipeline.id })) });
      }
      if ((await tx.crm_loss_reasons.count({ where: { workspace_id: workspaceId } })) === 0) {
        await tx.crm_loss_reasons.createMany({ data: DEFAULT_LOSS_REASONS.map((name) => ({ workspace_id: workspaceId, name })) });
      }
      await tx.crm_tags.createMany({ data: DEFAULT_TAGS.map((t) => ({ ...t, workspace_id: workspaceId })), skipDuplicates: true });
      await tx.crm_settings.create({ data: { workspace_id: workspaceId, distribution: DEFAULT_DISTRIBUTION } });
      return true;
    });
  }
}
