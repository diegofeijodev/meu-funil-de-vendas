/**
 * 2.9 TikTok Ads (somente servidor) pela TikTok API for Business v1.3: login (OAuth do app),
 * resultados diários por campanha e criação de campanha + grupo + anúncios em vídeo PAUSADOS.
 */
import { readCredential, writeCredentials } from "@/lib/credentials.server";

const BASE = "https://business-api.tiktok.com/open_api/v1.3";

async function creds(workspaceId: string) {
  const r = (k: string) => readCredential(workspaceId, k).then((v) => v ?? process.env[k] ?? null);
  const [appId, secret, token, advertiserId] = await Promise.all([
    r("TIKTOK_APP_ID"),
    r("TIKTOK_APP_SECRET"),
    readCredential(workspaceId, "TIKTOK_ACCESS_TOKEN"),
    readCredential(workspaceId, "TIKTOK_ADVERTISER_ID"),
  ]);
  return { appId, secret, token, advertiserId };
}

export async function tiktokMissing(workspaceId: string) {
  const c = await creds(workspaceId);
  const miss: string[] = [];
  if (!c.appId) miss.push("App ID");
  if (!c.secret) miss.push("Secret do app");
  if (!c.token) miss.push("Login com TikTok");
  if (!c.advertiserId) miss.push("Conta de anúncios");
  return miss;
}

export function tiktokLoginUrl(appId: string, redirectUri: string, state: string) {
  const qs = new URLSearchParams({ app_id: appId, state, redirect_uri: redirectUri });
  return `https://business-api.tiktok.com/portal/auth?${qs}`;
}

