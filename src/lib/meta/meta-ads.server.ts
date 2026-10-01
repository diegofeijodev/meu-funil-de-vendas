/**
 * Operações da Marketing API usadas pelo app (somente servidor).
 * Tudo é criado PAUSADO; ativação só acontece em chamada explícita após aprovação.
 */
import { graph, metaConfig, missingSecrets, MetaError } from "./graph.server";
import { DEFAULT_ADS_CONFIG, PLACEMENTS, type AdsConfig } from "./ads-config";

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

type ObjectivePlan = {
  objective: string;
  optimization: string;
  destination: string | null;
  kind: "traffic" | "awareness" | "engagement" | "sales" | "leads" | "whatsapp" | "remarketing";
};

function mapObjective(obj: string): ObjectivePlan {
  const o = (obj || "").toLowerCase();
  if (o === "leads" || o.includes("lead") || o.includes("cadastro"))
    return { objective: "OUTCOME_LEADS", optimization: "LEAD_GENERATION", destination: "ON_AD", kind: "leads" };
  if (o === "whatsapp" || o.includes("whats"))
    return { objective: "OUTCOME_ENGAGEMENT", optimization: "CONVERSATIONS", destination: "WHATSAPP", kind: "whatsapp" };
  if (o === "remarketing" || o.includes("remarketing") || o.includes("retarget"))
    return { objective: "OUTCOME_SALES", optimization: "OFFSITE_CONVERSIONS", destination: "WEBSITE", kind: "remarketing" };
  if (o.includes("aware") || o.includes("reconhec") || o.includes("alcance") || o.includes("brand"))
    return { objective: "OUTCOME_AWARENESS", optimization: "REACH", destination: null, kind: "awareness" };
  if (o.includes("engaj") || o.includes("engage"))
    return { objective: "OUTCOME_ENGAGEMENT", optimization: "POST_ENGAGEMENT", destination: null, kind: "engagement" };
  if (o.includes("sale") || o.includes("venda") || o.includes("convers"))
    return { objective: "OUTCOME_SALES", optimization: "OFFSITE_CONVERSIONS", destination: "WEBSITE", kind: "sales" };
  return { objective: "OUTCOME_TRAFFIC", optimization: "LINK_CLICKS", destination: "WEBSITE", kind: "traffic" };
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

/** Interesses reais do gerenciador de anúncios a partir dos nomes sugeridos pela estratégia. */
export async function searchInterests(names: string[]) {
  const out: { id: string; name: string }[] = [];
  for (const q of names.slice(0, 12)) {
    const r = await graph<{ data?: { id: string; name: string }[] }>(`/search`, {
      params: { type: "adinterest", q, limit: 1, locale: "pt_BR" },
    }).catch(() => null);
    const hit = r?.data?.[0];
    if (hit && !out.some((i) => i.id === hit.id)) out.push({ id: hit.id, name: hit.name });
  }
  return out;
}

export async function listCustomAudiences() {
  const { adAccountId } = await metaConfig();
  const r = await graph<{ data?: any[] }>(`/${adAccountId}/customaudiences`, {
    params: { fields: "id,name,subtype,approximate_count_lower_bound,delivery_status", limit: 100 },
  });
  return (r.data ?? []).map((a) => ({
    id: String(a.id),
    name: String(a.name),
    subtype: String(a.subtype ?? ""),
    size: Number(a.approximate_count_lower_bound ?? 0) || null,
  }));
}

/** Lookalike 1% no Brasil a partir de um público de origem. */
export async function createLookalike(sourceId: string, name: string) {
  const { adAccountId } = await metaConfig();
  const r = await graph<{ id: string }>(`/${adAccountId}/customaudiences`, {
    method: "POST",
    params: {
      name: `${name} · Semelhante 1% BR`.slice(0, 100),
      subtype: "LOOKALIKE",
      origin_audience_id: sourceId,
      lookalike_spec: { ratio: 0.01, country: "BR" },
    },
  });
  return r.id;
}

/** Público de visitantes do site (pixel, últimos 30 dias) para remarketing. */
export async function createWebsiteAudience(pixelId: string, name: string, days = 30) {
  const { adAccountId } = await metaConfig();
  const r = await graph<{ id: string }>(`/${adAccountId}/customaudiences`, {
    method: "POST",
    params: {
      name: `${name} · Visitantes ${days} dias`.slice(0, 100),
      prefill: true,
      rule: {
        inclusions: {
          operator: "or",
          rules: [
            {
              event_sources: [{ id: pixelId, type: "pixel" }],
              retention_seconds: days * 86400,
              filter: { operator: "and", filters: [{ field: "url", operator: "i_contains", value: "" }] },
            },
          ],
        },
      },
    },
  });
  return r.id;
}

/** Público com os contatos do CRM (e-mail e telefone com hash SHA-256, como a Meta exige). */
export async function upsertCustomerListAudience(
  name: string,
  existingId: string | null,
  contacts: { email: string | null; phone: string | null }[],
) {
  const { createHash } = await import("crypto");
  const h = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
  const { adAccountId } = await metaConfig();
  let id = existingId;
  if (!id) {
    const r = await graph<{ id: string }>(`/${adAccountId}/customaudiences`, {
      method: "POST",
      params: {
        name: name.slice(0, 100),
        subtype: "CUSTOM",
        customer_file_source: "USER_PROVIDED_ONLY",
        description: "Contatos do CRM (Meu Funil)",
      },
    });
    id = r.id;
  }
  const rows = contacts
    .map((c) => [c.email ? h(c.email) : "", c.phone ? h(c.phone.replace(/\D/g, "")) : ""])
    .filter((r) => r[0] || r[1]);
  for (let i = 0; i < rows.length; i += 5000) {
    await graph(`/${id}/users`, {
      method: "POST",
      params: { payload: { schema: ["EMAIL", "PHONE"], data: rows.slice(i, i + 5000) } },
    });
  }
  return { id, uploaded: rows.length };
}

/** Formulário instantâneo (Lead Ads) na Página, criado com o token da própria Página. */
async function createLeadForm(pageId: string, input: { name: string; privacyUrl: string; thanksUrl: string }) {
  const page = await graph<{ access_token?: string }>(`/${pageId}`, { params: { fields: "access_token" } });
  if (!page.access_token)
    throw new MetaError("Sem acesso de anúncios à Página. Dê ao usuário do sistema a permissão pages_manage_ads na Página.");
  const r = await graph<{ id: string }>(`/${pageId}/leadgen_forms`, {
    method: "POST",
    token: page.access_token,
    params: {
      name: `${input.name} · ${new Date().toISOString().slice(0, 10)}`.slice(0, 100),
      locale: "PT_BR",
      questions: [{ type: "FULL_NAME" }, { type: "EMAIL" }, { type: "PHONE" }],
      privacy_policy: { url: input.privacyUrl, link_text: "Política de privacidade" },
      follow_up_action_url: input.thanksUrl,
    },
  });
  return r.id;
}

function placementTargeting(placements: AdsConfig["placements"]) {
  if (placements === "auto" || !placements.length) return {};
  const fb = new Set<string>();
  const ig = new Set<string>();
  for (const key of placements) {
    const p = PLACEMENTS[key];
    if (!p) continue;
    (p.platform === "facebook" ? fb : ig).add(p.position);
  }
  const platforms = [fb.size ? "facebook" : null, ig.size ? "instagram" : null].filter(Boolean);
  return {
    publisher_platforms: platforms,
    ...(fb.size ? { facebook_positions: [...fb] } : {}),
    ...(ig.size ? { instagram_positions: [...ig] } : {}),
  };
}

export type PublishCreative = {
  id: string;
  title: string;
  url: string | null;
  thumb: string | null;
  angle?: string | null;
};

export type PublishAudience = { nome: string; tipo: string; interesses: string[] };

export type PublishInput = {
  name: string;
  objective: string;
  dailyBudget: number;
  landingUrl: string;
  privacyUrl?: string | null;
  primaryText: string;
  headline: string;
  audience: Record<string, unknown>;
  creatives: PublishCreative[];
  config?: AdsConfig;
  /** Públicos e ângulos da estratégia aprovada. */
  strategyAudiences?: PublishAudience[];
  angles?: { nome: string; gancho?: string | null; mensagem?: string | null }[];
};

export type Step = { key: string; label: string; status: "done" | "failed"; detail: string };

type AdsetPlan = {
  name: string;
  interests: { id: string; name: string }[];
  customAudiences: string[];
  creatives: PublishCreative[];
  angle?: { nome: string; gancho?: string | null; mensagem?: string | null } | null;
};

/** Cria campanha + conjuntos + criativos + anúncios, tudo PAUSADO. */
export async function publishPaused(input: PublishInput) {
  const cfg = await metaConfig();
  const conf = input.config ?? DEFAULT_ADS_CONFIG;
  const steps: Step[] = [];
  const plan = mapObjective(input.objective);
  let { objective, optimization, destination } = plan;
  let promoted: Record<string, unknown> | null = null;
  let leadFormId: string | null = null;
  const customAudiences = [...conf.customAudienceIds];

  if (plan.kind === "sales" || plan.kind === "remarketing") {
    const px = cfg.adAccountId ? await firstPixel(cfg.adAccountId) : null;
    if (px) {
      promoted = { pixel_id: px.id, custom_event_type: "PURCHASE" };
      steps.push({ key: "pixel", label: `Otimização por compras no pixel "${px.name}"`, status: "done", detail: px.id });
      if (plan.kind === "remarketing" && !customAudiences.length) {
        try {
          const aud = await createWebsiteAudience(px.id, input.name);
          customAudiences.push(aud);
          steps.push({ key: "rmkt", label: "Público de remarketing criado (visitantes do site, 30 dias)", status: "done", detail: aud });
        } catch (e) {
          steps.push({ key: "rmkt", label: "Público de remarketing", status: "failed", detail: e instanceof Error ? e.message : "falhou" });
        }
      }
    } else {
      objective = "OUTCOME_TRAFFIC";
      optimization = "LINK_CLICKS";
      destination = "WEBSITE";
      steps.push({ key: "pixel", label: "Sem pixel na conta: campanha criada como tráfego", status: "failed", detail: "Crie um pixel para otimizar por vendas e remarketing." });
    }
  }
  if (plan.kind === "leads" || plan.kind === "whatsapp") promoted = { page_id: cfg.pageId };
  if (plan.kind === "leads") {
    leadFormId = await createLeadForm(cfg.pageId!, {
      name: input.name,
      privacyUrl: input.privacyUrl || input.landingUrl,
      thanksUrl: input.landingUrl,
    });
    steps.push({ key: "form", label: "Formulário instantâneo criado (nome, e-mail, telefone)", status: "done", detail: leadFormId });
  }

  if (conf.lookalikeSourceId) {
    try {
      const lal = await createLookalike(conf.lookalikeSourceId, input.name);
      customAudiences.push(lal);
      steps.push({ key: "lal", label: "Público semelhante 1% (Brasil) criado", status: "done", detail: lal });
    } catch (e) {
      steps.push({ key: "lal", label: "Público semelhante", status: "failed", detail: e instanceof Error ? e.message : "falhou" });
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

  // Estrutura dos conjuntos.
  const sets: AdsetPlan[] = [];
  const strategyAud = conf.useStrategyAudiences ? (input.strategyAudiences ?? []).filter((a) => a.tipo !== "remarketing" && a.tipo !== "lista_clientes") : [];
  if (conf.structure === "per_audience" && strategyAud.length) {
    for (const a of strategyAud.slice(0, 4)) {
      sets.push({ name: a.nome, interests: await searchInterests(a.interesses), customAudiences, creatives: input.creatives });
    }
  } else if (conf.structure === "per_angle" && (input.angles ?? []).length) {
    const interests = strategyAud.length ? await searchInterests(strategyAud.flatMap((a) => a.interesses)) : [];
    for (const ang of (input.angles ?? []).slice(0, 5)) {
      const crs = input.creatives.filter((c) => c.angle === ang.nome);
      if (crs.length) sets.push({ name: `Ângulo: ${ang.nome}`, interests, customAudiences, creatives: crs, angle: ang });
    }
    const loose = input.creatives.filter((c) => !c.angle || !(input.angles ?? []).some((a) => a.nome === c.angle));
    if (loose.length) sets.push({ name: "Criativos gerais", interests, customAudiences, creatives: loose });
  }
  if (!sets.length) {
    const interests = strategyAud.length ? await searchInterests(strategyAud.flatMap((a) => a.interesses)) : [];
    sets.push({ name: "Conjunto 1", interests, customAudiences, creatives: input.creatives });
  }
  const perSet = Math.max(100, Math.round((input.dailyBudget * 100) / sets.length));
  if (sets.length > 1)
    steps.push({ key: "split", label: `${sets.length} conjuntos com verba igual (R$ ${(perSet / 100).toFixed(2)}/dia cada)`, status: "done", detail: conf.structure });

  const cta = conf.cta || (plan.kind === "whatsapp" ? "WHATSAPP_MESSAGE" : plan.kind === "leads" ? "SIGN_UP" : "LEARN_MORE");
  const ctaFor = () => {
    if (plan.kind === "whatsapp") return { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } };
    if (leadFormId) return { type: cta === "LEARN_MORE" ? "SIGN_UP" : cta, value: { lead_gen_form_id: leadFormId, link: input.landingUrl } };
    return { type: cta, value: { link: input.landingUrl } };
  };
  const link = plan.kind === "whatsapp" ? "https://api.whatsapp.com/send" : input.landingUrl;
  const identity = { page_id: cfg.pageId, ...(cfg.instagramId ? { instagram_user_id: cfg.instagramId } : {}) };

  const adsetIds: string[] = [];
  const adIds: string[] = [];
  const adMap: Record<string, { creativeId: string | null; adsetId: string; angle: string | null }> = {};
  const imageHashes = new Map<string, string>();

  for (const set of sets) {
    const targeting: Record<string, unknown> = {
      geo_locations: geo.geo,
      ...ages,
      ...placementTargeting(conf.placements),
      targeting_automation: { advantage_audience: conf.advantageAudience ? 1 : 0 },
    };
    if (set.interests.length) targeting["flexible_spec"] = [{ interests: set.interests }];
    if (set.customAudiences.length) targeting["custom_audiences"] = set.customAudiences.map((id) => ({ id }));
    if (conf.excludeAudienceIds.length) targeting["excluded_custom_audiences"] = conf.excludeAudienceIds.map((id) => ({ id }));
    let adset: { id: string };
    try {
      adset = await graph<{ id: string }>(`/${cfg.adAccountId}/adsets`, {
        method: "POST",
        params: {
          name: `${input.name} · ${set.name}`.slice(0, 200),
          campaign_id: campaign.id,
          daily_budget: perSet,
          billing_event: "IMPRESSIONS",
          optimization_goal: optimization,
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          status: "PAUSED",
          targeting,
          ...(promoted ? { promoted_object: promoted } : {}),
          ...(destination ? { destination_type: destination } : {}),
        },
      });
    } catch (e) {
      steps.push({ key: `adset-${set.name}`, label: `Conjunto "${set.name}"`, status: "failed", detail: e instanceof Error ? e.message : "falhou" });
      continue;
    }
    adsetIds.push(adset.id);
    steps.push({
      key: `adset-${adset.id}`,
      label: `Conjunto "${set.name}" criado (pausado)${set.interests.length ? ` · interesses: ${set.interests.map((i) => i.name).join(", ")}` : ""}`,
      status: "done",
      detail: adset.id,
    });

    const text = input.primaryText;
    const headline = (set.angle?.gancho || input.headline).slice(0, 40);
    const images = set.creatives.filter((c) => c.url && !/\.mp4(\?|$)/i.test(c.url));
    const useCarousel = conf.carousel && images.length >= 2 && plan.kind !== "whatsapp";
    const singles = useCarousel ? set.creatives.filter((c) => !images.includes(c)) : set.creatives;

    if (useCarousel) {
      try {
        const cards = [];
        for (const cr of images.slice(0, 10)) {
          const hash = imageHashes.get(cr.url!) ?? (await uploadImageFromUrl(cr.url!));
          imageHashes.set(cr.url!, hash);
          cards.push({ image_hash: hash, link, name: (cr.title || headline).slice(0, 40), call_to_action: ctaFor() });
        }
        const creative = await graph<{ id: string }>(`/${cfg.adAccountId}/adcreatives`, {
          method: "POST",
          params: {
            name: `${set.name} · Carrossel`,
            object_story_spec: { ...identity, link_data: { link, message: text, child_attachments: cards, multi_share_optimized: true, call_to_action: ctaFor() } },
          },
        });
        const ad = await graph<{ id: string }>(`/${cfg.adAccountId}/ads`, {
          method: "POST",
          params: { name: `${set.name} · Carrossel`, adset_id: adset.id, creative: { creative_id: creative.id }, status: "PAUSED" },
        });
        adIds.push(ad.id);
        adMap[ad.id] = { creativeId: images[0]!.id, adsetId: adset.id, angle: set.angle?.nome ?? images[0]!.angle ?? null };
        steps.push({ key: `ad-${ad.id}`, label: `Anúncio carrossel (${cards.length} cards) criado (pausado)`, status: "done", detail: ad.id });
      } catch (e) {
        steps.push({ key: `carousel-${adset.id}`, label: "Anúncio carrossel", status: "failed", detail: e instanceof Error ? e.message : "falhou" });
      }
    }

    for (const cr of singles) {
      try {
        if (!cr.url) throw new MetaError("criativo sem arquivo");
        const isVideo = /\.mp4(\?|$)/i.test(cr.url);
        let story: Record<string, unknown>;
        if (isVideo) {
          const videoId = await uploadVideoFromUrl(cr.url, cr.title);
          const thumb = cr.thumb && !/\.mp4/i.test(cr.thumb) ? cr.thumb : await videoThumbnail(videoId);
          if (!thumb) throw new MetaError("vídeo enviado, mas a Meta ainda não gerou a miniatura. Tente publicar de novo em alguns minutos.");
          story = { video_data: { video_id: videoId, image_url: thumb, message: text, title: headline, call_to_action: ctaFor() } };
        } else {
          const hash = imageHashes.get(cr.url) ?? (await uploadImageFromUrl(cr.url));
          imageHashes.set(cr.url, hash);
          story = { link_data: { image_hash: hash, link, message: text, name: headline, call_to_action: ctaFor() } };
        }
        const creative = await graph<{ id: string }>(`/${cfg.adAccountId}/adcreatives`, {
          method: "POST",
          params: { name: cr.title, object_story_spec: { ...identity, ...story } },
        });
        const ad = await graph<{ id: string }>(`/${cfg.adAccountId}/ads`, {
          method: "POST",
          params: { name: cr.title, adset_id: adset.id, creative: { creative_id: creative.id }, status: "PAUSED" },
        });
        adIds.push(ad.id);
        adMap[ad.id] = { creativeId: cr.id, adsetId: adset.id, angle: cr.angle ?? set.angle?.nome ?? null };
        steps.push({ key: `ad-${ad.id}`, label: `Anúncio "${cr.title}" criado (pausado)`, status: "done", detail: ad.id });
      } catch (e) {
        steps.push({ key: `ad-${cr.id}-${adset.id}`, label: `Anúncio "${cr.title}"`, status: "failed", detail: e instanceof Error ? e.message : "falhou" });
      }
    }
  }
  if (!adsetIds.length) throw new MetaError(steps.filter((s) => s.status === "failed").map((s) => `${s.label}: ${s.detail}`).join(" · ") || "Nenhum conjunto foi criado.");
  return { campaignId: campaign.id, adsetId: adsetIds[0]!, adsetIds, adIds, adMap, leadFormId, steps };
}

/** Pausa ou ativa um anúncio. */
export async function setAdStatus(adId: string, status: "ACTIVE" | "PAUSED") {
  await graph(`/${adId}`, { method: "POST", params: { status } });
}

/** Verba diária atual de um conjunto (R$). */
export async function getAdsetBudget(adsetId: string) {
  const r = await graph<{ daily_budget?: string; name?: string; effective_status?: string }>(`/${adsetId}`, {
    params: { fields: "daily_budget,name,effective_status" },
  });
  return { dailyBudget: Number(r.daily_budget ?? 0) / 100, name: r.name ?? adsetId, status: r.effective_status ?? null };
}

/** Altera a verba diária de um conjunto (R$). */
export async function setAdsetBudget(adsetId: string, dailyBudget: number) {
  await graph(`/${adsetId}`, { method: "POST", params: { daily_budget: Math.max(100, Math.round(dailyBudget * 100)) } });
}

const LEAD_ACTIONS = new Set(["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_conversion.messaging_conversation_started_7d"]);
const PURCHASE_ACTIONS = new Set(["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"]);

function sumActions(list: any[] | undefined, types: Set<string>) {
  // A Meta repete a mesma conversão em vários tipos (ex.: purchase e omni_purchase): usa o maior, não a soma.
  let best = 0;
  for (const a of list ?? []) if (types.has(a.action_type)) best = Math.max(best, Number(a.value ?? 0));
  return best;
}

export type DailyAdRow = {
  date: string;
  campaignId: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  conversions: number;
  revenue: number;
};

/** Insights por anúncio e por dia das campanhas informadas (com paginação). */
export async function fetchDailyAdInsights(metaCampaignIds: string[], since: string, until: string): Promise<DailyAdRow[]> {
  const { adAccountId } = await metaConfig();
  if (!metaCampaignIds.length) return [];
  const rows: DailyAdRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < 30; page++) {
    const r: { data?: any[]; paging?: { cursors?: { after?: string }; next?: string } } = await graph(`/${adAccountId}/insights`, {
      params: {
        level: "ad",
        time_increment: 1,
        time_range: { since, until },
        fields: "campaign_id,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,clicks,actions,action_values",
        filtering: [{ field: "campaign.id", operator: "IN", value: metaCampaignIds }],
        limit: 500,
        ...(after ? { after } : {}),
      },
    });
    for (const x of r.data ?? []) {
      rows.push({
        date: String(x.date_start),
        campaignId: String(x.campaign_id),
        adsetId: String(x.adset_id),
        adsetName: String(x.adset_name ?? ""),
        adId: String(x.ad_id),
        adName: String(x.ad_name ?? ""),
        spend: Number(x.spend ?? 0),
        impressions: Number(x.impressions ?? 0),
        reach: Number(x.reach ?? 0),
        clicks: Number(x.inline_link_clicks ?? x.clicks ?? 0),
        leads: sumActions(x.actions, LEAD_ACTIONS),
        conversions: sumActions(x.actions, PURCHASE_ACTIONS),
        revenue: sumActions(x.action_values, PURCHASE_ACTIONS),
      });
    }
    after = r.paging?.next ? (r.paging?.cursors?.after ?? null) : null;
    if (!after) break;
  }
  return rows;
}

/** Ativa ou pausa campanha, conjunto e anúncios. */
export async function setDeliveryStatus(
  ids: { campaignId: string; adsetIds?: string[]; adIds?: string[] },
  status: "ACTIVE" | "PAUSED",
) {
  const all = [ids.campaignId, ...(ids.adsetIds ?? []), ...(ids.adIds ?? [])].filter(Boolean) as string[];
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
