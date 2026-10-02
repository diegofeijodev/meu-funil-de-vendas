import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { assertExternalUrl, EXTERNAL_FETCH, ExternalFetch } from '../media/external-fetch';
import { UserError } from '../media/user-error';

/** Teto do corpo de qualquer resposta de servidor MCP / OAuth (5 MB). */
export const MAX_MCP_BODY_BYTES = 5 * 1024 * 1024;

/** Lê o corpo como texto aos pedaços e aborta ao passar do teto (não confia em content-length). */
export async function readTextCapped(res: Response, max = MAX_MCP_BODY_BYTES): Promise<string> {
  const tooBig = () => new UserError('A resposta do servidor MCP é grande demais.');
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    await res.body?.cancel().catch(() => undefined);
    throw tooBig();
  }
  if (!res.body) {
    const t = await res.text();
    if (Buffer.byteLength(t) > max) throw tooBig();
    return t;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export type McpTool = { name: string; description?: string | undefined; inputSchema?: unknown };
export type McpCallResult = { text: string; mediaUrl: string | null; structured: string | null };
export type AuthServerMetadata = { authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string; scopes_supported?: string[] };
export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: Date | null };

type JsonRpcResponse = { result?: any; error?: { code: number; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** O servidor MCP pede login (401/403). `resourceMetadataUrl` vem do `WWW-Authenticate` (RFC 9728). */
export class McpAuthRequiredError extends UserError {
  constructor(message: string, public readonly resourceMetadataUrl: string | null) {
    super(message);
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const randomToken = (size = 32) => b64url(randomBytes(size));
export function pkcePair() {
  const verifier = randomToken(48);
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

/** Escolhe a ferramenta mais provável para uma intenção (imagem, vídeo, publicação). */
export function pickTool(tools: McpTool[], keywords: string[]): McpTool | null {
  const lower = tools.map((t) => ({ t, hay: `${t.name} ${t.description ?? ''}`.toLowerCase() }));
  for (const kw of keywords) {
    const hit = lower.find((x) => x.hay.includes(kw));
    if (hit) return hit.t;
  }
  return tools[0] ?? null;
}

export function buildAuthorizationUrl(p: {
  authorizationEndpoint: string; clientId: string; redirectUri: string; state: string; challenge: string; scope?: string; resource?: string;
}): string {
  const url = new URL(p.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('state', p.state);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (p.scope) url.searchParams.set('scope', p.scope);
  if (p.resource) url.searchParams.set('resource', p.resource);
  return url.toString();
}

function buildScope(resourceScopes?: string[], serverScopes?: string[]) {
  const supported = new Set([...(serverScopes ?? []), ...(resourceScopes ?? [])]);
  const wanted = resourceScopes?.length ? [...resourceScopes] : [...supported];
  if (supported.has('offline_access') && !wanted.includes('offline_access')) wanted.push('offline_access');
  return wanted.join(' ') || undefined;
}

/**
 * Cliente MCP (Model Context Protocol) — Streamable HTTP / JSON-RPC 2.0 + OAuth 2.1 (PKCE).
 * Toda chamada de rede passa por `EXTERNAL_FETCH` (fake nos testes). Só https (localhost só fora de produção)
 * e nunca para a rede interna; redirecionamentos seguidos à mão (≤5, sem credencial entre origens).
 */
@Injectable()
export class McpClient {
  constructor(
    @Inject(EXTERNAL_FETCH) private readonly http: ExternalFetch,
    @Inject(ENV) private readonly env: Pick<Env, 'NODE_ENV'>,
  ) {}

  private get allowLocal() {
    return this.env.NODE_ENV !== 'production';
  }

  assertUrl(raw: string): string {
    try {
      return assertExternalUrl(raw, this.allowLocal, 'servidor MCP');
    } catch (e) {
      // Mesmas mensagens do protótipo.
      const msg = (e as { message?: string }).message ?? '';
      if (/inválido/.test(msg)) throw new UserError('Endereço do servidor MCP inválido.');
      if (/https/.test(msg)) throw new UserError('Use um endereço https:// para o servidor MCP.');
      throw e;
    }
  }

  /** fetch que segue redirecionamentos manualmente (preserva método/corpo em 307/308; 303 vira GET). */
  private async follow(input: string, init: RequestInit & { headers?: Record<string, string> }): Promise<Response> {
    let url = input;
    let method = init.method ?? 'GET';
    let body: BodyInit | null = (init.body ?? null) as BodyInit | null;
    let headers = { ...(init.headers ?? {}) };
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await this.http(url, { ...init, method, body, headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
      if (!REDIRECTS.has(res.status)) return res;
      const location = res.headers.get('location');
      if (!location) return res;
      const next = new URL(location, url);
      try {
        assertExternalUrl(next.toString(), this.allowLocal, 'servidor MCP');
      } catch {
        throw new UserError('O servidor MCP redirecionou para um endereço não seguro.');
      }
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = null;
        const { 'Content-Type': _ct, ...rest } = headers as Record<string, string>;
        headers = rest;
      }
      if (new URL(url).origin !== next.origin) {
        const { Authorization: _a, ...rest } = headers as Record<string, string>;
        headers = rest;
      }
      url = next.toString();
    }
    throw new UserError('O servidor MCP redirecionou vezes demais.');
  }

  private async rpc(url: string, token: string | null, method: string, params?: unknown, sessionId?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const res = await this.follow(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params ?? {} }) });
    const newSession = res.headers.get('Mcp-Session-Id') ?? sessionId;
    const text = await readTextCapped(res);
    if (res.status === 401 || res.status === 403) {
      const meta = /resource_metadata="([^"]+)"/i.exec(res.headers.get('www-authenticate') ?? '')?.[1] ?? null;
      throw new McpAuthRequiredError('O servidor MCP exige autenticação.', meta);
    }
    if (!res.ok) throw new UserError(`Servidor MCP respondeu ${res.status}: ${text.slice(0, 200)}`);
    if (!text.trim()) return { payload: {} as JsonRpcResponse, sessionId: newSession };
    let payload: JsonRpcResponse;
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const dataLine = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean).pop();
      payload = dataLine ? JSON.parse(dataLine) : {};
    } else {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new UserError('O servidor MCP devolveu uma resposta inválida.');
      }
    }
    if (payload.error) throw new UserError(payload.error.message);
    return { payload, sessionId: newSession };
  }

  private async notify(url: string, token: string | null, method: string, sessionId?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    await this.follow(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method }) }).catch(() => undefined);
  }

  /** Sessão nova (initialize + notifications/initialized) a cada chamada — igual ao protótipo. */
  async openSession(rawUrl: string, token: string | null) {
    const url = this.assertUrl(rawUrl);
    const init = await this.rpc(url, token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'ai-marketing-os', version: '1.0.0' },
    });
    await this.notify(url, token, 'notifications/initialized', init.sessionId ?? undefined);
    return { url, token, sessionId: init.sessionId ?? undefined };
  }

  async listTools(rawUrl: string, token: string | null): Promise<McpTool[]> {
    const s = await this.openSession(rawUrl, token);
    const res = await this.rpc(s.url, token, 'tools/list', {}, s.sessionId);
    return ((res.payload.result?.tools ?? []) as McpTool[]).map((t) => ({ name: t.name, description: t.description }));
  }

  async callTool(rawUrl: string, token: string | null, name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const s = await this.openSession(rawUrl, token);
    const res = await this.rpc(s.url, token, 'tools/call', { name, arguments: args }, s.sessionId);
    const result = res.payload.result ?? {};
    if (result.isError) {
      const msg = (result.content ?? []).map((c: any) => c?.text).filter(Boolean).join(' '); // eslint-disable-line @typescript-eslint/no-explicit-any
      throw new UserError(msg || `A ferramenta ${name} retornou erro.`);
    }
    const content: any[] = result.content ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const text = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
    let mediaUrl: string | null = null;
    for (const c of content) {
      if ((c?.type === 'image' || c?.type === 'video') && typeof c.data === 'string') {
        mediaUrl = c.data.startsWith('http') ? c.data : `data:${c.mimeType ?? 'image/png'};base64,${c.data}`;
        break;
      }
      if (c?.type === 'resource' && typeof c.resource?.uri === 'string' && c.resource.uri.startsWith('http')) {
        mediaUrl = c.resource.uri;
        break;
      }
    }
    if (!mediaUrl && result.structuredContent) {
      const found = /https?:\/\/[^\s"']+/i.exec(JSON.stringify(result.structuredContent));
      if (found) mediaUrl = found[0];
    }
    if (!mediaUrl) {
      const found = /https?:\/\/\S+\.(png|jpe?g|webp|gif|mp4|mov)/i.exec(text);
      if (found) mediaUrl = found[0];
    }
    return { text, mediaUrl, structured: result.structuredContent ? JSON.stringify(result.structuredContent) : null };
  }

  // ------------------------------------------------------------------ OAuth 2.1 / PKCE

  private async getJson(url: string): Promise<any | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const res = await this.follow(this.assertUrl(url), { method: 'GET', headers: { Accept: 'application/json' } });
      return res.ok ? JSON.parse(await readTextCapped(res)) : null;
    } catch {
      return null;
    }
  }

  /** Descobre o Authorization Server do servidor MCP (RFC 9728 + RFC 8414). */
  async discoverAuthServer(mcpUrl: string, resourceMetadataUrl?: string | null) {
    const target = new URL(this.assertUrl(mcpUrl));
    const prm =
      (resourceMetadataUrl ? await this.getJson(resourceMetadataUrl) : null) ??
      (await this.getJson(`${target.origin}/.well-known/oauth-protected-resource${target.pathname}`)) ??
      (await this.getJson(`${target.origin}/.well-known/oauth-protected-resource`));
    const issuer: string = prm?.authorization_servers?.[0] ?? target.origin;
    const issuerUrl = new URL(issuer);
    const candidates = [
      `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === '/' ? '' : issuerUrl.pathname}`,
      `${issuerUrl.origin}/.well-known/openid-configuration`,
      `${issuerUrl.origin}/.well-known/oauth-authorization-server`,
    ];
    for (const c of candidates) {
      const meta = await this.getJson(c);
      if (meta?.authorization_endpoint && meta?.token_endpoint) {
        return {
          metadata: meta as AuthServerMetadata,
          resource: (prm?.resource as string) ?? `${target.origin}${target.pathname}`,
          scope: buildScope(prm?.scopes_supported, meta.scopes_supported),
        };
      }
    }
    throw new UserError('Não foi possível descobrir o servidor de autenticação (OAuth) deste MCP.');
  }

  async registerClient(registrationEndpoint: string, redirectUri: string) {
    const res = await this.follow(this.assertUrl(registrationEndpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'Meu Funil',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
    if (!res.ok) throw new UserError(`Falha no registro do aplicativo OAuth (${res.status}).`);
    const json = JSON.parse(await readTextCapped(res)) as { client_id: string; client_secret?: string };
    return { clientId: json.client_id, clientSecret: json.client_secret ?? null };
  }

  private async tokenRequest(tokenEndpoint: string, form: Record<string, string>, clientSecret?: string | null): Promise<TokenSet> {
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (clientSecret) headers['Authorization'] = `Basic ${Buffer.from(`${form['client_id']}:${clientSecret}`).toString('base64')}`;
    const res = await this.follow(this.assertUrl(tokenEndpoint), { method: 'POST', headers, body: new URLSearchParams(form).toString() });
    const text = await readTextCapped(res);
    if (!res.ok) throw new UserError(`Falha ao obter o token (${res.status}): ${text.slice(0, 160)}`);
    let json: { access_token: string; refresh_token?: string; expires_in?: number };
    try {
      json = JSON.parse(text);
    } catch {
      throw new UserError('Falha ao obter o token (resposta inválida).');
    }
    if (!json.access_token) throw new UserError('Falha ao obter o token (resposta sem access_token).');
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
    };
  }

  exchangeCode(o: { tokenEndpoint: string; code: string; codeVerifier: string; clientId: string; clientSecret?: string | null; redirectUri: string; resource?: string | null }) {
    const form: Record<string, string> = { grant_type: 'authorization_code', code: o.code, code_verifier: o.codeVerifier, client_id: o.clientId, redirect_uri: o.redirectUri };
    if (o.resource) form['resource'] = o.resource;
    return this.tokenRequest(o.tokenEndpoint, form, o.clientSecret);
  }

  refreshAccessToken(o: { tokenEndpoint: string; refreshToken: string; clientId: string; clientSecret?: string | null; resource?: string | null }) {
    const form: Record<string, string> = { grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: o.clientId };
    if (o.resource) form['resource'] = o.resource;
    return this.tokenRequest(o.tokenEndpoint, form, o.clientSecret);
  }
}
