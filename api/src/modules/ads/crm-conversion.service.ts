import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { MetaGraphClient } from '../instagram/meta-graph';
import { gid } from './ads-ids';

const sha256 = (v: string) => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

export type ConversionEvent = 'Qualificado' | 'Ganho';

/**
 * `notifyMetaConversion` + `sendConversionEvent` do protótipo: manda "Qualificado"/"Ganho" do CRM para a API de Conversões
 * da Meta (`POST /{pixel_id}/events`, e-mail/telefone com SHA-256, `action_source system_generated`, valor em BRL).
 * Nunca lança depois da checagem de acesso: `{skipped:true}` sem integração conectada/lead; `{sent:false}` se a Meta falhar.
 * O lead é carregado POR workspace (o protótipo o buscava só pelo id: vazamento entre empresas).
 */
@Injectable()
export class CrmConversionService {
  private readonly logger = new Logger(CrmConversionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly graph: MetaGraphClient,
  ) {}

  async notify(userId: string, workspaceId: string, leadId: string, event: ConversionEvent): Promise<{ sent: boolean } | { skipped: true }> {
    // Mover lead é escrita: viewer não dispara conversão (o protótipo só pedia "ser membro").
    await this.access.require(userId, workspaceId, 'write');
    const [integration, lead] = await Promise.all([
      this.prisma.crm_integrations.findFirst({ where: { workspace_id: workspaceId, kind: 'meta_lead_ads' } }),
      this.prisma.crm_leads.findFirst({ where: { id: leadId, workspace_id: workspaceId }, select: { phone: true, email: true, estimated_value: true } }),
    ]);
    if (!integration || integration.status !== 'connected' || !lead) return { skipped: true };
    try {
      await this.sendConversionEvent(workspaceId, integration.config as Record<string, unknown>, event, lead.phone, lead.email, Number(lead.estimated_value ?? 0));
      return { sent: true };
    } catch (e) {
      this.logger.warn(`CAPI falhou: ${e instanceof Error ? e.message : e}`);
      return { sent: false };
    }
  }

  private async sendConversionEvent(workspaceId: string, config: Record<string, unknown>, eventName: ConversionEvent, phone: string | null, email: string | null, value: number) {
    const pixelRaw = String(config['pixel_id'] ?? '');
    if (!pixelRaw) return { skipped: 'pixel_id não configurado' };
    const pixelId = gid(pixelRaw, 'pixel');
    const userData: Record<string, string[]> = {};
    if (email) userData['em'] = [sha256(email)];
    if (phone) userData['ph'] = [sha256(phone.replace(/\D/g, ''))];
    if (!Object.keys(userData).length) return { skipped: 'sem dados de contato' };
    await this.graph.graph(workspaceId, `/${pixelId}/events`, {
      method: 'POST',
      params: {
        data: [
          {
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'system_generated',
            user_data: userData,
            custom_data: value ? { value, currency: 'BRL' } : undefined,
          },
        ],
      },
    });
    return { sent: true };
  }
}
