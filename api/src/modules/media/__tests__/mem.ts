import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { WorkspaceAccessService } from '../../access/access.service';
import { FilesService } from '../../files/files.service';
import { ImageService } from '../image.service';
import { AssetsService } from '../assets.service';

type Row = Record<string, any>;

/** Tabela em memória com o subconjunto do Prisma que este domínio usa (igualdade, in, not, has, contains, gte, OR, select, take, orderBy). */
export class MemTable {
  rows: Row[] = [];
  constructor(private readonly defaults: () => Row = () => ({}), private readonly rels: Record<string, (r: Row) => any> = {}) {}

  private cmp(v: any, cond: any, key: string): boolean {
    if (cond === null) return v == null;
    if (cond instanceof Date || typeof cond !== 'object') return v instanceof Date && cond instanceof Date ? v.getTime() === cond.getTime() : v === cond;
    if ('in' in cond) return cond.in.includes(v);
    if ('not' in cond) return cond.not === null ? v != null : v != null && v !== cond.not;
    if ('has' in cond) return Array.isArray(v) && v.includes(cond.has);
    if ('contains' in cond) return typeof v === 'string' && v.toLowerCase().includes(String(cond.contains).toLowerCase());
    if ('gte' in cond) return v >= cond.gte;
    throw new Error(`filtro não suportado em ${key}: ${JSON.stringify(cond)}`);
  }
  private match(r: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => (k === 'OR' ? (v as Row[]).some((w) => this.match(r, w)) : this.cmp(r[k], v, k)));
  }
  private shape(r: Row, a: Row = {}): Row {
    let out: Row = { ...r };
    for (const [rel, fn] of Object.entries(this.rels)) {
      const inc = a.include?.[rel] ?? a.select?.[rel];
      if (inc) out[rel] = fn(r);
    }
    if (a.select) {
      const sel: Row = {};
      for (const [k, on] of Object.entries(a.select)) if (on) sel[k] = out[k];
      out = sel;
    }
    return out;
  }
  async findMany(a: Row = {}) {
    let out = this.rows.filter((r) => this.match(r, a.where));
    const ob = Array.isArray(a.orderBy) ? a.orderBy[0] : a.orderBy;
    if (ob) {
      const [k, d] = Object.entries(ob)[0] as [string, any];
      const dir = typeof d === 'string' ? d : d.sort;
      out = [...out].sort((x, y) => (x[k] > y[k] ? 1 : x[k] < y[k] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    if (a.take) out = out.slice(0, a.take);
    return out.map((r) => this.shape(r, a));
  }
  async findFirst(a: Row = {}) { return (await this.findMany(a))[0] ?? null; }
  async findUnique(a: Row) {
    const w = { ...a.where };
    for (const [k, v] of Object.entries(w)) if (v && typeof v === 'object' && !(v instanceof Date) && !('in' in v) && !('not' in v)) { Object.assign(w, v); delete w[k]; }
    return this.findFirst({ ...a, where: w });
  }
  async count(a: Row = {}) { return this.rows.filter((r) => this.match(r, a.where)).length; }
  async create({ data, select }: Row) {
    const row = { id: randomUUID(), created_at: new Date(Date.now() + this.rows.length), updated_at: new Date(), ...this.defaults(), ...data };
    this.rows.push(row);
    return select ? this.shape(row, { select }) : { ...row };
  }
  async update({ where, data }: Row) {
    const r = this.rows.find((x) => this.match(x, where));
    if (!r) throw new Error('registro não encontrado');
    Object.assign(r, data, { updated_at: new Date() });
    return { ...r };
  }
  async updateMany({ where, data }: Row) {
    const hit = this.rows.filter((x) => this.match(x, where));
    hit.forEach((r) => Object.assign(r, data));
    return { count: hit.length };
  }
  async deleteMany({ where }: Row) {
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

export const WS_A = randomUUID();
export const WS_B = randomUUID();
export const OWNER = randomUUID();
export const ADMIN = randomUUID();
export const MARKETING = randomUUID();
export const VIEWER = randomUUID();
export const STRANGER = randomUUID();
const MEMBERS: [string, string, string][] = [
  [WS_A, OWNER, 'owner'], [WS_A, ADMIN, 'admin'], [WS_A, MARKETING, 'marketing'], [WS_A, VIEWER, 'viewer'], [WS_B, STRANGER, 'owner'],
];

export const status = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) { return e.getStatus ? `${e.getStatus()}:${e.getResponse().message}` : `erro:${e.message}`; }
};

export const memMembers = {
  findUnique: async ({ where }: any) => {
    const k = where.workspace_id_user_id;
    const m = MEMBERS.find(([w, u]) => w === k.workspace_id && u === k.user_id);
    return m ? { role: m[2] } : null;
  },
  findMany: async ({ where }: any) => MEMBERS.filter(([, u]) => u === where.user_id).map(([w, , r]) => ({ workspace_id: w, role: r })),
};

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface MediaWorld {
  dir: string;
  prisma: any;
  t: Record<string, MemTable>;
  files: FilesService;
  images: ImageService;
  access: WorkspaceAccessService;
  calls: { url: string; init?: RequestInit }[];
  fetchImpl: { current: Fetcher };
  assets: AssetsService;
  cleanup: () => void;
}

export const ENV_FOR_TESTS = { UPLOADS_DIR: '', JWT_SECRET: 'segredo-de-teste-16+', PUBLIC_URL: 'http://api.test', FILES_SIGNING_SECRET: undefined, NODE_ENV: 'test', APP_URL: 'http://web.test' } as any;

/** Mundo em memória do domínio de mídia: tabelas, disco temporário, fetch falso (nenhuma rede). */
export function mediaWorld(envOverride: Record<string, unknown> = {}): MediaWorld {
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-media-'));
  const t: Record<string, MemTable> = {};
  const brandName = (r: Row) => { const b = t['brands']!.rows.find((x) => x.id === r.brand_id); return b ? { name: b.name } : null; };
  const campName = (r: Row) => { const c = t['campaigns']!.rows.find((x) => x.id === r.campaign_id); return c ? { name: c.name } : null; };
  t['brands'] = new MemTable();
  t['campaigns'] = new MemTable(() => ({ status: 'draft' }));
  t['media_assets'] = new MemTable(() => ({ tags: [], status: 'draft', kind: 'image', source: 'upload', target_format: 'other', ig_ready: false, quality_report: {}, provider: null, folder: null, parent_id: null, thumbnail_path: null, thumbnail_url: null }), { brand: brandName, campaign: campName });
  t['creatives'] = new MemTable(() => ({ version: 1, status: 'draft', extras: {} }), { campaign: campName });
  t['ig_posts'] = new MemTable(() => ({ media: [] }));
  t['performance_daily'] = new MemTable(() => ({ source: 'meta' }), { campaign: (r) => { const c = t['campaigns']!.rows.find((x) => x.id === r.campaign_id); return c ? { name: c.name } : null; } });
  t['copies'] = new MemTable(() => ({ version: 1, status: 'draft', content: {} }), { campaign: (r) => { const c = t['campaigns']!.rows.find((x) => x.id === r.campaign_id); return c ? { name: c.name, brand_id: c.brand_id } : null; } });
  const prisma: any = { ...t, workspace_members: memMembers };
  const env = { ...ENV_FOR_TESTS, UPLOADS_DIR: dir, ...envOverride };
  const files = new FilesService(env);
  const images = new ImageService();
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = { current: (async () => new Response('nope', { status: 500 })) as Fetcher };
  const http: Fetcher = async (url, init) => { calls.push({ url, init }); return fetchImpl.current(url, init); };
  const access = new WorkspaceAccessService(prisma);
  const assets = new AssetsService(prisma, files, images, http, env);
  return { dir, prisma, t, files, images, access, calls, fetchImpl, assets, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Imagem sintética (cor sólida) pronta como bytes PNG/JPEG. */
export async function sampleImage(images: ImageService, w = 800, h = 600, png = false, color = 0x3366ccff): Promise<Buffer> {
  return Buffer.from(await images.encode(images.blank(w, h, color), png));
}

/** MP4 mínimo (ftyp + moov/mvhd + trak com hdlr/tkhd/stsd/mdhd/stts) para testar o leitor de cabeçalho. */
export function sampleMp4(o: { width?: number; height?: number; durationSec?: number; codec?: string; audio?: string; fps?: number } = {}): Buffer {
  const { width = 1080, height = 1920, durationSec = 8, codec = 'avc1', audio = 'mp4a', fps = 30 } = o;
  const box = (type: string, ...parts: Buffer[]) => {
    const body = Buffer.concat(parts);
    const h = Buffer.alloc(8);
    h.writeUInt32BE(8 + body.length, 0);
    h.write(type, 4, 'latin1');
    return Buffer.concat([h, body]);
  };
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
  const ts = 1000;
  const mvhd = box('mvhd', Buffer.concat([u32(0), u32(0), u32(0), u32(ts), u32(durationSec * ts), Buffer.alloc(80)]));
  const trak = (handler: string, c: string, w: number, h: number) => {
    const hdlr = box('hdlr', Buffer.concat([u32(0), u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(12)]));
    const stsd = box('stsd', Buffer.concat([u32(0), u32(1), u32(16), Buffer.from(c, 'latin1')]));
    const samples = fps * durationSec;
    const stts = box('stts', Buffer.concat([u32(0), u32(1), u32(samples), u32(ts / fps)]));
    const mdhd = box('mdhd', Buffer.concat([u32(0), u32(0), u32(0), u32(ts), u32(durationSec * ts), Buffer.alloc(4)]));
    const stbl = box('stbl', stsd, stts);
    const minf = box('minf', stbl);
    const mdia = box('mdia', mdhd, hdlr, minf);
    const tkhdBody = Buffer.concat([Buffer.alloc(76), u32(w * 65536), u32(h * 65536)]);
    return box('trak', box('tkhd', tkhdBody), mdia);
  };
  const moov = box('moov', mvhd, trak('vide', codec, width, height), trak('soun', audio, 0, 0));
  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(0), Buffer.from('isomavc1', 'latin1'));
  return Buffer.concat([ftyp, moov]);
}
