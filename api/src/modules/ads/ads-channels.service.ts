/** As 7 server fns de `ads/channels.functions.ts` (Google Ads / TikTok Ads): `POST /v1/ads/<nome-em-kebab>`. */
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { AiService } from '../ai/ai.service';
import { CampaignGuardsService } from '../campaigns/campaign-guards.service';
import { notFound, UserError } from '../media/user-error';
import { StrategistService } from '../strategist/strategist.service';
import { VaultService } from '../vault/vault.service';
import { AdsChannel } from './ads.dto';
import { guarded } from './ads-errors';
import { onlyDigits } from './ads-ids';
import { GoogleAdsClient } from './google-ads.client';
import { OAuthStateService } from './oauth-state.service';
import { TikTokAdsClient } from './tiktok-ads.client';

/** Reserva de criação vencida (processo morreu no meio): outra tentativa pode assumir. */
const CREATE_LEASE_MS = 10 * 60 * 1000;

const GOOGLE_KEYS = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'];
const TIKTOK_KEYS = ['TIKTOK_APP_ID', 'TIKTOK_APP_SECRET', 'TIKTOK_ADVERTISER_ID'];
/** Ids de conta entram em caminho de URL do Google/TikTok: só números (o Google aceita traços na tela). */
const NUMERIC_KEYS: Record<string, { re: RegExp; msg: string }> = {
  GOOGLE_ADS_CUSTOMER_ID: { re: /^[\d-]{5,20}$/, msg: 'O ID da conta do Google Ads deve conter só números.' },
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: { re: /^[\d-]{5,20}$/, msg: 'O ID da conta administradora do Google Ads deve conter só números.' },
  TIKTOK_ADVERTISER_ID: { re: /^\d{5,25}$/, msg: 'O ID da conta de anúncios do TikTok deve conter só números.' },
};

const SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titulos', 'descricoes', 'palavras_chave'],
  properties: {
    titulos: { type: 'array', items: { type: 'string' } },
    descricoes: { type: 'array', items: { type: 'string' } },
    palavras_chave: { type: 'array', items: { type: 'string' } },
  },
};

