import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { gid } from '../ads/ads-ids';
import { CrmCoreService, normalizePhone } from '../crm/crm-core.service';
import { MetaGraphClient } from '../instagram/meta-graph';
import { Integration } from '../webhooks/webhook-ledger.service';
import { UserFacingError } from './channel-errors';

type LeadField = { name: string; values: string[] };
type LeadgenRecord = { field_data?: LeadField[]; form_id?: string; campaign_name?: string; adset_name?: string; ad_name?: string; ad_id?: string };

function defaultTarget(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes('mail')) return 'email';
  if (n.includes('phone') || n.includes('telefone') || n.includes('whats')) return 'phone';
  if (n.includes('name') || n.includes('nome')) return 'name';
  if (n.includes('city') || n.includes('cidade')) return 'city';
  return null;
}

/** Aplica o mapeamento de campos do workspace (campo da Meta → campo do lead); sem mapeamento vale o reconhecimento automático. */
export function applyMapping(fields: LeadField[], mapping: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const target = mapping[f.name] ?? defaultTarget(f.name);
    if (!target) continue;
    const value = (f.values ?? []).join(', ');
    if (value) out[target] = value;
  }
  return out;
}

/** Meta Graph: leitura de leads (`leadgen`), custos por campanha e inscrição da Página (porte de `crm/meta.server.ts`). */
@Injectable()
export class LeadgenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphClient,
    private readonly core: CrmCoreService,
  ) {}

  /** Busca o registro de lead na Graph e cria/atualiza o lead do CRM. */
  async ingest(integration: Integration, leadgenId: string): Promise<{ leadId: string; duplicated: boolean }> {
    const ws = integration.workspace_id;
    const id = gid(leadgenId, 'lead');
    const lead = await this.graph.graph<LeadgenRecord>(ws, `/${id}`, { params: { fields: 'created_time,field_data,form_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name' } });
    const mapped = applyMapping(lead.field_data ?? [], (integration.field_mapping ?? {}) as Record<string, string>);
    const phone = normalizePhone(mapped['phone'] ?? null);
    const email = mapped['email']?.toLowerCase() ?? null;
    const name = mapped['name'] ?? 'Lead sem nome';

    const existing = await this.core.findLead(ws, phone, email);
    if (existing) {
      await this.core.addInteraction({
        workspaceId: ws, leadId: existing.id, kind: 'ai_action', authorType: 'system',
        content: `Novo envio de formulário Meta (${lead.ad_name ?? 'anúncio'}) recebido para um lead já existente.`,
        metadata: { leadgen_id: id.slice(0, 40), campaign: lead.campaign_name },
      });
      return { leadId: existing.id, duplicated: true };
    }

    const { pipelineId, stageId } = await this.core.firstStage(ws);
    const ownerId = await this.core.pickOwner(ws);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.crm_leads.create({
        data: {
          workspace_id: ws, pipeline_id: pipelineId, stage_id: stageId, name, phone, email, city: mapped['city'] ?? null, source: 'meta_lead_ads',
          campaign_name: lead.campaign_name ?? null, adset_name: lead.adset_name ?? null, ad_name: lead.ad_name ?? null, form_id: lead.form_id ?? null,
          external_id: id, owner_id: ownerId, lgpd_consent: true, lgpd_consent_at: new Date(), raw_payload: lead as unknown as Prisma.InputJsonObject,
        },
        select: { id: true },
      });
      if (stageId) await tx.crm_stage_history.create({ data: { workspace_id: ws, lead_id: row.id, from_stage_id: null, to_stage_id: stageId } });
      return row;
    });
    await this.core.addInteraction({ workspaceId: ws, leadId: created.id, kind: 'ai_action', authorType: 'system', content: `Lead recebido do formulário Meta Lead Ads (${lead.ad_name ?? 'anúncio'}).`, metadata: { leadgen_id: id } });
    await this.core.startCadence(ws, created.id, 'meta_lead_ads');
    return { leadId: created.id, duplicated: false };
  }

  /** Importação diária de custos por campanha (insights da Marketing API). Devolve quantas linhas gravou. */
  async importCosts(workspaceId: string, config: Record<string, unknown>, datePreset = 'yesterday'): Promise<number> {
    const raw = String(config['ad_account_id'] ?? '');
    if (!raw) throw new UserFacingError('ad_account_id não configurado');
    const account = raw.startsWith('act_') ? raw : `act_${raw}`;
    if (!/^act_\d{3,25}$/.test(account)) throw new UserFacingError('Identificador inválido (conta de anúncios).');
    const json = await this.graph.graph<{ data?: Record<string, string>[] }>(workspaceId, `/${account}/insights`, {
      params: { level: 'campaign', date_preset: datePreset, time_increment: 1, fields: 'campaign_id,campaign_name,spend,impressions,clicks' },
    });
    const rows = (json.data ?? []).map((r) => ({
      date: new Date(`${r['date_start'] ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
      campaign_id: r['campaign_id'] ?? '',
      campaign_name: r['campaign_name'] ?? null,
      spend: Number(r['spend'] ?? 0),
      impressions: Number(r['impressions'] ?? 0),
      clicks: Number(r['clicks'] ?? 0),
    }));
    if (!rows.length) return 0;
    await this.prisma.$transaction(
      rows.map((r) =>
        this.prisma.crm_campaign_costs.upsert({
          where: { workspace_id_date_campaign_id: { workspace_id: workspaceId, date: r.date, campaign_id: r.campaign_id } },
          create: { workspace_id: workspaceId, ...r },
          update: { campaign_name: r.campaign_name, spend: r.spend, impressions: r.impressions, clicks: r.clicks },
        }),
      ),
    );
    return rows.length;
  }

  /** Campos de um formulário de lead (tela de mapeamento). */
  async listFormFields(workspaceId: string, formId: string): Promise<{ name: string; fields: { key: string; label: string }[] }> {
    const id = gid(formId, 'formulário');
    const json = await this.graph.graph<{ name?: string; questions?: { key?: string; label?: string }[] }>(workspaceId, `/${id}`, { params: { fields: 'name,questions' } });
    return { name: json.name ?? id, fields: (json.questions ?? []).map((q) => ({ key: q.key ?? '', label: q.label ?? q.key ?? '' })) };
  }

  /** Inscreve a Página da empresa no app (sem isso a Meta não envia leads/mensagens ao webhook). */
  async subscribePage(workspaceId: string, fields: string[]): Promise<{ ok: true }> {
    const cfg = await this.graph.config(workspaceId);
    if (!cfg.pageId) throw new UserFacingError('Página do Facebook não configurada em Integrações.');
    const page = await this.graph.graph<{ access_token?: string }>(workspaceId, `/${gid(cfg.pageId, 'página')}`, { params: { fields: 'access_token' } });
    if (!page.access_token) throw new UserFacingError('Sem acesso à Página: dê ao usuário do sistema acesso total à Página.');
    await this.graph.graph(workspaceId, `/${cfg.pageId}/subscribed_apps`, { method: 'POST', token: page.access_token, params: { subscribed_fields: fields.join(',') } });
    return { ok: true };
  }
}
