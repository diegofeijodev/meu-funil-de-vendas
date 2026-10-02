import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { CrmDefaultsService } from '../crm-defaults/crm-defaults.service';
import { Integration } from '../webhooks/webhook-ledger.service';
import { CrmCoreService, normalizePhone } from './crm-core.service';

export class FormError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const MIN_FILL_MS = 2500;
export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 10 * 60e3;

const pick = (b: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = b[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
};

/**
 * Recebe o envio do formulário do site, aplica o anti-spam (campo isca, tempo mínimo de 2,5 s, 5 envios por 10 min por IP
 * com hash) e cria/atualiza o lead com origem "site" (porte de `ingestSiteLead`). O IP vem do `request.ip` do Fastify
 * (que só confia em `X-Forwarded-For` com `TRUST_PROXY=true`) — nunca de um cabeçalho cru.
 */
@Injectable()
export class SiteFormService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CrmCoreService,
    private readonly defaults: CrmDefaultsService,
  ) {}

  async ingest(integration: Integration, body: Record<string, unknown>, ip: string | null, now = Date.now()): Promise<{ spam?: true; leadId?: string; duplicated?: boolean }> {
    const ws = integration.workspace_id;
    // Campo isca preenchido = robô. Responde "ok" sem gravar nada.
    if (pick(body, ['website', 'url_hp'])) return { spam: true };
    const started = Number(body['_t'] ?? 0);
    if (started && now - started < MIN_FILL_MS) return { spam: true };

    const ipHash = ip ? createHash('sha256').update(`${integration.id}:${ip}`).digest('hex').slice(0, 32) : null;
    if (ipHash) {
      const count = await this.prisma.crm_webhook_events.count({
        where: { source: 'site_form', payload: { path: ['ip'], equals: ipHash }, created_at: { gte: new Date(now - RATE_WINDOW_MS) } },
      });
      if (count >= RATE_LIMIT) throw new FormError('Muitos envios seguidos. Tente de novo em alguns minutos.', 429);
    }

    const name = pick(body, ['name', 'nome', 'full_name', 'fullname', 'first_name']) ?? 'Lead do site';
    const emailRaw = pick(body, ['email', 'e-mail', 'mail']);
    const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null;
    const phone = normalizePhone(pick(body, ['phone', 'telefone', 'whatsapp', 'celular', 'tel']));
    if (!email && !phone) throw new FormError('Informe um e-mail válido ou um telefone.');
    const message = pick(body, ['message', 'mensagem', 'msg', 'comentario']);
    const utm = {
      utm_source: pick(body, ['utm_source']),
      utm_medium: pick(body, ['utm_medium']),
      utm_campaign: pick(body, ['utm_campaign']),
    };
    const page = pick(body, ['page', 'pagina', 'url']);

    await this.prisma.crm_webhook_events.create({
      data: { workspace_id: ws, source: 'site_form', payload: { ip: ipHash, page } as Prisma.InputJsonObject, status: 'processed' },
    });

    const existing = await this.core.findLead(ws, phone, email);
    if (existing) {
      await this.core.addInteraction({
        workspaceId: ws,
        leadId: existing.id,
        kind: 'message_in',
        authorType: 'contact',
        content: `Preencheu o formulário do site novamente${message ? `: "${message}"` : '.'}`,
        metadata: { page, ...utm },
      });
      return { leadId: existing.id, duplicated: true };
    }

    await this.defaults.ensure(ws);
    const { pipelineId, stageId } = await this.core.firstStage(ws);
    const ownerId = await this.core.pickOwner(ws);
    const content = `Lead do formulário do site${message ? `: "${message}"` : '.'}${page ? ` Página: ${page}` : ''}`;
    const leadId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.crm_leads.create({
        data: {
          workspace_id: ws,
          pipeline_id: pipelineId,
          stage_id: stageId,
          name,
          email,
          phone,
          source: 'site',
          owner_id: ownerId,
          ...utm,
          lgpd_consent: true,
          lgpd_consent_at: new Date(),
          last_interaction_at: new Date(),
        },
        select: { id: true },
      });
      if (stageId) await tx.crm_stage_history.create({ data: { workspace_id: ws, lead_id: created.id, from_stage_id: null, to_stage_id: stageId } });
      await tx.crm_interactions.create({
        data: { workspace_id: ws, lead_id: created.id, kind: 'message_in', author_type: 'system', content, metadata: { page, ...utm } as Prisma.InputJsonObject },
      });
      return created.id;
    });
    await this.core.startCadence(ws, leadId, 'site');
    return { leadId, duplicated: false };
  }
}
