/**
 * 2.8 Google Ads (somente servidor): login com Google (OAuth, refresh token), resultados diários
 * e criação de campanha de Pesquisa PAUSADA com anúncio responsivo e palavras-chave.
 * Exige token de desenvolvedor aprovado no Google Ads (Centro de API da conta de administrador).
 */
import { readCredential, writeCredentials } from "@/lib/credentials.server";

const API_VERSION = () => process.env["GOOGLE_ADS_API_VERSION"] || "v21";
const BASE = () => `https://googleads.googleapis.com/${API_VERSION()}`;
const SCOPE = "https://www.googleapis.com/auth/adwords";

type Creds = {
  clientId: string | null;
  clientSecret: string | null;
  developerToken: string | null;
  refreshToken: string | null;
  customerId: string | null;
  loginCustomerId: string | null;
};

export async function googleCreds(workspaceId: string): Promise<Creds> {
  const r = (k: string) => readCredential(workspaceId, k).then((v) => v ?? process.env[k] ?? null);
  const [clientId, clientSecret, developerToken, refreshToken, customerId, loginCustomerId] = await Promise.all([
    r("GOOGLE_ADS_CLIENT_ID"),
    r("GOOGLE_ADS_CLIENT_SECRET"),
    r("GOOGLE_ADS_DEVELOPER_TOKEN"),
    readCredential(workspaceId, "GOOGLE_ADS_REFRESH_TOKEN"),
    readCredential(workspaceId, "GOOGLE_ADS_CUSTOMER_ID"),
    readCredential(workspaceId, "GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
  ]);
  const clean = (v: string | null) => (v ? v.replace(/-/g, "") : null);
  return { clientId, clientSecret, developerToken, refreshToken, customerId: clean(customerId), loginCustomerId: clean(loginCustomerId) };
}

export async function googleMissing(workspaceId: string) {
  const c = await googleCreds(workspaceId);
  const miss: string[] = [];
  if (!c.clientId) miss.push("ID do cliente OAuth");
  if (!c.clientSecret) miss.push("Chave secreta do cliente OAuth");
  if (!c.developerToken) miss.push("Token de desenvolvedor");
  if (!c.refreshToken) miss.push("Login com Google");
  if (!c.customerId) miss.push("Conta do Google Ads");
  return miss;
}

export function googleLoginUrl(clientId: string, redirectUri: string, state: string) {
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`;
}

export async function googleExchangeCode(workspaceId: string, code: string, redirectUri: string) {
  const c = await googleCreds(workspaceId);
  if (!c.clientId || !c.clientSecret) throw new Error("Salve o ID e a chave secreta do cliente OAuth do Google.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const j = (await res.json()) as { refresh_token?: string; error_description?: string };
  if (!res.ok || !j.refresh_token) throw new Error(j.error_description ?? "O Google não devolveu o refresh token. Tente de novo.");
  await writeCredentials(workspaceId, { GOOGLE_ADS_REFRESH_TOKEN: j.refresh_token });
}

async function accessToken(c: Creds) {
  if (!c.clientId || !c.clientSecret || !c.refreshToken) throw new Error("Google Ads não conectado nesta empresa.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" }),
  });
  const j = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Login com Google expirou: ${j.error_description ?? res.status}. Entre de novo.`);
  return j.access_token;
}

async function call<T = any>(workspaceId: string, path: string, body?: unknown, method = "POST"): Promise<T> {
  const c = await googleCreds(workspaceId);
  if (!c.developerToken) throw new Error("Token de desenvolvedor do Google Ads não configurado.");
  const token = await accessToken(c);
  const res = await fetch(`${BASE()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": c.developerToken,
      "Content-Type": "application/json",
      ...(c.loginCustomerId ? { "login-customer-id": c.loginCustomerId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let j: any = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    j = { raw: text };
  }
  if (!res.ok) {
    const detail =
      j?.error?.details?.[0]?.errors?.map((e: any) => e.message).join(" · ") || j?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Google Ads: ${detail}`);
  }
  return j as T;
}

/** Contas que o login enxerga (para escolher na tela). */
export async function googleListCustomers(workspaceId: string) {
  const r = await call<{ resourceNames?: string[] }>(workspaceId, "/customers:listAccessibleCustomers", undefined, "GET");
  const ids = (r.resourceNames ?? []).map((n) => n.split("/")[1]!).filter(Boolean);
  const out: { id: string; name: string; manager: boolean }[] = [];
  for (const id of ids.slice(0, 50)) {
    try {
      const q = await call<{ results?: any[] }>(workspaceId, `/customers/${id}/googleAds:search`, {
        query: "SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1",
      });
      const row = q.results?.[0]?.customer;
      out.push({ id, name: row?.descriptiveName ?? id, manager: !!row?.manager });
    } catch {
      out.push({ id, name: id, manager: false });
    }
  }
  return out;
}

export type ExternalDailyRow = { externalCampaignId: string; date: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number; name: string };

/** Resultados diários das campanhas informadas (custos em micros convertidos para reais). */
export async function googleDailyResults(workspaceId: string, campaignIds: string[], days = 7): Promise<ExternalDailyRow[]> {
  const c = await googleCreds(workspaceId);
  if (!c.customerId || !campaignIds.length) return [];
  const ids = campaignIds.map((x) => x.replace(/\D/g, "")).filter(Boolean).join(",");
  const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);
  const r = await call<{ results?: any[] }>(workspaceId, `/customers/${c.customerId}/googleAds:search`, {
    query: `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE campaign.id IN (${ids}) AND segments.date BETWEEN '${since}' AND '${until}'`,
  });
  return (r.results ?? []).map((x) => ({
    externalCampaignId: String(x.campaign?.id),
    name: String(x.campaign?.name ?? ""),
    date: String(x.segments?.date),
    spend: Number(x.metrics?.costMicros ?? 0) / 1e6,
    impressions: Number(x.metrics?.impressions ?? 0),
    clicks: Number(x.metrics?.clicks ?? 0),
    conversions: Number(x.metrics?.conversions ?? 0),
    revenue: Number(x.metrics?.conversionsValue ?? 0),
  }));
}

