import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { Integration } from '../webhooks/webhook-ledger.service';
import { errText } from './ig-store.service';
import { MetaGraphClient } from './meta-graph';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const convKey = (igsid: string) => `ig:${igsid}`;
const OPT_OUT_WORDS = ['sair', 'parar', 'descadastrar', 'stop'];
export const isOptOut = (text: string | null | undefined) => !!text && OPT_OUT_WORDS.includes(text.trim().toLowerCase().replace(/[.!]/g, ''));

export type InstagramConfig = {
  /** Palavra no comentário → DM automática (ex.: QUERO → link da oferta). */
  keywords?: { word: string; dm: string; publicReply?: string | null }[];
  /** Responder qualquer comentário com uma DM gerada pelo SDR. */
  aiReplyComments?: boolean;
};

export type IgInbound =
  | { kind: 'dm'; igsid: string; mid: string; text: string | null; attachmentUrl?: string | null; attachmentType?: string | null }
  | { kind: 'comment'; igsid: string; username: string | null; commentId: string; text: string; mediaId: string | null };

/**
 * Pontos de extensão do CRM que vivem na Task 8 (cadências, agente SDR, compreensão de áudio/imagem). Sem implementação o canal
 * grava lead/conversa/mensagem normalmente, só não dispara cadência nem resposta automática do SDR.
 */
export interface CrmChannelHooks {
  startCadence?(workspaceId: string, leadId: string, source: string): Promise<void>;
  stopCadences?(leadId: string, reason: 'opt_out' | 'replied'): Promise<unknown>;
  runSdr?(input: { workspaceId: string; leadId: string; conversationId?: string; inboundText: string }): Promise<{ reply?: string | null } | null>;
  describeMedia?(workspaceId: string, url: string, type: 'audio' | 'image'): Promise<string | null>;
}
export const CRM_CHANNEL_HOOKS = Symbol('CRM_CHANNEL_HOOKS');

