import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { isUuid } from '../../common/ids/uuid';
import { CrmCoreService } from './crm-core.service';
import { UnsubscribeLinkService } from './unsubscribe-link.service';

/** `GET /api/public/unsubscribe/:leadId?t=` — descadastro por link assinado (assinatura presa ao lead + empresa dele). */
@Injectable()
export class UnsubscribeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: UnsubscribeLinkService,
    private readonly core: CrmCoreService,
  ) {}

  /**
   * `invalid` = id/assinatura não conferem (ou o lead não existe: não dá para provar a assinatura sem ele — resposta igual,
   * para a página não revelar quais ids existem). `ok` = lead descadastrado (idempotente).
   */
  async unsubscribe(leadId: string, token: string | undefined): Promise<'ok' | 'invalid'> {
    if (!isUuid(leadId)) return 'invalid';
    const lead = await this.prisma.crm_leads.findUnique({ where: { id: leadId }, select: { id: true, workspace_id: true, unsubscribed: true } });
    if (!lead || !this.links.verify(lead.workspace_id, lead.id, token)) return 'invalid';
    await this.prisma.crm_leads.update({ where: { id: lead.id }, data: { unsubscribed: true, ai_active: false } });
    await this.core.stopCadences(lead.workspace_id, lead.id, 'opt_out');
    if (!lead.unsubscribed) {
      await this.core.addInteraction({
        workspaceId: lead.workspace_id,
        leadId: lead.id,
        kind: 'ai_action',
        authorType: 'system',
        content: 'Lead se descadastrou pelo link do e-mail. Envios automáticos bloqueados.',
      });
    }
    return 'ok';
  }
}
