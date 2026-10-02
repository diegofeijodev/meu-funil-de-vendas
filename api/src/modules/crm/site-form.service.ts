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
/** Teto grosseiro por integração (qualquer IP) na mesma janela: rede de segurança se o limite por IP for contornado. */
export const INTEGRATION_CAP = 60;

/** Limites de tamanho dos campos livres (o corpo é público: sem eles um envio gravaria megabytes no lead). */
const MAX = { name: 300, email: 320, phone: 40, message: 2000, page: 2000, utm: 200 };

const pick = (b: Record<string, unknown>, keys: string[], max = 2000) => {
  for (const k of keys) {
    const v = b[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, max);
  }
  return null;
};

/**
 * Recebe o envio do formulário do site, aplica o anti-spam (campo isca, tempo mínimo de 2,5 s, 5 envios por 10 min por IP
 * com hash) e cria/atualiza o lead com origem "site" (porte de `ingestSiteLead`). O IP vem do `request.ip` do Fastify
 * (que só confia em `X-Forwarded-For` conforme `TRUST_PROXY`: número de saltos ou lista de proxies; `true` é inseguro) — nunca de um cabeçalho cru.
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
    // `_t` (instante em que o formulário abriu) é obrigatório: ausente, não numérico, zero, futuro ou com menos de 2,5 s = robô.
    const started = Number(body['_t']);
    if (!Number.isFinite(started) || started <= 0 || started > now || now - started < MIN_FILL_MS) return { spam: true };

    const ipHash = ip ? createHash('sha256').update(`${integration.id}:${ip}`).digest('hex').slice(0, 32) : null;
    if (ipHash) {
      const count = await this.prisma.crm_webhook_events.count({
        where: { source: 'site_form', payload: { path: ['ip'], equals: ipHash }, created_at: { gte: new Date(now - RATE_WINDOW_MS) } },
      });
      if (count >= RATE_LIMIT) throw new FormError('Muitos envios seguidos. Tente de novo em alguns minutos.', 429);
    }
    const total = await this.prisma.crm_webhook_events.count({
      where: { source: 'site_form', payload: { path: ['integration'], equals: integration.id }, created_at: { gte: new Date(now - RATE_WINDOW_MS) } },
    });
    if (total >= INTEGRATION_CAP) throw new FormError('Este formulário está recebendo envios demais agora. Tente de novo em alguns minutos.', 429);

    const name = pick(body, ['name', 'nome', 'full_name', 'fullname', 'first_name'], MAX.name) ?? 'Lead do site';
    const emailRaw = pick(body, ['email', 'e-mail', 'mail'], MAX.email);
    const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null;
    const phone = normalizePhone(pick(body, ['phone', 'telefone', 'whatsapp', 'celular', 'tel'], MAX.phone));
    if (!email && !phone) throw new FormError('Informe um e-mail válido ou um telefone.');
    const message = pick(body, ['message', 'mensagem', 'msg', 'comentario'], MAX.message);
    const utm = {
      utm_source: pick(body, ['utm_source'], MAX.utm),
      utm_medium: pick(body, ['utm_medium'], MAX.utm),
      utm_campaign: pick(body, ['utm_campaign'], MAX.utm),
    };
    const page = pick(body, ['page', 'pagina', 'url'], MAX.page);

    await this.prisma.crm_webhook_events.create({
      data: { workspace_id: ws, source: 'site_form', payload: { ip: ipHash, integration: integration.id, page } as Prisma.InputJsonObject, status: 'processed' },
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
