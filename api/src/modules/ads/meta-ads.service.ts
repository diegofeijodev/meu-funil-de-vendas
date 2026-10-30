/** As 11 server fns de `meta-ads.functions.ts` (`POST /v1/meta/meta-ads-*`, `meta-save-app`, `meta-login-url`, `meta-list-assets`, `meta-save-assets`). */
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { ActivityService } from '../activity/activity.service';
import { CampaignGuardsService } from '../campaigns/campaign-guards.service';
import { notFound, UserError } from '../media/user-error';
import { StrategistService } from '../strategist/strategist.service';
import { VaultService } from '../vault/vault.service';
import { readAdsConfig } from './ads-config';
import { guarded } from './ads-errors';
import { assertCanPublishUntil, assertPeriodOpen, campaignEndDay, requireDailyBudget } from './ads-preflight';
import { withUtm } from './ads-utm';
import { readGeoTargets } from '../campaigns/geo-targets';
import { MetaOAuthService } from './meta-oauth.service';
import { MetaOpsService } from './meta-ops.service';
import { CAMPAIGN_FINISHED, MSG_CAMPAIGN_ENDED } from '../campaigns/campaign-labels';
import { MetaSaveAssetsDto, MetaSaveCredentialsDto } from './ads.dto';

const MSG_NO_ACCESS = 'Você não tem acesso a esta área de trabalho.';
const MSG_VIEWER = 'Seu perfil não pode alterar campanhas.';
const MSG_ONLY_MANAGER = 'Só o dono ou um administrador conecta a Meta.';
const forbidden = (message: string) => new ForbiddenException({ code: 'FORBIDDEN', message });

