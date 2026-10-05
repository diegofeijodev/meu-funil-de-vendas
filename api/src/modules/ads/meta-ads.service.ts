/** As 11 server fns de `meta-ads.functions.ts` (`POST /v1/meta/meta-ads-*`, `meta-save-app`, `meta-login-url`, `meta-list-assets`, `meta-save-assets`). */
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
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
import { MetaOAuthService } from './meta-oauth.service';
import { MetaOpsService } from './meta-ops.service';
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

  private async publishLocked(userId: string, ws: string, campaignId: string) {
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: ws } });
    if (!c) throw notFound('Campanha não encontrada.');
    if (c.status !== 'approved' && c.status !== 'active') throw new UserError('A campanha precisa ser aprovada em Aprovações antes de ir para a Meta.');
    if (c.meta_campaign_id) throw new UserError('Esta campanha já foi enviada para a Meta. Use Ativar/Pausar.');
    if (!c.landing_url) throw new UserError('Preencha a página de destino (URL) da campanha antes de publicar.');

    const [creatives, copies] = await Promise.all([
      this.prisma.creatives.findMany({ where: { campaign_id: c.id, workspace_id: ws, status: 'approved' }, select: { id: true, title: true, preview_url: true, thumbnail_url: true, status: true, angle: true } }),
      this.prisma.copies.findMany({ where: { campaign_id: c.id, workspace_id: ws }, select: { content: true, status: true }, orderBy: { version: 'desc' }, take: 10 }),
    ]);
    if (!creatives.length) throw new UserError('Aprove pelo menos um criativo desta campanha antes de publicar.');
    // Copy aprovada mais recente (senão a última versão) e estratégia em vigor.
    const copy = ((copies.find((r) => r.status === 'approved') ?? copies[0])?.content ?? {}) as any;
    const strategy = await this.strategist.currentStrategy(ws, c.id);
    const adsConfig = readAdsConfig(c.ads_config);
    const privacyUrl = ((c.ads_config ?? {}) as { privacyUrl?: string | null }).privacyUrl ?? null;
    const sep = c.landing_url.includes('?') ? '&' : '?';
    const landing = `${c.landing_url}${sep}utm_source=meta&utm_medium=paid&utm_campaign=${encodeURIComponent(c.name)}`;
    // Publicar cria tudo PAUSADO (meta_delivery_status = PAUSED): o guarda de entrega não bloqueia, mas fica registrado aqui.
    await this.guards.assertCanSetDelivery(userId, ws, c.meta_delivery_status, 'PAUSED');

    let result;
    try {
      result = await guarded(() =>
        this.ops.publishPaused(ws, {
          name: c.name,
          objective: c.objective,
          dailyBudget: Number(c.budget_daily ?? 0) || 20,
          landingUrl: landing,
          primaryText: String(copy.meta_ad ?? copy.primary_text ?? c.offer_promise ?? c.name),
          headline: String(copy.headline ?? copy.headlines?.[0] ?? c.offer_product ?? c.name).slice(0, 40),
          audience: (c.audience ?? {}) as Record<string, unknown>,
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
    await this.activity.log(ws, userId, 'campaign.published', 'campaign', { campaign_id: c.id, mode: 'live' });
    return result;
  }

  /** Ativa/pausa na Meta — somente campanhas aprovadas. */
  async setStatus(userId: string, ws: string, campaignId: string, status: 'ACTIVE' | 'PAUSED') {
    await this.member(userId, ws, true);
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: ws } });
    if (!c?.meta_campaign_id) throw new UserError('Campanha ainda não publicada na Meta.');
    // 7.3 Ativar gasta verba: só dono/admin (guarda de entrega, mensagem do gatilho `guard_campaign_delivery`).
    await this.guards.assertCanSetDelivery(userId, ws, c.meta_delivery_status, status);
    if (status === 'ACTIVE' && c.status !== 'approved' && c.status !== 'active') throw new UserError('Só é possível ativar depois da aprovação em Aprovações.');
    const newStatus = status === 'ACTIVE' ? 'active' : c.status === 'active' ? 'approved' : c.status;
    await this.guards.assertCanSetCampaignStatus(userId, ws, c.status, newStatus);

    const paused = await this.prisma.ai_recommendations.findMany({ where: { workspace_id: ws, campaign_id: c.id, action: 'pause_ad', status: 'applied' }, select: { payload: true } });
    const pausedByOptimizer = new Set(paused.map((r) => (r.payload as { adId?: string } | null)?.adId).filter(Boolean) as string[]);
    await guarded(() =>
      this.ops.setDeliveryStatus(
        ws,
        {
          campaignId: c.meta_campaign_id!,
          adsetIds: (c.meta_adset_ids?.length ? c.meta_adset_ids : [c.meta_adset_id]).filter(Boolean) as string[],
          // Ao ativar, anúncios pausados pelo otimizador/regras continuam pausados.
          adIds: (c.meta_ad_ids ?? []).filter((id) => status === 'PAUSED' || !pausedByOptimizer.has(id)),
        },
        status,
      ),
    );
    await this.prisma.campaigns.update({ where: { id: c.id }, data: { meta_delivery_status: status, status: newStatus } });
    return { ok: true };
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