async function req<T = any>(token: string | null, path: string, opts: { method?: "GET" | "POST"; query?: Record<string, unknown>; body?: unknown } = {}): Promise<T> {
  const qs = opts.query
    ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]))}`
    : "";
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: opts.method ?? "GET",
    headers: { ...(token ? { "Access-Token": token } : {}), "Content-Type": "application/json" },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const j = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: T };
  if (!res.ok || (j.code !== undefined && j.code !== 0)) throw new Error(`TikTok: ${j.message ?? `HTTP ${res.status}`} (código ${j.code ?? res.status})`);
  return j.data as T;
}

export async function tiktokExchangeCode(workspaceId: string, authCode: string) {
  const c = await creds(workspaceId);
  if (!c.appId || !c.secret) throw new Error("Salve o App ID e o Secret do app do TikTok.");
  const data = await req<{ access_token: string; advertiser_ids?: string[] }>(null, "/oauth2/access_token/", {
    method: "POST",
    body: { app_id: c.appId, secret: c.secret, auth_code: authCode },
  });
  await writeCredentials(workspaceId, {
    TIKTOK_ACCESS_TOKEN: data.access_token,
    ...(data.advertiser_ids?.length === 1 ? { TIKTOK_ADVERTISER_ID: data.advertiser_ids[0]! } : {}),
  });
  return { advertisers: data.advertiser_ids ?? [] };
}

export async function tiktokListAdvertisers(workspaceId: string) {
  const c = await creds(workspaceId);
  if (!c.token || !c.appId || !c.secret) throw new Error("Entre com o TikTok primeiro.");
  const data = await req<{ list?: { advertiser_id: string; advertiser_name: string }[] }>(c.token, "/oauth2/advertiser/get/", {
    query: { app_id: c.appId, secret: c.secret },
  });
  return (data.list ?? []).map((a) => ({ id: String(a.advertiser_id), name: a.advertiser_name }));
}

export type TikTokDailyRow = { externalCampaignId: string; date: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number; name: string };

export async function tiktokDailyResults(workspaceId: string, campaignIds: string[], days = 7): Promise<TikTokDailyRow[]> {
  const c = await creds(workspaceId);
  if (!c.token || !c.advertiserId || !campaignIds.length) return [];
  const data = await req<{ list?: { dimensions: Record<string, string>; metrics: Record<string, string> }[] }>(c.token, "/report/integrated/get/", {
    query: {
      advertiser_id: c.advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_CAMPAIGN",
      dimensions: ["campaign_id", "stat_time_day"],
      metrics: ["campaign_name", "spend", "impressions", "clicks", "conversion"],
      start_date: new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
      filtering: [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify(campaignIds) }],
      page_size: 1000,
    },
  });
  return (data.list ?? []).map((r) => ({
    externalCampaignId: String(r.dimensions["campaign_id"]),
    date: String(r.dimensions["stat_time_day"]).slice(0, 10),
    name: String(r.metrics["campaign_name"] ?? ""),
    spend: Number(r.metrics["spend"] ?? 0),
    impressions: Number(r.metrics["impressions"] ?? 0),
    clicks: Number(r.metrics["clicks"] ?? 0),
    conversions: Number(r.metrics["conversion"] ?? 0),
    revenue: 0,
  }));
}

export type TikTokCampaignInput = {
  name: string;
  objective: string;
  dailyBudget: number;
  landingUrl: string;
  adText: string;
  brandName: string;
  logoUrl: string | null;
  videos: { title: string; url: string; cover: string | null }[];
};

/** Campanha + grupo + anúncios em vídeo, tudo desativado (DISABLE) até ativar. Brasil, posicionamento automático. */
export async function tiktokCreateCampaign(workspaceId: string, input: TikTokCampaignInput) {
  const c = await creds(workspaceId);
  if (!c.token || !c.advertiserId) throw new Error("Conecte o TikTok e escolha a conta de anúncios em Integrações.");
  const adv = c.advertiserId;
  const steps: { label: string; status: "done" | "failed"; detail: string }[] = [];
  const leads = /lead/i.test(input.objective);
  const camp = await req<{ campaign_id: string }>(c.token, "/campaign/create/", {
    method: "POST",
    body: {
      advertiser_id: adv,
      campaign_name: input.name.slice(0, 512),
      objective_type: leads ? "LEAD_GENERATION" : "TRAFFIC",
      budget_mode: "BUDGET_MODE_INFINITE",
      operation_status: "DISABLE",
    },
  });
  steps.push({ label: "Campanha criada (desativada)", status: "done", detail: camp.campaign_id });
  const group = await req<{ adgroup_id: string }>(c.token, "/adgroup/create/", {
    method: "POST",
    body: {
      advertiser_id: adv,
      campaign_id: camp.campaign_id,
      adgroup_name: `${input.name} · Grupo 1`.slice(0, 512),
      promotion_type: "WEBSITE",
      placement_type: "PLACEMENT_TYPE_AUTOMATIC",
      location_ids: ["3469034"],
      budget_mode: "BUDGET_MODE_DAY",
      budget: Math.max(50, Math.round(input.dailyBudget)),
      schedule_type: "SCHEDULE_FROM_NOW",
      schedule_start_time: new Date(Date.now() + 10 * 60e3).toISOString().replace("T", " ").slice(0, 19),
      optimization_goal: "CLICK",
      billing_event: "CPC",
      bid_type: "BID_TYPE_NO_BID",
      operation_status: "DISABLE",
    },
  });
  steps.push({ label: "Grupo criado (Brasil, posicionamento automático)", status: "done", detail: group.adgroup_id });

  // Identidade de anunciante personalizada (nome + logo da marca).
  let identityId: string | null = null;
  try {
    const ids = await req<{ identity_list?: { identity_id: string; display_name: string }[] }>(c.token, "/identity/get/", {
      query: { advertiser_id: adv, identity_type: "CUSTOMIZED_USER" },
    });
    identityId = ids.identity_list?.[0]?.identity_id ?? null;
    if (!identityId && input.logoUrl) {
      const logo = await req<{ image_id: string }>(c.token, "/file/image/ad/upload/", {
        method: "POST",
        body: { advertiser_id: adv, upload_type: "UPLOAD_BY_URL", image_url: input.logoUrl },
      });
      const created = await req<{ identity_id: string }>(c.token, "/identity/create/", {
        method: "POST",
        body: { advertiser_id: adv, display_name: input.brandName.slice(0, 40), image_uri: logo.image_id },
      });
      identityId = created.identity_id;
    }
  } catch (e) {
    steps.push({ label: "Identidade do anunciante", status: "failed", detail: e instanceof Error ? e.message : "falhou" });
  }
  if (!identityId) {
    steps.push({ label: "Anúncios", status: "failed", detail: "Sem identidade de anunciante: cadastre o logo da marca ou crie uma identidade no TikTok Ads Manager." });
    return { campaignId: camp.campaign_id, adgroupId: group.adgroup_id, steps };
  }
  for (const v of input.videos.slice(0, 5)) {
    try {
      const vid = await req<{ video_id: string }[] | { video_id: string }>(c.token, "/file/video/ad/upload/", {
        method: "POST",
        body: { advertiser_id: adv, upload_type: "UPLOAD_BY_URL", video_url: v.url, file_name: `${v.title.slice(0, 60)}-${Date.now()}.mp4` },
      });
      const videoId = Array.isArray(vid) ? vid[0]?.video_id : vid.video_id;
      if (!videoId) throw new Error("upload do vídeo sem id");
      const coverId = v.cover
        ? (
            await req<{ image_id: string }>(c.token, "/file/image/ad/upload/", {
              method: "POST",
              body: { advertiser_id: adv, upload_type: "UPLOAD_BY_URL", image_url: v.cover },
            })
          ).image_id
        : null;
      await req(c.token, "/ad/create/", {
        method: "POST",
        body: {
          advertiser_id: adv,
          adgroup_id: group.adgroup_id,
          creatives: [
            {
              ad_name: v.title.slice(0, 100),
              identity_type: "CUSTOMIZED_USER",
              identity_id: identityId,
              ad_format: "SINGLE_VIDEO",
              video_id: videoId,
              ...(coverId ? { image_ids: [coverId] } : {}),
              ad_text: input.adText.slice(0, 100),
              call_to_action: "LEARN_MORE",
              landing_page_url: input.landingUrl,
            },
          ],
        },
      });
      steps.push({ label: `Anúncio "${v.title}" criado`, status: "done", detail: videoId });
    } catch (e) {
      steps.push({ label: `Anúncio "${v.title}"`, status: "failed", detail: e instanceof Error ? e.message : "falhou" });
    }
  }
  return { campaignId: camp.campaign_id, adgroupId: group.adgroup_id, steps };
}

export async function tiktokSetStatus(workspaceId: string, campaignId: string, status: "ENABLE" | "DISABLE") {
  const c = await creds(workspaceId);
  if (!c.token || !c.advertiserId) throw new Error("TikTok não conectado.");
  await req(c.token, "/campaign/status/update/", {
    method: "POST",
    body: { advertiser_id: c.advertiserId, campaign_ids: [campaignId], operation_status: status },
  });
}
