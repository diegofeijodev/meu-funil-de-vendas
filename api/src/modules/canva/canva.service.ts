/**
 * Canva Connect API (REST). Cada empresa guarda no cofre (`app_credentials`, cifrado): CANVA_CLIENT_ID, CANVA_CLIENT_SECRET,
 * CANVA_TOKENS (JSON) e CANVA_OAUTH (state + verifier PKCE). Empresas que herdam da "empresa da agência" usam a conexão dela.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { AiKeysService } from '../ai/ai-keys.service';
import { AssetsService, MediaAsset } from '../media/assets.service';
import { EXTERNAL_FETCH, ExternalFetch } from '../media/external-fetch';
import { notFound, UserError } from '../media/user-error';
import { VaultService } from '../vault/vault.service';

export const CANVA_API = 'https://api.canva.com/rest/v1';
export const CANVA_AUTHORIZE = 'https://www.canva.com/api/oauth/authorize';
export const CANVA_SCOPES = 'asset:read asset:write design:content:read design:content:write design:meta:read profile:read';
const SIZES: Record<string, [number, number]> = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920], landscape: [1200, 628] };
const OAUTH_TTL_MS = 20 * 60_000;

type Tokens = { access_token: string; refresh_token: string; expires_at: number; name?: string | null; email?: string | null };
export class CanvaAuthError extends UserError {}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

@Injectable()
export class CanvaService {
  private readonly logger = new Logger(CanvaService.name);
  /** Espera entre consultas de tarefa (sobrescrito nos testes). */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly vault: VaultService,
    private readonly keys: AiKeysService,
    private readonly assets: AssetsService,
    @Inject(EXTERNAL_FETCH) private readonly http: ExternalFetch,
    @Inject(ENV) private readonly env: Pick<Env, 'PUBLIC_URL' | 'APP_URL'>,
  ) {}

  get redirectUri(): string {
    return `${this.env.PUBLIC_URL.replace(/\/$/, '')}/api/public/canva/oauth/callback`;
  }

  // ------------------------------------------------------------------ cofre

  private async readJSON<T>(ws: string, key: string): Promise<T | null> {
    const v = await this.vault.get(ws, key);
    if (!v) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }

  private async appCreds(ws: string) {
    const id = (await this.vault.get(ws, 'CANVA_CLIENT_ID')) ?? (await this.vault.get(null, 'CANVA_CLIENT_ID'));
    const secret = (await this.vault.get(ws, 'CANVA_CLIENT_SECRET')) ?? (await this.vault.get(null, 'CANVA_CLIENT_SECRET'));
    return id && secret ? { id, secret } : null;
  }

  /** Empresa cuja conexão Canva vale para esta (a própria ou a da agência). */
  private async ownerOf(ws: string): Promise<string | null> {
    if (await this.readJSON<Tokens>(ws, 'CANVA_TOKENS')) return ws;
    const src = await this.keys.inheritSource(ws);
    if (src && (await this.readJSON<Tokens>(src, 'CANVA_TOKENS'))) return src;
    return null;
  }

  // ------------------------------------------------------------------ app e OAuth

  async saveApp(userId: string, ws: string, clientId: string, clientSecret: string | null) {
    await this.access.require(userId, ws, 'manage');
    const rows: Record<string, string> = { CANVA_CLIENT_ID: clientId.trim() };
    if (clientSecret?.trim()) rows['CANVA_CLIENT_SECRET'] = clientSecret.trim();
    await this.vault.set(ws, rows);
    return { ok: true };
  }

  async status(userId: string, ws: string) {
    await this.access.require(userId, ws, 'read');
    const app = await this.appCreds(ws);
    const owner = await this.ownerOf(ws);
    const t = owner ? await this.readJSON<Tokens>(owner, 'CANVA_TOKENS') : null;
    return {
      appSaved: !!app,
      clientIdHint: app ? `${app.id.slice(0, 4)}••••` : null,
      connected: !!t,
      inherited: !!owner && owner !== ws,
      name: t?.name ?? null,
      email: t?.email ?? null,
    };
  }

  async oauthStart(userId: string, ws: string) {
    await this.access.require(userId, ws, 'manage');
    const app = await this.appCreds(ws);
    if (!app) throw new UserError('Salve o Client ID e o Client secret do app Canva antes de entrar.');
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = `${ws}.${b64url(randomBytes(24))}`;
    await this.vault.set(ws, { CANVA_OAUTH: JSON.stringify({ state, verifier, at: Date.now() }) });
    const u = new URL(CANVA_AUTHORIZE);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', app.id);
    u.searchParams.set('redirect_uri', this.redirectUri);
    u.searchParams.set('scope', CANVA_SCOPES);
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return { authUrl: u.toString() };
  }

  private async tokenRequest(app: { id: string; secret: string }, body: Record<string, string>) {
    const res = await this.http(`${CANVA_API}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${app.id}:${app.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !json.access_token) {
      this.logger.error(`[canva] token ${res.status}`);
      throw new CanvaAuthError(json.error_description || json.message || `O Canva recusou o login (${res.status}).`);
    }
    return json as { access_token: string; refresh_token: string; expires_in: number };
  }

  /** Callback: valida o state, troca o code e grava os tokens + perfil. Devolve a empresa. */
  async finishOAuth(state: string, code: string): Promise<string> {
    const ws = state.split('.')[0] ?? '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ws)) throw new UserError('Retorno do Canva inválido.');
    const saved = await this.readJSON<{ state: string; verifier: string; at: number }>(ws, 'CANVA_OAUTH');
    if (!saved || saved.state !== state || Date.now() - saved.at > OAUTH_TTL_MS) throw new UserError('Sessão de login expirada. Tente entrar de novo.');
    const app = await this.appCreds(ws);
    if (!app) throw new UserError('App Canva não configurado.');
    const t = await this.tokenRequest(app, { grant_type: 'authorization_code', code, code_verifier: saved.verifier, redirect_uri: this.redirectUri });
    const tokens: Tokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
    const p = await this.profile(tokens.access_token).catch(() => null);
    tokens.name = p?.name ?? null;
    tokens.email = p?.email ?? null;
    await this.vault.set(ws, { CANVA_TOKENS: JSON.stringify(tokens) });
    await this.vault.delete(ws, 'CANVA_OAUTH');
    return ws;
  }

  private async profile(token: string) {
    const r = await this.http(`${CANVA_API}/users/me/profile`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new CanvaAuthError(`Perfil Canva indisponível (${r.status}).`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = (await r.json()) as any;
    return { name: (j.profile?.display_name as string) ?? null, email: (j.profile?.email as string) ?? null };
  }

  async disconnect(userId: string, ws: string) {
    await this.access.require(userId, ws, 'manage');
    await this.dropTokens(ws);
    return { ok: true };
  }

  private async dropTokens(ws: string) {
    await this.vault.delete(ws, 'CANVA_TOKENS');
    await this.vault.delete(ws, 'CANVA_OAUTH');
  }

  /** Token válido (renova antes de expirar; o refresh_token do Canva é de uso único). */
  private async accessToken(ws: string): Promise<{ token: string; owner: string }> {
    const owner = await this.ownerOf(ws);
    if (!owner) throw new UserError('Canva não está conectado nesta empresa. Entre com Canva em Integrações.');
    const t = (await this.readJSON<Tokens>(owner, 'CANVA_TOKENS'))!;
    if (t.expires_at - Date.now() > 120_000) return { token: t.access_token, owner };
    const app = await this.appCreds(owner);
    if (!app) throw new UserError('App Canva não configurado.');
    try {
      const n = await this.tokenRequest(app, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
      const next: Tokens = { ...t, access_token: n.access_token, refresh_token: n.refresh_token ?? t.refresh_token, expires_at: Date.now() + n.expires_in * 1000 };
      await this.vault.set(owner, { CANVA_TOKENS: JSON.stringify(next) });
      return { token: next.access_token, owner };
    } catch (e) {
      if (e instanceof CanvaAuthError) {
        await this.dropTokens(owner);
        throw new UserError('A conexão com o Canva expirou ou foi revogada. Entre com Canva de novo em Integrações.');
      }
      throw e;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async api(ws: string, path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<any> {
    const { token, owner } = await this.accessToken(ws);
    const res = await this.http(`${CANVA_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json().catch(() => ({}))) as any;
    if (res.status === 401) {
      await this.dropTokens(owner);
      throw new UserError('O Canva recusou o acesso (login revogado). Entre com Canva de novo em Integrações.');
    }
    if (!res.ok) {
      this.logger.error(`[canva] ${path} ${res.status}`);
      throw new UserError(`Canva: ${json.message || json.error || `erro ${res.status}`}`);
    }
    return json;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async poll(ws: string, path: string, pick: (j: any) => any) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const j = pick(await this.api(ws, path));
      if (j?.status === 'success') return j;
      if (j?.status === 'failed') throw new UserError(`Canva: ${j.error?.message ?? 'a tarefa falhou'}`);
      await this.sleep(2000);
    }
    throw new UserError('O Canva demorou demais para responder. Tente de novo em instantes.');
  }

  // ------------------------------------------------------------------ operações

  async test(userId: string, ws: string) {
    await this.access.require(userId, ws, 'read');
    const j = await this.api(ws, '/users/me/profile');
    return { name: (j.profile?.display_name as string) ?? null };
  }

  private async loadAsset(ws: string, assetId: string): Promise<{ url: string; title: string }> {
    const a = await this.prisma.media_assets.findFirst({ where: { id: assetId, workspace_id: ws }, select: { url: true, title: true } });
    if (!a || !a.url) throw notFound('Mídia não encontrada.');
    return { url: a.url, title: a.title ?? 'Criativo' };
  }

  /** Envia uma mídia para os uploads do Canva e devolve o asset_id. */
  private async upload(ws: string, asset: { url: string; title: string }) {
    let bytes: Uint8Array;
    try {
      bytes = (await this.assets.download(asset.url)).bytes;
    } catch {
      throw new UserError('Não foi possível baixar a mídia da biblioteca.');
    }
    const start = await this.api(ws, '/asset-uploads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Asset-Upload-Metadata': JSON.stringify({ name_base64: Buffer.from(asset.title.slice(0, 50) || 'Criativo').toString('base64') }),
      },
      body: bytes as BodyInit,
    });
    const jobId = start.job?.id as string;
    const done = start.job?.status === 'success' ? start.job : await this.poll(ws, `/asset-uploads/${encodeURIComponent(jobId)}`, (j) => j.job);
    return { assetId: (done.asset?.id as string) ?? null };
  }

  async sendAsset(userId: string, ws: string, assetId: string) {
    await this.access.require(userId, ws, 'write');
    return this.upload(ws, await this.loadAsset(ws, assetId));
  }

  /** Cria um design editável (com mídia opcional) e devolve o link de edição. */
  async createFromBrief(userId: string, ws: string, d: { title: string; size?: string | null; assetId?: string | null }) {
    await this.access.require(userId, ws, 'write');
    let canvaAssetId: string | null = null;
    if (d.assetId) canvaAssetId = (await this.upload(ws, await this.loadAsset(ws, d.assetId))).assetId;
    const [width, height] = SIZES[d.size ?? 'portrait'] ?? SIZES['portrait']!;
    const j = await this.api(ws, '/designs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        design_type: { type: 'custom', width, height },
        title: d.title.slice(0, 250) || 'Meu Funil',
        ...(canvaAssetId ? { asset_id: canvaAssetId } : {}),
      }),
    });
    return { designId: (j.design?.id as string) ?? null, editUrl: (j.design?.urls?.edit_url as string) ?? null };
  }

  async listDesigns(userId: string, ws: string, query?: string | null) {
    await this.access.require(userId, ws, 'read');
    const q = new URLSearchParams({ ownership: 'any', sort_by: query ? 'relevance' : 'modified_descending' });
    if (query) q.set('query', query);
    const j = await this.api(ws, `/designs?${q}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((j.items ?? []) as any[]).map((d) => ({ id: String(d.id), title: String(d.title ?? 'Sem título'), thumbnail: (d.thumbnail?.url as string) ?? null }));
  }

  /** Exporta um design (png/jpg/mp4) e salva na biblioteca ligado ao design_id (marca/campanha conferidas no workspace). */
  async importDesign(
    userId: string,
    ws: string,
    d: { designId: string; title?: string | null; format?: 'png' | 'jpg' | 'mp4' | null; brandId?: string | null; campaignId?: string | null },
  ): Promise<MediaAsset> {
    await this.access.require(userId, ws, 'write');
    const designId = /design\/([A-Za-z0-9_-]+)/.exec(d.designId)?.[1] ?? d.designId;
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(designId)) throw new UserError('Endereço ou id do design inválido.');
    if (d.brandId && !(await this.prisma.brands.findFirst({ where: { id: d.brandId, workspace_id: ws }, select: { id: true } }))) throw notFound('Marca não encontrada.');
    if (d.campaignId && !(await this.prisma.campaigns.findFirst({ where: { id: d.campaignId, workspace_id: ws }, select: { id: true } }))) throw notFound('Campanha não encontrada.');
    const fmt = d.format ?? 'png';
    const start = await this.api(ws, '/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ design_id: designId, format: fmt === 'jpg' ? { type: 'jpg', quality: 92 } : { type: fmt } }),
    });
    const done = start.job?.status === 'success' ? start.job : await this.poll(ws, `/exports/${encodeURIComponent(String(start.job?.id))}`, (j) => j.job);
    const urls = (done.urls ?? []) as string[];
    if (!urls.length) throw new UserError('O Canva não devolveu o arquivo exportado.');
    const out: MediaAsset[] = [];
    for (const [i, url] of urls.entries()) {
      out.push(
        await this.assets.ingest({
          workspaceId: ws, kind: fmt === 'mp4' ? 'video' : 'image', targetFormat: 'other', source: 'canva', sourceUrl: url,
          title: `${d.title || `Canva ${designId}`}${urls.length > 1 ? ` (${i + 1})` : ''}`, provider: 'canva', prompt: `canva_design_id:${designId}`,
          brandId: d.brandId ?? null, campaignId: d.campaignId ?? null, createdBy: userId, normalize: false,
        }),
      );
    }
    return out[0]!;
  }

  // ------------------------------------------------------------------ callback público

  /** Para onde o callback devolve o navegador (`/integrations?canva=ok|error&msg=`). */
  backUrl(status: 'ok' | 'error', msg?: string): string {
    const to = new URL('/integrations', this.env.APP_URL);
    to.searchParams.set('canva', status);
    if (msg) to.searchParams.set('msg', msg.slice(0, 200));
    return to.toString();
  }
}