export type GoogleCampaignInput = {
  name: string;
  objective: string;
  dailyBudget: number;
  landingUrl: string;
  headlines: string[];
  descriptions: string[];
  keywords: string[];
};

/** Cria campanha de Pesquisa PAUSADA: verba, campanha (Brasil, português), grupo, palavras-chave e anúncio responsivo. */
export async function googleCreateSearchCampaign(workspaceId: string, input: GoogleCampaignInput) {
  const c = await googleCreds(workspaceId);
  if (!c.customerId) throw new Error("Escolha a conta do Google Ads em Integrações.");
  const cid = c.customerId;
  const steps: { label: string; status: "done" | "failed"; detail: string }[] = [];
  const budget = await call<{ results: { resourceName: string }[] }>(workspaceId, `/customers/${cid}/campaignBudgets:mutate`, {
    operations: [{ create: { name: `${input.name} · verba ${Date.now()}`, amountMicros: String(Math.max(1, Math.round(input.dailyBudget)) * 1_000_000), deliveryMethod: "STANDARD", explicitlyShared: false } }],
  });
  steps.push({ label: "Verba diária criada", status: "done", detail: budget.results[0]!.resourceName });
  const wantsConversions = /lead|venda|sale|convers|whats/i.test(input.objective);
  const campaign = await call<{ results: { resourceName: string }[] }>(workspaceId, `/customers/${cid}/campaigns:mutate`, {
    operations: [
      {
        create: {
          name: input.name,
          status: "PAUSED",
          advertisingChannelType: "SEARCH",
          campaignBudget: budget.results[0]!.resourceName,
          ...(wantsConversions ? { maximizeConversions: {} } : { targetSpend: {} }),
          networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false },
          containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        },
      },
    ],
  });
  const campaignRn = campaign.results[0]!.resourceName;
  const campaignId = campaignRn.split("/").pop()!;
  steps.push({ label: "Campanha de Pesquisa criada (pausada)", status: "done", detail: campaignId });
  try {
    await call(workspaceId, `/customers/${cid}/campaignCriteria:mutate`, {
      operations: [
        { create: { campaign: campaignRn, location: { geoTargetConstant: "geoTargetConstants/2076" } } },
        { create: { campaign: campaignRn, language: { languageConstant: "languageConstants/1014" } } },
      ],
    });
    steps.push({ label: "Público: Brasil, português", status: "done", detail: "" });
  } catch (e) {
    steps.push({ label: "Localização e idioma", status: "failed", detail: e instanceof Error ? e.message : "falhou" });
  }
  const adGroup = await call<{ results: { resourceName: string }[] }>(workspaceId, `/customers/${cid}/adGroups:mutate`, {
    operations: [{ create: { name: `${input.name} · Grupo 1`, campaign: campaignRn, status: "ENABLED", type: "SEARCH_STANDARD" } }],
  });
  const adGroupRn = adGroup.results[0]!.resourceName;
  steps.push({ label: "Grupo de anúncios criado", status: "done", detail: adGroupRn.split("/").pop()! });
  const kws = [...new Set(input.keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 2))].slice(0, 20);
  if (kws.length) {
    try {
      await call(workspaceId, `/customers/${cid}/adGroupCriteria:mutate`, {
        operations: kws.map((text) => ({ create: { adGroup: adGroupRn, status: "ENABLED", keyword: { text: text.slice(0, 80), matchType: "PHRASE" } } })),
      });
      steps.push({ label: `${kws.length} palavras-chave (frase)`, status: "done", detail: kws.join(", ") });
    } catch (e) {
      steps.push({ label: "Palavras-chave", status: "failed", detail: e instanceof Error ? e.message : "falhou" });
    }
  }
  const heads = [...new Set(input.headlines.map((h) => h.trim().slice(0, 30)).filter(Boolean))].slice(0, 15);
  const descs = [...new Set(input.descriptions.map((d) => d.trim().slice(0, 90)).filter(Boolean))].slice(0, 4);
  if (heads.length < 3 || descs.length < 2) throw new Error("O anúncio responsivo precisa de pelo menos 3 títulos e 2 descrições.");
  try {
    await call(workspaceId, `/customers/${cid}/adGroupAds:mutate`, {
      operations: [
        {
          create: {
            adGroup: adGroupRn,
            status: "ENABLED",
            ad: {
              finalUrls: [input.landingUrl],
              responsiveSearchAd: { headlines: heads.map((text) => ({ text })), descriptions: descs.map((text) => ({ text })) },
            },
          },
        },
      ],
    });
    steps.push({ label: `Anúncio responsivo (${heads.length} títulos, ${descs.length} descrições)`, status: "done", detail: "" });
  } catch (e) {
    steps.push({ label: "Anúncio responsivo", status: "failed", detail: e instanceof Error ? e.message : "falhou" });
  }
  return { campaignId, steps };
}

export async function googleSetStatus(workspaceId: string, campaignId: string, status: "ENABLED" | "PAUSED") {
  const c = await googleCreds(workspaceId);
  if (!c.customerId) throw new Error("Conta do Google Ads não escolhida.");
  await call(workspaceId, `/customers/${c.customerId}/campaigns:mutate`, {
    operations: [{ update: { resourceName: `customers/${c.customerId}/campaigns/${campaignId}`, status }, updateMask: "status" }],
  });
}
