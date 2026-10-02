import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { isUuid } from '../../common/ids/uuid';
import { AccessLevel, WorkspaceAccessService } from '../access/access.service';

/** Mensagens dos gatilhos do banco (db.md §4), que aqui viram guardas de serviço (o banco não vê o usuário). */
export const MSG_APPROVE_CAMPAIGN = 'Só o dono ou um administrador da empresa pode aprovar a campanha.';
export const MSG_ACTIVATE_DELIVERY = 'Só o dono ou um administrador pode ativar a veiculação (gastar verba).';
export const MSG_DECIDE_APPROVAL = 'Só o dono ou um administrador da empresa pode decidir aprovações.';

const APPROVED_OR_ACTIVE = ['approved', 'active'];

/**
 * Equivalentes dos gatilhos de papel do protótipo:
 *  - `guard_campaign_approval`: `campaigns.status` virar approved|active (vindo de outro estado) = owner|admin.
 *    Alternar approved<->active continua livre.
 *  - `guard_campaign_delivery`: `meta_delivery_status` virar 'ACTIVE' (gasta verba) = owner|admin.
 *  - `guard_approval_decision`: `approval_requests.status` virar approved|rejected = owner|admin.
 * Todo código que muda esses campos (aprovações, publicação/ativação na Meta) chama estes métodos ANTES de gravar.
 * No protótipo o servidor (service_role) passava direto; aqui quem passa é quem chama sem `userId` (jobs internos).
 */
@Injectable()
export class CampaignGuardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  private async isManager(userId: string, workspaceId: string): Promise<boolean> {
    return this.access.can(userId, workspaceId, 'manage');
  }

  /** `guard_campaign_approval`. `from` = status atual (null em INSERT). */
  async assertCanSetCampaignStatus(userId: string, workspaceId: string, from: string | null, to: string): Promise<void> {
    if (!APPROVED_OR_ACTIVE.includes(to)) return;
    if (from && APPROVED_OR_ACTIVE.includes(from)) return;
    if (!(await this.isManager(userId, workspaceId))) throw new ForbiddenException({ code: 'FORBIDDEN', message: MSG_APPROVE_CAMPAIGN });
  }

  /** `guard_campaign_delivery`. */
  async assertCanSetDelivery(userId: string, workspaceId: string, from: string | null, to: string | null): Promise<void> {
    if (to !== 'ACTIVE' || from === 'ACTIVE') return;
    if (!(await this.isManager(userId, workspaceId))) throw new ForbiddenException({ code: 'FORBIDDEN', message: MSG_ACTIVATE_DELIVERY });
  }

  /** `guard_approval_decision`. */
  async assertCanDecideApproval(userId: string, workspaceId: string): Promise<void> {
    if (!(await this.isManager(userId, workspaceId))) throw new ForbiddenException({ code: 'FORBIDDEN', message: MSG_DECIDE_APPROVAL });
  }

  /**
   * `campaignOf` + `requireRole` do protótipo: acha a campanha pelo id; quem não é membro do workspace dela recebe
   * 404 "Campanha não encontrada." (o RLS escondia a linha); membro sem o papel exigido recebe 403.
   */
  async resolveCampaign(userId: string, campaignId: string, level: AccessLevel) {
    const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Campanha não encontrada.' });
    if (!isUuid(campaignId)) throw notFound();
    const c = await this.prisma.campaigns.findUnique({
      where: { id: campaignId },
      select: { id: true, workspace_id: true, brand_id: true, name: true, objective: true, status: true },
    });
    if (!c || !(await this.access.roleOf(userId, c.workspace_id))) throw notFound();
    await this.access.require(userId, c.workspace_id, level);
    return c;
  }
}
