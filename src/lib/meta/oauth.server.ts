/**
 * 5.4 "Entrar com Facebook" (somente servidor): troca o token colado à mão por login OAuth.
 * O token de usuário de longa duração (~60 dias) é salvo no cofre da empresa, com a data de expiração.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { GRAPH_VERSION, metaConfig } from "./graph.server";

export const META_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "pages_manage_metadata",
  "pages_messaging",
  "leads_retrieval",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "instagram_manage_messages",
  "instagram_manage_comments",
];

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export async function buildLoginUrl(workspaceId: string, userId: string, origin: string) {
  const cfg = await metaConfig(workspaceId);
  if (!cfg.appId || !cfg.appSecret) throw new Error("Salve primeiro o ID e a chave secreta do app da Meta.");
  const payload = b64url(JSON.stringify({ w: workspaceId, u: userId, e: Date.now() + 15 * 60e3 }));
  const state = `${payload}.${sign(payload, cfg.appSecret)}`;
  const qs = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: `${origin}/api/public/meta/oauth/callback`,
    state,
    response_type: "code",
    scope: META_SCOPES.join(","),
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${qs}`;
}

async function save(workspaceId: string, rows: Record<string, string>) {
  const { writeCredentials } = await import("@/lib/credentials.server");
  await writeCredentials(workspaceId, rows);
}

export async function handleCallback(code: string, state: string, origin: string) {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) throw new Error("Retorno inválido do Facebook.");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { w: string; u: string; e: number };
  if (Date.now() > data.e) throw new Error("O login expirou. Tente de novo.");
  const cfg = await metaConfig(data.w);
  if (!cfg.appId || !cfg.appSecret) throw new Error("App da Meta não configurado nesta empresa.");
  const expected = Buffer.from(sign(payload, cfg.appSecret));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new Error("Assinatura do retorno inválida.");

  const base = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`;
  const short = await fetch(
    `${base}?${new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: `${origin}/api/public/meta/oauth/callback`, code })}`,
  );
  const sj = (await short.json()) as { access_token?: string; error?: { message?: string } };
  if (!short.ok || !sj.access_token) throw new Error(sj.error?.message ?? "O Facebook não liberou o acesso.");
  const long = await fetch(
    `${base}?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: sj.access_token })}`,
  );
  const lj = (await long.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!long.ok || !lj.access_token) throw new Error(lj.error?.message ?? "Não foi possível obter o token de longa duração.");
  const expiresAt = new Date(Date.now() + (lj.expires_in ?? 60 * 86400) * 1000).toISOString();
  await save(data.w, {
    META_SYSTEM_USER_TOKEN: lj.access_token,
    META_TOKEN_EXPIRES_AT: expiresAt,
    META_TOKEN_SOURCE: "facebook_login",
  });
  return { workspaceId: data.w, expiresAt };
}

/** Contas de anúncios, Páginas e Instagram que o token enxerga (para escolher na tela). */
export async function listAssets(workspaceId: string) {
  const { graph, runWithMetaWorkspace } = await import("./graph.server");
  return runWithMetaWorkspace(workspaceId, async () => {
    const [accounts, pages] = await Promise.all([
      graph<{ data?: { id: string; name: string; account_status: number; currency?: string }[] }>("/me/adaccounts", {
        params: { fields: "id,name,account_status,currency", limit: 100 },
      }),
      graph<{ data?: { id: string; name: string; instagram_business_account?: { id: string; username?: string } }[] }>("/me/accounts", {
        params: { fields: "id,name,instagram_business_account{id,username}", limit: 100 },
      }),
    ]);
    return {
      adAccounts: (accounts.data ?? []).map((a) => ({ id: a.id, name: a.name, active: a.account_status === 1, currency: a.currency ?? null })),
      pages: (pages.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        instagramId: p.instagram_business_account?.id ?? null,
        instagramUsername: p.instagram_business_account?.username ?? null,
      })),
    };
  });
}

export async function saveAssets(workspaceId: string, v: { adAccountId: string; pageId: string; instagramId: string | null }) {
  await save(workspaceId, {
    META_AD_ACCOUNT_ID: v.adAccountId,
    META_PAGE_ID: v.pageId,
    ...(v.instagramId ? { META_INSTAGRAM_ACCOUNT_ID: v.instagramId } : {}),
  });
}

export async function saveApp(workspaceId: string, appId: string, appSecret: string) {
  await save(workspaceId, { META_APP_ID: appId, META_APP_SECRET: appSecret });
}

export async function tokenInfo(workspaceId: string) {
  const { readCredential } = await import("@/lib/credentials.server");
  const [expiresAt, source] = await Promise.all([
    readCredential(workspaceId, "META_TOKEN_EXPIRES_AT"),
    readCredential(workspaceId, "META_TOKEN_SOURCE"),
  ]);
  return { expiresAt, source: source ?? "system_user" };
}
