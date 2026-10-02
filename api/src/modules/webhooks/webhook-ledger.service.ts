import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { VaultService } from '../vault/vault.service';

export type IntegrationKind = 'meta_lead_ads' | 'whatsapp' | 'instagram' | 'site_form';
export type Integration = {
  id: string;
  workspace_id: string;
  kind: string;
  provider: string;
  status: string;
  config: Record<string, unknown>;
  field_mapping: Record<string, unknown>;
  webhook_token: string;
  verify_token: string;
};

const STALE_MS = 10 * 60e3;

/**
 * Peças compartilhadas pelos webhooks da Meta (Instagram, WhatsApp Cloud, Lead Ads): integração pelo token da URL,
 * assinatura `x-hub-signature-256` e o livro de eventos `crm_webhook_events` (idempotência por `(source, external_id)`).
 */
@Injectable()
export class WebhookLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    @Inject(ENV) private readonly env: Pick<Env, 'META_APP_SECRET'>,
  ) {}

  async integrationByToken(token: string, kind: IntegrationKind): Promise<Integration | null> {
    if (!token || token.length > 200) return null;
    const row = await this.prisma.crm_integrations.findUnique({ where: { webhook_token: token } });
    return row && row.kind === kind ? (row as unknown as Integration) : null;
  }

  private matches(rawBody: string, header: string, secret: string): boolean {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(header.slice(7));
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Aceita o App Secret do ambiente ou o salvo em Integrações (da empresa, depois o global). */
  async verifyMetaSignatureFor(rawBody: string, header: string | undefined | null, workspaceId: string | null): Promise<boolean> {
    if (!header?.startsWith('sha256=')) return false;
    if (this.env.META_APP_SECRET && this.matches(rawBody, header, this.env.META_APP_SECRET)) return true;
    const secret = (workspaceId ? await this.vault.get(workspaceId, 'META_APP_SECRET') : null) ?? (await this.vault.get(null, 'META_APP_SECRET'));
    return !!secret && this.matches(rawBody, header, secret);
  }

  /**
   * Reserva um evento de webhook para processar. Devolve o id do registro, ou null se já foi processado (ou está em
   * processamento agora). Eventos que falharam, ou que travaram em "processing" há mais de 10 min, são reprocessados no reenvio.
   */
  async claimEvent(args: { workspaceId: string | null; source: string; externalId?: string | null; payload?: unknown }): Promise<string | null> {
    try {
      const row = await this.prisma.crm_webhook_events.create({
        data: { workspace_id: args.workspaceId, source: args.source, external_id: args.externalId ?? null, payload: (args.payload ?? undefined) as never, status: 'processing' },
        select: { id: true },
      });
      return row.id;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
    if (!args.externalId) return null;
    const existing = await this.prisma.crm_webhook_events.findFirst({ where: { source: args.source, external_id: args.externalId }, select: { id: true, status: true, created_at: true } });
    if (!existing) return null;
    const stale = existing.status === 'processing' && Date.now() - existing.created_at.getTime() > STALE_MS;
    if (existing.status !== 'failed' && !stale) return null;
    const reclaimed = await this.prisma.crm_webhook_events.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { status: 'processing', error_message: null, created_at: new Date() },
    });
    return reclaimed.count ? existing.id : null;
  }

  async finishEvent(id: string, error: string | null) {
    await this.prisma.crm_webhook_events.update({ where: { id }, data: { status: error ? 'failed' : 'processed', error_message: error } });
  }

  async touchIntegration(id: string, patch: { status?: string; last_error?: string | null }) {
    await this.prisma.crm_integrations.update({ where: { id }, data: { last_event_at: new Date(), ...patch } });
  }
}
