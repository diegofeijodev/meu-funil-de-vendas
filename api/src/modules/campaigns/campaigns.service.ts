import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createWithNextVersion } from '../../common/database/next-version';
import { PrismaService } from '../../common/database/prisma.service';
import { pilotSummary } from './pilot-summary';
import { ActivityService } from '../activity/activity.service';
import { brl, OBJECTIVES } from './campaign-labels';
import { CampaignGuardsService } from './campaign-guards.service';
import { igCampaignScope, IG_NOT_PENDING } from '../instagram/ig-campaign-scope';
import { CreateCampaignDto, CreateCopyDto, SetBudgetDto } from './dto/campaigns.dto';
import { parseOfferTerms } from './offer-terms';
import { geoText, parseGeoTargets } from './geo-targets';

const notFound = (message = 'Campanha não encontrada.') => new NotFoundException({ code: 'NOT_FOUND', message });
const MAX_JSON_CHARS = 50_000;
const toDate = (v: string | null | undefined): Date | null => (v ? new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v) : null);
const jsonLen = (v: unknown) => JSON.stringify(v ?? null).length;
/** Destino do anúncio: só http(s) com host (a Meta recusa o resto e `javascript:` nunca deve virar link). */
const cleanLandingUrl = (raw: string): string | null => {
  const v = (raw ?? '').trim();
  if (!v || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? v : null;
  } catch {
    return null;
  }
};
/** Estados em que o destino ainda pode mudar aqui (depois de publicada, o anúncio vive na Meta). */
const LANDING_EDITABLE = ['draft', 'pending_approval', 'approved'];

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
    // Linha do estrategista em cada cartão: a execução mais recente do piloto de cada campanha (uma consulta só).
    const runs = rows.length
      ? await this.prisma.campaign_pilot_runs.findMany({
          where: { workspace_id: workspaceId, campaign_id: { in: rows.map((r) => r.id) } },
          orderBy: { created_at: 'desc' },
          select: { campaign_id: true, status: true, current_step: true, steps: true },
        })
      : [];
    const latest = new Map<string, (typeof runs)[number]>();
    for (const r of runs) if (!latest.has(r.campaign_id)) latest.set(r.campaign_id, r);
    return rows.map(({ brand, ...c }) => ({ ...c, brands: brand, pilot_summary: pilotSummary(latest.get(c.id) ?? null) }));
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
    const [strategy, copy, creatives, perf, costs, instagram] = await Promise.all([
      this.prisma.campaign_strategies.findFirst({ where: { campaign_id: id, workspace_id: workspaceId }, orderBy: { version: 'desc' } }),
      this.prisma.copies.findFirst({ where: { campaign_id: id, workspace_id: workspaceId }, orderBy: { version: 'desc' } }),
      this.prisma.creatives.findMany({ where: { campaign_id: id, workspace_id: workspaceId }, orderBy: { created_at: 'desc' } }),
      this.prisma.performance_daily.findMany({ where: { campaign_id: id, workspace_id: workspaceId, source: { not: 'demo' } } }),
      this.prisma.campaign_costs.findMany({ where: { campaign_id: id, workspace_id: workspaceId } }),
      this.instagramLinks(workspaceId, id),
    ]);
    return { campaign, strategy, copy, creatives, perf, costs, instagram };
  }

  /**
   * Instagram ligado à campanha (para o diálogo e a faixa de "Encerrar campanha"): o mesmo critério do cancelamento
   * (`igCampaignScope`) — programações da campanha e as semanas recorrentes, planos ligados — e quantos posts ainda vão sair.
   */
  private async instagramLinks(workspaceId: string, campaignId: string) {
    const scope = await igCampaignScope(this.prisma, workspaceId, campaignId);
    if (!scope.posts) return { linked: false, pending_posts: 0 };
    const pending = await this.prisma.ig_posts.count({ where: { AND: [scope.posts, { status: { notIn: IG_NOT_PENDING } }] } });
    return { linked: true, pending_posts: pending };
  }

  /** INSERT do wizard (`status` sempre `draft`) + atividade `campaign.created`. */
  async create(userId: string, workspaceId: string, dto: CreateCampaignDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Informe o nome da campanha.' });
    if (jsonLen(dto.audience) > MAX_JSON_CHARS) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Público grande demais.' });
    const offerTerms = parseOfferTerms(dto.offer_terms);
    // Pedido pela conversa com promessa: as condições são obrigatórias (o "Ver/ajustar" não pode contorná-las).
    if (dto.intake_text?.trim() && dto.offer_promise?.trim() && !offerTerms) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Diga o que é grátis ou oferecido.' });
    }
    const geoTargets = parseGeoTargets(dto.geo_targets);
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
        // Com região estruturada, o texto legível sai dela (uma verdade só).
        audience: (geoTargets.length ? { ...dto.audience, localizacao: geoText(geoTargets) } : dto.audience) as Prisma.InputJsonObject,
        budget_total: dto.budget_total ?? null,
        budget_daily: dto.budget_daily ?? null,
        goal_leads: dto.goal_leads ?? null,
        goal_sales: dto.goal_sales ?? null,
        avg_ticket: dto.avg_ticket ?? null,
        margin_percent: dto.margin_percent ?? null,
        max_cac: dto.max_cac ?? null,
        formats: dto.formats,
        intake_text: dto.intake_text?.trim() || null,
        offer_terms: offerTerms ? (offerTerms as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
        geo_targets: geoTargets as unknown as Prisma.InputJsonArray,
        status: 'draft',
      },
    });
    await this.activity.log(workspaceId, userId, 'campaign.created', 'campaign', { campaign_id: campaign.id, name });
    return campaign;
  }

  /**
   * Define/troca a página de destino. A criação aceitava `landing_url`, mas nada editava depois: campanha criada sem
   * a URL ficava presa em "Preencha a página de destino" ao publicar na Meta.
   */
  async setLandingUrl(userId: string, workspaceId: string, campaignId: string, landingUrl: string) {
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: workspaceId }, select: { id: true, status: true } });
    if (!c) throw notFound();
    const url = cleanLandingUrl(landingUrl);
    if (!url) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Informe uma URL válida, começando com http:// ou https://.' });
    if (!LANDING_EDITABLE.includes(c.status)) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'A campanha já foi publicada: mude o destino direto na Meta.' });
    }
    const updated = await this.prisma.campaigns.update({ where: { id: campaignId }, data: { landing_url: url } });
    await this.activity.log(workspaceId, userId, 'campaign.landing_updated', 'campaign', { campaign_id: campaignId });
    return updated;
  }

  /**
   * Campanha que ainda não foi para a Meta (verba e cidade de depois vivem lá). Exceção: verba VAZIA de campanha antiga já na Meta
   * (publicada com o R$ 20 silencioso) pode ser preenchida — não mexe na Meta e o Google/TikTok precisam dela.
   */
  private async beforePublish(userId: string, workspaceId: string, campaignId: string, opts: { fillEmptyBudget?: boolean } = {}) {
    const c = await this.prisma.campaigns.findFirst({
      where: { id: campaignId, workspace_id: workspaceId },
      select: { id: true, status: true, meta_campaign_id: true, audience: true, budget_daily: true, budget_total: true },
    });
    if (!c) throw notFound();
    const fillingGap = opts.fillEmptyBudget && !(Number(c.budget_daily ?? 0) > 0) && c.status !== 'finished';
    if (!fillingGap && (!LANDING_EDITABLE.includes(c.status) || c.meta_campaign_id)) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'A campanha já foi publicada: mude direto na Meta.' });
    }
    await this.guards.assertCanChangeApprovedTerms(userId, workspaceId, c.status);
    return c;
  }

  /** Verba por dia (obrigatória para publicar) e teto do mês opcional. Antes, verba vazia virava R$ 20/dia na Meta. */
  async setBudget(userId: string, workspaceId: string, campaignId: string, dto: SetBudgetDto) {
    const daily = Number(dto.budget_daily);
    if (!Number.isFinite(daily) || daily <= 0) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Informe um valor por dia maior que zero.' });
    // Total ausente = fica o de antes (o wizard já gravou "Verba total"); `null` limpa.
    const keepTotal = dto.budget_total === undefined;
    const total = dto.budget_total == null ? null : Number(dto.budget_total);
    if (total != null && total < daily) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'O teto do mês não pode ser menor que a verba de um dia.' });
    }
    const c = await this.beforePublish(userId, workspaceId, campaignId, { fillEmptyBudget: true });
    const updated = await this.prisma.campaigns.update({
      where: { id: campaignId },
      data: keepTotal ? { budget_daily: daily } : { budget_daily: daily, budget_total: total },
    });
    const num = (v: unknown) => (v == null ? null : Number(v));
    await this.activity.log(workspaceId, userId, 'campaign.budget_updated', 'campaign', {
      campaign_id: campaignId,
      from: { daily: num(c.budget_daily) ?? 0, total: num(c.budget_total) },
      to: { daily, total: keepTotal ? num(c.budget_total) : total },
    });
    return updated;
  }

  /** Região estruturada (cidades da Meta + raio). Grava também o texto legível em `audience.localizacao` — uma verdade só. */
  async setGeoTargets(userId: string, workspaceId: string, campaignId: string, raw: unknown[]) {
    const targets = parseGeoTargets(raw);
    if (!targets.length) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Escolha pelo menos uma cidade.' });
    const c = await this.beforePublish(userId, workspaceId, campaignId);
    const audience = { ...((c.audience ?? {}) as Record<string, unknown>), localizacao: geoText(targets) };
    const updated = await this.prisma.campaigns.update({
      where: { id: campaignId },
      data: { geo_targets: targets as unknown as Prisma.InputJsonArray, audience: audience as Prisma.InputJsonObject },
    });
    await this.activity.log(workspaceId, userId, 'campaign.geo_updated', 'campaign', { campaign_id: campaignId, to: targets });
    return updated;
  }

  /** Cidade do anúncio (`audience.localizacao`, lida pela publicação na Meta); o resto do público fica igual. */
  async setLocation(userId: string, workspaceId: string, campaignId: string, location: string) {
    const text = (location ?? '').trim();
    if (text.length < 2) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Informe a cidade (ex.: Jundiaí, SP).' });
    const c = await this.beforePublish(userId, workspaceId, campaignId);
    const before = String(((c.audience ?? {}) as Record<string, unknown>)['localizacao'] ?? '');
    const audience = { ...((c.audience ?? {}) as Record<string, unknown>), localizacao: text };
    // Texto livre volta ao caminho da Fatia 0: a lista estruturada antiga deixaria de ser a verdade.
    const updated = await this.prisma.campaigns.update({
      where: { id: campaignId },
      data: { audience: audience as Prisma.InputJsonObject, geo_targets: [] as unknown as Prisma.InputJsonArray },
    });
    await this.activity.log(workspaceId, userId, 'campaign.location_updated', 'campaign', { campaign_id: campaignId, from: before, to: text });
    return updated;
  }

  /** INSERT em `copies` (versão = anterior + 1) + atividade `campaign.copy_generated`. */
  async createCopy(actorId: string | null, workspaceId: string, campaignId: string, dto: CreateCopyDto) {
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: workspaceId }, select: { id: true } });
    if (!c) throw notFound();
    if (jsonLen(dto.content) > MAX_JSON_CHARS) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Copy grande demais.' });
    const { row: copy } = await createWithNextVersion(
      async () => (await this.prisma.copies.findFirst({ where: { campaign_id: campaignId, workspace_id: workspaceId }, orderBy: { version: 'desc' }, select: { version: true } }))?.version,
      (version) => this.prisma.copies.create({ data: { workspace_id: workspaceId, campaign_id: campaignId, content: dto.content as Prisma.InputJsonObject, status: 'draft', version } }),
    );
    await this.activity.log(workspaceId, actorId, 'campaign.copy_generated', 'campaign', { campaign_id: campaignId });
    return copy;
  }

  /**
   * "Solicitar aprovação": `approval_requests` pendente + `campaigns.status = pending_approval`
   * (duas escritas do navegador no protótipo, aqui numa transação) + atividade `campaign.approval_requested`.
   * Título e resumo saem do servidor com o mesmo texto da tela.
   */
  async requestApproval(userId: string, workspaceId: string, campaignId: string, summary?: string) {
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
          // O piloto manda o resumo do pacote (as artes ainda não existem no momento do pedido).
          summary: summary ?? `Verba diária de ${brl(Number(c.budget_daily ?? 0))}, ${creatives} criativo(s), objetivo ${OBJECTIVES[c.objective] ?? c.objective}.`,
          status: 'pending',
          requested_by: userId,
        },
      });
      // Condicional: dois pedidos ao mesmo tempo → só um passa de rascunho (o outro desfaz a transação e recebe a frase de sempre).
      const moved = await tx.campaigns.updateMany({ where: { id: campaignId, workspace_id: workspaceId, status: 'draft' }, data: { status: 'pending_approval' } });
      if (moved.count !== 1) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Só campanhas em rascunho podem solicitar aprovação.' });
      return req;
    });
    await this.activity.log(workspaceId, userId, 'campaign.approval_requested', 'campaign', { campaign_id: campaignId });
    return approval;
  }
}
