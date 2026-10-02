import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { CrmCoreService } from '../crm/crm-core.service';
import { CrmChannelHooks } from '../instagram/inbound.service';
import { MediaUnderstandingService } from './media-understanding.service';
import { SdrService } from './sdr.service';

/**
 * Comportamento de CRM do canal Instagram (ponto de extensão `CRM_CHANNEL_HOOKS` da Task 5): cadências por origem, parada por
 * resposta/descadastro, agente SDR e compreensão de áudio/imagem. Só depende do núcleo do CRM (sem o módulo do Instagram: sem ciclo).
 */
@Injectable()
export class CrmChannelHooksService implements CrmChannelHooks {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CrmCoreService,
    private readonly sdr: SdrService,
    private readonly media: MediaUnderstandingService,
  ) {}

  startCadence(workspaceId: string, leadId: string, source: string) {
    return this.core.startCadence(workspaceId, leadId, source);
  }

  async stopCadences(leadId: string, reason: 'opt_out' | 'replied') {
    const lead = await this.prisma.crm_leads.findUnique({ where: { id: leadId }, select: { workspace_id: true } });
    return lead ? this.core.stopCadences(lead.workspace_id, leadId, reason) : 0;
  }

  async runSdr(input: { workspaceId: string; leadId: string; conversationId?: string; inboundText: string }) {
    const r = await this.sdr.run(input);
    return 'reply' in r ? { reply: r.reply } : null;
  }

  describeMedia(workspaceId: string, url: string, type: 'audio' | 'image') {
    return this.media.describe(workspaceId, url, type);
  }
}
