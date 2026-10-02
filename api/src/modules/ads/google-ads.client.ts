/**
 * Google Ads (porte de `ads/google-ads.server.ts`): login com Google (OAuth, refresh token), resultados diários e criação de
 * campanha de Pesquisa PAUSADA com anúncio responsivo e palavras-chave. Exige token de desenvolvedor aprovado no Google Ads.
 */
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { addDays, todaySp } from '../../common/time/dates';
import { Env } from '../../common/config/env.validation';
import { VaultService } from '../vault/vault.service';
import { ADS_FETCH, AdsFetch } from './ads-fetch';
import { AdsProviderError, AdsSetupError } from './ads-errors';
import { isDigits } from './ads-ids';

const SCOPE = 'https://www.googleapis.com/auth/adwords';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

type Creds = { clientId: string | null; clientSecret: string | null; developerToken: string | null; refreshToken: string | null; customerId: string | null; loginCustomerId: string | null };
export type ExternalDailyRow = { externalCampaignId: string; date: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number; name: string };
export type GoogleCampaignInput = { name: string; objective: string; dailyBudget: number; landingUrl: string; headlines: string[]; descriptions: string[]; keywords: string[] };
export type ChannelStep = { label: string; status: 'done' | 'failed'; detail: string };

const cleanId = (v: string | null) => (v ? v.replace(/-/g, '') : null);
const msg = (e: unknown) => (e instanceof Error ? e.message : 'falhou');

@Injectable()
export class GoogleAdsClient {
  constructor(
    private readonly vault: VaultService,
    @Inject(ADS_FETCH) private readonly http: AdsFetch,
    @Inject(ENV) private readonly env: Pick<Env, 'GOOGLE_ADS_API_VERSION' | 'GOOGLE_ADS_CLIENT_ID' | 'GOOGLE_ADS_CLIENT_SECRET' | 'GOOGLE_ADS_DEVELOPER_TOKEN'>,
  ) {}

  private get base() {
    return `https://googleads.googleapis.com/${this.env.GOOGLE_ADS_API_VERSION || 'v21'}`;
  }

  /** Cofre da empresa → cofre global → ambiente. */
  private async pick(ws: string, key: string, envName?: keyof Env & string): Promise<string | null> {
    const fromEnv = envName ? ((this.env as unknown as Record<string, string | undefined>)[envName] ?? null) : null;
    return (await this.vault.get(ws, key)) ?? (await this.vault.get(null, key)) ?? (fromEnv?.trim() || null);
  }

