import { Controller, Get, Headers, HttpCode, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator';
import { Integration, IntegrationKind, WebhookLedgerService } from '../webhooks/webhook-ledger.service';
import { errText } from './channel-common';
import { ChannelSecrets } from './channel-http';
import { LeadgenService } from './leadgen.service';
import { parseCloudPayload, parseUnofficialPayload } from './wa-payload';
import { WhatsAppService } from './whatsapp.service';

export const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/** GET de verificação da Meta: `hub.mode=subscribe` + `hub.verify_token` igual (tempo constante) ao da integração. */
async function verify(ledger: WebhookLedgerService, token: string, kind: IntegrationKind, q: Record<string, string>, reply: FastifyReply) {
  const integration = await ledger.integrationByToken(token, kind);
  if (!integration || q['hub.mode'] !== 'subscribe' || !safeEqual(String(q['hub.verify_token'] ?? ''), integration.verify_token)) {
    reply.status(403);
    return 'Forbidden';
  }
  reply.header('Content-Type', 'text/plain');
  return String(q['hub.challenge'] ?? '');
}

const headerOf = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h) ?? '';

/**
 * Webhook do WhatsApp (Cloud API, Z-API e Evolution). Cloud: assinatura `x-hub-signature-256` do corpo bruto. Z-API/Evolution não assinam:
 * vale o token da URL (comparado em tempo constante pelo cofre) e, se a empresa salvou `WHATSAPP_WEBHOOK_SECRET`, o cabeçalho
 * `x-webhook-secret` / `Client-Token` / `apikey` / `Authorization: Bearer` também precisa bater.
 */
@Public()
@SkipThrottle()
@Controller('api/public/webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);
  constructor(private readonly ledger: WebhookLedgerService, private readonly wa: WhatsAppService, private readonly secrets: ChannelSecrets) {}

  @Get(':token')
  get(@Param('token') token: string, @Query() q: Record<string, string>, @Res({ passthrough: true }) reply: FastifyReply) {
    return verify(this.ledger, token, 'whatsapp', q, reply);
  }

  private async secretOk(integration: Integration, h: Record<string, string | string[] | undefined>): Promise<boolean> {
    const secret = await this.secrets.get(integration.workspace_id, 'WHATSAPP_WEBHOOK_SECRET');
    if (!secret) return true;
    const given = [h['x-webhook-secret'], h['client-token'], h['apikey'], headerOf(h['authorization']).replace(/^Bearer\s+/i, '')].map(headerOf);
    return given.some((g) => safeEqual(g, secret));
  }

  @Post(':token') @HttpCode(200)
  async post(@Param('token') token: string, @Headers() headers: Record<string, string | string[] | undefined>, @Req() req: FastifyRequest & { rawBody?: Buffer }, @Res({ passthrough: true }) reply: FastifyReply) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
    const integration = await this.ledger.integrationByToken(token, 'whatsapp');
    if (!integration) { reply.status(404); return 'Not found'; }
    if (integration.provider === 'whatsapp_cloud') {
      if (!raw || !(await this.ledger.verifyMetaSignatureFor(raw, headerOf(headers['x-hub-signature-256']), integration.workspace_id))) {
        this.logger.error('assinatura inválida');
        reply.status(401);
        return 'Invalid signature';
      }
    } else if (!(await this.secretOk(integration, headers))) {
      reply.status(401);
      return 'Invalid secret';
    }
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(raw); } catch { reply.status(400); return 'Bad request'; }
    if (!payload || typeof payload !== 'object') { reply.status(400); return 'Bad request'; }

    const { inbound, statuses } = integration.provider === 'whatsapp_cloud' ? parseCloudPayload(payload) : { inbound: parseUnofficialPayload(payload), statuses: [] };
    for (const msg of inbound) {
      const eventId = await this.ledger.claimEvent({ workspaceId: integration.workspace_id, source: 'whatsapp_message', externalId: msg.externalId, payload: msg });
      if (!eventId) continue;
      try {
        await this.wa.handleInbound(integration, msg);
        await this.ledger.finishEvent(eventId, null);
        await this.ledger.touchIntegration(integration.id, { status: 'connected', last_error: null });
      } catch (err) {
        const detail = errText(err);
        this.logger.error(`falha ao processar mensagem: ${detail}`);
        await this.ledger.finishEvent(eventId, detail);
        await this.ledger.touchIntegration(integration.id, { status: 'error', last_error: detail });
      }
    }
    for (const s of statuses) await this.wa.applyStatusUpdate(integration.workspace_id, s.id, s.status);
    return 'ok';
  }
}

/** Webhook do Meta Lead Ads (`leadgen`). Assinatura obrigatória; falha em algum lead = 500 (a Meta reenvia). */
@Public()
@SkipThrottle()
@Controller('api/public/webhooks/meta/leadgen')
export class LeadgenWebhookController {
  private readonly logger = new Logger(LeadgenWebhookController.name);
  constructor(private readonly ledger: WebhookLedgerService, private readonly leadgen: LeadgenService) {}

  @Get(':token')
  get(@Param('token') token: string, @Query() q: Record<string, string>, @Res({ passthrough: true }) reply: FastifyReply) {
    return verify(this.ledger, token, 'meta_lead_ads', q, reply);
  }

  @Post(':token') @HttpCode(200)
  async post(@Param('token') token: string, @Headers('x-hub-signature-256') sig: string | undefined, @Req() req: FastifyRequest & { rawBody?: Buffer }, @Res({ passthrough: true }) reply: FastifyReply) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
    const integration = await this.ledger.integrationByToken(token, 'meta_lead_ads');
    if (!integration) { reply.status(404); return 'Not found'; }
    if (!raw || !(await this.ledger.verifyMetaSignatureFor(raw, sig, integration.workspace_id))) {
      this.logger.error('assinatura inválida');
      reply.status(401);
      return 'Invalid signature';
    }
    let payload: { entry?: { changes?: { value?: Record<string, unknown> }[] }[] };
    try { payload = JSON.parse(raw); } catch { reply.status(400); return 'Bad request'; }
    let failed = false;
    for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
      for (const change of entry.changes ?? []) {
        const leadgenId = String(change.value?.['leadgen_id'] ?? '');
        if (!leadgenId) continue;
        const eventId = await this.ledger.claimEvent({ workspaceId: integration.workspace_id, source: 'meta_leadgen', externalId: leadgenId, payload: change.value });
        if (!eventId) continue;
        try {
          await this.leadgen.ingest(integration, leadgenId);
          await this.ledger.finishEvent(eventId, null);
          await this.ledger.touchIntegration(integration.id, { status: 'connected', last_error: null });
        } catch (err) {
          const detail = errText(err);
          this.logger.error(`falha ao processar lead: ${detail}`);
          failed = true;
          await this.ledger.finishEvent(eventId, detail);
          await this.ledger.touchIntegration(integration.id, { status: 'error', last_error: detail });
        }
      }
    }
    if (failed) { reply.status(500); return 'retry later'; }
    return 'ok';
  }
}
