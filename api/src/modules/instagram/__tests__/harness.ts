import { randomUUID } from 'node:crypto';
import { WorkspaceAccessService } from '../../access/access.service';
import { memMembers, OWNER, VIEWER, WS_A } from '../../media/__tests__/mem';
import { IgStore } from '../ig-store.service';

type Row = Record<string, any>;

/** Tabela em memória com o subconjunto do Prisma que o Instagram usa (gt/gte/lt/lte, in/notIn/not, has, JSON path, OR/AND, orderBy com nulls). */
export class IgTable {
  rows: Row[] = [];
  constructor(private readonly defaults: () => Row = () => ({}), private readonly unique: string[] | null = null) {}

  private cmp(v: any, cond: any, key: string): boolean {
    if (cond === null) return v == null;
    if (cond instanceof Date || typeof cond !== 'object') return v instanceof Date && cond instanceof Date ? v.getTime() === cond.getTime() : v === cond;
    return Object.entries(cond).every(([op, c]: [string, any]) => {
      const t = (x: any) => (x instanceof Date ? x.getTime() : x);
      switch (op) {
        case 'in': return c.includes(v);
        case 'notIn': return !c.includes(v);
        case 'not': return c === null ? v != null : v !== c;
        case 'has': return Array.isArray(v) && v.includes(c);
        case 'contains': return typeof v === 'string' && v.toLowerCase().includes(String(c).toLowerCase());
        case 'gt': return v != null && t(v) > t(c);
        case 'gte': return v != null && t(v) >= t(c);
        case 'lt': return v != null && t(v) < t(c);
        case 'lte': return v != null && t(v) <= t(c);
        case 'path': return true; // tratado em match
        case 'equals': return true;
        default: throw new Error(`filtro não suportado em ${key}: ${op}`);
      }
    });
  }
  private match(r: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => this.match(r, w));
      if (k === 'AND') return (v as Row[]).every((w) => this.match(r, w));
      if (v && typeof v === 'object' && 'path' in v) return (v.path as string[]).reduce((o: any, p: string) => o?.[p], r[k]) === v.equals;
      return this.cmp(r[k], v, k);
    });
  }
  private pick(r: Row, a: Row = {}): Row {
    if (!a.select) return { ...r };
    const out: Row = {};
    for (const [k, on] of Object.entries(a.select)) if (on) out[k] = r[k];
    return out;
  }
  private sorted(rows: Row[], orderBy: any) {
    const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return [...rows].sort((x, y) => {
      for (const ob of list) {
        const [k, d] = Object.entries(ob)[0] as [string, any];
        const dir = typeof d === 'string' ? d : d.sort;
        const nullsLast = typeof d === 'object' && d.nulls === 'last';
        const a = x[k], b = y[k];
        if (a == null || b == null) {
          if (a == null && b == null) continue;
          const nullFirst = !nullsLast;
          return (a == null ? -1 : 1) * (nullFirst ? 1 : -1);
        }
        const av = a instanceof Date ? a.getTime() : a, bv = b instanceof Date ? b.getTime() : b;
        if (av === bv) continue;
        return (av > bv ? 1 : -1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }
  async findMany(a: Row = {}) {
    let out = this.sorted(this.rows.filter((r) => this.match(r, a.where)), a.orderBy);
    if (a.take) out = out.slice(0, a.take);
    return out.map((r) => this.pick(r, a));
  }
  async findFirst(a: Row = {}) { return (await this.findMany(a))[0] ?? null; }
  async findUnique(a: Row) {
    const OPS = new Set(['in', 'notIn', 'not', 'has', 'contains', 'gt', 'gte', 'lt', 'lte', 'path', 'equals']);
    const w: Row = {};
    for (const [k, v] of Object.entries(a.where)) {
      // Chave composta (`workspace_id_phone: { workspace_id, phone }`): achata.
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && Object.keys(v).every((x) => !OPS.has(x))) Object.assign(w, v);
      else w[k] = v;
    }
    return this.findFirst({ ...a, where: w });
  }
  async count(a: Row = {}) { return this.rows.filter((r) => this.match(r, a.where)).length; }
  private build(data: Row): Row {
    return { id: randomUUID(), created_at: new Date(Date.now() + this.rows.length), updated_at: new Date(), ...this.defaults(), ...data };
  }
  async create({ data, select }: Row) {
    const row = this.build(data);
    if (this.unique && this.unique.every((k) => row[k] != null) && this.rows.some((r) => this.unique!.every((k) => (r[k] instanceof Date ? r[k].getTime() === row[k]?.getTime?.() : r[k] === row[k])))) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
    this.rows.push(row);
    return this.pick(row, { select });
  }
  async createMany({ data }: Row) {
    for (const d of data as Row[]) this.rows.push(this.build(d));
    return { count: (data as Row[]).length };
  }
  async createManyAndReturn({ data, select }: Row) {
    const out: Row[] = [];
    for (const d of data as Row[]) {
      const r = this.build(d);
      this.rows.push(r);
      out.push(this.pick(r, { select }));
    }
    return out;
  }
  private apply(r: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && 'increment' in v) r[k] = (r[k] ?? 0) + (v as any).increment;
      else r[k] = v;
    }
    r.updated_at = new Date();
  }
  async update({ where, data }: Row) {
    const r = this.rows.find((x) => this.match(x, where));
    if (!r) throw new Error('registro não encontrado');
    this.apply(r, data);
    return { ...r };
  }
  async updateMany({ where, data }: Row) {
    const hit = this.rows.filter((x) => this.match(x, where));
    hit.forEach((r) => this.apply(r, data));
    return { count: hit.length };
  }
  async deleteMany({ where }: Row = {}) {
    const keep = this.rows.filter((x) => !this.match(x, where));
    const n = this.rows.length - keep.length;
    this.rows = keep;
    return { count: n };
  }
  async upsert({ where, create, update }: Row) {
    const found = await this.findUnique({ where });
    return found ? this.update({ where: { id: found.id }, data: update }) : this.create({ data: create });
  }
}