@Injectable()
export class AdsChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly guards: CampaignGuardsService,
    private readonly vault: VaultService,
    private readonly google: GoogleAdsClient,
    private readonly tiktok: TikTokAdsClient,
    private readonly states: OAuthStateService,
    private readonly ai: AiService,
    private readonly strategist: StrategistService,
    @Inject(ENV) private readonly env: Pick<Env, 'PUBLIC_URL' | 'APP_URL'>,
  ) {}

  redirectUri(channel: AdsChannel): string {
    return `${this.env.PUBLIC_URL.replace(/\/$/, '')}/api/public/ads/oauth/${channel}`;
  }

  /** Para onde o callback devolve o navegador (`/integrations?ads=<canal>` | `?ads_erro=…`). */
  backUrl(q: { ads?: string; ads_erro?: string }): string {
    const to = new URL('/integrations', this.env.APP_URL);
    if (q.ads) to.searchParams.set('ads', q.ads);
    if (q.ads_erro) to.searchParams.set('ads_erro', q.ads_erro.slice(0, 300));
    return to.toString();
  }

  async status(userId: string, ws: string) {
    await this.access.require(userId, ws, 'read');
    const [google, tiktok] = await Promise.all([this.google.missing(ws), this.tiktok.missing(ws)]);
    return { google, tiktok };
  }

  async saveApp(userId: string, ws: string, channel: AdsChannel, values: Record<string, string>) {
    await this.access.require(userId, ws, 'manage');
    const allowed = channel === 'google' ? GOOGLE_KEYS : TIKTOK_KEYS;
    const rows: Record<string, string> = {};
    for (const [k, raw] of Object.entries(values ?? {})) {
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (!allowed.includes(k) || !v) continue;
      if (v.length > 500) throw new UserError('Valor grande demais.');
      const rule = NUMERIC_KEYS[k];
      if (rule && !rule.re.test(v)) throw new UserError(rule.msg);
      rows[k] = v;
    }
    if (!Object.keys(rows).length) throw new UserError('Nada para salvar.');
    await this.vault.set(ws, rows);
    return { ok: true };
  }

  /** Link do login (Google OAuth ou autorização do TikTok for Business). `origin` do cliente é ignorado: o retorno é a API (PUBLIC_URL). */
  async loginUrl(userId: string, ws: string, channel: AdsChannel) {
    await this.access.require(userId, ws, 'manage');
    if (channel === 'google') {
      const c = await this.google.creds(ws);
      if (!c.clientId || !c.clientSecret) throw new UserError('Salve o ID e a chave secreta do cliente OAuth primeiro.');
      return { url: this.google.loginUrl(c.clientId, this.redirectUri('google'), await this.states.issue('google', ws, userId)) };
    }
    const c = await this.tiktok.creds(ws);
    if (!c.appId || !c.secret) throw new UserError('Salve o App ID e o Secret do app do TikTok primeiro.');
    return { url: this.tiktok.loginUrl(c.appId, this.redirectUri('tiktok'), await this.states.issue('tiktok', ws, userId)) };
  }

  /** Retorno do login: consome o `state` (uso único), confere que quem iniciou ainda é owner|admin e troca o código. */
  async finishLogin(channel: AdsChannel, code: string, state: string): Promise<void> {
    const { workspaceId, userId } = await this.states.consume(channel, state);
    if (!(await this.access.can(userId, workspaceId, 'manage'))) throw new UserError('Só o dono ou um administrador conecta as contas de anúncios.');
    await guarded(async () => {
      if (channel === 'google') await this.google.exchangeCode(workspaceId, code, this.redirectUri('google'));
      else await this.tiktok.exchangeCode(workspaceId, code);
    });
  }

  async listAccounts(userId: string, ws: string, channel: AdsChannel) {
    await this.access.require(userId, ws, 'manage');
    return guarded(async () => {
      if (channel === 'google') return (await this.google.listCustomers(ws)).map((c) => ({ id: c.id, name: `${c.name}${c.manager ? ' (administradora)' : ''}` }));
      return this.tiktok.listAdvertisers(ws);
    });
  }

  /** Liga uma campanha já existente no canal à campanha do app (para trazer os resultados). */
  async link(userId: string, campaignId: string, channel: AdsChannel, externalId: string) {
    const c = await this.guards.resolveCampaign(userId, campaignId, 'write');
    const col = channel === 'google' ? 'google_campaign_id' : 'tiktok_campaign_id';
    await this.prisma.campaigns.update({ where: { id: c.id }, data: { [col]: onlyDigits(externalId) || null } });
    return { ok: true };
  }

  /**
   * Reserva atômica (vale entre instâncias): só uma requisição por campanha/canal cria a campanha externa. Duplo clique ou
   * retry → 409, sem segunda chamada de IA nem campanha órfã. Reserva vencida (>10 min) pode ser reassumida.
   */
  private async claim(id: string, ws: string, channel: AdsChannel): Promise<void> {
    const p = channel === 'google' ? 'google' : 'tiktok';
    const stale = new Date(Date.now() - CREATE_LEASE_MS);
    const r = await this.prisma.campaigns.updateMany({
      where: { id, workspace_id: ws, [`${p}_campaign_id`]: null, OR: [{ [`${p}_creating_at`]: null }, { [`${p}_creating_at`]: { lt: stale } }] },
      data: { [`${p}_creating_at`]: new Date() },
    });
    if (r.count !== 1) throw new ConflictException({ code: 'CONFLICT', message: `Esta campanha já está sendo enviada para o ${channel === 'google' ? 'Google' : 'TikTok'}. Aguarde.` });
  }

  private async release(id: string, ws: string, channel: AdsChannel): Promise<void> {
    const col = channel === 'google' ? 'google_creating_at' : 'tiktok_creating_at';
    await this.prisma.campaigns.updateMany({ where: { id, workspace_id: ws }, data: { [col]: null } }).catch(() => undefined);
  }

  /** Cria a campanha pausada no Google (Pesquisa) ou no TikTok (vídeo) a partir da copy, da estratégia e dos criativos aprovados. */
  async create(userId: string, campaignId: string, channel: AdsChannel) {
    const base = await this.guards.resolveCampaign(userId, campaignId, 'write');
    const c = await this.prisma.campaigns.findFirst({ where: { id: base.id, workspace_id: base.workspace_id }, include: { brand: { select: { name: true, logo_url: true } } } });
    if (!c) throw notFound('Campanha não encontrada.');
    if (c.status !== 'approved' && c.status !== 'active') throw new UserError('A campanha precisa ser aprovada antes de ir para outros canais.');
    if (!c.landing_url) throw new UserError('Preencha a página de destino da campanha.');
    const ws = c.workspace_id;
    const copies = await this.prisma.copies.findMany({ where: { campaign_id: c.id, workspace_id: ws }, select: { content: true, status: true }, orderBy: { version: 'desc' }, take: 10 });
    const copy = ((copies.find((r) => r.status === 'approved') ?? copies[0])?.content ?? {}) as any;
    const strategy = await this.strategist.currentStrategy(ws, c.id);
    const sep = c.landing_url.includes('?') ? '&' : '?';

    if (channel === 'google') {
      if (c.google_campaign_id) throw new UserError('Esta campanha já tem campanha ligada no Google Ads.');
      await this.claim(c.id, ws, 'google');
      try {
        // Títulos (≤30), descrições (≤90) e palavras-chave no formato do Google, escritos pela IA a partir da copy e da estratégia.
        const ai = (await this.ai.json(ws, {
          prompt: [
            'Você é especialista em Google Ads de Pesquisa no Brasil. Gere em português:',
            '- titulos: 12 a 15 títulos com NO MÁXIMO 30 caracteres cada (contando espaços), sem pontuação de exclamação repetida;',
            '- descricoes: 4 descrições com NO MÁXIMO 90 caracteres;',
            '- palavras_chave: 12 a 20 termos que o cliente digitaria no Google (sem marcas de concorrentes).',
            `OFERTA: ${JSON.stringify({ produto: c.offer_product, promessa: c.offer_promise, preco: c.offer_price, publico: c.audience })}`,
            `COPY: ${JSON.stringify({ headline: copy.headline, variacoes: copy.headline_variacoes, texto: copy.texto_curto, cta: copy.cta })}`,
            `ESTRATÉGIA: ${JSON.stringify({ big_idea: strategy?.big_idea, angulos: strategy?.angulos_detalhados?.map((a) => a.gancho) })}`,
          ].join('\n'),
          schema: SEARCH_SCHEMA,
          name: 'google_search_assets',
        })) as { titulos?: string[]; descricoes?: string[]; palavras_chave?: string[] };
        const r = await guarded(() =>
          this.google.createSearchCampaign(ws, {
            name: c.name,
            objective: c.objective,
            dailyBudget: Number(c.budget_daily ?? 0) || 20,
            landingUrl: `${c.landing_url}${sep}utm_source=google&utm_medium=cpc&utm_campaign=${encodeURIComponent(c.name)}`,
            headlines: ai.titulos ?? [],
            descriptions: ai.descricoes ?? [],
            keywords: ai.palavras_chave ?? [],
          }),
        );
        await this.prisma.campaigns.update({ where: { id: c.id }, data: { google_campaign_id: r.campaignId, google_status: 'PAUSED', google_creating_at: null } });
        return r;
      } catch (e) {
        await this.release(c.id, ws, 'google');
        throw e;
      }
    }

    if (c.tiktok_campaign_id) throw new UserError('Esta campanha já tem campanha ligada no TikTok Ads.');
    const creatives = await this.prisma.creatives.findMany({ where: { campaign_id: c.id, workspace_id: ws, status: 'approved' }, select: { title: true, preview_url: true, extras: true } });
    const videos = creatives
      .filter((x) => x.preview_url && /\.mp4(\?|$)/i.test(x.preview_url))
      .map((x) => ({ title: x.title, url: x.preview_url!, cover: ((x.extras ?? {}) as { cover_url?: string | null }).cover_url ?? null }));
    if (!videos.length) throw new UserError('O TikTok só aceita vídeo: aprove pelo menos um criativo em vídeo desta campanha.');
    await this.claim(c.id, ws, 'tiktok');
    try {
      const r = await guarded(() =>
        this.tiktok.createCampaign(ws, {
          name: c.name,
          objective: c.objective,
          dailyBudget: Number(c.budget_daily ?? 0) || 50,
          landingUrl: `${c.landing_url}${sep}utm_source=tiktok&utm_medium=paid&utm_campaign=${encodeURIComponent(c.name)}`,
          adText: String(copy.headline ?? c.offer_promise ?? c.name),
          brandName: c.brand?.name ?? c.name,
          logoUrl: c.brand?.logo_url ?? null,
          videos,
        }),
      );
      await this.prisma.campaigns.update({ where: { id: c.id }, data: { tiktok_campaign_id: r.campaignId, tiktok_status: 'DISABLE', tiktok_creating_at: null } satisfies Prisma.campaignsUpdateInput });
      return r;
    } catch (e) {
      await this.release(c.id, ws, 'tiktok');
      throw e;
    }
  }

  /** Ativar (só dono/admin, gasta verba) ou pausar no canal. */
  async setStatus(userId: string, campaignId: string, channel: AdsChannel, active: boolean) {
    const base = await this.guards.resolveCampaign(userId, campaignId, active ? 'manage' : 'write');
    const c = await this.prisma.campaigns.findFirst({ where: { id: base.id, workspace_id: base.workspace_id } });
    if (!c) throw notFound('Campanha não encontrada.');
    if (channel === 'google') {
      if (!c.google_campaign_id) throw new UserError('Sem campanha no Google Ads.');
      await guarded(() => this.google.setStatus(c.workspace_id, c.google_campaign_id!, active ? 'ENABLED' : 'PAUSED'));
      await this.prisma.campaigns.update({ where: { id: c.id }, data: { google_status: active ? 'ENABLED' : 'PAUSED' } });
    } else {
      if (!c.tiktok_campaign_id) throw new UserError('Sem campanha no TikTok Ads.');
      await guarded(() => this.tiktok.setStatus(c.workspace_id, c.tiktok_campaign_id!, active ? 'ENABLE' : 'DISABLE'));
      await this.prisma.campaigns.update({ where: { id: c.id }, data: { tiktok_status: active ? 'ENABLE' : 'DISABLE' } });
    }
    return { ok: true };
  }
}
