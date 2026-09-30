/**
 * Operações da Marketing API usadas pelo app (somente servidor).
 * Tudo é criado PAUSADO; ativação só acontece em chamada explícita após aprovação.
 */
import { graph, metaConfig, missingSecrets, MetaError } from "./graph.server";

export async function isConfigured() {
  return (await missingSecrets()).length === 0;
}

export async function testConnection() {
  const missing = await missingSecrets();
  if (missing.length) {
    return { ok: false as const, missing, error: `Faltam credenciais: ${missing.join(", ")}. Preencha o formulário em Integrações.` };
  }
  const cfg = await metaConfig();
  try {
    const [me, account, page, ig] = await Promise.all([
      graph<{ id: string; name: string }>("/me", { params: { fields: "id,name" } }),
      graph<any>(`/${cfg.adAccountId}`, {
        params: { fields: "name,account_status,currency,timezone_name,amount_spent,business_name" },
      }),
      graph<any>(`/${cfg.pageId}`, { params: { fields: "name,id" } }).catch((e) => ({ error: String(e.message) })),
      cfg.instagramId
        ? graph<any>(`/${cfg.instagramId}`, { params: { fields: "username" } }).catch((e) => ({ error: String(e.message) }))
        : Promise.resolve(null),
    ]);
    const STATUS: Record<number, string> = {
      1: "Ativa",
      2: "Desativada",
      3: "Pendente de pagamento",
      7: "Em análise de risco",
      9: "Em período de carência",
      100: "Fechamento pendente",
      101: "Fechada",
    };
    return {
      ok: true as const,
      missing: [] as string[],
      user: me.name,
      account: {
        id: cfg.adAccountId,
        name: account.name as string,
        status: STATUS[account.account_status as number] ?? String(account.account_status),
        currency: account.currency as string,
        timezone: account.timezone_name as string,
      },
      page: page?.error ? { id: cfg.pageId, name: null, error: page.error as string } : { id: page.id, name: page.name },
      instagram: ig ? (ig.error ? { username: null, error: ig.error as string } : { username: ig.username as string }) : null,
      error: null as string | null,
    };
  } catch (e) {
    return { ok: false as const, missing: [] as string[], error: e instanceof Error ? e.message : "Falha ao conectar na Meta." };
  }
}

export async function listStructure() {
  const { adAccountId } = await metaConfig();
  const fields = "id,name,status,effective_status";
  const [campaigns, adsets, ads] = await Promise.all([
    graph<{ data: any[] }>(`/${adAccountId}/campaigns`, { params: { fields: `${fields},objective,daily_budget`, limit: 50 } }),
    graph<{ data: any[] }>(`/${adAccountId}/adsets`, { params: { fields: `${fields},campaign_id,daily_budget`, limit: 50 } }),
    graph<{ data: any[] }>(`/${adAccountId}/ads`, { params: { fields: `${fields},adset_id`, limit: 50 } }),
  ]);
  return { campaigns: campaigns.data, adsets: adsets.data, ads: ads.data };
}