export const uuid = () => randomUUID();
const now = () => new Date();

/** Mundo em memória do Instagram: tabelas + Graph falso (nenhuma rede). */
export function igWorld() {
  const t: Record<string, IgTable> = {
    ig_posts: new IgTable(() => ({ status: 'idea', hashtags: [], creative_brief: {}, media: [], ai_generation_log: [], metrics_collected: [], retry_count: 0, source: 'app', plan_id: null, run_id: null, automation: null, approved_at: null, scheduled_at: null, published_at: null, ig_media_id: null, ig_creation_id: null, last_error: null, rejection_reason: null, caption: null, cta: null, theme: null, hook: null })),
    ig_content_plans: new IgTable(() => ({ status: 'draft', auto_publish: false, requires_approval: true, content_pillars: [], posting_frequency: { feed: 3 }, preferred_times: [], hashtag_strategy: {}, ai_notes: [], pillar_weights: {}, posting_days: [0, 1, 2, 3, 4, 5, 6], brand_id: null, cta_default: null, objective: null, tone_of_voice: null })),
    ig_auto_runs: new IgTable(() => ({ status: 'planning', filled: 0, slots: [], recurring: false, locked_until: null, parent_id: null, campaign_id: null, last_error: null, focus: null, mode: 'publish' })),
    ig_autopilot_events: new IgTable(() => ({ level: 'info' })),
    ig_autopilot_weeks: new IgTable(() => ({}), ['plan_id', 'week_start']),
    publishing_jobs: new IgTable(() => ({ status: 'queued', attempts: 0, locked_at: null, log: null, mode: 'mock', channel: 'meta_ads', ig_post_id: null })),
    instagram_accounts: new IgTable(() => ({ status: 'disconnected' })),
    ig_post_metrics: new IgTable(() => ({ collected_at: now() })),
    ig_account_insights: new IgTable(),
    media_assets: new IgTable(() => ({ ig_ready: true, quality_report: {}, provider: 'gemini', source: 'gemini', url: 'https://cdn.test/a.jpg' })),
    brands: new IgTable(),
    campaigns: new IgTable(),
    cron_tokens: new IgTable(),
    cron_heartbeats: new IgTable(),
    crm_integrations: new IgTable(() => ({ status: 'connected', config: {}, webhook_token: randomUUID().replace(/-/g, ''), verify_token: 'vt-123' })),
    crm_webhook_events: new IgTable(() => ({ status: 'processed', error_message: null }), ['source', 'external_id']),
    crm_leads: new IgTable(() => ({ unsubscribed: false, ai_active: true, first_response_at: null, source: 'manual' })),
    crm_conversations: new IgTable(() => ({ unread_count: 0, window_expires_at: null })),
    crm_messages: new IgTable(),
    crm_interactions: new IgTable(),
    crm_pipelines: new IgTable(),
    crm_stages: new IgTable(),
    crm_settings: new IgTable(),
    crm_stage_history: new IgTable(),
    workspace_members: new IgTable(),
  };
  const prisma: any = { ...t, workspace_members: memMembers, $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops) };
  const access = new WorkspaceAccessService(prisma);
  const store = new IgStore(prisma);

  const calls: { ws: string | null; path: string; opts: any }[] = [];
  const responders: ((path: string, opts: any, ws: string | null) => any | undefined)[] = [];
  const cfg = { appId: 'app', appSecret: 'segredo-meta', token: 'tok', adAccountId: null, pageId: 'page1', instagramId: null };
  const graph = {
    config: async () => ({ ...cfg }),
    graph: jest.fn(async (ws: string | null, path: string, opts: any = {}) => {
      calls.push({ ws, path, opts });
      for (const r of responders) {
        const out = r(path, opts, ws);
        if (out instanceof Error) throw out;
        if (out !== undefined) return out;
      }
      return {};
    }),
  } as any;
  const respond = (fn: (path: string, opts: any, ws: string | null) => any) => { responders.unshift(fn); };
  return { t, prisma, access, store, graph, calls, respond, cfg, WS_A, OWNER, VIEWER };
}

