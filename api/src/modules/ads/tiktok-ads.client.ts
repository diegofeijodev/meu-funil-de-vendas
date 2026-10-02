/**
 * TikTok Ads (porte de `ads/tiktok-ads.server.ts`) pela TikTok API for Business v1.3: login (OAuth do app), resultados diários por
 * campanha e criação de campanha + grupo + anúncios em vídeo DESATIVADOS.
 */
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { addDays, todaySp } from '../../common/time/dates';
import { Env } from '../../common/config/env.validation';
import { VaultService } from '../vault/vault.service';
import { ADS_FETCH, AdsFetch } from './ads-fetch';
import { AdsProviderError, AdsSetupError } from './ads-errors';
import { isDigits } from './ads-ids';
import { ChannelStep, ExternalDailyRow } from './google-ads.client';

const BASE = 'https://business-api.tiktok.com/open_api/v1.3';
export type TikTokCampaignInput = { name: string; objective: string; dailyBudget: number; landingUrl: string; adText: string; brandName: string; logoUrl: string | null; videos: { title: string; url: string; cover: string | null }[] };
const msg = (e: unknown) => (e instanceof Error ? e.message : 'falhou');

@Injectable()
export class TikTokAdsClient {
  constructor(
    private readonly vault: VaultService,
    @Inject(ADS_FETCH) private readonly http: AdsFetch,
    @Inject(ENV) private readonly env: Pick<Env, 'TIKTOK_APP_ID' | 'TIKTOK_APP_SECRET'>,
  ) {}

  async creds(ws: string) {
    const pick = async (k: string, envValue?: string) => (await this.vault.get(ws, k)) ?? (await this.vault.get(null, k)) ?? (envValue?.trim() || null);
    const [appId, secret, token, advertiserId] = await Promise.all([
      pick('TIKTOK_APP_ID', this.env.TIKTOK_APP_ID),
      pick('TIKTOK_APP_SECRET', this.env.TIKTOK_APP_SECRET),
      this.vault.get(ws, 'TIKTOK_ACCESS_TOKEN'),
      this.vault.get(ws, 'TIKTOK_ADVERTISER_ID'),
    ]);
    return { appId, secret, token, advertiserId };
  }

  async missing(ws: string): Promise<string[]> {
    const c = await this.creds(ws);
    const miss: string[] = [];
    if (!c.appId) miss.push('App ID');
    if (!c.secret) miss.push('Secret do app');
    if (!c.token) miss.push('Login com TikTok');
    if (!c.advertiserId) miss.push('Conta de anúncios');
    return miss;
  }

  loginUrl(appId: string, redirectUri: string, state: string): string {
    return `https://business-api.tiktok.com/portal/auth?${new URLSearchParams({ app_id: appId, state, redirect_uri: redirectUri })}`;
  }