@Injectable()
export class MetaAdsService {
  /** Campanhas sendo enviadas agora (a API roda em UMA instância): evita publicar duas vezes no mesmo clique duplo. */
  private readonly publishing = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly vault: VaultService,
    private readonly ops: MetaOpsService,
    private readonly oauth: MetaOAuthService,
    private readonly guards: CampaignGuardsService,
    private readonly strategist: StrategistService,
    private readonly activity: ActivityService,
  ) {}

  /** `requireMember(ctx, ws, edit)` do protótipo (mensagens idênticas). */
  private async member(userId: string, ws: string, edit = false) {
    const role = await this.access.roleOf(userId, ws);
    if (!role) throw forbidden(MSG_NO_ACCESS);
    if (edit && role === 'viewer') throw forbidden(MSG_VIEWER);
    return role;
  }

  /** `requireManager` do protótipo: owner|admin (também para quem não é membro). */
  private async manager(userId: string, ws: string) {
    if (!(await this.access.can(userId, ws, 'manage'))) throw forbidden(MSG_ONLY_MANAGER);
  }

  async saveCredentials(userId: string, d: MetaSaveCredentialsDto) {
    // Decisão: o protótipo deixava qualquer não-viewer (marketing) sobrescrever as credenciais — inconsistente com os demais
    // portões de conexão; aqui exige owner|admin (como metaSaveApp/metaSaveAssets).
    await this.manager(userId, d.workspaceId);
    const rows: Record<string, string> = {
      META_APP_ID: d.appId, META_APP_SECRET: d.appSecret, META_SYSTEM_USER_TOKEN: d.systemUserToken, META_AD_ACCOUNT_ID: d.adAccountId, META_PAGE_ID: d.pageId,
      // Token colado à mão (usuário do sistema) não vence: limpa a data do login com Facebook.
      META_TOKEN_SOURCE: 'system_user', META_TOKEN_EXPIRES_AT: '',
    };
    if (d.instagramId?.trim()) rows['META_INSTAGRAM_ACCOUNT_ID'] = d.instagramId.trim();
    await this.vault.set(d.workspaceId, rows);
    const missing = await this.ops.missing(d.workspaceId);
    return { ok: true, configured: missing.length === 0, missing };
  }

  async status(userId: string, ws: string) {
    await this.member(userId, ws);
    const [missing, token] = await Promise.all([this.ops.missing(ws), this.oauth.tokenInfo(ws)]);
    return { configured: missing.length === 0, missing, tokenExpiresAt: token.expiresAt, tokenSource: token.source, redirectUri: this.oauth.redirectUri };
  }

  async test(userId: string, ws: string) {
    await this.member(userId, ws);
    return guarded(() => this.ops.testConnection(ws));
  }

  /** `GET /v1/workspaces/:ws/geo/search?q=` (Fatia 2): cidades da Meta para a região. Sem Meta conectada, a tela salva só o nome. */
  async geoSearch(userId: string, ws: string, q: string) {
    await this.member(userId, ws);
    const text = (q ?? '').trim().slice(0, 80);
    if (text.length < 2) return { items: [] };
    const missing = await this.ops.missing(ws);
    if (missing.includes('META_SYSTEM_USER_TOKEN') || missing.includes('META_APP_SECRET')) {
      return { error: { code: 'META_NOT_CONNECTED', message: 'Conecte a Meta em Integrações para buscar a cidade. Até lá, escreva cidade e estado.' } };
    }
    return { items: await guarded(() => this.ops.searchCities(ws, text)) };
  }

  async list(userId: string, ws: string) {
    await this.member(userId, ws);
    return guarded(() => this.ops.listStructure(ws));
  }

  async insights(userId: string, d: { workspaceId: string; since: string; until: string; campaignId?: string | null }) {
    await this.member(userId, d.workspaceId);
    let metaCampaignId: string | null = null;
    if (d.campaignId) {
      // Só campanhas DESTA empresa (o protótipo confiava no RLS).
      const c = await this.prisma.campaigns.findFirst({ where: { id: d.campaignId, workspace_id: d.workspaceId }, select: { meta_campaign_id: true } });
      metaCampaignId = c?.meta_campaign_id ?? null;
      if (!metaCampaignId) throw new UserError('Esta campanha ainda não foi publicada na Meta.');
    }
    return guarded(() => this.ops.fetchInsights(d.workspaceId, { since: d.since, until: d.until, campaignId: metaCampaignId }));
  }

  /** Publica a campanha aprovada na Meta — tudo PAUSADO. */
  async publish(userId: string, ws: string, campaignId: string) {
    await this.member(userId, ws, true);
    // Trava ANTES de ler a campanha (verificar+travar é síncrono): quem chega durante o envio é recusado e quem chega depois
    // lê o estado já gravado ("já foi enviada"). A API roda em UMA instância.
    const lock = `${ws}:${campaignId}`;
    if (this.publishing.has(lock)) throw new ConflictException({ code: 'CONFLICT', message: 'Esta campanha já está sendo enviada para a Meta. Aguarde.' });
    this.publishing.add(lock);
    try {
      return await this.publishLocked(userId, ws, campaignId);
    } finally {
      this.publishing.delete(lock);
    }
  }

  /**
   * Piloto do estrategista (Fatia 4): mesmo miolo e mesma trava do "Publicar na Meta", sem papel de tela (o pacote foi aprovado por
   * dono/admin em Aprovações). Tudo nasce PAUSADO; ligar continua só pelo `setStatus` (manage). Auditoria sem ator, com a origem.
   */
  async publishAsSystem(ws: string, campaignId: string, via: { runId: string }) {
    const lock = `${ws}:${campaignId}`;
    if (this.publishing.has(lock)) throw new ConflictException({ code: 'CONFLICT', message: 'Esta campanha já está sendo enviada para a Meta. Aguarde.' });
    this.publishing.add(lock);
    try {
      return await this.publishLocked(null, ws, campaignId, via);
    } finally {
      this.publishing.delete(lock);
    }
  }

  private async publishLocked(userId: string | null, ws: string, campaignId: string, via?: { runId: string }) {
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: ws } });
    if (!c) throw notFound('Campanha não encontrada.');
    if (c.status === CAMPAIGN_FINISHED) throw new UserError(MSG_CAMPAIGN_ENDED);
    if (c.status !== 'approved' && c.status !== 'active') throw new UserError('A campanha precisa ser aprovada em Aprovações antes de ir para a Meta.');
    if (c.meta_campaign_id) throw new UserError('Esta campanha já foi enviada para a Meta. Use Ativar/Pausar.');
    if (!c.landing_url) throw new UserError('Preencha a página de destino (URL) da campanha antes de publicar.');
    const dailyBudget = requireDailyBudget(c.budget_daily);
    const endDay = campaignEndDay(c.end_date);
    assertCanPublishUntil(endDay);

    const [creatives, copies] = await Promise.all([
      this.prisma.creatives.findMany({ where: { campaign_id: c.id, workspace_id: ws, status: 'approved' }, select: { id: true, title: true, preview_url: true, thumbnail_url: true, status: true, angle: true } }),
      this.prisma.copies.findMany({ where: { campaign_id: c.id, workspace_id: ws }, select: { content: true, status: true }, orderBy: { version: 'desc' }, take: 10 }),
    ]);
    // Código estável: a tela leva direto aos criativos sem comparar texto.
    if (!creatives.length) throw new BadRequestException({ code: 'NO_APPROVED_CREATIVE', message: 'Aprove pelo menos um criativo desta campanha antes de publicar.' });
    // Copy aprovada mais recente (senão a última versão) e estratégia em vigor.
    const copy = ((copies.find((r) => r.status === 'approved') ?? copies[0])?.content ?? {}) as any;
    const strategy = await this.strategist.currentStrategy(ws, c.id);
    const adsConfig = readAdsConfig(c.ads_config);
    const privacyUrl = ((c.ads_config ?? {}) as { privacyUrl?: string | null }).privacyUrl ?? null;
    const landing = withUtm(c.landing_url, 'meta', 'paid', c.name);
    // Publicar cria tudo PAUSADO (meta_delivery_status = PAUSED): o guarda de entrega não bloqueia, mas fica registrado aqui.
    if (userId) await this.guards.assertCanSetDelivery(userId, ws, c.meta_delivery_status, 'PAUSED');

    let result;
    try {
      result = await guarded(() =>
        this.ops.publishPaused(ws, {
          name: c.name,
          objective: c.objective,
          dailyBudget,
          endDate: endDay,
          landingUrl: landing,
          primaryText: String(copy.meta_ad ?? copy.primary_text ?? c.offer_promise ?? c.name),
          headline: String(copy.headline ?? copy.headlines?.[0] ?? c.offer_product ?? c.name).slice(0, 40),
          audience: (c.audience ?? {}) as Record<string, unknown>,
          geoTargets: readGeoTargets(c.geo_targets),
          creatives: creatives.map((x) => ({ id: x.id, title: x.title, url: x.preview_url, thumb: x.thumbnail_url, angle: x.angle ?? null })),
          config: adsConfig,
          privacyUrl,
          strategyAudiences: (strategy?.publicos_meta ?? []).map((a) => ({ nome: a.nome, tipo: a.tipo, interesses: a.interesses })),
          angles: (strategy?.angulos_detalhados ?? []).map((a) => ({ nome: a.nome, gancho: a.gancho, mensagem: a.mensagem })),
        }),
      );
    } catch (e) {
      const text = (e as { response?: { message?: string } })?.response?.message ?? (e instanceof Error ? e.message : 'Falha ao publicar na Meta.');
      await this.prisma.publishing_jobs.create({ data: { workspace_id: ws, campaign_id: c.id, target: 'meta', status: 'failed', mode: 'live', log: text } });
      throw e;
    }
    await this.prisma.campaigns.update({
      where: { id: c.id },
      data: {
        meta_campaign_id: result.campaignId,
        meta_adset_id: result.adsetId,
        meta_adset_ids: result.adsetIds,
        meta_ad_ids: result.adIds,
        meta_ad_map: result.adMap as unknown as Prisma.InputJsonObject,
        meta_lead_form_id: result.leadFormId,
        meta_delivery_status: 'PAUSED',
      },
    });
    await this.prisma.publishing_jobs.create({
      data: {
        workspace_id: ws, campaign_id: c.id, target: 'meta', mode: 'live',
        status: result.steps.some((s) => s.status === 'failed') ? 'partial' : 'done',
        log: result.steps.map((s) => `${s.label}: ${s.detail}`).join('\n'),
      },
    });
    // No protótipo o navegador gravava a auditoria depois de publicar; agora é daqui.
    await this.activity.log(ws, userId, 'campaign.published', 'campaign', { campaign_id: c.id, mode: 'live', ...(via ? { via: 'pilot', run_id: via.runId } : {}) });
    return result;
  }

  /** Ativa/pausa na Meta — somente campanhas aprovadas. */
  async setStatus(userId: string, ws: string, campaignId: string, status: 'ACTIVE' | 'PAUSED', opts: { confirmOffer?: boolean } = {}) {
    await this.member(userId, ws, true);
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: ws } });
    if (!c?.meta_campaign_id) throw new UserError('Campanha ainda não publicada na Meta.');
    // Encerrada: pausar continua possível; reativar, não.
    if (status === 'ACTIVE' && c.status === CAMPAIGN_FINISHED) throw new UserError(MSG_CAMPAIGN_ENDED);
    // Período vencido: ligar de novo gastaria fora do combinado (e campanhas antigas não têm data de fim na Meta).
    if (status === 'ACTIVE') assertPeriodOpen(campaignEndDay(c.end_date));
    // 7.3 Ativar gasta verba: só dono/admin (guarda de entrega, mensagem do gatilho `guard_campaign_delivery`).
    await this.guards.assertCanSetDelivery(userId, ws, c.meta_delivery_status, status);
    if (status === 'ACTIVE' && c.status !== 'approved' && c.status !== 'active') throw new UserError('Só é possível ativar depois da aprovação em Aprovações.');
    const newStatus = status === 'ACTIVE' ? 'active' : c.status === 'active' ? 'approved' : c.status;
    await this.guards.assertCanSetCampaignStatus(userId, ws, c.status, newStatus);

    // Oferta definida no intake (`offer_terms`): ligar exige o "Confirmo que o Freela cumpre" de quem liga (dono/admin), gravado aqui (§0.7 #1).
    const terms = c.offer_terms && typeof c.offer_terms === 'object' ? (c.offer_terms as Record<string, unknown>) : null;
    if (status === 'ACTIVE' && terms && !terms['confirmed_at']) {
      if (!opts.confirmOffer) throw new BadRequestException({ code: 'OFFER_UNCONFIRMED', message: 'Confirme que o Freela cumpre a oferta antes de ligar.' });
      await this.prisma.campaigns.updateMany({
        where: { id: c.id, workspace_id: ws },
        data: { offer_terms: { ...terms, confirmed_by: userId, confirmed_at: new Date().toISOString() } as Prisma.InputJsonObject },
      });
    }
    // "Não usar esta arte" (conferência): o anúncio dessa arte continua pausado ao ligar.
    const excludedAds = await this.excludedAdIds(ws, c.id, c.meta_ad_map);
    const paused = await this.prisma.ai_recommendations.findMany({ where: { workspace_id: ws, campaign_id: c.id, action: 'pause_ad', status: 'applied' }, select: { payload: true } });
    const pausedByOptimizer = new Set(paused.map((r) => (r.payload as { adId?: string } | null)?.adId).filter(Boolean) as string[]);
    const adsetIds = (c.meta_adset_ids?.length ? c.meta_adset_ids : [c.meta_adset_id]).filter(Boolean) as string[];
    await guarded(() =>
      this.ops.setDeliveryStatus(
        ws,
        {
          campaignId: c.meta_campaign_id!,
          adsetIds,
          // Ao ativar, anúncios pausados pelo otimizador/regras continuam pausados.
          adIds: (c.meta_ad_ids ?? []).filter((id) => status === 'PAUSED' || (!pausedByOptimizer.has(id) && !excludedAds.has(id))),
        },
        status,
      ),
    );
    // Condicional: se a campanha foi encerrada enquanto a Meta ativava, ela não volta a "ativa" — pausa de novo e avisa.
    const upd = await this.prisma.campaigns.updateMany({ where: { id: c.id, workspace_id: ws, status: { not: CAMPAIGN_FINISHED } }, data: { meta_delivery_status: status, status: newStatus } });
    if (!upd.count) {
      if (status === 'ACTIVE') {
        const repaused = await this.ops
          .setDeliveryStatus(ws, { campaignId: c.meta_campaign_id!, adsetIds, adIds: c.meta_ad_ids ?? [] }, 'PAUSED')
          .then(() => true, () => false);
        // Se a nova pausa falhar, fica ACTIVE: a tela mostra "Pausar os canais de novo".
        await this.prisma.campaigns.updateMany({ where: { id: c.id, workspace_id: ws }, data: { meta_delivery_status: repaused ? 'PAUSED' : 'ACTIVE' } });
        throw new UserError(MSG_CAMPAIGN_ENDED);
      }
      await this.prisma.campaigns.updateMany({ where: { id: c.id, workspace_id: ws }, data: { meta_delivery_status: status } });
    }
    return { ok: true };
  }

  /** Ids dos anúncios (na Meta) de criativos marcados "Não usar esta arte". `meta_ad_map` = { adId: { creativeId, … } }. */
  private async excludedAdIds(ws: string, campaignId: string, adMap: unknown): Promise<Set<string>> {
    const rows = await this.prisma.creatives.findMany({ where: { campaign_id: campaignId, workspace_id: ws }, select: { id: true, extras: true } });
    const excluded = new Set(rows.filter((r) => (r.extras as { excluded_from_ads_at?: string } | null)?.excluded_from_ads_at).map((r) => r.id));
    const map = (adMap && typeof adMap === 'object' ? adMap : {}) as Record<string, { creativeId?: string }>;
    return new Set(Object.entries(map).filter(([, v]) => v?.creativeId && excluded.has(v.creativeId)).map(([adId]) => adId));
  }

  /** "Não usar esta arte" na conferência: pausa na Meta os anúncios dessa arte e marca o criativo, para o "Ligar" não os reativar. */
  async excludeCreative(userId: string, ws: string, campaignId: string, creativeId: string) {
    await this.member(userId, ws, true);
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: ws }, select: { id: true, meta_ad_map: true } });
    if (!c) throw notFound('Campanha não encontrada.');
    const cr = await this.prisma.creatives.findFirst({ where: { id: creativeId, campaign_id: c.id, workspace_id: ws }, select: { id: true, extras: true } });
    if (!cr) throw notFound('Criativo não encontrado.');
    const map = (c.meta_ad_map && typeof c.meta_ad_map === 'object' ? c.meta_ad_map : {}) as Record<string, { creativeId?: string }>;
    const adIds = Object.entries(map).filter(([, v]) => v?.creativeId === cr.id).map(([adId]) => adId);
    for (const adId of adIds) await guarded(() => this.ops.setAdStatus(ws, adId, 'PAUSED'));
    const extras = { ...((cr.extras as Record<string, unknown> | null) ?? {}), excluded_from_ads_at: new Date().toISOString() };
    await this.prisma.creatives.updateMany({ where: { id: cr.id, workspace_id: ws }, data: { extras: extras as Prisma.InputJsonObject } });
    await this.activity.log(ws, userId, 'campaign.creative_excluded', 'campaign', { campaign_id: c.id, creative_id: cr.id, ad_ids: adIds });
    return { ok: true, paused: adIds.length };
  }

  async saveApp(userId: string, ws: string, appId: string, appSecret: string) {
    await this.manager(userId, ws);
    await this.oauth.saveApp(ws, appId, appSecret);
    return { ok: true };
  }

  async loginUrl(userId: string, ws: string) {
    await this.manager(userId, ws);
    return guarded(async () => ({ url: await this.oauth.buildLoginUrl(ws, userId) }));
  }

  async listAssets(userId: string, ws: string) {
    await this.manager(userId, ws);
    return guarded(() => this.oauth.listAssets(ws));
  }

  async saveAssets(userId: string, d: MetaSaveAssetsDto) {
    await this.manager(userId, d.workspaceId);
    await this.oauth.saveAssets(d.workspaceId, { adAccountId: d.adAccountId, pageId: d.pageId, instagramId: d.instagramId ?? null });
    return { ok: true };
  }
}
