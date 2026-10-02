import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { brl, OBJECTIVES } from './campaign-labels';
import { CampaignGuardsService } from './campaign-guards.service';
import { CreateCampaignDto, CreateCopyDto } from './dto/campaigns.dto';

const notFound = (message = 'Campanha não encontrada.') => new NotFoundException({ code: 'NOT_FOUND', message });
const MAX_JSON_CHARS = 50_000;
const toDate = (v: string | null | undefined): Date | null => (v ? new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v) : null);
const jsonLen = (v: unknown) => JSON.stringify(v ?? null).length;

/**
 * Campanhas: as leituras/escritas diretas das telas `/campaigns`, `/campaigns/new` e `/campaigns/$id`
 * (antes `supabase.from(...)` com RLS). Toda id é conferida contra o workspace da URL.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly guards: CampaignGuardsService,
  ) {}

  /** `campaigns select *, brands(name)` eq workspace_id order created_at desc. */
  async list(workspaceId: string) {
    const rows = await this.prisma.campaigns.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      include: { brand: { select: { name: true } } },
    });
    return rows.map(({ brand, ...c }) => ({ ...c, brands: brand }));
  }

  /** `performance_daily select *` eq workspace_id neq source 'demo' (KPIs por campanha da lista). */
  performance(workspaceId: string) {
    return this.prisma.performance_daily.findMany({ where: { workspace_id: workspaceId, source: { not: 'demo' } } });
  }

  /** `campaigns select *, brands(*)` eq id. */
  async get(workspaceId: string, id: string) {
    const row = await this.prisma.campaigns.findFirst({ where: { id, workspace_id: workspaceId }, include: { brand: true } });
    if (!row) throw notFound();
    const { brand, ...c } = row;
    return { ...c, brands: brand };
  }

  /** As seis leituras de `["campaign", id]` juntas (mesmos filtros e ordens). */
  async detail(workspaceId: string, id: string) {
    const campaign = await this.get(workspaceId, id);
    const [strategy, copy, creatives, perf, costs] = await Promise.all([
      this.prisma.campaign_strategies.findFirst({ where: { campaign_id: id, workspace_id: workspaceId }, orderBy: { version: 'desc' } }),
      this.prisma.copies.findFirst({ where: { campaign_id: id, workspace_id: workspaceId }, orderBy: { version: 'desc' } }),
      this.prisma.creatives.findMany({ where: { campaign_id: id, workspace_id: workspaceId }, orderBy: { created_at: 'desc' } }),
      this.prisma.performance_daily.findMany({ where: { campaign_id: id, workspace_id: workspaceId, source: { not: 'demo' } } }),
      this.prisma.campaign_costs.findMany({ where: { campaign_id: id, workspace_id: workspaceId } }),
    ]);
    return { campaign, strategy, copy, creatives, perf, costs };
  }

  /** INSERT do wizard (`status` sempre `draft`) + atividade `campaign.created`. */
  async create(userId: string, workspaceId: string, dto: CreateCampaignDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Informe o nome da campanha.' });
    if (jsonLen(dto.audience) > MAX_JSON_CHARS) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Público grande demais.' });
    const brand = await this.prisma.brands.findFirst({ where: { id: dto.brand_id, workspace_id: workspaceId }, select: { id: true } });
    if (!brand) throw notFound('Marca não encontrada.');
    const campaign = await this.prisma.campaigns.create({
      data: {
        workspace_id: workspaceId,
        brand_id: brand.id,
        name,
        objective: dto.objective,
        offer_product: dto.offer_product ?? null,
        offer_price: dto.offer_price ?? null,
        offer_promise: dto.offer_promise ?? null,
        landing_url: dto.landing_url ?? null,
        start_date: toDate(dto.start_date),
        end_date: toDate(dto.end_date),
        audience: dto.audience as Prisma.InputJsonObject,
        budget_total: dto.budget_total ?? null,
        budget_daily: dto.budget_daily ?? null,
        goal_leads: dto.goal_leads ?? null,
        goal_sales: dto.goal_sales ?? null,
        avg_ticket: dto.avg_ticket ?? null,
        margin_percent: dto.margin_percent ?? null,
        max_cac: dto.max_cac ?? null,
        formats: dto.formats,
        status: 'draft',
      },
    });
    await this.activity.log(workspaceId, userId, 'campaign.created', 'campaign', { campaign_id: campaign.id, name });
    return campaign;
  }

  /** INSERT em `copies` (versão = anterior + 1) + atividade `campaign.copy_generated`. */
  async createCopy(userId: string, workspaceId: string, campaignId: string, dto: CreateCopyDto) {
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: workspaceId }, select: { id: true } });
    if (!c) throw notFound();
    if (jsonLen(dto.content) > MAX_JSON_CHARS) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Copy grande demais.' });
    const last = await this.prisma.copies.findFirst({ where: { campaign_id: campaignId, workspace_id: workspaceId }, orderBy: { version: 'desc' }, select: { version: true } });
    const copy = await this.prisma.copies.create({
      data: { workspace_id: workspaceId, campaign_id: campaignId, content: dto.content as Prisma.InputJsonObject, status: 'draft', version: (last?.version ?? 0) + 1 },
    });
    await this.activity.log(workspaceId, userId, 'campaign.copy_generated', 'campaign', { campaign_id: campaignId });
    return copy;
  }

  /**
   * "Solicitar aprovação": `approval_requests` pendente + `campaigns.status = pending_approval`
   * (duas escritas do navegador no protótipo, aqui numa transação) + atividade `campaign.approval_requested`.
   * Título e resumo saem do servidor com o mesmo texto da tela.
   */
  async requestApproval(userId: string, workspaceId: string, campaignId: string) {
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: workspaceId } });
    if (!c) throw notFound();
    if (c.status !== 'draft') {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Só campanhas em rascunho podem solicitar aprovação.' });
    }
    await this.guards.assertCanSetCampaignStatus(userId, workspaceId, c.status, 'pending_approval');
    const creatives = await this.prisma.creatives.count({ where: { campaign_id: campaignId, workspace_id: workspaceId } });
    const approval = await this.prisma.$transaction(async (tx) => {
      const req = await tx.approval_requests.create({
        data: {
          workspace_id: workspaceId,
          entity_type: 'campaign',
          entity_id: campaignId,
          campaign_id: campaignId,
          title: `Publicar campanha "${c.name}" na Meta`,
          summary: `Verba diária de ${brl(Number(c.budget_daily ?? 0))}, ${creatives} criativo(s), objetivo ${OBJECTIVES[c.objective] ?? c.objective}.`,
          status: 'pending',
          requested_by: userId,
        },
      });
      await tx.campaigns.update({ where: { id: campaignId }, data: { status: 'pending_approval' } });
      return req;
    });
    await this.activity.log(workspaceId, userId, 'campaign.approval_requested', 'campaign', { campaign_id: campaignId });
    return approval;
  }
}