  private async req<T = any>(token: string | null, path: string, opts: { method?: 'GET' | 'POST'; query?: Record<string, unknown>; body?: unknown } = {}): Promise<T> {
    const qs = opts.query ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))}` : '';
    let res: Response;
    try {
      res = await this.http(`${BASE}${path}${qs}`, {
        method: opts.method ?? 'GET',
        headers: { ...(token ? { 'Access-Token': token } : {}), 'Content-Type': 'application/json' },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new AdsProviderError('Não foi possível falar com o TikTok agora. Tente de novo em instantes.');
    }
    const j = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: T };
    if (!res.ok || (j.code !== undefined && j.code !== 0)) throw new AdsProviderError(`TikTok: ${j.message ?? `HTTP ${res.status}`} (código ${j.code ?? res.status})`);
    return j.data as T;
  }

  async exchangeCode(ws: string, authCode: string) {
    const c = await this.creds(ws);
    if (!c.appId || !c.secret) throw new AdsSetupError('Salve o App ID e o Secret do app do TikTok.');
    const data = await this.req<{ access_token: string; advertiser_ids?: string[] }>(null, '/oauth2/access_token/', { method: 'POST', body: { app_id: c.appId, secret: c.secret, auth_code: authCode } });
    const one: Record<string, string> = data.advertiser_ids?.length === 1 && isDigits(data.advertiser_ids[0]) ? { TIKTOK_ADVERTISER_ID: data.advertiser_ids[0]! } : {};
    await this.vault.set(ws, { TIKTOK_ACCESS_TOKEN: data.access_token, ...one });
    return { advertisers: data.advertiser_ids ?? [] };
  }

  async listAdvertisers(ws: string) {
    const c = await this.creds(ws);
    if (!c.token || !c.appId || !c.secret) throw new AdsSetupError('Entre com o TikTok primeiro.');
    const data = await this.req<{ list?: { advertiser_id: string; advertiser_name: string }[] }>(c.token, '/oauth2/advertiser/get/', { query: { app_id: c.appId, secret: c.secret } });
    return (data.list ?? []).map((a) => ({ id: String(a.advertiser_id), name: a.advertiser_name }));
  }

  async dailyResults(ws: string, campaignIds: string[], days = 7, range?: { since: string; until: string }): Promise<ExternalDailyRow[]> {
    const c = await this.creds(ws);
    const ids = campaignIds.filter(isDigits);
    if (!c.token || !c.advertiserId || !ids.length) return [];
    const data = await this.req<{ list?: { dimensions: Record<string, string>; metrics: Record<string, string> }[] }>(c.token, '/report/integrated/get/', {
      query: {
        advertiser_id: c.advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: ['campaign_id', 'stat_time_day'],
        metrics: ['campaign_name', 'spend', 'impressions', 'clicks', 'conversion'],
        start_date: range?.since ?? addDays(todaySp(), -days),
        end_date: range?.until ?? todaySp(),
        filtering: [{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify(ids) }],
        page_size: 1000,
      },
    });
    return (data.list ?? []).map((r) => ({
      externalCampaignId: String(r.dimensions['campaign_id']),
      date: String(r.dimensions['stat_time_day']).slice(0, 10),
      name: String(r.metrics['campaign_name'] ?? ''),
      spend: Number(r.metrics['spend'] ?? 0),
      impressions: Number(r.metrics['impressions'] ?? 0),
      clicks: Number(r.metrics['clicks'] ?? 0),
      conversions: Number(r.metrics['conversion'] ?? 0),
      revenue: 0,
    }));
  }

  /** Campanha + grupo + anúncios em vídeo, tudo desativado (DISABLE) até ativar. Brasil, posicionamento automático. */
  async createCampaign(ws: string, input: TikTokCampaignInput) {
    const c = await this.creds(ws);
    if (!c.token || !c.advertiserId) throw new AdsSetupError('Conecte o TikTok e escolha a conta de anúncios em Integrações.');
    const adv = c.advertiserId;
    const steps: ChannelStep[] = [];
    const leads = /lead/i.test(input.objective);
    const camp = await this.req<{ campaign_id: string }>(c.token, '/campaign/create/', {
      method: 'POST',
      body: { advertiser_id: adv, campaign_name: input.name.slice(0, 512), objective_type: leads ? 'LEAD_GENERATION' : 'TRAFFIC', budget_mode: 'BUDGET_MODE_INFINITE', operation_status: 'DISABLE' },
    });
    steps.push({ label: 'Campanha criada (desativada)', status: 'done', detail: camp.campaign_id });
    const group = await this.req<{ adgroup_id: string }>(c.token, '/adgroup/create/', {
      method: 'POST',
      body: {
        advertiser_id: adv,
        campaign_id: camp.campaign_id,
        adgroup_name: `${input.name} · Grupo 1`.slice(0, 512),
        promotion_type: 'WEBSITE',
        placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
        location_ids: ['3469034'],
        budget_mode: 'BUDGET_MODE_DAY',
        budget: Math.max(50, Math.round(input.dailyBudget)),
        schedule_type: 'SCHEDULE_FROM_NOW',
        schedule_start_time: new Date(Date.now() + 10 * 60e3).toISOString().replace('T', ' ').slice(0, 19),
        optimization_goal: 'CLICK',
        billing_event: 'CPC',
        bid_type: 'BID_TYPE_NO_BID',
        operation_status: 'DISABLE',
      },
    });
    steps.push({ label: 'Grupo criado (Brasil, posicionamento automático)', status: 'done', detail: group.adgroup_id });

    // Identidade de anunciante personalizada (nome + logo da marca).
    let identityId: string | null = null;
    try {
      const ids = await this.req<{ identity_list?: { identity_id: string; display_name: string }[] }>(c.token, '/identity/get/', { query: { advertiser_id: adv, identity_type: 'CUSTOMIZED_USER' } });
      identityId = ids.identity_list?.[0]?.identity_id ?? null;
      if (!identityId && input.logoUrl) {
        const logo = await this.req<{ image_id: string }>(c.token, '/file/image/ad/upload/', { method: 'POST', body: { advertiser_id: adv, upload_type: 'UPLOAD_BY_URL', image_url: input.logoUrl } });
        const created = await this.req<{ identity_id: string }>(c.token, '/identity/create/', { method: 'POST', body: { advertiser_id: adv, display_name: input.brandName.slice(0, 40), image_uri: logo.image_id } });
        identityId = created.identity_id;
      }
    } catch (e) {
      steps.push({ label: 'Identidade do anunciante', status: 'failed', detail: msg(e) });
    }
    if (!identityId) {
      steps.push({ label: 'Anúncios', status: 'failed', detail: 'Sem identidade de anunciante: cadastre o logo da marca ou crie uma identidade no TikTok Ads Manager.' });
      return { campaignId: camp.campaign_id, adgroupId: group.adgroup_id, steps };
    }
    for (const v of input.videos.slice(0, 5)) {
      try {
        const vid = await this.req<{ video_id: string }[] | { video_id: string }>(c.token, '/file/video/ad/upload/', {
          method: 'POST',
          body: { advertiser_id: adv, upload_type: 'UPLOAD_BY_URL', video_url: v.url, file_name: `${v.title.slice(0, 60)}-${Date.now()}.mp4` },
        });
        const videoId = Array.isArray(vid) ? vid[0]?.video_id : vid.video_id;
        if (!videoId) throw new Error('upload do vídeo sem id');
        const coverId = v.cover
          ? (await this.req<{ image_id: string }>(c.token, '/file/image/ad/upload/', { method: 'POST', body: { advertiser_id: adv, upload_type: 'UPLOAD_BY_URL', image_url: v.cover } })).image_id
          : null;
        await this.req(c.token, '/ad/create/', {
          method: 'POST',
          body: {
            advertiser_id: adv,
            adgroup_id: group.adgroup_id,
            creatives: [
              {
                ad_name: v.title.slice(0, 100),
                identity_type: 'CUSTOMIZED_USER',
                identity_id: identityId,
                ad_format: 'SINGLE_VIDEO',
                video_id: videoId,
                ...(coverId ? { image_ids: [coverId] } : {}),
                ad_text: input.adText.slice(0, 100),
                call_to_action: 'LEARN_MORE',
                landing_page_url: input.landingUrl,
              },
            ],
          },
        });
        steps.push({ label: `Anúncio "${v.title}" criado`, status: 'done', detail: videoId });
      } catch (e) {
        steps.push({ label: `Anúncio "${v.title}"`, status: 'failed', detail: msg(e) });
      }
    }
    return { campaignId: camp.campaign_id, adgroupId: group.adgroup_id, steps };
  }

  async setStatus(ws: string, campaignId: string, status: 'ENABLE' | 'DISABLE') {
    const c = await this.creds(ws);
    if (!c.token || !c.advertiserId) throw new AdsSetupError('TikTok não conectado.');
    if (!isDigits(campaignId)) throw new AdsSetupError('ID da campanha do TikTok inválido.');
    await this.req(c.token, '/campaign/status/update/', { method: 'POST', body: { advertiser_id: c.advertiserId, campaign_ids: [campaignId], operation_status: status } });
  }
}
