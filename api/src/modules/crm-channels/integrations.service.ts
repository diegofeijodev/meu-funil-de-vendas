import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { notFound } from '../crm/crm-errors';
import { CrmCoreService } from '../crm/crm-core.service';
import { InboundService } from '../instagram/inbound.service';
import { Integration, WebhookLedgerService } from '../webhooks/webhook-ledger.service';
import { MetaGraphClient } from '../instagram/meta-graph';
import { VaultService } from '../vault/vault.service';
import { CalendarService } from './calendar.service';
import { ChannelHttp, ChannelSecrets, CHANNEL_SECRETS } from './channel-http';
import { friendly, ProviderError, UserFacingError } from './channel-errors';
import { errText } from './channel-common';
import { EmailService } from './email.service';
import { LeadgenService } from './leadgen.service';
import { WhatsAppService } from './whatsapp.service';

export const KIND_PROVIDERS: Record<string, string[]> = {
  meta_lead_ads: ['meta'], instagram: ['meta'], site_form: ['site'], email: ['resend'], calendar: ['calcom'], whatsapp: ['whatsapp_cloud', 'zapi', 'evolution'],
};
const SOURCE_KIND: Record<string, string> = { meta_leadgen: 'meta_lead_ads', whatsapp_message: 'whatsapp', instagram: 'instagram' };

