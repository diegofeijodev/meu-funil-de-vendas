import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { CrmCoreService, normalizePhone } from '../crm/crm-core.service';
import { Integration } from '../webhooks/webhook-ledger.service';
import { errText, isOptOut, WINDOW_MS } from './channel-common';
import { ChannelHttp, ChannelSecrets } from './channel-http';
import { ProviderError, UserFacingError } from './channel-errors';
import { MediaUnderstandingService } from './media-understanding.service';
import { SdrService } from './sdr.service';
import { InboundMessage } from './wa-payload';
import { OutgoingMessage, WaProviders } from './wa-providers';

/** Camada de WhatsApp do CRM (porte de `crm/whatsapp.server.ts`): conversas, envio com registro, recebimento e recibos. */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  readonly providers: WaProviders;
  private readonly sdrInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    http: ChannelHttp,
    private readonly secrets: ChannelSecrets,
    private readonly core: CrmCoreService,
    private readonly media: MediaUnderstandingService,
    private readonly sdr: SdrService,
  ) {
    this.providers = new WaProviders(http, (ws, name) => this.secrets.get(ws, name));
  }

  integration(workspaceId: string) {
    return this.prisma.crm_integrations.findFirst({ where: { workspace_id: workspaceId, kind: 'whatsapp' } });
  }

  async ensureConversation(args: { integration: Pick<Integration, 'workspace_id' | 'provider'>; phone: string; waId?: string | null; leadId?: string | null }) {
    const ws = args.integration.workspace_id;
    return this.prisma.crm_conversations.upsert({
      where: { workspace_id_phone: { workspace_id: ws, phone: args.phone } },
      create: { workspace_id: ws, lead_id: args.leadId ?? null, phone: args.phone, wa_id: args.waId ?? null, provider: args.integration.provider },
      update: {},
    });
  }

  windowOpen(conversation: { window_expires_at: Date | null }): boolean {
    return !!conversation.window_expires_at && conversation.window_expires_at.getTime() > Date.now();
  }

  /** Grava a mensagem de saída e a envia pelo provedor da empresa. Nunca envia a quem pediu para sair nem texto livre fora das 24 h (API oficial). */
  async sendAndStore(args: { integration: { workspace_id: string; provider: string; config: unknown }; conversationId: string; leadId: string | null; message: OutgoingMessage; sentBy?: string | null; authorType?: 'user' | 'ai' | 'system' }) {
    const ws = args.integration.workspace_id;
    if (args.leadId) {
      const lead = await this.prisma.crm_leads.findFirst({ where: { id: args.leadId, workspace_id: ws }, select: { unsubscribed: true } });
      if (lead?.unsubscribed) throw new UserFacingError('Lead descadastrado: envios bloqueados.');
    }
    const conv = await this.prisma.crm_conversations.findFirst({ where: { id: args.conversationId, workspace_id: ws }, select: { window_expires_at: true } });
    if (!conv) throw new UserFacingError('Conversa não encontrada.');
    if (args.integration.provider === 'whatsapp_cloud' && args.message.kind !== 'template' && !this.windowOpen(conv)) {
      throw new UserFacingError('Fora da janela de 24 horas: envie um template aprovado.');
    }
    const row = await this.prisma.crm_messages.create({
      data: {
        workspace_id: ws, conversation_id: args.conversationId, lead_id: args.leadId, direction: 'out',
        message_type: args.message.kind === 'template' ? 'template' : args.message.kind, body: args.message.body ?? null, media_url: args.message.mediaUrl ?? null,
        template_name: args.message.templateName ?? null, status: 'queued', sent_by: args.sentBy ?? null, author_type: args.authorType ?? 'user',
      },
      select: { id: true },
    });
    try {
      const { externalId } = await this.providers.send(args.integration, args.message);
      await this.prisma.crm_messages.update({ where: { id: row.id }, data: { status: 'sent', external_id: externalId } });
      await this.prisma.crm_conversations.update({ where: { id: args.conversationId }, data: { last_message_at: new Date(), last_message_preview: args.message.body ?? args.message.templateName ?? 'Mídia' } });
      return { id: row.id, externalId };
    } catch (err) {
      const detail = errText(err);
      this.logger.error(`falha ao enviar: ${detail}`);
      await this.prisma.crm_messages.update({ where: { id: row.id }, data: { status: 'failed', error_message: detail.slice(0, 500) } });
      throw new ProviderError('Não foi possível enviar a mensagem.');
    }
  }

  /** Mensagem enviada pelo usuário na tela do lead (`sendWhatsAppMessage`): respeita opt-out e a janela de 24 h; pausa a IA e encerra cadências. */
  async sendFromUser(userId: string, d: { workspaceId: string; leadId: string; kind: OutgoingMessage['kind']; body?: string; mediaUrl?: string; templateName?: string; templateLanguage?: string; templateParams?: string[] }) {
    const ws = d.workspaceId;
    const [integration, lead] = await Promise.all([
      this.integration(ws),
      this.prisma.crm_leads.findFirst({ where: { id: d.leadId, workspace_id: ws }, select: { id: true, phone: true, unsubscribed: true } }),
    ]);
    if (!integration || integration.status !== 'connected') throw new UserFacingError('Conecte o WhatsApp nas integrações do CRM.');
    if (!lead?.phone) throw new UserFacingError('Este lead não tem telefone cadastrado.');
    if (lead.unsubscribed) throw new UserFacingError('Lead descadastrado: envios bloqueados.');
    if (d.kind === 'text' && !d.body?.trim()) throw new UserFacingError('Escreva a mensagem.');
    if ((d.kind === 'image' || d.kind === 'audio') && !d.mediaUrl?.trim()) throw new UserFacingError('Informe a URL da mídia.');
    if (d.kind === 'template' && !d.templateName?.trim()) throw new UserFacingError('Escolha um template.');

    const conversation = await this.ensureConversation({ integration, phone: lead.phone, leadId: lead.id });
    if (integration.provider === 'whatsapp_cloud' && d.kind !== 'template' && !this.windowOpen(conversation)) {
      throw new UserFacingError('Fora da janela de 24 horas: envie um template aprovado.');
    }
    const result = await this.sendAndStore({
      integration, conversationId: conversation.id, leadId: lead.id, sentBy: userId, authorType: 'user',
      message: {
        to: lead.phone, kind: d.kind,
        ...(d.body !== undefined ? { body: d.body } : {}), ...(d.mediaUrl !== undefined ? { mediaUrl: d.mediaUrl } : {}),
        ...(d.templateName !== undefined ? { templateName: d.templateName } : {}), ...(d.templateLanguage !== undefined ? { templateLanguage: d.templateLanguage } : {}),
        ...(d.templateParams !== undefined ? { templateParams: d.templateParams } : {}),
      },
    });
    await this.prisma.crm_interactions.create({ data: { workspace_id: ws, lead_id: lead.id, kind: 'message_out', author_type: 'user', content: d.body ?? d.templateName ?? 'Mídia enviada' } });
    // Um humano respondeu: a IA é pausada e as cadências são encerradas.
    await this.prisma.crm_leads.update({ where: { id: lead.id }, data: { ai_active: false } });
    await this.core.stopCadences(ws, lead.id, 'human_takeover');
    return result;
  }

  /** Lead do número (com trava por número: duas mensagens simultâneas de um número novo não criam dois leads). */
  private async leadForPhone(integration: Integration, phone: string, msg: InboundMessage) {
    const ws = integration.workspace_id;
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wa-lead:${ws}:${phone}`}))`;
      const existing = await tx.crm_leads.findFirst({ where: { workspace_id: ws, phone } });
      if (existing) return { lead: existing, isNew: false };
      const { pipelineId, stageId } = await this.core.firstStage(ws);
      const ownerId = await this.core.pickOwner(ws);
      const lead = await tx.crm_leads.create({
        data: {
          workspace_id: ws, pipeline_id: pipelineId, stage_id: stageId, name: msg.profileName || phone, phone, wa_id: msg.waId ?? null,
          source: msg.referral?.adId ? 'click_to_whatsapp' : 'whatsapp', campaign_name: msg.referral?.campaignName ?? null, referral_ad_id: msg.referral?.adId ?? null, owner_id: ownerId,
        },
      });
      if (stageId) await tx.crm_stage_history.create({ data: { workspace_id: ws, lead_id: lead.id, from_stage_id: null, to_stage_id: stageId } });
      return { lead, isNew: true };
    });
    if (created.isNew) await this.core.startCadence(ws, created.lead.id, created.lead.source);
    else if (msg.referral?.adId && !created.lead.referral_ad_id) {
      await this.prisma.crm_leads.update({ where: { id: created.lead.id }, data: { referral_ad_id: msg.referral.adId, campaign_name: msg.referral.campaignName ?? created.lead.campaign_name, source: 'click_to_whatsapp' } });
    }
    return created.lead;
  }

  /** Guarda a mensagem recebida (criando o lead se o número é novo), trata opt-out, para cadências e aciona o SDR. */
  async handleInbound(integration: Integration, msg: InboundMessage): Promise<{ leadId?: string; conversationId?: string; ignored?: string }> {
    const ws = integration.workspace_id;
    const phone = normalizePhone(msg.from);
    if (!phone) return { ignored: 'telefone inválido' };

    const lead = await this.leadForPhone(integration, phone, msg);
    const conversation = await this.ensureConversation({ integration, phone, waId: msg.waId ?? null, leadId: lead.id });

    // Reentrega/reprocessamento do mesmo evento do provedor: já gravada, nenhum efeito colateral (contador, janela, cadência, SDR).
    if (msg.externalId && (await this.prisma.crm_messages.findFirst({ where: { workspace_id: ws, external_id: msg.externalId, direction: 'in' }, select: { id: true } }))) {
      return { leadId: lead.id, conversationId: conversation.id, ignored: 'mensagem duplicada' };
    }

    // Mídia da API oficial chega como id: baixa e guarda para aparecer na conversa e para o SDR entender.
    let mediaFile: { bytes: Buffer; mime: string } | null = null;
    if (!msg.mediaUrl && msg.mediaId && integration.provider === 'whatsapp_cloud') {
      try {
        const token = await this.secrets.get(ws, 'WHATSAPP_CLOUD_TOKEN');
        if (token) {
          mediaFile = await this.media.downloadCloudMedia(token, msg.mediaId);
          msg.mediaUrl = await this.media.store(ws, mediaFile.bytes, mediaFile.mime);
        }
      } catch (e) {
        this.logger.error(`mídia não baixada: ${errText(e)}`);
      }
    }

    try {
      await this.prisma.crm_messages.create({
        data: { workspace_id: ws, conversation_id: conversation.id, lead_id: lead.id, direction: 'in', message_type: msg.type, body: msg.body, media_url: msg.mediaUrl ?? null, status: 'received', external_id: msg.externalId, author_type: 'system' },
      });
    } catch (e) {
      // Índice único parcial (workspace, external_id) das recebidas: outra entrega da mesma mensagem ganhou a corrida.
      if ((e as { code?: string }).code === 'P2002') return { leadId: lead.id, conversationId: conversation.id, ignored: 'mensagem duplicada' };
      throw e;
    }
    await this.prisma.crm_conversations.update({
      where: { id: conversation.id },
      data: { lead_id: lead.id, unread_count: { increment: 1 }, last_message_at: new Date(), last_message_preview: msg.body ?? 'Mídia recebida', window_expires_at: new Date(Date.now() + WINDOW_MS) },
    });
    await this.core.addInteraction({ workspaceId: ws, leadId: lead.id, kind: 'message_in', authorType: 'system', content: msg.body ?? `Mídia recebida (${msg.type})` });

    const patch: Prisma.crm_leadsUpdateInput = {};
    if (!lead.first_response_at) patch.first_response_at = new Date();
    const optedOut = isOptOut(msg.body);
    if (optedOut) {
      patch.unsubscribed = true;
      patch.ai_active = false;
      await this.core.stopCadences(ws, lead.id, 'opt_out');
      await this.core.addInteraction({ workspaceId: ws, leadId: lead.id, kind: 'ai_action', authorType: 'system', content: 'Lead pediu para sair. Envios automáticos bloqueados.' });
    }
    if (Object.keys(patch).length) await this.prisma.crm_leads.update({ where: { id: lead.id }, data: patch });

    // Lead respondeu: a cadência para e a conversa volta para a IA ou para o responsável.
    if (!optedOut) {
      await this.core.stopCadences(ws, lead.id, 'replied');
      let text = msg.body ?? '';
      if (!text.trim() && (msg.type === 'audio' || msg.type === 'image') && (mediaFile || msg.mediaUrl)) {
        text = await this.media.describe(ws, mediaFile ?? msg.mediaUrl!, msg.type).catch(() => '');
      }
      await this.triggerSdr(integration, lead.id, conversation.id, text);
    }
    return { leadId: lead.id, conversationId: conversation.id };
  }

  /** Roda o agente SDR para a mensagem recebida e responde no WhatsApp. */
  private async triggerSdr(integration: Integration, leadId: string, conversationId: string, inboundText: string) {
    if (!inboundText.trim()) return;
    // Uma execução por lead por vez (instância única): duas mensagens simultâneas não geram duas respostas.
    // A mais recente já está no histórico e entra na próxima execução.
    const guardKey = `${integration.workspace_id}:${leadId}`;
    if (this.sdrInFlight.has(guardKey)) return;
    this.sdrInFlight.add(guardKey);
    try {
      const result = await this.sdr.run({ workspaceId: integration.workspace_id, leadId, conversationId, inboundText });
      const reply = ('reply' in result && result.reply) || null;
      if (!reply) return;
      const lead = await this.prisma.crm_leads.findFirst({ where: { id: leadId, workspace_id: integration.workspace_id }, select: { phone: true } });
      if (!lead?.phone) return;
      await this.sendAndStore({ integration, conversationId, leadId, message: { to: lead.phone, kind: 'text', body: reply }, authorType: 'ai' });
    } catch (err) {
      this.logger.error(`[sdr] falha ao responder o lead: ${errText(err)}`);
    } finally {
      this.sdrInFlight.delete(guardKey);
    }
  }

  /** Recibos de entrega/leitura da Cloud API. */
  async applyStatusUpdate(workspaceId: string, externalId: string, status: string) {
    const map: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
    const mapped = map[status];
    if (!mapped) return;
    await this.prisma.crm_messages.updateMany({ where: { workspace_id: workspaceId, external_id: externalId }, data: { status: mapped } });
  }
}
