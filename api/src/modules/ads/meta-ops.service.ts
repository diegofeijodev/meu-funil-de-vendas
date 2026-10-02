/**
 * Operações da Marketing API (porte de `meta/meta-ads.server.ts`). Tudo é criado PAUSADO; ativar só em chamada explícita
 * depois da aprovação. A empresa é explícita em toda chamada (no protótipo era AsyncLocalStorage) e todo id que entra em
 * caminho de URL passa por `gid()`/`actId()`.
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { todaySp } from '../../common/time/dates';
import { AssetsService } from '../media/assets.service';
import { MetaError, MetaGraphClient } from '../instagram/meta-graph';
import { actId, gid, isDigits } from './ads-ids';
import { AdsConfig, DEFAULT_ADS_CONFIG, PLACEMENTS } from './ads-config';

type G = Record<string, any>;

export type PublishCreative = { id: string; title: string; url: string | null; thumb: string | null; angle?: string | null };
export type PublishAudience = { nome: string; tipo: string; interesses: string[] };
export type PublishInput = {
  name: string;
  objective: string;
  dailyBudget: number;
  landingUrl: string;
  privacyUrl?: string | null;
  primaryText: string;
  headline: string;
  audience: Record<string, unknown>;
  creatives: PublishCreative[];
  config?: AdsConfig;
  strategyAudiences?: PublishAudience[];
  angles?: { nome: string; gancho?: string | null; mensagem?: string | null }[];
};
export type Step = { key: string; label: string; status: 'done' | 'failed'; detail: string };
export type PublishResult = {
  campaignId: string;
  adsetId: string;
  adsetIds: string[];
  adIds: string[];
  adMap: Record<string, { creativeId: string | null; adsetId: string; angle: string | null }>;
  leadFormId: string | null;
  steps: Step[];
};

type ObjectivePlan = { objective: string; optimization: string; destination: string | null; kind: 'traffic' | 'awareness' | 'engagement' | 'sales' | 'leads' | 'whatsapp' | 'remarketing' };
type AdsetPlan = { name: string; interests: { id: string; name: string }[]; customAudiences: string[]; creatives: PublishCreative[]; angle?: { nome: string; gancho?: string | null; mensagem?: string | null } | null };

const ACCOUNT_STATUS: Record<number, string> = {
  1: 'Ativa', 2: 'Desativada', 3: 'Pendente de pagamento', 7: 'Em análise de risco', 9: 'Em período de carência', 100: 'Fechamento pendente', 101: 'Fechada',
};
const LEAD_ACTIONS = new Set(['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.messaging_conversation_started_7d']);
const PURCHASE_ACTIONS = new Set(['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase']);
const isVideoUrl = (u: string) => /\.mp4(\?|$)/i.test(u);
const msg = (e: unknown, fb = 'falhou') => (e instanceof Error ? e.message : fb);

export function mapObjective(obj: string): ObjectivePlan {
  const o = (obj || '').toLowerCase();
  if (o === 'leads' || o.includes('lead') || o.includes('cadastro')) return { objective: 'OUTCOME_LEADS', optimization: 'LEAD_GENERATION', destination: 'ON_AD', kind: 'leads' };
  if (o === 'whatsapp' || o.includes('whats')) return { objective: 'OUTCOME_ENGAGEMENT', optimization: 'CONVERSATIONS', destination: 'WHATSAPP', kind: 'whatsapp' };
  if (o === 'remarketing' || o.includes('remarketing') || o.includes('retarget')) return { objective: 'OUTCOME_SALES', optimization: 'OFFSITE_CONVERSIONS', destination: 'WEBSITE', kind: 'remarketing' };
  if (o.includes('aware') || o.includes('reconhec') || o.includes('alcance') || o.includes('brand')) return { objective: 'OUTCOME_AWARENESS', optimization: 'REACH', destination: null, kind: 'awareness' };
  if (o.includes('engaj') || o.includes('engage')) return { objective: 'OUTCOME_ENGAGEMENT', optimization: 'POST_ENGAGEMENT', destination: null, kind: 'engagement' };
  if (o.includes('sale') || o.includes('venda') || o.includes('convers')) return { objective: 'OUTCOME_SALES', optimization: 'OFFSITE_CONVERSIONS', destination: 'WEBSITE', kind: 'sales' };
  return { objective: 'OUTCOME_TRAFFIC', optimization: 'LINK_CLICKS', destination: 'WEBSITE', kind: 'traffic' };
}

/** "25-45", "25 a 45", "18+" → faixa de idade aceita pela Meta. */
export function parseAges(aud: Record<string, unknown>) {
  const a = aud as any;
  let min = Number(a.age_min ?? a.ageMin) || 0;
  let max = Number(a.age_max ?? a.ageMax) || 0;
  const nums = String(a.idade ?? '').match(/\d{2}/g)?.map(Number) ?? [];
  if (!min && nums[0]) min = nums[0];
  if (!max && nums[1]) max = nums[1];
  return { age_min: Math.max(18, Math.min(65, min || 18)), age_max: Math.min(65, Math.max(18, max || 65)) };
}

