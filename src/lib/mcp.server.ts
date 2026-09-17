/**
 * Cliente MCP (Model Context Protocol) — Streamable HTTP / JSON-RPC + OAuth 2.1 (PKCE).
 * Roda apenas no servidor: tokens do workspace nunca chegam ao navegador.
 *
 * IMPORTANTE (runtime edge): `redirect: "error"` NÃO é suportado no runtime de
 * borda (Workers) e derruba a requisição com
 * "Invalid redirect value, must be one of 'follow' or 'manual'".
 * Por isso usamos sempre `redirect: "manual"` e tratamos 3xx explicitamente.
 */

export type McpTool = { name: string; description?: string | undefined; inputSchema?: unknown };

type JsonRpcResponse = { result?: any; error?: { code: number; message: string } };

export class McpAuthRequiredError extends Error {
  constructor(
    message: string,
    public readonly resourceMetadataUrl: string | null,
  ) {
    super(message);
    this.name = "McpAuthRequiredError";
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function assertUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Endereço do servidor MCP inválido.");
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new Error("Use um endereço https:// para o servidor MCP.");
  }
  return parsed.toString();
}

/**
 * fetch compatível com edge: segue redirecionamentos manualmente lendo o header
 * `Location`, preservando método/corpo em 307/308 e trocando para GET em 303.
 */
export async function edgeFetch(input: string, init: RequestInit & { headers?: Record<string, string> }) {
  let url = input;
  let method = init.method ?? "GET";
  let body: BodyInit | null = (init.body ?? null) as BodyInit | null;
  let headers = { ...(init.headers ?? {}) };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, { ...init, method, body, headers, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(res.status)) return res;

    const location = res.headers.get("location");
    if (!location) return res; // 3xx sem Location: devolve para quem chamou tratar
    const next = new URL(location, url);
    if (next.protocol !== "https:" && next.hostname !== "localhost" && next.hostname !== "127.0.0.1") {
      throw new Error("O servidor MCP redirecionou para um endereço não seguro.");
    }
    // 303 (e 301/302 por convenção dos navegadores em POST) viram GET sem corpo.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET";
      body = null;
      const { "Content-Type": _ct, ...rest } = headers as Record<string, string>;
      headers = rest;
    }
    // Ao trocar de origem, não repassa credenciais.
    if (new URL(url).origin !== next.origin) {
      const { Authorization: _a, ...rest } = headers as Record<string, string>;
      headers = rest;
    }
    url = next.toString();
  }
  throw new Error("O servidor MCP redirecionou vezes demais.");
}

async function rpc(url: string, token: string | null, method: string, params?: unknown, sessionId?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await edgeFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? {} }),
  });

  const newSession = res.headers.get("Mcp-Session-Id") ?? sessionId;
  const text = await res.text();

  if (res.status === 401 || res.status === 403) {
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    const meta = /resource_metadata="([^"]+)"/i.exec(wwwAuth)?.[1] ?? null;
    throw new McpAuthRequiredError("O servidor MCP exige autenticação.", meta);
  }
  if (!res.ok) throw new Error(`Servidor MCP respondeu ${res.status}: ${text.slice(0, 200)}`);
  if (!text.trim()) return { payload: {} as JsonRpcResponse, sessionId: newSession };

  let payload: JsonRpcResponse;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const dataLine = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .pop();
    payload = dataLine ? JSON.parse(dataLine) : {};
  } else {
    payload = JSON.parse(text);
  }
  if (payload.error) throw new Error(payload.error.message);
  return { payload, sessionId: newSession };
}

async function notify(url: string, token: string | null, method: string, sessionId?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  await edgeFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method }),
  }).catch(() => undefined);
}

export async function openSession(rawUrl: string, token: string | null) {
  const url = assertUrl(rawUrl);
  const init = await rpc(url, token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "ai-marketing-os", version: "1.0.0" },
  });
  await notify(url, token, "notifications/initialized", init.sessionId ?? undefined);
  return { url, token, sessionId: init.sessionId ?? undefined };
}

export async function listTools(rawUrl: string, token: string | null): Promise<McpTool[]> {
  const s = await openSession(rawUrl, token);
  const res = await rpc(s.url, token, "tools/list", {}, s.sessionId);
  const tools = (res.payload.result?.tools ?? []) as McpTool[];
  return tools.map((t) => ({ name: t.name, description: t.description }));
}

export type McpCallResult = { text: string; mediaUrl: string | null; structured: string | null };