  async creds(ws: string): Promise<Creds> {
    const [clientId, clientSecret, developerToken, refreshToken, customerId, loginCustomerId] = await Promise.all([
      this.pick(ws, 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_ID'),
      this.pick(ws, 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_CLIENT_SECRET'),
      this.pick(ws, 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_DEVELOPER_TOKEN'),
      this.vault.get(ws, 'GOOGLE_ADS_REFRESH_TOKEN'),
      this.vault.get(ws, 'GOOGLE_ADS_CUSTOMER_ID'),
      this.vault.get(ws, 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
    ]);
    return { clientId, clientSecret, developerToken, refreshToken, customerId: cleanId(customerId), loginCustomerId: cleanId(loginCustomerId) };
  }

  async missing(ws: string): Promise<string[]> {
    const c = await this.creds(ws);
    const miss: string[] = [];
    if (!c.clientId) miss.push('ID do cliente OAuth');
    if (!c.clientSecret) miss.push('Chave secreta do cliente OAuth');
    if (!c.developerToken) miss.push('Token de desenvolvedor');
    if (!c.refreshToken) miss.push('Login com Google');
    if (!c.customerId) miss.push('Conta do Google Ads');
    return miss;
  }

  loginUrl(clientId: string, redirectUri: string, state: string): string {
    const qs = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`;
  }

  async exchangeCode(ws: string, code: string, redirectUri: string): Promise<void> {
    const c = await this.creds(ws);
    if (!c.clientId || !c.clientSecret) throw new AdsSetupError('Salve o ID e a chave secreta do cliente OAuth do Google.');
    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json().catch(() => ({}))) as { refresh_token?: string; error_description?: string };
    if (!res.ok || !j.refresh_token) throw new AdsProviderError(j.error_description ?? 'O Google não devolveu o refresh token. Tente de novo.');
    await this.vault.set(ws, { GOOGLE_ADS_REFRESH_TOKEN: j.refresh_token });
  }

  private async accessToken(c: Creds): Promise<string> {
    if (!c.clientId || !c.clientSecret || !c.refreshToken) throw new AdsSetupError('Google Ads não conectado nesta empresa.');
    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
    if (!res.ok || !j.access_token) throw new AdsProviderError(`Login com Google expirou: ${j.error_description ?? res.status}. Entre de novo.`);
    return j.access_token;
  }

  private async call<T = any>(ws: string, path: string, body?: unknown, method = 'POST'): Promise<T> {
    const c = await this.creds(ws);
    if (!c.developerToken) throw new AdsSetupError('Token de desenvolvedor do Google Ads não configurado.');
    const token = await this.accessToken(c);
    const res = await this.http(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': c.developerToken,
        'Content-Type': 'application/json',
        ...(c.loginCustomerId && isDigits(c.loginCustomerId) ? { 'login-customer-id': c.loginCustomerId } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let j: any = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      j = { raw: text };
    }
    if (!res.ok) {
      const detail = j?.error?.details?.[0]?.errors?.map((e: any) => e.message).join(' · ') || j?.error?.message || `HTTP ${res.status}`;
      throw new AdsProviderError(`Google Ads: ${detail}`);
    }
    return j as T;
  }

  private customer(c: Creds): string {
    if (!c.customerId) throw new AdsSetupError('Escolha a conta do Google Ads em Integrações.');
    if (!isDigits(c.customerId)) throw new AdsSetupError('O ID da conta do Google Ads é inválido (use só números).');
    return c.customerId;
  }

  /** Contas que o login enxerga (para escolher na tela). */
  async listCustomers(ws: string) {
    const r = await this.call<{ resourceNames?: string[] }>(ws, '/customers:listAccessibleCustomers', undefined, 'GET');
    const ids = (r.resourceNames ?? []).map((n) => n.split('/')[1] ?? '').filter(isDigits);
    const out: { id: string; name: string; manager: boolean }[] = [];
    for (const id of ids.slice(0, 50)) {
      try {
        const q = await this.call<{ results?: any[] }>(ws, `/customers/${id}/googleAds:search`, { query: 'SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1' });
        const row = q.results?.[0]?.customer;
        out.push({ id, name: row?.descriptiveName ?? id, manager: !!row?.manager });
      } catch {
        out.push({ id, name: id, manager: false });
      }
    }
    return out;
  }

  /** Resultados diários das campanhas informadas (custos em micros convertidos para reais). */
  async dailyResults(ws: string, campaignIds: string[], days = 7, range?: { since: string; until: string }): Promise<ExternalDailyRow[]> {
    const c = await this.creds(ws);
    const ids = campaignIds.filter(isDigits);
    if (!c.customerId || !ids.length) return [];
    const cid = this.customer(c);
    const since = range?.since ?? addDays(todaySp(), -days);
    const until = range?.until ?? todaySp();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new AdsSetupError('Período inválido.');
    const r = await this.call<{ results?: any[] }>(ws, `/customers/${cid}/googleAds:search`, {
      query: `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE campaign.id IN (${ids.join(',')}) AND segments.date BETWEEN '${since}' AND '${until}'`,
    });
    return (r.results ?? []).map((x) => ({
      externalCampaignId: String(x.campaign?.id),
      name: String(x.campaign?.name ?? ''),
      date: String(x.segments?.date),
      spend: Number(x.metrics?.costMicros ?? 0) / 1e6,
      impressions: Number(x.metrics?.impressions ?? 0),
      clicks: Number(x.metrics?.clicks ?? 0),
      conversions: Number(x.metrics?.conversions ?? 0),
      revenue: Number(x.metrics?.conversionsValue ?? 0),
    }));
  }

  /** Cria campanha de Pesquisa PAUSADA: verba, campanha (Brasil, português), grupo, palavras-chave e anúncio responsivo. */
  async createSearchCampaign(ws: string, input: GoogleCampaignInput) {
    const cid = this.customer(await this.creds(ws));
    const steps: ChannelStep[] = [];
    const budget = await this.call<{ results: { resourceName: string }[] }>(ws, `/customers/${cid}/campaignBudgets:mutate`, {
      operations: [{ create: { name: `${input.name} · verba ${Date.now()}`, amountMicros: String(Math.max(1, Math.round(input.dailyBudget)) * 1_000_000), deliveryMethod: 'STANDARD', explicitlyShared: false } }],
    });
    steps.push({ label: 'Verba diária criada', status: 'done', detail: budget.results[0]!.resourceName });
    const wantsConversions = /lead|venda|sale|convers|whats/i.test(input.objective);
    const campaign = await this.call<{ results: { resourceName: string }[] }>(ws, `/customers/${cid}/campaigns:mutate`, {
      operations: [
        {
          create: {
            name: input.name,
            status: 'PAUSED',
            advertisingChannelType: 'SEARCH',
            campaignBudget: budget.results[0]!.resourceName,
            ...(wantsConversions ? { maximizeConversions: {} } : { targetSpend: {} }),
            networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false },
            containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
          },
        },
      ],
    });
    const campaignRn = campaign.results[0]!.resourceName;
    const campaignId = campaignRn.split('/').pop()!;
    steps.push({ label: 'Campanha de Pesquisa criada (pausada)', status: 'done', detail: campaignId });
    try {
      await this.call(ws, `/customers/${cid}/campaignCriteria:mutate`, {
        operations: [
          { create: { campaign: campaignRn, location: { geoTargetConstant: 'geoTargetConstants/2076' } } },
          { create: { campaign: campaignRn, language: { languageConstant: 'languageConstants/1014' } } },
        ],
      });
      steps.push({ label: 'Público: Brasil, português', status: 'done', detail: '' });
    } catch (e) {
      steps.push({ label: 'Localização e idioma', status: 'failed', detail: msg(e) });
    }
    const adGroup = await this.call<{ results: { resourceName: string }[] }>(ws, `/customers/${cid}/adGroups:mutate`, {
      operations: [{ create: { name: `${input.name} · Grupo 1`, campaign: campaignRn, status: 'ENABLED', type: 'SEARCH_STANDARD' } }],
    });
    const adGroupRn = adGroup.results[0]!.resourceName;
    steps.push({ label: 'Grupo de anúncios criado', status: 'done', detail: adGroupRn.split('/').pop()! });
    const kws = [...new Set(input.keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 2))].slice(0, 20);
    if (kws.length) {
      try {
        await this.call(ws, `/customers/${cid}/adGroupCriteria:mutate`, {
          operations: kws.map((text) => ({ create: { adGroup: adGroupRn, status: 'ENABLED', keyword: { text: text.slice(0, 80), matchType: 'PHRASE' } } })),
        });
        steps.push({ label: `${kws.length} palavras-chave (frase)`, status: 'done', detail: kws.join(', ') });
      } catch (e) {
        steps.push({ label: 'Palavras-chave', status: 'failed', detail: msg(e) });
      }
    }
    const heads = [...new Set(input.headlines.map((h) => h.trim().slice(0, 30)).filter(Boolean))].slice(0, 15);
    const descs = [...new Set(input.descriptions.map((d) => d.trim().slice(0, 90)).filter(Boolean))].slice(0, 4);
    if (heads.length < 3 || descs.length < 2) throw new AdsProviderError('O anúncio responsivo precisa de pelo menos 3 títulos e 2 descrições.');
    try {
      await this.call(ws, `/customers/${cid}/adGroupAds:mutate`, {
        operations: [{ create: { adGroup: adGroupRn, status: 'ENABLED', ad: { finalUrls: [input.landingUrl], responsiveSearchAd: { headlines: heads.map((text) => ({ text })), descriptions: descs.map((text) => ({ text })) } } } }],
      });
      steps.push({ label: `Anúncio responsivo (${heads.length} títulos, ${descs.length} descrições)`, status: 'done', detail: '' });
    } catch (e) {
      steps.push({ label: 'Anúncio responsivo', status: 'failed', detail: msg(e) });
    }
    return { campaignId, steps };
  }

  async setStatus(ws: string, campaignId: string, status: 'ENABLED' | 'PAUSED') {
    const c = await this.creds(ws);
    if (!c.customerId) throw new AdsSetupError('Conta do Google Ads não escolhida.');
    const cid = this.customer(c);
    if (!isDigits(campaignId)) throw new AdsSetupError('ID da campanha do Google Ads inválido.');
    await this.call(ws, `/customers/${cid}/campaigns:mutate`, { operations: [{ update: { resourceName: `customers/${cid}/campaigns/${campaignId}`, status }, updateMask: 'status' }] });
  }
}
