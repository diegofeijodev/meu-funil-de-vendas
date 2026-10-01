/**
 * Canva Connect API (REST) — somente servidor. Cada empresa guarda no cofre (app_credentials):
 * CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, CANVA_TOKENS (JSON) e CANVA_OAUTH (state + verifier).
 * Empresas configuradas para herdar da "empresa da agência" usam a conexão dela.
 */
import { readCredential, writeCredentials, deleteCredential } from "@/lib/credentials.server";

export const CANVA_API = "https://api.canva.com/rest/v1";
export const CANVA_AUTHORIZE = "https://www.canva.com/api/oauth/authorize";
export const CANVA_REDIRECT_URI = "https://www.meufunildevendas.com.br/api/public/canva/oauth/callback";
export const CANVA_SCOPES = "asset:read asset:write design:content:read design:content:write design:meta:read profile:read";

type Tokens = { access_token: string; refresh_token: string; expires_at: number; name?: string | null; email?: string | null };

export class CanvaAuthError extends Error {}

async function readJSON<T>(ws: string, key: string): Promise<T | null> {
  const v = await readCredential(ws, key);
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

async function appCreds(ws: string) {
  const id = (await readCredential(ws, "CANVA_CLIENT_ID")) ?? (await readCredential(null, "CANVA_CLIENT_ID"));
  const secret = (await readCredential(ws, "CANVA_CLIENT_SECRET")) ?? (await readCredential(null, "CANVA_CLIENT_SECRET"));
  return id && secret ? { id, secret } : null;
}

/** Empresa cuja conexão Canva vale para esta (a própria ou a da agência). */
async function ownerOf(ws: string): Promise<string | null> {
  if (await readJSON<Tokens>(ws, "CANVA_TOKENS")) return ws;
  const { inheritSource } = await import("@/lib/ai-keys.server");
  const src = await inheritSource(ws);
  if (src && (await readJSON<Tokens>(src, "CANVA_TOKENS"))) return src;
  return null;
}

function b64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function saveCanvaApp(ws: string, clientId: string, clientSecret: string | null) {
  const rows: Record<string, string> = { CANVA_CLIENT_ID: clientId.trim() };
  if (clientSecret?.trim()) rows["CANVA_CLIENT_SECRET"] = clientSecret.trim();
  await writeCredentials(ws, rows);
}

export async function canvaStatus(ws: string) {
  const app = await appCreds(ws);
  const owner = await ownerOf(ws);
  const t = owner ? await readJSON<Tokens>(owner, "CANVA_TOKENS") : null;
  return {
    appSaved: !!app,
    clientIdHint: app ? `${app.id.slice(0, 4)}••••` : null,
    connected: !!t,
    inherited: !!owner && owner !== ws,
    name: t?.name ?? null,
    email: t?.email ?? null,
  };
}

export async function startCanvaOAuth(ws: string) {
  const app = await appCreds(ws);
  if (!app) throw new Error("Salve o Client ID e o Client secret do app Canva antes de entrar.");
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = `${ws}.${b64url(crypto.getRandomValues(new Uint8Array(24)))}`;
  await writeCredentials(ws, { CANVA_OAUTH: JSON.stringify({ state, verifier, at: Date.now() }) });
  const u = new URL(CANVA_AUTHORIZE);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", app.id);
  u.searchParams.set("redirect_uri", CANVA_REDIRECT_URI);
  u.searchParams.set("scope", CANVA_SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function tokenRequest(app: { id: string; secret: string }, body: Record<string, string>) {
  const res = await fetch(`${CANVA_API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${app.id}:${app.secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !json.access_token) {
    console.error("[canva] token", res.status, json);
    throw new CanvaAuthError(json.error_description || json.message || `O Canva recusou o login (${res.status}).`);
  }
  return json as { access_token: string; refresh_token: string; expires_in: number };
}

/** Callback: valida o state, troca o code e grava os tokens + perfil. Retorna a empresa. */
export async function finishCanvaOAuth(state: string, code: string) {
  const ws = state.split(".")[0] ?? "";
  if (!/^[0-9a-f-]{36}$/.test(ws)) throw new Error("Retorno do Canva inválido.");
  const saved = await readJSON<{ state: string; verifier: string; at: number }>(ws, "CANVA_OAUTH");
  if (!saved || saved.state !== state || Date.now() - saved.at > 20 * 60_000) throw new Error("Sessão de login expirada. Tente entrar de novo.");
  const app = await appCreds(ws);
  if (!app) throw new Error("App Canva não configurado.");
  const t = await tokenRequest(app, {
    grant_type: "authorization_code",
    code,
    code_verifier: saved.verifier,
    redirect_uri: CANVA_REDIRECT_URI,
  });
  const tokens: Tokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  const p = await profile(tokens.access_token).catch(() => null);
  tokens.name = p?.name ?? null;
  tokens.email = p?.email ?? null;
  await writeCredentials(ws, { CANVA_TOKENS: JSON.stringify(tokens) });
  await deleteCredential(ws, "CANVA_OAUTH");
  return ws;
}

async function profile(token: string) {
  const r = await fetch(`${CANVA_API}/users/me/profile`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new CanvaAuthError(`Perfil Canva indisponível (${r.status}).`);
  const j = (await r.json()) as any;
  return { name: (j.profile?.display_name as string) ?? null, email: (j.profile?.email as string) ?? null };
}

export async function disconnectCanva(ws: string) {
  await deleteCredential(ws, "CANVA_TOKENS");
  await deleteCredential(ws, "CANVA_OAUTH");
}

/** Token válido (renova antes de expirar; o refresh_token do Canva é de uso único). */
async function accessToken(ws: string): Promise<{ token: string; owner: string }> {
  const owner = await ownerOf(ws);
  if (!owner) throw new Error("Canva não está conectado nesta empresa. Entre com Canva em Integrações.");
  const t = (await readJSON<Tokens>(owner, "CANVA_TOKENS"))!;
  if (t.expires_at - Date.now() > 120_000) return { token: t.access_token, owner };
  const app = await appCreds(owner);
  if (!app) throw new Error("App Canva não configurado.");
  try {
    const n = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: t.refresh_token });
    const next: Tokens = { ...t, access_token: n.access_token, refresh_token: n.refresh_token ?? t.refresh_token, expires_at: Date.now() + n.expires_in * 1000 };
    await writeCredentials(owner, { CANVA_TOKENS: JSON.stringify(next) });
    return { token: next.access_token, owner };
  } catch (e) {
    if (e instanceof CanvaAuthError) {
      await disconnectCanva(owner);
      throw new Error("A conexão com o Canva expirou ou foi revogada. Entre com Canva de novo em Integrações.");
    }
    throw e;
  }
}

async function api(ws: string, path: string, init: RequestInit = {}) {
  const { token, owner } = await accessToken(ws);
  const res = await fetch(`${CANVA_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as any;
  if (res.status === 401) {
    await disconnectCanva(owner);
    throw new Error("O Canva recusou o acesso (login revogado). Entre com Canva de novo em Integrações.");
  }
  if (!res.ok) {
    console.error("[canva]", path, res.status, json);
    throw new Error(`Canva: ${json.message || json.error || `erro ${res.status}`}`);
  }
  return json;
}

async function poll(ws: string, path: string, pick: (j: any) => any) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const j = pick(await api(ws, path));
    if (j?.status === "success") return j;
    if (j?.status === "failed") throw new Error(`Canva: ${j.error?.message ?? "a tarefa falhou"}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("O Canva demorou demais para responder. Tente de novo em instantes.");
}

export async function testCanva(ws: string) {
  const j = await api(ws, "/users/me/profile");
  return { name: (j.profile?.display_name as string) ?? null };
}

/** Envia uma mídia para os uploads do Canva e devolve o asset_id. */
export async function sendAssetToCanva(ws: string, asset: { url: string; title: string }) {
  const file = await fetch(asset.url);
  if (!file.ok) throw new Error("Não foi possível baixar a mídia da biblioteca.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const start = await api(ws, "/asset-uploads", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from(asset.title.slice(0, 50) || "Criativo").toString("base64") }),
    },
    body: bytes,
  });
  const jobId = start.job?.id as string;
  const done = start.job?.status === "success" ? start.job : await poll(ws, `/asset-uploads/${jobId}`, (j) => j.job);
  return { assetId: (done.asset?.id as string) ?? null };
}

const SIZES: Record<string, [number, number]> = {
  square: [1080, 1080],
  portrait: [1080, 1350],
  story: [1080, 1920],
  landscape: [1200, 628],
};

/** Cria um design editável (opcionalmente com uma mídia já enviada) e devolve o link de edição. */
export async function createCanvaDesign(ws: string, input: { title: string; size?: string | null; assetId?: string | null }) {
  const [width, height] = SIZES[input.size ?? "portrait"] ?? SIZES.portrait!;
  const j = await api(ws, "/designs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      design_type: { type: "custom", width, height },
      title: input.title.slice(0, 250) || "Meu Funil",
      ...(input.assetId ? { asset_id: input.assetId } : {}),
    }),
  });
  return { designId: (j.design?.id as string) ?? null, editUrl: (j.design?.urls?.edit_url as string) ?? null };
}

export async function listCanvaDesigns(ws: string, query?: string | null) {
  const q = new URLSearchParams({ ownership: "any", sort_by: query ? "relevance" : "modified_descending" });
  if (query) q.set("query", query);
  const j = await api(ws, `/designs?${q}`);
  return ((j.items ?? []) as any[]).map((d) => ({
    id: String(d.id),
    title: String(d.title ?? "Sem título"),
    thumbnail: (d.thumbnail?.url as string) ?? null,
  }));
}

/** Exporta um design (png/jpg/mp4) e salva na biblioteca ligado ao design_id. */
export async function importCanvaDesign(
  ws: string,
  input: { designId: string; title?: string | null; format?: "png" | "jpg" | "mp4" | null; brandId?: string | null; campaignId?: string | null; createdBy?: string | null },
) {
  const fmt = input.format ?? "png";
  const start = await api(ws, "/exports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ design_id: input.designId, format: fmt === "jpg" ? { type: "jpg", quality: 92 } : { type: fmt } }),
  });
  const done = start.job?.status === "success" ? start.job : await poll(ws, `/exports/${start.job?.id}`, (j) => j.job);
  const urls = (done.urls ?? []) as string[];
  if (!urls.length) throw new Error("O Canva não devolveu o arquivo exportado.");
  const { ingestAsset } = await import("@/lib/media/assets.server");
  const assets = [];
  for (const [i, url] of urls.entries()) {
    assets.push(
      await ingestAsset({
        workspaceId: ws,
        kind: fmt === "mp4" ? "video" : "image",
        targetFormat: "other",
        source: "canva",
        sourceUrl: url,
        title: `${input.title || `Canva ${input.designId}`}${urls.length > 1 ? ` (${i + 1})` : ""}`,
        provider: "canva",
        prompt: `canva_design_id:${input.designId}`,
        brandId: input.brandId ?? null,
        campaignId: input.campaignId ?? null,
        createdBy: input.createdBy ?? null,
        normalize: false,
      } as any),
    );
  }
  return assets[0]!;
}
