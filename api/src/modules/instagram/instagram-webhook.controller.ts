import { Controller, Get, HttpCode, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookLedgerService } from '../webhooks/webhook-ledger.service';
import { errText } from './ig-store.service';
import { IgInbound, InboundService } from './inbound.service';

type IgEntry = {
  id?: string;
  messaging?: {
    sender?: { id?: string };
    timestamp?: number;
    message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: { type?: string; payload?: { url?: string } }[] };
  }[];
  changes?: { field?: string; value?: { id?: string; text?: string; from?: { id?: string; username?: string }; media?: { id?: string } } }[];
};

/** Eventos do payload da Meta (`object=instagram`): Direct (ignora eco e mensagens da própria conta) e comentários. */
export function extractEvents(payload: { entry?: IgEntry[] }): { id: string; msg: IgInbound }[] {
  const events: { id: string; msg: IgInbound }[] = [];
  for (const entry of payload.entry ?? []) {
    const ownId = String(entry.id ?? '');
    for (const m of entry.messaging ?? []) {
      const sender = String(m.sender?.id ?? '');
      if (!m.message || m.message.is_echo || !sender || sender === ownId) continue;
      const att = m.message.attachments?.[0];
      events.push({
        id: String(m.message.mid ?? `${sender}:${m.timestamp}`),
        msg: { kind: 'dm', igsid: sender, mid: String(m.message.mid ?? ''), text: m.message.text ?? null, attachmentUrl: att?.payload?.url ?? null, attachmentType: att?.type ?? null },
      });
    }
    for (const ch of entry.changes ?? []) {
      if (ch.field !== 'comments' || !ch.value?.id) continue;
      const from = ch.value.from;
      if (!from?.id || from.id === ownId) continue;
      events.push({
        id: `comment:${ch.value.id}`,
        msg: { kind: 'comment', igsid: String(from.id), username: from.username ?? null, commentId: String(ch.value.id), text: String(ch.value.text ?? ''), mediaId: ch.value.media?.id ?? null },
      });
    }
  }
  return events;
}

/**
 * Webhook do Instagram (objeto "instagram" no app da Meta). Público; o segredo é o token da URL
 * (`crm_integrations.webhook_token`, `kind=instagram`) + a assinatura `x-hub-signature-256` do corpo bruto.
 * GET = verificação (`hub.verify_token`); POST = Direct e comentários. Falha em algum evento = 500 (a Meta reenvia).
 */
@Public()
@SkipThrottle()
@Controller('api/public/webhooks/instagram')
export class InstagramWebhookController {
  private readonly logger = new Logger(InstagramWebhookController.name);

  constructor(
    private readonly ledger: WebhookLedgerService,
    private readonly inbound: InboundService,
  ) {}

  @Get(':token')
  async verify(@Param('token') token: string, @Query() q: Record<string, string>, @Res({ passthrough: true }) reply: FastifyReply) {
    const integration = await this.ledger.integrationByToken(token, 'instagram');
    const given = Buffer.from(String(q['hub.verify_token'] ?? ''));
    const stored = Buffer.from(integration?.verify_token ?? '');
    const same = stored.length > 0 && given.length === stored.length && timingSafeEqual(given, stored);
    if (!integration || q['hub.mode'] !== 'subscribe' || !same) {
      reply.status(403);
      return 'Forbidden';
    }
    reply.header('Content-Type', 'text/plain');
    return String(q['hub.challenge'] ?? '');
  }

  @Post(':token') @HttpCode(200)
  async receive(@Param('token') token: string, @Req() req: FastifyRequest & { rawBody?: Buffer }, @Res({ passthrough: true }) reply: FastifyReply) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
    const integration = await this.ledger.integrationByToken(token, 'instagram');
    if (!integration) {
      reply.status(404);
      return 'Not found';
    }
    const sig = req.headers['x-hub-signature-256'];
    if (!raw || !(await this.ledger.verifyMetaSignatureFor(raw, Array.isArray(sig) ? sig[0] : sig, integration.workspace_id))) {
      reply.status(401);
      return 'Invalid signature';
    }
    let payload: { entry?: IgEntry[] };
    try {
      payload = JSON.parse(raw);
    } catch {
      reply.status(400);
      return 'Bad request';
    }
    let failed = false;
    for (const ev of extractEvents(payload)) {
      const eventId = await this.ledger.claimEvent({ workspaceId: integration.workspace_id, source: 'instagram', externalId: ev.id, payload: ev.msg });
      if (!eventId) continue;
      try {
        await this.inbound.handleInstagramInbound(integration, ev.msg);
        await this.ledger.finishEvent(eventId, null);
        await this.ledger.touchIntegration(integration.id, { status: 'connected', last_error: null });
      } catch (err) {
        const detail = errText(err);
        this.logger.error(`[instagram-webhook] ${detail}`);
        failed = true;
        await this.ledger.finishEvent(eventId, detail);
        await this.ledger.touchIntegration(integration.id, { status: 'error', last_error: detail });
      }
    }
    if (failed) {
      reply.status(500);
      return 'retry later';
    }
    return 'ok';
  }
}