export async function callTool(
  rawUrl: string,
  token: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const s = await openSession(rawUrl, token);
  const res = await rpc(s.url, token, "tools/call", { name, arguments: args }, s.sessionId);
  const result = res.payload.result ?? {};
  if (result.isError) {
    const msg = (result.content ?? []).map((c: any) => c?.text).filter(Boolean).join(" ");
    throw new Error(msg || `A ferramenta ${name} retornou erro.`);
  }
  const content: any[] = result.content ?? [];
  const text = content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
  let mediaUrl: string | null = null;
  for (const c of content) {
    if ((c?.type === "image" || c?.type === "video") && typeof c.data === "string") {
      mediaUrl = c.data.startsWith("http") ? c.data : `data:${c.mimeType ?? "image/png"};base64,${c.data}`;
      break;
    }
    if (c?.type === "resource" && typeof c.resource?.uri === "string" && c.resource.uri.startsWith("http")) {
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
  return {
    text,
    mediaUrl,
    structured: result.structuredContent ? JSON.stringify(result.structuredContent) : null,
  };
}

/** Escolhe a ferramenta mais provável para uma intenção (imagem, vídeo, publicação). */
export function pickTool(tools: McpTool[], keywords: string[]): McpTool | null {
  const lower = tools.map((t) => ({ t, hay: `${t.name} ${t.description ?? ""}`.toLowerCase() }));
  for (const kw of keywords) {
    const hit = lower.find((x) => x.hay.includes(kw));
    if (hit) return hit.t;
  }
  return tools[0] ?? null;
}

/* ----------------------------- OAuth 2.1 / PKCE ---------------------------- */

export type AuthServerMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
};

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await edgeFetch(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Descobre o Authorization Server do servidor MCP (RFC 9728 + RFC 8414). */
export async function discoverAuthServer(mcpUrl: string, resourceMetadataUrl?: string | null) {
  const target = new URL(mcpUrl);
  const prm =
    (resourceMetadataUrl ? await getJson(resourceMetadataUrl) : null) ??
    (await getJson(`${target.origin}/.well-known/oauth-protected-resource${target.pathname}`)) ??
    (await getJson(`${target.origin}/.well-known/oauth-protected-resource`));

  const issuer: string = prm?.authorization_servers?.[0] ?? target.origin;
  const issuerUrl = new URL(issuer);
  const candidates = [
    `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === "/" ? "" : issuerUrl.pathname}`,
    `${issuerUrl.origin}/.well-known/openid-configuration`,
    `${issuerUrl.origin}/.well-known/oauth-authorization-server`,
  ];
  for (const c of candidates) {
    const meta = await getJson(c);
    if (meta?.authorization_endpoint && meta?.token_endpoint) {
      return {
        metadata: meta as AuthServerMetadata,
        resource: (prm?.resource as string) ?? `${target.origin}${target.pathname}`,
        scope: buildScope(prm?.scopes_supported, meta.scopes_supported),
      };
    }
  }
  throw new Error("Não foi possível descobrir o servidor de autenticação (OAuth) deste MCP.");
}

function buildScope(resourceScopes?: string[], serverScopes?: string[]) {
  const supported = new Set([...(serverScopes ?? []), ...(resourceScopes ?? [])]);
  const wanted = resourceScopes?.length ? [...resourceScopes] : [...supported];
  if (supported.has("offline_access") && !wanted.includes("offline_access")) wanted.push("offline_access");
  return wanted.join(" ") || undefined;
}

export async function registerClient(registrationEndpoint: string, redirectUri: string) {
  const res = await edgeFetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Meu Funil",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) throw new Error(`Falha no registro do aplicativo OAuth (${res.status}).`);
  const json = (await res.json()) as { client_id: string; client_secret?: string };
  return { clientId: json.client_id, clientSecret: json.client_secret ?? null };
}

function base64url(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(size = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function pkcePair() {
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest) };
}

export function buildAuthorizationUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scope?: string | undefined;
  resource?: string | undefined;
}) {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (params.scope) url.searchParams.set("scope", params.scope);
  if (params.resource) url.searchParams.set("resource", params.resource);
  return url.toString();
}

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: string | null };

async function tokenRequest(tokenEndpoint: string, form: Record<string, string>, clientSecret?: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (clientSecret) headers["Authorization"] = `Basic ${btoa(`${form["client_id"]}:${clientSecret}`)}`;
  const res = await edgeFetch(tokenEndpoint, { method: "POST", headers, body: new URLSearchParams(form).toString() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Falha ao obter o token (${res.status}): ${text.slice(0, 160)}`);
  const json = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null,
  } satisfies TokenSet;
}

export function exchangeCode(opts: {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string | null;
  redirectUri: string;
  resource?: string | null;
}) {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code: opts.code,
    code_verifier: opts.codeVerifier,
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
  };
  if (opts.resource) form["resource"] = opts.resource;
  return tokenRequest(opts.tokenEndpoint, form, opts.clientSecret);
}

export function refreshAccessToken(opts: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string | null;
  resource?: string | null;
}) {
  const form: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  };
  if (opts.resource) form["resource"] = opts.resource;
  return tokenRequest(opts.tokenEndpoint, form, opts.clientSecret);
}
