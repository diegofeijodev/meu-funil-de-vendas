import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { isUuid } from '../../common/ids/uuid';
import { WorkspaceAccessService } from '../access/access.service';
import { ActivityService } from '../activity/activity.service';
import { CampaignGuardsService } from '../campaigns/campaign-guards.service';

export const MSG_ONLY_MANAGERS_DECIDE = 'Só o dono ou um administrador da empresa pode aprovar ou rejeitar.';

/**
 * Aprovações (`approvals.functions.ts` + leituras diretas da tela `/approvals`).
 * Só owner|admin decidem. Aprovar uma campanha a leva para `approved` (rejeitar volta para `draft`);
 * um criativo recebe o status da decisão. Tudo numa transação; a atividade é gravada depois do commit.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly activity: ActivityService,
    private readonly guards: CampaignGuardsService,
  ) {}

  /** `approval_requests select *, campaigns(name)` eq workspace_id order created_at desc. */
  async list(workspaceId: string) {
    const rows = await this.prisma.approval_requests.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      include: { campaign: { select: { name: true } } },
    });
    return rows.map(({ campaign, ...r }) => ({ ...r, campaigns: campaign }));
  }

  /** `activity_logs select *` eq workspace_id order created_at desc limit N (a tela pede 30). */
  logs(workspaceId: string, limit = 30) {
    return this.prisma.activity_logs.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(Math.trunc(limit) || 30, 1), 200),
    });
  }

  async decide(userId: string, approvalId: string, decision: 'approved' | 'rejected') {
    const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido de aprovação não encontrado.' });
    if (!isUuid(approvalId)) throw notFound();
    const req = await this.prisma.approval_requests.findUnique({ where: { id: approvalId } });
    // Pedido de workspace alheio parece inexistente (o RLS escondia a linha).
    const role = req ? await this.access.roleOf(userId, req.workspace_id) : null;
    if (!req || !role) throw notFound();
    if (req.status !== 'pending') throw new ConflictException({ code: 'CONFLICT', message: 'Este pedido já foi decidido.' });
    if (role !== 'owner' && role !== 'admin') throw new ForbiddenException({ code: 'FORBIDDEN', message: MSG_ONLY_MANAGERS_DECIDE });
    await this.guards.assertCanDecideApproval(userId, req.workspace_id);

    await this.prisma.$transaction(async (tx) => {
      // Guardado por `status = pending`: duas decisões ao mesmo tempo → só uma vale.
      const upd = await tx.approval_requests.updateMany({
        where: { id: req.id, workspace_id: req.workspace_id, status: 'pending' },
        data: { status: decision, decided_at: new Date(), decided_by: userId },
      });
      if (upd.count === 0) throw new ConflictException({ code: 'CONFLICT', message: 'Este pedido já foi decidido.' });
      if (req.entity_id) {
        if (req.entity_type === 'campaign') {
          const status = decision === 'approved' ? 'approved' : 'draft';
          const c = await tx.campaigns.findFirst({ where: { id: req.entity_id, workspace_id: req.workspace_id }, select: { status: true } });
          if (c) {
            await this.guards.assertCanSetCampaignStatus(userId, req.workspace_id, c.status, status);
            await tx.campaigns.update({ where: { id: req.entity_id }, data: { status } });
          }
        }
        if (req.entity_type === 'creative') {
          await tx.creatives.updateMany({ where: { id: req.entity_id, workspace_id: req.workspace_id }, data: { status: decision } });
        }
      }
    });
    await this.activity.log(req.workspace_id, userId, `approval.${decision}`, req.entity_type, { request_id: req.id, entity_id: req.entity_id });
    return { ok: true };
  }
}
