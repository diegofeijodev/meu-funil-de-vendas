import { randomUUID } from 'node:crypto';
import { WorkspaceAccessService } from '../../access/access.service';
import { CampaignGuardsService } from '../../campaigns/campaign-guards.service';
import { IgTable } from '../../instagram/__tests__/harness';
import { ADMIN, MARKETING, memMembers, OWNER, STRANGER, VIEWER, WS_A, WS_B } from '../../media/__tests__/mem';
import { CredentialStore } from '../../vault/credential-store';
import { VaultService } from '../../vault/vault.service';
import { GoogleAdsClient } from '../google-ads.client';
import { MetaOpsService } from '../meta-ops.service';
import { OAuthStateService } from '../oauth-state.service';
import { PerfRow, PerfStore } from '../perf-store';
import { TikTokAdsClient } from '../tiktok-ads.client';
import { AdsOpsService } from '../ads-ops.service';
import { AdsChannelsService } from '../ads-channels.service';
import { MetaAdsService } from '../meta-ads.service';
import { MetaOAuthService } from '../meta-oauth.service';

export { ADMIN, MARKETING, OWNER, STRANGER, VIEWER, WS_A, WS_B };

/** Cofre em memória (a criptografia é a de verdade). */
export class MemStore extends CredentialStore {
  rows = new Map<string, string>();
  private k = (ws: string | null, key: string) => `${ws ?? 'global'}|${key}`;
  async read(ws: string | null, key: string) { const v = this.rows.get(this.k(ws, key)); return v ? { value: v, updated_at: new Date() } : null; }
  async upsert(ws: string | null, key: string, value: string) { this.rows.set(this.k(ws, key), value); }
  async delete(ws: string | null, key: string) { this.rows.delete(this.k(ws, key)); }
  async list() { return []; }
}

export class MemPerf extends PerfStore {
  meta: PerfRow[] = [];
  external: PerfRow[] = [];
  constructor() { super(null as any); }
  async upsertMeta(rows: PerfRow[]) { this.meta.push(...rows); return rows.length; }
  async upsertExternal(rows: PerfRow[]) { this.external.push(...rows); return rows.length; }
}

export const uid = () => randomUUID();
const ENV: any = { PUBLIC_URL: 'http://api.test', APP_URL: 'http://web.test', NODE_ENV: 'test', GOOGLE_ADS_API_VERSION: 'v21' };