export function placementTargeting(placements: AdsConfig['placements']) {
  if (placements === 'auto' || !placements.length) return {};
  const fb = new Set<string>();
  const ig = new Set<string>();
  for (const key of placements) {
    const p = PLACEMENTS[key];
    if (!p) continue;
    (p.platform === 'facebook' ? fb : ig).add(p.position);
  }
  const platforms = [fb.size ? 'facebook' : null, ig.size ? 'instagram' : null].filter(Boolean);
  return { publisher_platforms: platforms, ...(fb.size ? { facebook_positions: [...fb] } : {}), ...(ig.size ? { instagram_positions: [...ig] } : {}) };
}

function sumActions(list: any[] | undefined, types: Set<string>) {
  // A Meta repete a mesma conversão em vários tipos (ex.: purchase e omni_purchase): usa o maior, não a soma.
  let best = 0;
  for (const a of list ?? []) if (types.has(a.action_type)) best = Math.max(best, Number(a.value ?? 0));
  return best;
}

export type DailyAdRow = {
  date: string; campaignId: string; adsetId: string; adsetName: string; adId: string; adName: string;
  spend: number; impressions: number; reach: number; clicks: number; leads: number; conversions: number; revenue: number;
};

@Injectable()
export class MetaOpsService {
  /** Espera entre consultas da miniatura do vídeo (sobrescrito nos testes). */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly graphClient: MetaGraphClient,
    private readonly assets: AssetsService,
  ) {}

  private graph<T = any>(ws: string, path: string, opts: { method?: 'GET' | 'POST' | 'DELETE'; params?: Record<string, unknown>; token?: string } = {}) {
    return this.graphClient.graph<T>(ws, path, opts);
  }

  async missing(ws: string): Promise<string[]> {
    const c = await this.graphClient.config(ws);
    const out: string[] = [];
    if (!c.appId) out.push('META_APP_ID');
    if (!c.appSecret) out.push('META_APP_SECRET');
    if (!c.token) out.push('META_SYSTEM_USER_TOKEN');
    if (!c.adAccountId) out.push('META_AD_ACCOUNT_ID');
    if (!c.pageId) out.push('META_PAGE_ID');
    return out;
  }

  private async account(ws: string) {
    const c = await this.graphClient.config(ws);
    return { ...c, adAccountId: actId(c.adAccountId) };
  }

  async testConnection(ws: string) {
    const missing = await this.missing(ws);
    if (missing.length) return { ok: false as const, missing, error: `Faltam credenciais: ${missing.join(', ')}. Preencha o formulário em Integrações.` };
    try {
      const cfg = await this.account(ws);
      const pageId = gid(cfg.pageId, 'Página');
      const [me, account, page, ig] = await Promise.all([
        this.graph<G>(ws, '/me', { params: { fields: 'id,name' } }),
        this.graph<G>(ws, `/${cfg.adAccountId}`, { params: { fields: 'name,account_status,currency,timezone_name,amount_spent,business_name' } }),
        this.graph<G>(ws, `/${pageId}`, { params: { fields: 'name,id' } }).catch((e): G => ({ error: String(e.message) })),
        cfg.instagramId
          ? this.graph<G>(ws, `/${gid(cfg.instagramId, 'Instagram')}`, { params: { fields: 'username' } }).catch((e): G => ({ error: String(e.message) }))
          : Promise.resolve<G | null>(null),
      ]);
      return {
        ok: true as const,
        missing: [] as string[],
        user: me.name as string,
        account: {
          id: cfg.adAccountId,
          name: account.name as string,
          status: ACCOUNT_STATUS[account.account_status as number] ?? String(account.account_status),
          currency: account.currency as string,
          timezone: account.timezone_name as string,
        },
        page: page?.error ? { id: cfg.pageId, name: null, error: page.error as string } : { id: page.id, name: page.name },
        instagram: ig ? (ig.error ? { username: null, error: ig.error as string } : { username: ig.username as string }) : null,
        error: null as string | null,
      };
    } catch (e) {
      return { ok: false as const, missing: [] as string[], error: msg(e, 'Falha ao conectar na Meta.') };
    }
  }

  async listStructure(ws: string) {
    const { adAccountId } = await this.account(ws);
    const fields = 'id,name,status,effective_status';
    const [campaigns, adsets, ads] = await Promise.all([
      this.graph<{ data: any[] }>(ws, `/${adAccountId}/campaigns`, { params: { fields: `${fields},objective,daily_budget`, limit: 50 } }),
      this.graph<{ data: any[] }>(ws, `/${adAccountId}/adsets`, { params: { fields: `${fields},campaign_id,daily_budget`, limit: 50 } }),
      this.graph<{ data: any[] }>(ws, `/${adAccountId}/ads`, { params: { fields: `${fields},adset_id`, limit: 50 } }),
    ]);
    return { campaigns: campaigns.data, adsets: adsets.data, ads: ads.data };
  }

  /** O download passa pelo `AssetsService` (SSRF-guard: URL própria assinada ou externa validada, sem rede interna). */
  async uploadImageFromUrl(ws: string, url: string) {
    const { adAccountId } = await this.account(ws);
    let bytes: string;
    try {
      bytes = Buffer.from((await this.assets.download(url)).bytes).toString('base64');
    } catch {
      throw new MetaError('Não foi possível baixar a imagem do criativo.');
    }
    const out = await this.graph<{ images: Record<string, { hash: string }> }>(ws, `/${adAccountId}/adimages`, { method: 'POST', params: { bytes } });
    const first = Object.values(out.images ?? {})[0];
    if (!first?.hash) throw new MetaError('A Meta não devolveu o identificador da imagem.');
    return first.hash;
  }

  async uploadVideoFromUrl(ws: string, url: string, title: string) {
    const { adAccountId } = await this.account(ws);
    const out = await this.graph<{ id: string }>(ws, `/${adAccountId}/advideos`, { method: 'POST', params: { file_url: url, name: title.slice(0, 100) } });
    return out.id;
  }

  private async videoThumbnail(ws: string, videoId: string): Promise<string | null> {
    const id = gid(videoId, 'vídeo');
    for (let i = 0; i < 10; i++) {
      const v = await this.graph<G>(ws, `/${id}`, { params: { fields: 'picture,status' } }).catch(() => null);
      if (v?.picture) return v.picture as string;
      await this.sleep(3000);
    }
    return null;
  }

  private async geoFor(ws: string, aud: Record<string, unknown>) {
    const a = aud as any;
    const text = String(a.localizacao ?? a.location ?? a.cities ?? '').trim();
    const names = text
      .replace(/\be\s+regi[aã]o\b|\bregi[aã]o\b|\bSP\b|\bBrasil\b/gi, '')
      .split(/[,;/]|\se\s|\s-\s/)
      .map((x) => x.trim())
      .filter((x) => x.length > 2)
      .slice(0, 10);
    const cities: { key: string; radius: number; distance_unit: string; name: string }[] = [];
    for (const q of names) {
      const r = await this.graph<{ data?: { key: string; name: string; type: string }[] }>(ws, '/search', {
        params: { type: 'adgeolocation', q, location_types: JSON.stringify(['city']), country_code: 'BR' },
      }).catch(() => null);
      const hit = r?.data?.find((d) => d.type === 'city');
      if (hit && !cities.some((c) => c.key === hit.key)) cities.push({ key: hit.key, radius: 20, distance_unit: 'kilometer', name: hit.name });
    }
    return cities.length
      ? { geo: { cities: cities.map(({ name: _n, ...c }) => c) }, label: `${cities.map((c) => c.name).join(', ')} (raio de 20 km)` }
      : { geo: { countries: ['BR'] }, label: 'Brasil inteiro (localização não reconhecida)' };
  }

  private async firstPixel(ws: string, adAccountId: string) {
    const r = await this.graph<{ data?: { id: string; name: string }[] }>(ws, `/${adAccountId}/adspixels`, { params: { fields: 'id,name' } }).catch(() => null);
    return r?.data?.[0] ?? null;
  }

  /** Interesses reais do gerenciador de anúncios a partir dos nomes sugeridos pela estratégia. */
  async searchInterests(ws: string, names: string[]) {
    const out: { id: string; name: string }[] = [];
    for (const q of names.slice(0, 12)) {
      const r = await this.graph<{ data?: { id: string; name: string }[] }>(ws, '/search', { params: { type: 'adinterest', q, limit: 1, locale: 'pt_BR' } }).catch(() => null);
      const hit = r?.data?.[0];
      if (hit && !out.some((i) => i.id === hit.id)) out.push({ id: hit.id, name: hit.name });
    }
    return out;
  }

  async listCustomAudiences(ws: string) {
    const { adAccountId } = await this.account(ws);
    const r = await this.graph<{ data?: any[] }>(ws, `/${adAccountId}/customaudiences`, {
      params: { fields: 'id,name,subtype,approximate_count_lower_bound,delivery_status', limit: 100 },
    });
    return (r.data ?? []).map((a) => ({ id: String(a.id), name: String(a.name), subtype: String(a.subtype ?? ''), size: Number(a.approximate_count_lower_bound ?? 0) || null }));
  }

  /** Lookalike 1% no Brasil a partir de um público de origem. */
  async createLookalike(ws: string, sourceId: string, name: string) {
    const { adAccountId } = await this.account(ws);
    const r = await this.graph<{ id: string }>(ws, `/${adAccountId}/customaudiences`, {
      method: 'POST',
      params: { name: `${name} · Semelhante 1% BR`.slice(0, 100), subtype: 'LOOKALIKE', origin_audience_id: gid(sourceId, 'público'), lookalike_spec: { ratio: 0.01, country: 'BR' } },
    });
    return r.id;
  }

  /** Público de visitantes do site (pixel, últimos 30 dias) para remarketing. */
  async createWebsiteAudience(ws: string, pixelId: string, name: string, days = 30) {
    const { adAccountId } = await this.account(ws);
    const r = await this.graph<{ id: string }>(ws, `/${adAccountId}/customaudiences`, {
      method: 'POST',
      params: {
        name: `${name} · Visitantes ${days} dias`.slice(0, 100),
        prefill: true,
        rule: {
          inclusions: {
            operator: 'or',
            rules: [{ event_sources: [{ id: gid(pixelId, 'pixel'), type: 'pixel' }], retention_seconds: days * 86400, filter: { operator: 'and', filters: [{ field: 'url', operator: 'i_contains', value: '' }] } }],
          },
        },
      },
    });
    return r.id;
  }

  /** Público com os contatos do CRM (e-mail e telefone com hash SHA-256, como a Meta exige). */
  async upsertCustomerListAudience(ws: string, name: string, existingId: string | null, contacts: { email: string | null; phone: string | null }[]) {
    const h = (v: string) => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');
    const { adAccountId } = await this.account(ws);
    let id = existingId && isDigits(existingId) ? existingId : null;
    if (!id) {
      const r = await this.graph<{ id: string }>(ws, `/${adAccountId}/customaudiences`, {
        method: 'POST',
        params: { name: name.slice(0, 100), subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY', description: 'Contatos do CRM (Meu Funil)' },
      });
      id = r.id;
    }
    const audienceId = gid(id, 'público');
    const rows = contacts.map((c) => [c.email ? h(c.email) : '', c.phone ? h(c.phone.replace(/\D/g, '')) : '']).filter((r) => r[0] || r[1]);
    for (let i = 0; i < rows.length; i += 5000) {
      await this.graph(ws, `/${audienceId}/users`, { method: 'POST', params: { payload: { schema: ['EMAIL', 'PHONE'], data: rows.slice(i, i + 5000) } } });
    }
    return { id: audienceId, uploaded: rows.length };
  }

  /** Formulário instantâneo (Lead Ads) na Página, criado com o token da própria Página. */
  private async createLeadForm(ws: string, pageId: string, input: { name: string; privacyUrl: string; thanksUrl: string }) {
    const pid = gid(pageId, 'Página');
    const page = await this.graph<{ access_token?: string }>(ws, `/${pid}`, { params: { fields: 'access_token' } });
    if (!page.access_token) throw new MetaError('Sem acesso de anúncios à Página. Dê ao usuário do sistema a permissão pages_manage_ads na Página.');
    const r = await this.graph<{ id: string }>(ws, `/${pid}/leadgen_forms`, {
      method: 'POST',
      token: page.access_token,
      params: {
        name: `${input.name} · ${todaySp()}`.slice(0, 100),
        locale: 'PT_BR',
        questions: [{ type: 'FULL_NAME' }, { type: 'EMAIL' }, { type: 'PHONE' }],
        privacy_policy: { url: input.privacyUrl, link_text: 'Política de privacidade' },
        follow_up_action_url: input.thanksUrl,
      },
    });
    return r.id;
  }

  /** Cria campanha + conjuntos + criativos + anúncios, tudo PAUSADO. */
  async publishPaused(ws: string, input: PublishInput): Promise<PublishResult> {
    const cfg = await this.account(ws);
    const adAccountId = cfg.adAccountId;
    const pageId = gid(cfg.pageId, 'Página');
    const igId = cfg.instagramId ? gid(cfg.instagramId, 'Instagram') : null;
    const conf = input.config ?? DEFAULT_ADS_CONFIG;
    const steps: Step[] = [];
    const plan = mapObjective(input.objective);
    let { objective, optimization, destination } = plan;
    let promoted: Record<string, unknown> | null = null;
    let leadFormId: string | null = null;
    const customAudiences = conf.customAudienceIds.filter(isDigits);
    const excludeAudiences = conf.excludeAudienceIds.filter(isDigits);

    if (plan.kind === 'sales' || plan.kind === 'remarketing') {
      const px = await this.firstPixel(ws, adAccountId);
      if (px) {
        promoted = { pixel_id: px.id, custom_event_type: 'PURCHASE' };
        steps.push({ key: 'pixel', label: `Otimização por compras no pixel "${px.name}"`, status: 'done', detail: px.id });
        if (plan.kind === 'remarketing' && !customAudiences.length) {
          try {
            const aud = await this.createWebsiteAudience(ws, px.id, input.name);
            customAudiences.push(aud);
            steps.push({ key: 'rmkt', label: 'Público de remarketing criado (visitantes do site, 30 dias)', status: 'done', detail: aud });
          } catch (e) {
            steps.push({ key: 'rmkt', label: 'Público de remarketing', status: 'failed', detail: msg(e) });
          }
        }
      } else {
        objective = 'OUTCOME_TRAFFIC';
        optimization = 'LINK_CLICKS';
        destination = 'WEBSITE';
        steps.push({ key: 'pixel', label: 'Sem pixel na conta: campanha criada como tráfego', status: 'failed', detail: 'Crie um pixel para otimizar por vendas e remarketing.' });
      }
    }
    if (plan.kind === 'leads' || plan.kind === 'whatsapp') promoted = { page_id: pageId };
    if (plan.kind === 'leads') {
      leadFormId = await this.createLeadForm(ws, pageId, { name: input.name, privacyUrl: input.privacyUrl || input.landingUrl, thanksUrl: input.landingUrl });
      steps.push({ key: 'form', label: 'Formulário instantâneo criado (nome, e-mail, telefone)', status: 'done', detail: leadFormId });
    }

    if (conf.lookalikeSourceId) {
      try {
        const lal = await this.createLookalike(ws, conf.lookalikeSourceId, input.name);
        customAudiences.push(lal);
        steps.push({ key: 'lal', label: 'Público semelhante 1% (Brasil) criado', status: 'done', detail: lal });
      } catch (e) {
        steps.push({ key: 'lal', label: 'Público semelhante', status: 'failed', detail: msg(e) });
      }
    }

    const campaign = await this.graph<{ id: string }>(ws, `/${adAccountId}/campaigns`, {
      method: 'POST',
      params: { name: input.name, objective, status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false },
    });
    steps.push({ key: 'campaign', label: 'Campanha criada (pausada)', status: 'done', detail: campaign.id });

    const aud = input.audience ?? {};
    const ages = parseAges(aud);
    const geo = await this.geoFor(ws, aud);
    steps.push({ key: 'geo', label: `Público: ${geo.label}, ${ages.age_min}–${ages.age_max} anos`, status: 'done', detail: '' });

    // Estrutura dos conjuntos.
    const sets: AdsetPlan[] = [];
    const strategyAud = conf.useStrategyAudiences ? (input.strategyAudiences ?? []).filter((a) => a.tipo !== 'remarketing' && a.tipo !== 'lista_clientes') : [];
    if (conf.structure === 'per_audience' && strategyAud.length) {
      for (const a of strategyAud.slice(0, 4)) sets.push({ name: a.nome, interests: await this.searchInterests(ws, a.interesses), customAudiences, creatives: input.creatives });
    } else if (conf.structure === 'per_angle' && (input.angles ?? []).length) {
      const interests = strategyAud.length ? await this.searchInterests(ws, strategyAud.flatMap((a) => a.interesses)) : [];
      for (const ang of (input.angles ?? []).slice(0, 5)) {
        const crs = input.creatives.filter((c) => c.angle === ang.nome);
        if (crs.length) sets.push({ name: `Ângulo: ${ang.nome}`, interests, customAudiences, creatives: crs, angle: ang });
      }
      const loose = input.creatives.filter((c) => !c.angle || !(input.angles ?? []).some((a) => a.nome === c.angle));
      if (loose.length) sets.push({ name: 'Criativos gerais', interests, customAudiences, creatives: loose });
    }
    if (!sets.length) {
      const interests = strategyAud.length ? await this.searchInterests(ws, strategyAud.flatMap((a) => a.interesses)) : [];
      sets.push({ name: 'Conjunto 1', interests, customAudiences, creatives: input.creatives });
    }
    const perSet = Math.max(100, Math.round((input.dailyBudget * 100) / sets.length));
    if (sets.length > 1) steps.push({ key: 'split', label: `${sets.length} conjuntos com verba igual (R$ ${(perSet / 100).toFixed(2)}/dia cada)`, status: 'done', detail: conf.structure });

    const cta = conf.cta || (plan.kind === 'whatsapp' ? 'WHATSAPP_MESSAGE' : plan.kind === 'leads' ? 'SIGN_UP' : 'LEARN_MORE');
    const ctaFor = () => {
      if (plan.kind === 'whatsapp') return { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } };
      if (leadFormId) return { type: cta === 'LEARN_MORE' ? 'SIGN_UP' : cta, value: { lead_gen_form_id: leadFormId, link: input.landingUrl } };
      return { type: cta, value: { link: input.landingUrl } };
    };
    const link = plan.kind === 'whatsapp' ? 'https://api.whatsapp.com/send' : input.landingUrl;
    const identity = { page_id: pageId, ...(igId ? { instagram_user_id: igId } : {}) };

    const adsetIds: string[] = [];
    const adIds: string[] = [];
    const adMap: PublishResult['adMap'] = {};
    const imageHashes = new Map<string, string>();

    for (const set of sets) {
      const targeting: Record<string, unknown> = {
        geo_locations: geo.geo,
        ...ages,
        ...placementTargeting(conf.placements),
        targeting_automation: { advantage_audience: conf.advantageAudience ? 1 : 0 },
      };
      if (set.interests.length) targeting['flexible_spec'] = [{ interests: set.interests }];
      if (set.customAudiences.length) targeting['custom_audiences'] = set.customAudiences.map((id) => ({ id }));
      if (excludeAudiences.length) targeting['excluded_custom_audiences'] = excludeAudiences.map((id) => ({ id }));
      let adset: { id: string };
      try {
        adset = await this.graph<{ id: string }>(ws, `/${adAccountId}/adsets`, {
          method: 'POST',
          params: {
            name: `${input.name} · ${set.name}`.slice(0, 200),
            campaign_id: campaign.id,
            daily_budget: perSet,
            billing_event: 'IMPRESSIONS',
            optimization_goal: optimization,
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            status: 'PAUSED',
            targeting,
            ...(promoted ? { promoted_object: promoted } : {}),
            ...(destination ? { destination_type: destination } : {}),
          },
        });
      } catch (e) {
        steps.push({ key: `adset-${set.name}`, label: `Conjunto "${set.name}"`, status: 'failed', detail: msg(e) });
        continue;
      }
      adsetIds.push(adset.id);
      steps.push({
        key: `adset-${adset.id}`,
        label: `Conjunto "${set.name}" criado (pausado)${set.interests.length ? ` · interesses: ${set.interests.map((i) => i.name).join(', ')}` : ''}`,
        status: 'done',
        detail: adset.id,
      });

      const text = input.primaryText;
      const headline = (set.angle?.gancho || input.headline).slice(0, 40);
      const images = set.creatives.filter((c) => c.url && !isVideoUrl(c.url));
      const useCarousel = conf.carousel && images.length >= 2 && plan.kind !== 'whatsapp';
      const singles = useCarousel ? set.creatives.filter((c) => !images.includes(c)) : set.creatives;

      if (useCarousel) {
        try {
          const cards = [];
          for (const cr of images.slice(0, 10)) {
            const hash = imageHashes.get(cr.url!) ?? (await this.uploadImageFromUrl(ws, cr.url!));
            imageHashes.set(cr.url!, hash);
            cards.push({ image_hash: hash, link, name: (cr.title || headline).slice(0, 40), call_to_action: ctaFor() });
          }
          const creative = await this.graph<{ id: string }>(ws, `/${adAccountId}/adcreatives`, {
            method: 'POST',
            params: { name: `${set.name} · Carrossel`, object_story_spec: { ...identity, link_data: { link, message: text, child_attachments: cards, multi_share_optimized: true, call_to_action: ctaFor() } } },
          });
          const ad = await this.graph<{ id: string }>(ws, `/${adAccountId}/ads`, {
            method: 'POST',
            params: { name: `${set.name} · Carrossel`, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED' },
          });
          adIds.push(ad.id);
          adMap[ad.id] = { creativeId: images[0]!.id, adsetId: adset.id, angle: set.angle?.nome ?? images[0]!.angle ?? null };
          steps.push({ key: `ad-${ad.id}`, label: `Anúncio carrossel (${cards.length} cards) criado (pausado)`, status: 'done', detail: ad.id });
        } catch (e) {
          steps.push({ key: `carousel-${adset.id}`, label: 'Anúncio carrossel', status: 'failed', detail: msg(e) });
        }
      }

      for (const cr of singles) {
        try {
          if (!cr.url) throw new MetaError('criativo sem arquivo');
          let story: Record<string, unknown>;
          if (isVideoUrl(cr.url)) {
            const videoId = await this.uploadVideoFromUrl(ws, cr.url, cr.title);
            const thumb = cr.thumb && !/\.mp4/i.test(cr.thumb) ? cr.thumb : await this.videoThumbnail(ws, videoId);
            if (!thumb) throw new MetaError('vídeo enviado, mas a Meta ainda não gerou a miniatura. Tente publicar de novo em alguns minutos.');
            story = { video_data: { video_id: videoId, image_url: thumb, message: text, title: headline, call_to_action: ctaFor() } };
          } else {
            const hash = imageHashes.get(cr.url) ?? (await this.uploadImageFromUrl(ws, cr.url));
            imageHashes.set(cr.url, hash);
            story = { link_data: { image_hash: hash, link, message: text, name: headline, call_to_action: ctaFor() } };
          }
          const creative = await this.graph<{ id: string }>(ws, `/${adAccountId}/adcreatives`, { method: 'POST', params: { name: cr.title, object_story_spec: { ...identity, ...story } } });
          const ad = await this.graph<{ id: string }>(ws, `/${adAccountId}/ads`, {
            method: 'POST',
            params: { name: cr.title, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED' },
          });
          adIds.push(ad.id);
          adMap[ad.id] = { creativeId: cr.id, adsetId: adset.id, angle: cr.angle ?? set.angle?.nome ?? null };
          steps.push({ key: `ad-${ad.id}`, label: `Anúncio "${cr.title}" criado (pausado)`, status: 'done', detail: ad.id });
        } catch (e) {
          steps.push({ key: `ad-${cr.id}-${adset.id}`, label: `Anúncio "${cr.title}"`, status: 'failed', detail: msg(e) });
        }
      }
    }
    if (!adsetIds.length) throw new MetaError(steps.filter((s) => s.status === 'failed').map((s) => `${s.label}: ${s.detail}`).join(' · ') || 'Nenhum conjunto foi criado.');
    return { campaignId: campaign.id, adsetId: adsetIds[0]!, adsetIds, adIds, adMap, leadFormId, steps };
  }

  /** Pausa ou ativa um anúncio. */
  async setAdStatus(ws: string, adId: string, status: 'ACTIVE' | 'PAUSED') {
    await this.graph(ws, `/${gid(adId, 'anúncio')}`, { method: 'POST', params: { status } });
  }

  /** `effective_status` do anúncio (as regras só pausam o que está ACTIVE). */
  async adEffectiveStatus(ws: string, adId: string): Promise<string | null> {
    const r = await this.graph<{ effective_status?: string }>(ws, `/${gid(adId, 'anúncio')}`, { params: { fields: 'effective_status' } });
    return r.effective_status ?? null;
  }

  /** Verba diária atual de um conjunto (R$). */
  async getAdsetBudget(ws: string, adsetId: string) {
    const r = await this.graph<{ daily_budget?: string; name?: string; effective_status?: string }>(ws, `/${gid(adsetId, 'conjunto')}`, { params: { fields: 'daily_budget,name,effective_status' } });
    return { dailyBudget: Number(r.daily_budget ?? 0) / 100, name: r.name ?? adsetId, status: r.effective_status ?? null };
  }

  /** Altera a verba diária de um conjunto (R$). */
  async setAdsetBudget(ws: string, adsetId: string, dailyBudget: number) {
    await this.graph(ws, `/${gid(adsetId, 'conjunto')}`, { method: 'POST', params: { daily_budget: Math.max(100, Math.round(dailyBudget * 100)) } });
  }

  /** Insights por anúncio e por dia das campanhas informadas (com paginação). */
  async fetchDailyAdInsights(ws: string, metaCampaignIds: string[], since: string, until: string): Promise<DailyAdRow[]> {
    const { adAccountId } = await this.account(ws);
    if (!metaCampaignIds.length) return [];
    const ids = metaCampaignIds.map((x) => gid(x, 'campanha'));
    const rows: DailyAdRow[] = [];
    let after: string | null = null;
    for (let page = 0; page < 30; page++) {
      const r: { data?: any[]; paging?: { cursors?: { after?: string }; next?: string } } = await this.graph(ws, `/${adAccountId}/insights`, {
        params: {
          level: 'ad',
          time_increment: 1,
          time_range: { since, until },
          fields: 'campaign_id,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,clicks,actions,action_values',
          filtering: [{ field: 'campaign.id', operator: 'IN', value: ids }],
          limit: 500,
          ...(after ? { after } : {}),
        },
      });
      for (const x of r.data ?? []) {
        rows.push({
          date: String(x.date_start),
          campaignId: String(x.campaign_id),
          adsetId: String(x.adset_id),
          adsetName: String(x.adset_name ?? ''),
          adId: String(x.ad_id),
          adName: String(x.ad_name ?? ''),
          spend: Number(x.spend ?? 0),
          impressions: Number(x.impressions ?? 0),
          reach: Number(x.reach ?? 0),
          clicks: Number(x.inline_link_clicks ?? x.clicks ?? 0),
          leads: sumActions(x.actions, LEAD_ACTIONS),
          conversions: sumActions(x.actions, PURCHASE_ACTIONS),
          revenue: sumActions(x.action_values, PURCHASE_ACTIONS),
        });
      }
      after = r.paging?.next ? (r.paging?.cursors?.after ?? null) : null;
      if (!after) break;
    }
    return rows;
  }

  /** Ativa ou pausa campanha, conjuntos e anúncios. */
  async setDeliveryStatus(ws: string, ids: { campaignId: string; adsetIds?: string[]; adIds?: string[] }, status: 'ACTIVE' | 'PAUSED') {
    const all = [ids.campaignId, ...(ids.adsetIds ?? []), ...(ids.adIds ?? [])].filter(Boolean).map((id) => gid(id));
    for (const id of all) await this.graph(ws, `/${id}`, { method: 'POST', params: { status } });
    return { updated: all.length };
  }

  async fetchInsights(ws: string, opts: { since: string; until: string; campaignId?: string | null }) {
    const { adAccountId } = await this.account(ws);
    const target = opts.campaignId ? gid(opts.campaignId, 'campanha') : adAccountId;
    const out = await this.graph<{ data: any[] }>(ws, `/${target}/insights`, {
      params: {
        fields: 'spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type',
        time_range: { since: opts.since, until: opts.until },
        level: opts.campaignId ? 'campaign' : 'account',
      },
    });
    const row = out.data?.[0] ?? {};
    const leads = Number((row.actions ?? []).find((a: any) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped')?.value ?? 0);
    const spend = Number(row.spend ?? 0);
    return {
      spend,
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      ctr: Number(row.ctr ?? 0),
      cpc: Number(row.cpc ?? 0),
      leads,
      cpl: leads ? spend / leads : 0,
    };
  }
}