export async function uploadImageFromUrl(url: string) {
  const { adAccountId } = await metaConfig();
  const res = await fetch(url);
  if (!res.ok) throw new MetaError(`Não foi possível baixar a imagem do criativo (${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer()).toString("base64");
  const out = await graph<{ images: Record<string, { hash: string }> }>(`/${adAccountId}/adimages`, {
    method: "POST",
    params: { bytes },
  });
  const first = Object.values(out.images ?? {})[0];
  if (!first?.hash) throw new MetaError("A Meta não devolveu o identificador da imagem.");
  return first.hash;
}

export async function uploadVideoFromUrl(url: string, title: string) {
  const { adAccountId } = await metaConfig();
  const out = await graph<{ id: string }>(`/${adAccountId}/advideos`, {
    method: "POST",
    params: { file_url: url, name: title.slice(0, 100) },
  });
  return out.id;
}

async function videoThumbnail(videoId: string): Promise<string | null> {
  for (let i = 0; i < 10; i++) {
    const v = await graph<any>(`/${videoId}`, { params: { fields: "picture,status" } }).catch(() => null);
    if (v?.picture) return v.picture as string;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

function mapObjective(obj: string) {
  const o = (obj || "").toLowerCase();
  if (o.includes("aware") || o.includes("reconhec") || o.includes("alcance") || o.includes("brand"))
    return { objective: "OUTCOME_AWARENESS", optimization: "REACH" };
  if (o.includes("engaj") || o.includes("engage")) return { objective: "OUTCOME_ENGAGEMENT", optimization: "POST_ENGAGEMENT" };
  if (o.includes("sale") || o.includes("venda") || o.includes("convers"))
    return { objective: "OUTCOME_SALES", optimization: "OFFSITE_CONVERSIONS" };
  return { objective: "OUTCOME_TRAFFIC", optimization: "LINK_CLICKS" };
}

/** "25-45", "25 a 45", "18+" → faixa de idade aceita pela Meta. */
function parseAges(aud: Record<string, unknown>) {
  const a = aud as any;
  let min = Number(a.age_min ?? a.ageMin) || 0;
  let max = Number(a.age_max ?? a.ageMax) || 0;
  const nums = String(a.idade ?? "").match(/\d{2}/g)?.map(Number) ?? [];
  if (!min && nums[0]) min = nums[0];
  if (!max && nums[1]) max = nums[1];
  return { age_min: Math.max(18, Math.min(65, min || 18)), age_max: Math.min(65, Math.max(18, max || 65)) };
}

/** Converte "Valinhos e região, Vinhedo" em cidades da Meta com raio de 20 km. */
async function geoFor(aud: Record<string, unknown>) {
  const a = aud as any;
  const text = String(a.localizacao ?? a.location ?? a.cities ?? "").trim();
  const names = text
    .replace(/\be\s+regi[aã]o\b|\bregi[aã]o\b|\bSP\b|\bBrasil\b/gi, "")
    .split(/[,;/]|\se\s|\s-\s/)
    .map((x) => x.trim())
    .filter((x) => x.length > 2)
    .slice(0, 10);
  const cities: { key: string; radius: number; distance_unit: string; name: string }[] = [];
  for (const q of names) {
    const r = await graph<{ data?: { key: string; name: string; type: string }[] }>(`/search`, {
      params: { type: "adgeolocation", q, location_types: JSON.stringify(["city"]), country_code: "BR" },
    }).catch(() => null);
    const hit = r?.data?.find((d) => d.type === "city");
    if (hit && !cities.some((c) => c.key === hit.key)) cities.push({ key: hit.key, radius: 20, distance_unit: "kilometer", name: hit.name });
  }
  return cities.length
    ? { geo: { cities: cities.map(({ name: _n, ...c }) => c) }, label: `${cities.map((c) => c.name).join(", ")} (raio de 20 km)` }
    : { geo: { countries: ["BR"] }, label: "Brasil inteiro (localização não reconhecida)" };
}

async function firstPixel(adAccountId: string) {
  const r = await graph<{ data?: { id: string; name: string }[] }>(`/${adAccountId}/adspixels`, { params: { fields: "id,name" } }).catch(() => null);
  return r?.data?.[0] ?? null;
}

export type PublishInput = {
  name: string;
  objective: string;
  dailyBudget: number;
  landingUrl: string;
  primaryText: string;
  headline: string;
  audience: Record<string, unknown>;
  creatives: { id: string; title: string; url: string | null; thumb: string | null }[];
};

export type Step = { key: string; label: string; status: "done" | "failed"; detail: string };

/** Cria campanha + conjunto + criativos + anúncios, tudo PAUSADO. */
export async function publishPaused(input: PublishInput) {
  const cfg = await metaConfig();
  const steps: Step[] = [];
  let { objective, optimization } = mapObjective(input.objective);
  let promoted: Record<string, unknown> | null = null;
  if (objective === "OUTCOME_SALES") {
    const px = cfg.adAccountId ? await firstPixel(cfg.adAccountId) : null;
    if (px) {
      promoted = { pixel_id: px.id, custom_event_type: "PURCHASE" };
      steps.push({ key: "pixel", label: `Otimização por compras no pixel "${px.name}"`, status: "done", detail: px.id });
    } else {
      objective = "OUTCOME_TRAFFIC";
      optimization = "LINK_CLICKS";
      steps.push({ key: "pixel", label: "Sem pixel na conta: campanha criada como tráfego", status: "failed", detail: "Crie um pixel para otimizar por vendas." });
    }
  }

  const campaign = await graph<{ id: string }>(`/${cfg.adAccountId}/campaigns`, {
    method: "POST",
    params: {
      name: input.name,
      objective,
      status: "PAUSED",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    },
  });
  steps.push({ key: "campaign", label: "Campanha criada (pausada)", status: "done", detail: campaign.id });

  const aud = input.audience ?? {};
  const ages = parseAges(aud);
  const geo = await geoFor(aud);
  steps.push({ key: "geo", label: `Público: ${geo.label}, ${ages.age_min}–${ages.age_max} anos`, status: "done", detail: "" });
  const adset = await graph<{ id: string }>(`/${cfg.adAccountId}/adsets`, {
    method: "POST",
    params: {
      name: `${input.name} · Conjunto 1`,
      campaign_id: campaign.id,
      daily_budget: Math.max(100, Math.round(input.dailyBudget * 100)),
      billing_event: "IMPRESSIONS",
      optimization_goal: optimization,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      status: "PAUSED",
      targeting: {
        geo_locations: geo.geo,
        ...ages,
        targeting_automation: { advantage_audience: 0 },
      },
      ...(promoted ? { promoted_object: promoted } : {}),
      ...(optimization === "POST_ENGAGEMENT" || optimization === "REACH" ? {} : { destination_type: "WEBSITE" }),
    },
  });
  steps.push({ key: "adset", label: "Conjunto criado (pausado)", status: "done", detail: adset.id });

  const adIds: string[] = [];
  const cta = { type: "LEARN_MORE", value: { link: input.landingUrl } };
  for (const cr of input.creatives) {
    try {
      if (!cr.url) throw new MetaError("criativo sem arquivo");
      const isVideo = /\.mp4(\?|$)/i.test(cr.url);
      let story: Record<string, unknown>;
      if (isVideo) {
        const videoId = await uploadVideoFromUrl(cr.url, cr.title);
        const thumb = cr.thumb && !/\.mp4/i.test(cr.thumb) ? cr.thumb : await videoThumbnail(videoId);
        if (!thumb) throw new MetaError("vídeo enviado, mas a Meta ainda não gerou a miniatura. Tente publicar de novo em alguns minutos.");
        story = { video_data: { video_id: videoId, image_url: thumb, message: input.primaryText, title: input.headline, call_to_action: cta } };
      } else {
        const hash = await uploadImageFromUrl(cr.url);
        story = { link_data: { image_hash: hash, link: input.landingUrl, message: input.primaryText, name: input.headline, call_to_action: cta } };
      }
      const creative = await graph<{ id: string }>(`/${cfg.adAccountId}/adcreatives`, {
        method: "POST",
        params: {
          name: cr.title,
          object_story_spec: { page_id: cfg.pageId, ...(cfg.instagramId ? { instagram_user_id: cfg.instagramId } : {}), ...story },
        },
      });
      const ad = await graph<{ id: string }>(`/${cfg.adAccountId}/ads`, {
        method: "POST",
        params: { name: cr.title, adset_id: adset.id, creative: { creative_id: creative.id }, status: "PAUSED" },
      });
      adIds.push(ad.id);
      steps.push({ key: `ad-${cr.id}`, label: `Anúncio "${cr.title}" criado (pausado)`, status: "done", detail: ad.id });
    } catch (e) {
      steps.push({ key: `ad-${cr.id}`, label: `Anúncio "${cr.title}"`, status: "failed", detail: e instanceof Error ? e.message : "falhou" });
    }
  }
  return { campaignId: campaign.id, adsetId: adset.id, adIds, steps };
}

/** Ativa ou pausa campanha, conjunto e anúncios. */
export async function setDeliveryStatus(ids: { campaignId: string; adsetId?: string | null; adIds?: string[] }, status: "ACTIVE" | "PAUSED") {
  const all = [ids.campaignId, ids.adsetId, ...(ids.adIds ?? [])].filter(Boolean) as string[];
  for (const id of all) await graph(`/${id}`, { method: "POST", params: { status } });
  return { updated: all.length };
}

export async function fetchInsights(opts: { since: string; until: string; campaignId?: string | null }) {
  const { adAccountId } = await metaConfig();
  const target = opts.campaignId ?? adAccountId;
  const out = await graph<{ data: any[] }>(`/${target}/insights`, {
    params: {
      fields: "spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type",
      time_range: { since: opts.since, until: opts.until },
      level: opts.campaignId ? "campaign" : "account",
    },
  });
  const row = out.data?.[0] ?? {};
  const leads = Number(
    (row.actions ?? []).find((a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped")?.value ?? 0,
  );
  const spend = Number(row.spend ?? 0);
  return {
    spend,
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    ctr: Number(row.ctr ?? 0),
    cpc: Number(row.cpc ?? 0),
    leads,
    cpl: leads ? spend / leads : 0,
  };
}