export function adsWorld() {
  const t: Record<string, IgTable> = {
    campaigns: new IgTable(() => ({ status: 'draft', budget_daily: 0, objective: 'leads', meta_ad_ids: [], meta_adset_ids: [], meta_ad_map: {}, ads_config: {}, automation_rules: {}, meta_campaign_id: null, meta_adset_id: null, meta_delivery_status: null, meta_lead_form_id: null, google_campaign_id: null, google_status: null, tiktok_campaign_id: null, tiktok_status: null, landing_url: null, audience: {}, offer_promise: null, offer_product: null, offer_price: null, brand_id: null })),
    creatives: new IgTable(() => ({ status: 'draft', angle: null, preview_url: null, thumbnail_url: null, extras: {} })),
    copies: new IgTable(() => ({ version: 1, status: 'draft', content: {} })),
    brands: new IgTable(),
    ai_recommendations: new IgTable(() => ({ status: 'pending', source: 'ai', payload: {}, severity: 'medium', requires_approval: true })),
    publishing_jobs: new IgTable(),
    performance_daily: new IgTable(() => ({ source: 'meta' })),
    oauth_states: new IgTable(),
    crm_stages: new IgTable(),
    crm_leads: new IgTable(() => ({ unsubscribed: false })),
    activity_logs: new IgTable(),
    cron_tokens: new IgTable(),
    cron_heartbeats: new IgTable(),
  };
  // oauth_states usa `state_hash` como chave (findUnique({ where: { state_hash } })) — o IgTable já resolve por igualdade.
  const prisma: any = { ...t, workspace_members: memMembers };
  const access = new WorkspaceAccessService(prisma);
  const guards = new CampaignGuardsService(prisma, access);
  const store = new MemStore();
  const vault = new VaultService(store, { NODE_ENV: 'test' });
  const activity = { log: jest.fn(async () => undefined) } as any;
  const strategist = { currentStrategy: jest.fn(async () => null) } as any;
  const ai = { json: jest.fn(async () => ({ recomendacoes: [] })) } as any;
  const crm = { ensure: jest.fn(async () => false) } as any;
  const perf = new MemPerf();

  // Graph falsa: responders por caminho; nenhuma rede.
  const calls: { ws: string | null; path: string; opts: any }[] = [];
  const responders: ((path: string, opts: any, ws: string | null) => any | undefined)[] = [];
  const cfg: any = { appId: 'app123', appSecret: 'segredo-meta', token: 'tok', adAccountId: 'act_1001', pageId: '2002', instagramId: '3003' };
  const graphClient: any = {
    base: 'https://graph.test/v24.0',
    config: jest.fn(async () => ({ ...cfg })),
    graph: jest.fn(async (ws: string | null, path: string, opts: any = {}) => {
      calls.push({ ws, path, opts });
      for (const r of responders) {
        const out = r(path, opts, ws);
        if (out instanceof Error) throw out;
        if (out !== undefined) return out;
      }
      return {};
    }),
  };
  const respond = (fn: (path: string, opts: any, ws: string | null) => any) => { responders.unshift(fn); };
  const assets = { download: jest.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' })) } as any;
  const ops = new MetaOpsService(graphClient, assets);
  ops.sleep = async () => undefined;

  const http: jest.Mock<Promise<Response>, [string, any?]> = jest.fn(async (_url: string, _init?: any) => new Response('{}', { status: 200 }));
  const google = new GoogleAdsClient(vault, http as any, ENV);
  const tiktok = new TikTokAdsClient(vault, http as any, ENV);
  const states = new OAuthStateService(prisma);
  const oauth = new MetaOAuthService(vault, graphClient, states, access, http as any, ENV);
  const meta = new MetaAdsService(prisma, access, vault, ops, oauth, guards, strategist, activity);
  const adsOps = new AdsOpsService(prisma, access, guards, ops, google, tiktok, perf, ai, strategist, vault, crm);
  const channels = new AdsChannelsService(prisma, access, guards, vault, google, tiktok, states, ai, strategist, ENV);

  /** Campanha pronta para publicar (aprovada, com destino) + um criativo aprovado. */
  const seedCampaign = (over: Record<string, any> = {}) => {
    const c: any = { id: uid(), workspace_id: WS_A, brand_id: null, name: 'Campanha X', objective: 'traffic', status: 'approved', landing_url: 'https://site.test/lp', budget_daily: 30, created_at: new Date(), updated_at: new Date(), meta_ad_ids: [], meta_adset_ids: [], meta_ad_map: {}, ads_config: {}, automation_rules: {}, meta_campaign_id: null, meta_adset_id: null, meta_delivery_status: null, audience: {}, google_campaign_id: null, tiktok_campaign_id: null, offer_promise: 'Promessa', offer_product: 'Produto', ...over };
    t['campaigns']!.rows.push(c);
    return c;
  };
  const seedCreative = (campaignId: string, over: Record<string, any> = {}) => {
    const r: any = { id: uid(), workspace_id: WS_A, campaign_id: campaignId, title: 'Criativo 1', status: 'approved', preview_url: 'https://cdn.test/a.jpg', thumbnail_url: null, angle: null, extras: {}, created_at: new Date(), ...over };
    t['creatives']!.rows.push(r);
    return r;
  };
  return { t, prisma, access, guards, vault, store, activity, strategist, ai, crm, perf, calls, respond, cfg, graphClient, assets, ops, http, google, tiktok, states, oauth, meta, adsOps, channels, seedCampaign, seedCreative, ENV };
}
export type AdsWorld = ReturnType<typeof adsWorld>;

/** Graph falsa que responde a publicação inteira (campanha, conjunto, imagem, criativo, anúncio). */
export function respondPublish(w: AdsWorld) {
  let n = 0;
  w.respond((path, opts) => {
    if (path === '/search') return { data: [] };
    if (path.endsWith('/adspixels')) return { data: [] };
    if (path.endsWith('/adimages')) return { images: { a: { hash: 'h1' } } };
    if (path.endsWith('/campaigns') && opts.method === 'POST') return { id: '9001' };
    if (path.endsWith('/adsets') && opts.method === 'POST') return { id: `910${++n}` };
    if (path.endsWith('/adcreatives')) return { id: `920${++n}` };
    if (path.endsWith('/ads') && opts.method === 'POST') return { id: `930${++n}` };
    if (path.endsWith('/leadgen_forms')) return { id: '9400' };
    return undefined;
  });
}