/** Integrações do CRM (porte de `crm-integrations.functions.ts`). Autorização é do controller; aqui tudo é escopado pelo workspace. */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: ChannelHttp,
    private readonly secrets: ChannelSecrets,
    private readonly vault: VaultService,
    private readonly graph: MetaGraphClient,
    private readonly leadgen: LeadgenService,
    private readonly whatsapp: WhatsAppService,
    private readonly email: EmailService,
    private readonly calendar: CalendarService,
    private readonly instagram: InboundService,
    private readonly ledger: WebhookLedgerService,
    private readonly core: CrmCoreService,
  ) {}

  /** Lista as integrações; quem não é owner/admin não recebe os tokens do webhook. */
  async list(ws: string, canManage: boolean) {
    const rows = await this.prisma.crm_integrations.findMany({ where: { workspace_id: ws } });
    return rows.map((r) => (canManage ? r : { ...r, webhook_token: '', verify_token: '' }));
  }

  async save(ws: string, d: { kind: string; provider: string; config?: Record<string, unknown>; fieldMapping?: Record<string, string>; status?: string }) {
    if (!KIND_PROVIDERS[d.kind]?.includes(d.provider)) throw new UserFacingError('Combinação de canal e provedor inválida.');
    const base = d.config?.['base_url'];
    if ((d.provider === 'zapi' || d.provider === 'evolution') && typeof base === 'string' && base.trim()) this.http.userBase(base, 'URL base da instância');
    const existing = await this.prisma.crm_integrations.findUnique({ where: { workspace_id_kind: { workspace_id: ws, kind: d.kind } }, select: { config: true, field_mapping: true } });
    const row = {
      provider: d.provider,
      status: d.status ?? 'connecting',
      config: { ...((existing?.config as object) ?? {}), ...(d.config ?? {}) } as Prisma.InputJsonObject,
      field_mapping: { ...((existing?.field_mapping as object) ?? {}), ...(d.fieldMapping ?? {}) } as Prisma.InputJsonObject,
      last_error: null,
    };
    try {
      return await this.prisma.crm_integrations.upsert({
        where: { workspace_id_kind: { workspace_id: ws, kind: d.kind } },
        create: { workspace_id: ws, kind: d.kind, ...row },
        update: row,
        select: { id: true, webhook_token: true, verify_token: true, status: true },
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw friendly(e, 'Não foi possível salvar a integração.', this.logger);
    }
  }

  private byKind(ws: string, kind: string) {
    return this.prisma.crm_integrations.findUnique({ where: { workspace_id_kind: { workspace_id: ws, kind } } });
  }

  async test(ws: string, kind: string): Promise<{ ok: boolean; missing: string[]; error?: string }> {
    const integration = await this.byKind(ws, kind);
    if (!integration) throw new UserFacingError('Configure a integração antes de testar.');
    const meta = await this.graph.config(ws);
    const missing: string[] = [];
    const has = (n: string) => this.secrets.get(ws, n);
    if (kind === 'meta_lead_ads') {
      if (!meta.appSecret) missing.push('META_APP_SECRET');
      if (!meta.token) missing.push('META_SYSTEM_USER_TOKEN');
    } else if (kind === 'instagram') {
      if (!meta.appSecret) missing.push('META_APP_SECRET');
      if (!meta.token) missing.push('META_SYSTEM_USER_TOKEN');
      if (!meta.pageId) missing.push('META_PAGE_ID');
    } else if (kind === 'email') {
      if (!(await has('RESEND_API_KEY'))) missing.push('RESEND_API_KEY');
    } else if (kind === 'calendar') {
      if (!(await has('CALCOM_API_KEY'))) missing.push('CALCOM_API_KEY');
    } else if (kind === 'site_form') {
      // formulário próprio: sem credenciais externas
    } else if (integration.provider === 'whatsapp_cloud') {
      if (!(await has('WHATSAPP_CLOUD_TOKEN'))) missing.push('WHATSAPP_CLOUD_TOKEN');
      if (!meta.appSecret) missing.push('META_APP_SECRET');
    } else if (integration.provider === 'zapi') {
      if (!(await has('ZAPI_TOKEN'))) missing.push('ZAPI_TOKEN');
    } else if (integration.provider === 'evolution') {
      if (!(await has('EVOLUTION_API_KEY'))) missing.push('EVOLUTION_API_KEY');
    }
    if (missing.length) {
      await this.prisma.crm_integrations.update({ where: { id: integration.id }, data: { status: 'error', last_error: `Credenciais ausentes: ${missing.join(', ')}` } });
      return { ok: false, missing };
    }
    try {
      if (kind === 'meta_lead_ads' || kind === 'instagram') {
        await this.graph.graph(ws, '/me', { params: { fields: 'id,name' } });
        await this.leadgen.subscribePage(ws, kind === 'instagram' ? ['messages', 'feed'] : ['leadgen']);
      }
      if (kind === 'email') {
        const domains = await this.email.domains(ws);
        const from = String((integration.config as Record<string, unknown>)['from_email'] ?? '');
        const domain = from.split('@')[1]?.toLowerCase();
        const found = domains.find((d) => d.name.toLowerCase() === domain);
        if (!found) throw new Error(`O domínio ${domain || 'do remetente'} não está cadastrado no Resend.`);
        if (found.status !== 'verified') throw new Error(`O domínio ${domain} ainda não foi verificado no Resend (status: ${found.status}).`);
      }
      if (kind === 'calendar') await this.calendar.test(ws, String((integration.config as Record<string, unknown>)['event_type_id'] ?? ''));
      if (kind === 'whatsapp' && integration.provider === 'whatsapp_cloud') await this.whatsapp.providers.listTemplates(integration);
      await this.prisma.crm_integrations.update({ where: { id: integration.id }, data: { status: 'connected', last_error: null, last_event_at: new Date() } });
      return { ok: true, missing: [] };
    } catch (err) {
      const detail = errText(err);
      this.logger.error(`teste falhou: ${detail}`);
      await this.prisma.crm_integrations.update({ where: { id: integration.id }, data: { status: 'error', last_error: detail.slice(0, 500) } });
      return { ok: false, missing: [], error: detail };
    }
  }

  async disconnect(ws: string, kind: string) {
    await this.prisma.crm_integrations.updateMany({ where: { workspace_id: ws, kind }, data: { status: 'disconnected', last_error: null } });
    return { ok: true };
  }

  async loadMetaFormFields(ws: string, formId: string) {
    try {
      return await this.leadgen.listFormFields(ws, formId);
    } catch (e) {
      throw friendly(e, 'Não foi possível carregar os campos do formulário.', this.logger);
    }
  }

  async syncTemplates(ws: string) {
    const integration = await this.byKind(ws, 'whatsapp');
    if (!integration || integration.provider !== 'whatsapp_cloud') throw new UserFacingError('Templates existem apenas na API oficial do WhatsApp.');
    try {
      const templates = await this.whatsapp.providers.listTemplates(integration);
      if (templates.length) {
        await this.prisma.$transaction(
          templates.map((t) =>
            this.prisma.crm_wa_templates.upsert({
              where: { workspace_id_name_language: { workspace_id: ws, name: t.name, language: t.language } },
              create: { workspace_id: ws, name: t.name, language: t.language, category: t.category, status: t.status, body_preview: t.body, variables: t.variables },
              update: { category: t.category, status: t.status, body_preview: t.body, variables: t.variables, synced_at: new Date() },
            }),
          ),
        );
      }
      return { count: templates.length };
    } catch (e) {
      throw friendly(e, 'Não foi possível sincronizar os templates.', this.logger);
    }
  }

  async importCostsNow(ws: string) {
    const integration = await this.byKind(ws, 'meta_lead_ads');
    if (!integration) throw new UserFacingError('Conecte o Meta Lead Ads primeiro.');
    try {
      return { imported: await this.leadgen.importCosts(ws, integration.config as Record<string, unknown>, 'last_7d') };
    } catch (e) {
      throw friendly(e, 'Não foi possível importar os custos das campanhas.', this.logger);
    }
  }

  async saveSecret(ws: string, key: string, value: string) {
    if (!(CHANNEL_SECRETS as readonly string[]).includes(key)) throw new UserFacingError('Credencial inválida.');
    if (!value || value.trim().length < 8) throw new UserFacingError('Valor muito curto.');
    try {
      await this.vault.set(ws, { [key]: value.trim() });
    } catch (e) {
      throw friendly(e, 'Não foi possível salvar a credencial.', this.logger);
    }
    return { ok: true };
  }

  async secretsStatus(ws: string) {
    const out: Record<string, string> = {};
    for (const k of CHANNEL_SECRETS) out[k] = await this.secrets.source(ws, k);
    return out;
  }

  listFailedEvents(ws: string) {
    return this.prisma.crm_webhook_events.findMany({
      where: { workspace_id: ws, status: 'failed' }, orderBy: { created_at: 'desc' }, take: 50,
      select: { id: true, source: true, external_id: true, error_message: true, created_at: true },
    });
  }

  async reprocess(ws: string, eventId: string) {
    const ev = await this.prisma.crm_webhook_events.findFirst({ where: { id: eventId, workspace_id: ws } });
    if (!ev) throw new UserFacingError('Evento não encontrado.');
    const kind = SOURCE_KIND[ev.source];
    if (!kind) throw new UserFacingError('Este tipo de evento não pode ser reprocessado.');
    const integration = (await this.byKind(ws, kind)) as unknown as Integration | null;
    if (!integration) throw new UserFacingError('Integração não encontrada.');
    try {
      if (kind === 'meta_lead_ads') await this.leadgen.ingest(integration, String(ev.external_id));
      else if (kind === 'whatsapp') await this.whatsapp.handleInbound(integration, ev.payload as never);
      else await this.instagram.handleInstagramInbound(integration, ev.payload as never);
      await this.ledger.finishEvent(ev.id, null);
      return { ok: true };
    } catch (e) {
      const detail = errText(e);
      await this.ledger.finishEvent(ev.id, detail);
      throw new ProviderError(detail);
    }
  }

  async sendInstagram(userId: string, ws: string, leadId: string, body: string) {
    const lead = await this.prisma.crm_leads.findFirst({ where: { id: leadId, workspace_id: ws }, select: { id: true } });
    if (!lead) throw notFound('Lead não encontrado.');
    let r;
    try {
      r = await this.instagram.sendInstagramAndStore({ workspaceId: ws, leadId, text: body.trim(), sentBy: userId, authorType: 'user' });
    } catch (e) {
      throw new UserFacingError(errText(e));
    }
    await this.prisma.crm_leads.update({ where: { id: leadId }, data: { ai_active: false } });
    await this.core.stopCadences(ws, leadId, 'human_takeover');
    return r;
  }

  async sendEmail(ws: string, leadId: string, subject: string, body: string) {
    try {
      return await this.email.sendLeadEmail({ workspaceId: ws, leadId, subject: subject.trim(), body: body.trim(), authorType: 'user' });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ProviderError(errText(e));
    }
  }
}