export type IgWorld = ReturnType<typeof igWorld>;

/** Post pronto para publicar (mídia com URL pública HTTPS e asset validado). */
export function seedPost(w: IgWorld, over: Row = {}): any {
  const asset = { id: uuid(), workspace_id: WS_A, ig_ready: true, quality_report: {}, provider: 'gemini', source: 'gemini', url: 'https://cdn.test/a.jpg' };
  w.t['media_assets']!.rows.push(asset);
  const post: any = {
    id: uuid(), workspace_id: WS_A, format: 'feed_image', status: 'approved', created_at: new Date(), updated_at: new Date(), caption: 'Legenda', hashtags: ['a', 'b'], cta: 'Peça já',
    hashtagsx: undefined, hashtags_: undefined, plan_id: null, run_id: null, automation: null, approved_at: new Date(), scheduled_at: null, published_at: null, ig_media_id: null, ig_creation_id: null, retry_count: 0,
    creative_brief: {}, ai_generation_log: [], metrics_collected: [], source: 'app', last_error: null, rejection_reason: null, theme: 'Tema', hook: null,
    media: [{ url: asset.url, type: 'image', order: 0, asset_id: asset.id, ig_ready: true }],
    ...over,
  };
  w.t['ig_posts']!.rows.push(post);
  return post;
}

// ---------------------------------------------------------------------------------------------------------------------
// Serviços ligados a fakes (IA, provedor de mídia, pipeline, biblioteca, estrategista): nenhuma rede, nenhum disco.
// ---------------------------------------------------------------------------------------------------------------------
import { AccountService } from '../account.service';
import { AutoCalendarService } from '../auto-calendar.service';
import { AutopilotService } from '../autopilot.service';
import { ContentService } from '../content.service';
import { InboundService } from '../inbound.service';
import { InstagramActionsService } from '../instagram-actions.service';
import { InstagramResourcesService } from '../instagram-resources.service';
import { MediaGenerationService } from '../media-generation.service';
import { MetricsService } from '../metrics.service';
import { PublishingService } from '../publishing.service';

export const ART = {
  subject: 's', scene: 'c', composition: 'x', lighting: 'l', camera: '50mm', style: 'foto', color_palette: ['#fff'], mood: 'm', text_in_image: 'none', negative: 'blurry',
  aspect_ratio: '1:1', prompt_final: 'A frosty glass of draft beer on a wooden counter, warm light, 50mm', video_shots: [],
};
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

