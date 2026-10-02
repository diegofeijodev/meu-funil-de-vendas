import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createWithNextVersion } from '../../common/database/next-version';
import { PrismaService } from '../../common/database/prisma.service';
import { toWire } from '../../common/http/wire';
import { isUuid } from '../../common/ids/uuid';
import { WorkspaceAccessService } from '../access/access.service';
import { ActivityService } from '../activity/activity.service';
import { AiError } from '../ai/ai-error';
import { AiService } from '../ai/ai.service';
import { CampaignGuardsService } from '../campaigns/campaign-guards.service';
import { OBJECTIVES } from '../campaigns/campaign-labels';
import { buildStrategyPrompt, normalizeStrategy, STRATEGY_SCHEMA } from './strategist.prompt';
import { FullStrategy } from './strategy-types';

/**
 * Agente estrategista (`ai/strategist.functions.ts` + `strategist.server.ts`).
 * Gera a estratégia da campanha com IA real, guarda versões (`campaign_strategies`), aprova uma versão
 * (as aprovadas anteriores viram `superseded`) e cria o plano do Instagram a partir dela.
 */
@Injectable()
export class StrategistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly guards: CampaignGuardsService,
    private readonly access: WorkspaceAccessService,
    private readonly activity: ActivityService,
  ) {}

  /** Resultados anteriores da marca (campanhas já veiculadas) para a IA aprender com eles. */
  private async pastResults(workspaceId: string, brandId: string, excludeCampaignId: string) {
    const camps = await this.prisma.campaigns.findMany({
      where: { workspace_id: workspaceId, brand_id: brandId, id: { not: excludeCampaignId } },
      select: { id: true, name: true, objective: true },
      take: 20,
    });
    const ids = camps.map((c) => c.id);
    if (!ids.length) return [];
    const perf = await this.prisma.performance_daily.findMany({
      where: { workspace_id: workspaceId, source: { not: 'demo' }, campaign_id: { in: ids } },
      select: { campaign_id: true, spend: true, impressions: true, clicks: true, leads: true, conversions: true, revenue: true },
    });
    const agg = new Map<string, { spend: number; impressions: number; clicks: number; leads: number; sales: number; revenue: number }>();
    for (const r of perf) {
      const a = agg.get(r.campaign_id) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, sales: 0, revenue: 0 };
      a.spend += Number(r.spend ?? 0);
      a.impressions += Number(r.impressions ?? 0);
      a.clicks += Number(r.clicks ?? 0);
      a.leads += Number(r.leads ?? 0);
      a.sales += Number(r.conversions ?? 0);
      a.revenue += Number(r.revenue ?? 0);
      agg.set(r.campaign_id, a);
    }
    return camps
      .filter((c) => agg.has(c.id))
      .map((c) => {
        const a = agg.get(c.id)!;
        return {
          campanha: c.name,
          objetivo: OBJECTIVES[c.objective] ?? c.objective,
          gasto: Math.round(a.spend),
          ctr: a.impressions ? Number(((a.clicks / a.impressions) * 100).toFixed(2)) : null,
          cpl: a.leads ? Number((a.spend / a.leads).toFixed(2)) : null,
          roas: a.spend ? Number((a.revenue / a.spend).toFixed(2)) : null,
        };
      });
  }

  /** `generateStrategyAI`: lê marca/personas/produtos/aprendizados/histórico, monta o prompt e chama a IA (schema estrito). */
  async generateStrategyAI(workspaceId: string, campaignId: string): Promise<FullStrategy> {
    const row = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: workspaceId }, include: { brand: true } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Campanha não encontrada.' });
    const { brand, ...campaign } = row;
    if (!brand) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'A campanha precisa de uma marca com o DNA preenchido.' });

    const [personas, products, learnings, history] = await Promise.all([
      this.prisma.personas.findMany({
        where: { brand_id: brand.id, workspace_id: workspaceId },
        select: { name: true, age_range: true, location: true, pains: true, desires: true, interests: true, segment_type: true },
        orderBy: { created_at: 'asc' },
        take: 4,
      }),
      this.prisma.products.findMany({
        where: { brand_id: brand.id, workspace_id: workspaceId },
        select: { name: true, description: true, price: true },
        orderBy: { created_at: 'asc' },
        take: 6,
      }),
      this.prisma.brand_learnings.findMany({
        where: { brand_id: brand.id, workspace_id: workspaceId },
        select: { category: true, value: true, metric: true },
        orderBy: { score: 'desc' },
        take: 10,
      }),
      this.pastResults(workspaceId, brand.id, campaignId),
    ]);

    // Dados no formato de fio (numeric → number, date → "YYYY-MM-DD"), como o PostgREST entregava ao protótipo.
    const prompt = buildStrategyPrompt(
      toWire(campaign) as Record<string, any>, toWire(brand) as Record<string, any>,
      toWire(personas) as unknown[], toWire(products) as unknown[], toWire(learnings) as unknown[], history,
    );
    const raw = await this.ai.json<Record<string, any>>(workspaceId, { prompt, schema: STRATEGY_SCHEMA, name: 'campaign_strategy' });
    const strategy = normalizeStrategy(raw);
    if (!strategy) throw new AiError('A IA não devolveu uma estratégia completa. Tente de novo.');
    return strategy;
  }

  /** Estratégia em vigor: a aprovada mais recente, senão a última versão (`currentStrategy`). Sempre dentro do workspace. */
  async currentStrategy(workspaceId: string, campaignId: string | null | undefined): Promise<FullStrategy | null> {
    if (!campaignId || !isUuid(campaignId)) return null;
    const rows = await this.prisma.campaign_strategies.findMany({
      where: { campaign_id: campaignId, workspace_id: workspaceId },
      select: { content: true, status: true, version: true },
      orderBy: { version: 'desc' },
      take: 10,
    });
    return ((rows.find((r) => r.status === 'approved') ?? rows[0])?.content as unknown as FullStrategy | undefined) ?? null;
  }

  /** 1.1 Gera (ou regera) a estratégia e salva uma nova versão em rascunho. */
  async generate(userId: string, campaignId: string) {
    const c = await this.guards.resolveCampaign(userId, campaignId, 'write');
    const content = await this.generateStrategyAI(c.workspace_id, c.id);
    // A versão é calculada DEPOIS da geração (até ~1 min), como no protótipo.
    const { version } = await createWithNextVersion(
      async () => (await this.prisma.campaign_strategies.findFirst({
        where: { campaign_id: c.id, workspace_id: c.workspace_id }, orderBy: { version: 'desc' }, select: { version: true },
      }))?.version,
      (v) => this.prisma.campaign_strategies.create({
        data: { workspace_id: c.workspace_id, campaign_id: c.id, content: content as unknown as Prisma.InputJsonObject, status: 'draft', version: v },
      }),
    );
    await this.activity.log(c.workspace_id, userId, 'campaign.strategy_generated', 'campaign', { campaign_id: c.id, version });
    return { version, content };
  }

  /** 1.2 Aprova a versão: as aprovadas anteriores viram `superseded`. */
  async approve(userId: string, strategyId: string) {
    const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Estratégia não encontrada.' });
    if (!isUuid(strategyId)) throw notFound();
    const s = await this.prisma.campaign_strategies.findUnique({
      where: { id: strategyId }, select: { id: true, workspace_id: true, campaign_id: true, version: true },
    });
    if (!s || !(await this.access.roleOf(userId, s.workspace_id))) throw notFound();
    await this.access.require(userId, s.workspace_id, 'write');
    await this.prisma.$transaction(async (tx) => {
      await tx.campaign_strategies.updateMany({ where: { campaign_id: s.campaign_id, workspace_id: s.workspace_id, status: 'approved' }, data: { status: 'superseded' } });
      await tx.campaign_strategies.update({ where: { id: s.id }, data: { status: 'approved' } });
    });
    await this.activity.log(s.workspace_id, userId, 'campaign.strategy_approved', 'campaign', { campaign_id: s.campaign_id, version: s.version });
    return { ok: true };
  }

  /** 1.3 Cria o plano de conteúdo do Instagram a partir da estratégia (pilares, pesos, temas, frequência). */
  async createIgPlan(userId: string, campaignId: string) {
    const c = await this.guards.resolveCampaign(userId, campaignId, 'write');
    const s = await this.currentStrategy(c.workspace_id, c.id);
    if (!s) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Gere a estratégia da campanha primeiro.' });
    const plan = s.plano_instagram;
    const pillars = (plan?.pilares ?? []).map((p) => p.nome).filter(Boolean);
    if (!pillars.length) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Esta versão da estratégia não tem plano do Instagram. Regere a estratégia.' });
    }
    const total = (plan?.pilares ?? []).reduce((acc, p) => acc + (Number(p.peso) || 0), 0) || 1;
    const weights = Object.fromEntries((plan?.pilares ?? []).map((p) => [p.nome, Math.round(((Number(p.peso) || 0) / total) * 100) / 100]));
    const brand = c.brand_id
      ? await this.prisma.brands.findFirst({ where: { id: c.brand_id, workspace_id: c.workspace_id }, select: { tone_of_voice: true } })
      : null;
    const freq = plan?.frequencia ?? { feed: 3, reels: 2, stories: 7 };
    const created = await this.prisma.ig_content_plans.create({
      data: {
        workspace_id: c.workspace_id,
        brand_id: c.brand_id,
        name: `Instagram · ${c.name}`,
        objective: s.objetivo_smart || s.big_idea,
        tone_of_voice: brand?.tone_of_voice ?? null,
        content_pillars: pillars,
        pillar_weights: weights,
        posting_frequency: {
          feed_image: Math.max(1, Math.round(Number(freq.feed) * 0.6)),
          feed_carousel: Math.max(0, Math.round(Number(freq.feed) * 0.4)),
          feed: Number(freq.feed) || 3,
          reels: Number(freq.reels) || 2,
          stories: Number(freq.stories) || 7,
        },
        hashtag_strategy: { notes: `Temas da campanha: ${(plan?.temas ?? []).join('; ')}`, audience: s.icp },
        cta_default: s.briefing_criativo?.cta ?? null,
        requires_approval: true,
        auto_publish: false,
        status: 'draft',
      },
      select: { id: true },
    });
    return { planId: created.id };
  }
}