/** Canal Instagram do CRM: Direct e comentários viram lead, entram na caixa de entrada e (com o SDR da Task 8) são respondidos. */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphClient,
    @Optional() @Inject(CRM_CHANNEL_HOOKS) private readonly hooks: CrmChannelHooks | null,
  ) {}

  private async pageToken(workspaceId: string) {
    const cfg = await this.graph.config(workspaceId);
    if (!cfg.pageId) throw new Error('Página do Facebook não configurada em Integrações.');
    const r = await this.graph.graph<{ access_token?: string }>(workspaceId, `/${cfg.pageId}`, { params: { fields: 'access_token' } });
    if (!r.access_token) throw new Error('Sem acesso à Página: dê ao usuário do sistema acesso total à Página.');
    return { pageId: cfg.pageId, token: r.access_token };
  }

  private async igProfile(workspaceId: string, igsid: string): Promise<{ name?: string; username?: string }> {
    try {
      const { token } = await this.pageToken(workspaceId);
      return await this.graph.graph(workspaceId, `/${igsid}`, { token, params: { fields: 'name,username' } });
    } catch {
      return {};
    }
  }

  /** Envia DM (recipient = IGSID) ou resposta privada a um comentário (recipient = comment_id). */
  async sendInstagramDm(workspaceId: string, recipient: { id: string } | { comment_id: string }, text: string) {
    const { pageId, token } = await this.pageToken(workspaceId);
    const r = await this.graph.graph<{ message_id?: string }>(workspaceId, `/${pageId}/messages`, { method: 'POST', token, params: { recipient, message: { text: text.slice(0, 1000) } } });
    return r.message_id ?? null;
  }

  private async replyToComment(workspaceId: string, commentId: string, text: string) {
    const { token } = await this.pageToken(workspaceId);
    await this.graph.graph(workspaceId, `/${commentId}/replies`, { method: 'POST', token, params: { message: text.slice(0, 300) } });
  }

  private async firstStage(workspaceId: string) {
    const pipeline = await this.prisma.crm_pipelines.findFirst({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'asc' }, select: { id: true } });
    if (!pipeline) return { pipelineId: null as string | null, stageId: null as string | null };
    const stage = await this.prisma.crm_stages.findFirst({ where: { pipeline_id: pipeline.id, workspace_id: workspaceId }, orderBy: { position: 'asc' }, select: { id: true } });
    return { pipelineId: pipeline.id, stageId: stage?.id ?? null };
  }

  /** Distribuição do CRM: dono fixo ou rodízio entre os membros. */
  private async pickOwner(workspaceId: string): Promise<string | null> {
    const [settings, members] = await Promise.all([
      this.prisma.crm_settings.findUnique({ where: { workspace_id: workspaceId }, select: { distribution: true, default_owner_id: true } }),
      this.prisma.workspace_members.findMany({ where: { workspace_id: workspaceId }, select: { user_id: true }, orderBy: { user_id: 'asc' } }),
    ]);
    if (settings?.distribution === 'fixed') return settings.default_owner_id ?? null;
    if (!members.length) return null;
    const count = await this.prisma.crm_leads.count({ where: { workspace_id: workspaceId } });
    return members[count % members.length]!.user_id;
  }

  private async addInteraction(workspaceId: string, leadId: string, content: string, metadata: Record<string, unknown> = {}) {
    await this.prisma.crm_interactions.create({ data: { workspace_id: workspaceId, lead_id: leadId, kind: 'message_in', author_type: 'system', content, metadata: metadata as Prisma.InputJsonObject } });
    await this.prisma.crm_leads.update({ where: { id: leadId }, data: { last_interaction_at: new Date() } });
  }

  private async findOrCreateLead(integration: Integration, igsid: string, username: string | null, source: 'instagram_dm' | 'instagram_comment') {
    const ws = integration.workspace_id;
    const existing = await this.prisma.crm_leads.findFirst({ where: { workspace_id: ws, instagram_id: igsid } });
    if (existing) return existing;
    const profile = username ? { username } : await this.igProfile(ws, igsid);
    const { pipelineId, stageId } = await this.firstStage(ws);
    const ownerId = await this.pickOwner(ws);
    const lead = await this.prisma.crm_leads.create({
      data: {
        workspace_id: ws,
        pipeline_id: pipelineId,
        stage_id: stageId,
        name: (profile as { name?: string }).name || (profile.username ? `@${profile.username}` : 'Lead do Instagram'),
        source,
        owner_id: ownerId,
        instagram_id: igsid,
        instagram_username: profile.username ?? null,
      },
    });
    if (stageId) await this.prisma.crm_stage_history.create({ data: { workspace_id: ws, lead_id: lead.id, from_stage_id: null, to_stage_id: stageId } });
    await this.hooks?.startCadence?.(ws, lead.id, source);
    return lead;
  }

  private async ensureIgConversation(workspaceId: string, igsid: string, leadId: string) {
    const existing = await this.prisma.crm_conversations.findUnique({ where: { workspace_id_phone: { workspace_id: workspaceId, phone: convKey(igsid) } } });
    if (existing) return existing;
    return this.prisma.crm_conversations.create({ data: { workspace_id: workspaceId, lead_id: leadId, phone: convKey(igsid), provider: 'instagram' } });
  }

  /** Grava e envia uma DM (bloqueia lead descadastrado e fora da janela de 24 h). */
  async sendInstagramAndStore(args: { workspaceId: string; leadId: string; text: string; sentBy?: string | null; authorType?: 'user' | 'ai' | 'system' }) {
    const lead = await this.prisma.crm_leads.findFirst({ where: { id: args.leadId, workspace_id: args.workspaceId }, select: { id: true, unsubscribed: true, instagram_id: true } });
    if (!lead?.instagram_id) throw new Error('Este lead não tem conversa no Instagram.');
    if (lead.unsubscribed) throw new Error('Lead descadastrado: envios bloqueados.');
    const conv = await this.ensureIgConversation(args.workspaceId, lead.instagram_id, lead.id);
    const expires = conv.window_expires_at ? conv.window_expires_at.getTime() : 0;
    if (expires <= Date.now()) throw new Error('Fora da janela de 24 horas do Instagram: espere o lead mandar mensagem.');
    const row = await this.prisma.crm_messages.create({
      data: { workspace_id: args.workspaceId, conversation_id: conv.id, lead_id: lead.id, direction: 'out', message_type: 'text', body: args.text, status: 'queued', sent_by: args.sentBy ?? null, author_type: args.authorType ?? 'user' },
      select: { id: true },
    });
    try {
      const externalId = await this.sendInstagramDm(args.workspaceId, { id: lead.instagram_id }, args.text);
      await this.prisma.crm_messages.update({ where: { id: row.id }, data: { status: 'sent', external_id: externalId } });
      await this.prisma.crm_conversations.update({ where: { id: conv.id }, data: { last_message_at: new Date(), last_message_preview: args.text.slice(0, 120) } });
      return { id: row.id, externalId };
    } catch (e) {
      const detail = errText(e);
      await this.prisma.crm_messages.update({ where: { id: row.id }, data: { status: 'failed', error_message: detail } });
      throw new Error(`Não foi possível enviar no Instagram: ${detail}`);
    }
  }

  private async replyWithSdr(integration: Integration, leadId: string, conversationId: string, text: string) {
    if (!text.trim() || !this.hooks?.runSdr) return;
    try {
      const r = await this.hooks.runSdr({ workspaceId: integration.workspace_id, leadId, conversationId, inboundText: text });
      if (r?.reply) await this.sendInstagramAndStore({ workspaceId: integration.workspace_id, leadId, text: r.reply, authorType: 'ai' });
    } catch (e) {
      this.logger.error(`[instagram-sdr] falha ao responder: ${errText(e)}`);
    }
  }

  async handleInstagramInbound(integration: Integration, msg: IgInbound) {
    const ws = integration.workspace_id;
    const source = msg.kind === 'dm' ? 'instagram_dm' : 'instagram_comment';
    const lead = await this.findOrCreateLead(integration, msg.igsid, msg.kind === 'comment' ? msg.username : null, source);
    const leadId = lead.id;

    if (msg.kind === 'comment') {
      await this.addInteraction(ws, leadId, `Comentou no Instagram: "${msg.text}"`, { comment_id: msg.commentId, media_id: msg.mediaId });
      if (lead.unsubscribed) return { leadId };
      const cfg = (integration.config ?? {}) as InstagramConfig;
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const rule = (cfg.keywords ?? []).find((k) => k.word && norm(msg.text).includes(norm(k.word)));
      let dm: string | null = rule?.dm ?? null;
      if (!dm && cfg.aiReplyComments && lead.ai_active !== false && this.hooks?.runSdr) {
        const r = await this.hooks.runSdr({ workspaceId: ws, leadId, inboundText: `[Comentário público no post] ${msg.text}` }).catch(() => null);
        dm = r?.reply || null;
      }
      if (dm) {
        // Resposta privada ao comentário abre a conversa no Direct.
        const externalId = await this.sendInstagramDm(ws, { comment_id: msg.commentId }, dm).catch((e) => {
          this.logger.error(`[instagram] resposta privada falhou: ${errText(e)}`);
          return null;
        });
        const conv = await this.ensureIgConversation(ws, msg.igsid, leadId);
        await this.prisma.crm_messages.create({
          data: { workspace_id: ws, conversation_id: conv.id, lead_id: leadId, direction: 'out', message_type: 'text', body: dm, status: externalId ? 'sent' : 'failed', external_id: externalId, author_type: rule ? 'system' : 'ai' },
        });
        if (rule?.publicReply) await this.replyToComment(ws, msg.commentId, rule.publicReply).catch(() => null);
      }
      return { leadId };
    }

    const conv = await this.ensureIgConversation(ws, msg.igsid, leadId);
    const type = msg.attachmentType === 'image' ? 'image' : msg.attachmentType === 'audio' ? 'audio' : msg.attachmentType === 'video' ? 'video' : msg.text ? 'text' : 'other';
    await this.prisma.crm_messages.create({
      data: { workspace_id: ws, conversation_id: conv.id, lead_id: leadId, direction: 'in', message_type: type, body: msg.text, media_url: msg.attachmentUrl ?? null, status: 'received', external_id: msg.mid, author_type: 'system' },
    });
    await this.prisma.crm_conversations.update({
      where: { id: conv.id },
      data: { lead_id: leadId, unread_count: (conv.unread_count ?? 0) + 1, last_message_at: new Date(), last_message_preview: msg.text ?? 'Mídia recebida', window_expires_at: new Date(Date.now() + WINDOW_MS) },
    });
    await this.addInteraction(ws, leadId, msg.text ?? `Mídia recebida no Direct (${type})`);
    const patch: Prisma.crm_leadsUpdateInput = { last_interaction_at: new Date() };
    if (!lead.first_response_at) patch.first_response_at = new Date();
    let optedOut = false;
    if (isOptOut(msg.text)) {
      patch.unsubscribed = true;
      patch.ai_active = false;
      optedOut = true;
      await this.hooks?.stopCadences?.(leadId, 'opt_out');
    }
    await this.prisma.crm_leads.update({ where: { id: leadId }, data: patch });
    if (optedOut) return { leadId };
    await this.hooks?.stopCadences?.(leadId, 'replied');
    let text = msg.text ?? '';
    if (!text && msg.attachmentUrl && (type === 'audio' || type === 'image') && this.hooks?.describeMedia) {
      text = (await this.hooks.describeMedia(ws, msg.attachmentUrl, type).catch(() => null)) ?? '';
    }
    await this.replyWithSdr(integration, leadId, conv.id, text);
    return { leadId };
  }
}