export function igServices(w: IgWorld) {
  /** Respostas da IA por nome do schema (`ig_calendar`, `ig_caption`, `ig_pillars`, `ig_auto_calendar`). */
  const aiJson: Record<string, (req: any) => any> = {};
  const ai = {
    jsonWithEngine: jest.fn(async (_ws: string, req: any) => ({ content: aiJson[req.name]?.(req) ?? {}, engine: 'IA do app' })),
    json: jest.fn(async () => ({ ...ART })),
  } as any;
  const provider: any = {
    id: 'gemini', label: 'Gemini', sandbox: false,
    generateImage: jest.fn(async () => ({ status: 'ready', assetUrl: null, bytes: PNG, mime: 'image/png', thumbnailUrl: null, externalJobId: null, cost: 1 })),
    generateVideo: jest.fn(async () => ({ status: 'ready', assetUrl: 'https://provider.test/v.mp4', thumbnailUrl: null, externalJobId: null, cost: 6 })),
    getGenerationStatus: jest.fn(async (id: string) => ({ status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 })),
    getAsset: jest.fn(async () => null),
  };
  const providers = { resolve: jest.fn(async () => provider) } as any;
  const refs = { loadBrandRefs: jest.fn(async () => []), loadFont: jest.fn(async () => new ArrayBuffer(0)), loadLogo: jest.fn(async () => null) } as any;
  const pipeline = {
    run: jest.fn(async (inp: any) => {
      const asset = { id: uuid(), workspace_id: inp.workspaceId, url: 'https://cdn.test/final.jpg', kind: 'image', width: 1080, height: 1080, ig_ready: true, quality_report: {}, provider: 'gemini', source: 'gemini' };
      w.t['media_assets']!.rows.push(asset);
      const win = { assetId: asset.id, url: asset.url, score: { total: 40 }, winner: true };
      return { pending: null, ad: inp.ad, variations: [win], winner: win, finalAssetId: asset.id, finalUrl: asset.url, finalThumb: asset.url, width: 1080, height: 1080, igReady: true, cost: 3 };
    }),
  } as any;
  const extras = { build: jest.fn(async () => ({ cover_url: 'https://cdn.test/cover.jpg', captions_srt: 'https://cdn.test/c.srt' })) } as any;
  const assets = {
    ingest: jest.fn(async (i: any) => {
      const row = { id: uuid(), workspace_id: i.workspaceId, url: `https://cdn.test/${uuid()}.${i.kind === 'video' ? 'mp4' : 'jpg'}`, kind: i.kind, width: 1080, height: i.kind === 'video' ? 1920 : 1350, duration_seconds: i.kind === 'video' ? 8 : null, ig_ready: true, quality_report: {}, provider: i.provider ?? 'upload', source: i.source, ig_post_id: i.igPostId ?? null, title: i.title };
      w.t['media_assets']!.rows.push(row);
      return row;
    }),
    download: jest.fn(async () => ({ bytes: new Uint8Array(PNG), mime: 'image/png' })),
  } as any;
  const strategist = { currentStrategy: jest.fn(async () => null) } as any;
  const http = jest.fn(async () => new Response(null, { status: 200 }));
  const images = {} as any;

  const content = new ContentService(w.prisma, ai, w.store);
  const publishing = new PublishingService(w.store, w.graph, http as any);
  publishing.sleep = async () => undefined;
  const mediaGen = new MediaGenerationService(w.store, ai, providers, refs, pipeline, extras, assets, content, publishing, images);
  const metrics = new MetricsService(w.store, w.graph);
  const account = new AccountService(w.store, w.graph, metrics, assets);
  const auto = new AutoCalendarService(w.store, content, strategist, mediaGen, publishing);
  const autopilot = new AutopilotService(w.store, content, mediaGen, publishing, auto);
  const actions = new InstagramActionsService(w.access, w.store, account, content, mediaGen, publishing, metrics, autopilot, auto);
  const resources = new InstagramResourcesService(w.store, auto);
  const hooks = { startCadence: jest.fn(async () => undefined), stopCadences: jest.fn(async () => 0), runSdr: jest.fn(async () => null) as jest.Mock, describeMedia: jest.fn(async () => null) };
  const inbound = new InboundService(w.prisma, w.graph, hooks as any);
  return { ai, aiJson, provider, providers, refs, pipeline, extras, assets, strategist, http, content, publishing, mediaGen, metrics, account, auto, autopilot, actions, resources, inbound, hooks };
}
