import { Controller, Get, HttpCode, Inject, Logger, Options, Param, Post, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { Public } from '../../common/decorators/public.decorator';
import { Integration, WebhookLedgerService } from '../webhooks/webhook-ledger.service';
import { embedScript, formConfig, renderFormHtml } from './site-form.render';
import { FormError, SiteFormService } from './site-form.service';
import { UnsubscribeService } from './unsubscribe.service';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** O formulário é feito para ser embutido em iframe de OUTROS sites: libera `frame-ancestors` (o helmet global bloquearia). */
const FORM_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src * data:; connect-src 'self'; form-action 'self'; frame-ancestors *; base-uri 'none'";
const TOKEN_RE = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_FIELD = 10_000;

const unsubscribePage = (msg: string) =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Descadastro</title><body style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;text-align:center"><p style="font-size:17px">${msg}</p></body></html>`;

/** Lê o corpo de um POST de formulário: JSON, urlencoded (já parseados pelo Fastify) ou multipart (campos de texto). */
async function readBody(req: FastifyRequest): Promise<Record<string, unknown>> {
  if (req.isMultipart?.()) {
    const out: Record<string, unknown> = {};
    for await (const part of req.parts()) {
      if (part.type === 'field' && typeof part.value === 'string') out[part.fieldname] = part.value.slice(0, MAX_FIELD);
      else if (part.type === 'file') part.file.resume();
    }
    return out;
  }
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('corpo inválido');
  return b as Record<string, unknown>;
}

/** Rotas públicas do CRM (sem JWT): formulário do site (página, script de embed, recebimento) e descadastro. */
@Public()
@SkipThrottle()
@Controller('api/public')
export class CrmPublicController {
  private readonly logger = new Logger(CrmPublicController.name);

  constructor(
    private readonly ledger: WebhookLedgerService,
    private readonly forms: SiteFormService,
    private readonly unsubscribe: UnsubscribeService,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_URL'>,
  ) {}

  private async integration(token: string): Promise<Integration | null> {
    const i = await this.ledger.integrationByToken(token, 'site_form');
    return !i || i.status === 'disconnected' ? null : i;
  }

  @Options('forms/:token')
  preflight(@Res() reply: FastifyReply) {
    return reply.status(204).headers(CORS).send();
  }

  /** `<script src=".../api/public/forms/embed/TOKEN">`: o token só monta a URL do iframe (não é validado no banco). */
  @Get('forms/embed/:token')
  embed(@Param('token') token: string, @Res() reply: FastifyReply) {
    if (!TOKEN_RE.test(token)) return reply.status(404).headers(CORS).send({ error: 'Formulário não encontrado.' });
    const origin = this.env.APP_URL.replace(/\/+$/, '');
    return reply
      .status(200)
      .headers({ ...CORS, 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
      .send(embedScript(token, origin));
  }

  @Get('forms/:token')
  async form(@Param('token') token: string, @Res() reply: FastifyReply) {
    const integration = await this.integration(token);
    if (!integration) return reply.status(404).header('Content-Type', 'text/plain; charset=utf-8').send('Formulário não encontrado');
    // o helmet global grava X-Frame-Options direto no `res` cru: tira de lá (e do reply) para o iframe de outros sites funcionar
    reply.raw?.removeHeader('x-frame-options');
    reply.removeHeader('x-frame-options');
    return reply
      .status(200)
      .headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': FORM_CSP })
      .send(renderFormHtml(token, formConfig(integration)));
  }

  @Post('forms/:token') @HttpCode(200)
  async submit(@Param('token') token: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const integration = await this.integration(token);
    if (!integration) return reply.status(404).headers(CORS).send({ error: 'Formulário não encontrado.' });

    const type = String(req.headers['content-type'] ?? '');
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      return reply.status(400).headers(CORS).send({ error: 'Dados inválidos.' });
    }
    try {
      await this.forms.ingest(integration, body, req.ip ?? null);
      await this.ledger.touchIntegration(integration.id, { status: 'connected', last_error: null });
      const cfg = formConfig(integration);
      // Envio de formulário HTML comum (sem JS): redireciona para a página de obrigado.
      if (!type.includes('application/json') && cfg.redirect_url) return reply.status(303).header('Location', cfg.redirect_url).send();
      return reply.status(200).headers(CORS).send({ ok: true, redirect: cfg.redirect_url });
    } catch (e) {
      if (e instanceof FormError) return reply.status(e.status).headers(CORS).send({ error: e.message });
      this.logger.error(`[site-form] ${e instanceof Error ? e.message : e}`);
      return reply.status(500).headers(CORS).send({ error: 'Não foi possível enviar agora.' });
    }
  }

  @Get('unsubscribe/:leadId')
  async unsubscribeLead(@Param('leadId') leadId: string, @Query('t') t: string | undefined, @Res() reply: FastifyReply) {
    const result = await this.unsubscribe.unsubscribe(leadId, typeof t === 'string' ? t : undefined);
    const msg = result === 'ok' ? 'Pronto. Você não receberá mais nossos e-mails.' : 'Link inválido ou expirado.';
    return reply.status(200).headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).send(unsubscribePage(msg));
  }
}
