/**
 * Publicação orgânica no Instagram (somente servidor).
 * Token da Meta vem do cofre (metaConfig) — nunca é salvo em instagram_accounts.
 */
import { normalizeHashtags, asText, asList } from "./normalize";
import { graph, metaConfig, MetaError, runWithMetaWorkspace } from "@/lib/meta/graph.server";
import { getWorkspaceAiKey } from "@/lib/ai-keys.server";
import { viaGateway, viaGemini, viaOpenAI } from "@/lib/copy-ai.server";
import { resolveProvider, providerLog, type ProviderChoice } from "@/lib/creative.server";

const BUCKET = "ig-media";
const MAX_ATTEMPTS = 3;
const DAILY_LIMIT = 25;

export type IgFormat = "feed_image" | "feed_carousel" | "reel" | "story_image" | "story_video";
export type Engine = "auto" | "chatgpt" | "gemini";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "erro desconhecido");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const ASPECT: Record<IgFormat, string> = {
  feed_image: "1:1",
  feed_carousel: "4:5",
  reel: "9:16",
  story_image: "9:16",
  story_video: "9:16",
};
const isVideo = (f: IgFormat) => f === "reel" || f === "story_video";

async function getPost(id: string) {
  const s = await db();
  const { data, error } = await s.from("ig_posts").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Post não encontrado.");
  return data as any;
}

async function patchPost(id: string, patch: Record<string, unknown>) {
  const s = await db();
  const { error } = await s
    .from("ig_posts")
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function appendLog(post: any, entry: Record<string, unknown>) {
  const log = Array.isArray(post.ai_generation_log) ? post.ai_generation_log : [];
  return [...log, { at: new Date().toISOString(), ...entry }].slice(-50);
}

/* ---------------- Conta ---------------- */

/**
 * Exigência de aprovação do post: a programação automática decide pelo próprio modo
 * ("publish" publica sozinho, "approval" espera aprovação); sem ela, vale o plano.
 */
export async function approvalRequired(post: any): Promise<boolean | null> {
  if (post.automation === "publish") return false;
  if (post.automation === "approval") return true;
  if (!post.plan_id) return null;
  const { data } = await (await db())
    .from("ig_content_plans")
    .select("requires_approval")
    .eq("id", post.plan_id)
    .maybeSingle();
  return (data?.requires_approval as boolean | undefined) ?? null;
}

export async function connectInstagramAccount(workspaceId: string, pageIdOverride?: string | null) {
  const r = await runWithMetaWorkspace(workspaceId, () => connectInner(workspaceId, pageIdOverride));
  if (r.ok) {
    // Importa o histórico recente logo após conectar (não bloqueia a conexão se falhar).
    await syncInstagramHistory(workspaceId).catch((e) => console.error("[ig-sync]", errMsg(e)));
  }
  return r;
}

async function connectInner(workspaceId: string, pageIdOverride?: string | null) {
  const s = await db();
  const cfg = await metaConfig(workspaceId);
  const pageId = pageIdOverride || cfg.pageId;
  try {
    if (!cfg.token)
      throw new Error("Salve as credenciais da Meta em Integrações antes de conectar o Instagram.");
    if (!pageId) throw new Error("ID da Página do Facebook não configurado.");
    const page = await graph<{ instagram_business_account?: { id: string } }>(`/${pageId}`, {
      params: { fields: "instagram_business_account" },
    });
    const igId = page.instagram_business_account?.id;
    if (!igId)
      throw new Error("Esta Página não tem uma conta profissional do Instagram vinculada.");
    const ig = await graph<{ username?: string; profile_picture_url?: string }>(`/${igId}`, {
      params: { fields: "username,profile_picture_url" },
    });
    const row = {
      workspace_id: workspaceId,
      ig_user_id: igId,
      username: ig.username ?? null,
      facebook_page_id: pageId,
      profile_picture_url: ig.profile_picture_url ?? null,
      status: "connected",
      last_error: null,
      connected_at: new Date().toISOString(),
    };
    const { error } = await s
      .from("instagram_accounts")
      .upsert(row as never, { onConflict: "workspace_id" });
    if (error) throw new Error(error.message);
    return { ok: true as const, username: row.username, igUserId: igId };
  } catch (e) {
    await s.from("instagram_accounts").upsert(
      {
        workspace_id: workspaceId,
        facebook_page_id: pageId,
        status: "error",
        last_error: errMsg(e),
      } as never,
      {
        onConflict: "workspace_id",
      },
    );
    return { ok: false as const, error: errMsg(e) };
  }
}

/** Lista as Páginas acessíveis pelo token da Meta e o Instagram vinculado a cada uma. */
export async function listInstagramOptions(workspaceId?: string | null) {
  return runWithMetaWorkspace(workspaceId, () => listOptionsInner(workspaceId));
}

async function listOptionsInner(workspaceId?: string | null) {
  const cfg = await metaConfig(workspaceId);
  if (!cfg.token)
    return { ok: false as const, error: "Salve as credenciais da Meta em Integrações primeiro.", options: [] };
  try {
    const r = await graph<{
      data?: {
        id: string;
        name: string;
        instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
      }[];
    }>(`/me/accounts`, {
      params: {
        fields: "id,name,instagram_business_account{id,username,profile_picture_url}",
        limit: "100",
      },
    });
    const options = (r.data ?? []).map((p) => ({
      pageId: p.id,
      pageName: p.name,
      igUserId: p.instagram_business_account?.id ?? null,
      username: p.instagram_business_account?.username ?? null,
      picture: p.instagram_business_account?.profile_picture_url ?? null,
    }));
    return { ok: true as const, options };
  } catch (e) {
    return { ok: false as const, error: errMsg(e), options: [] };
  }
}

export async function disconnectInstagramAccount(workspaceId: string) {
  const s = await db();
  const { error } = await s.from("instagram_accounts").delete().eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}

async function liveAccount(workspaceId: string) {
  const s = await db();
  const { data } = await s
    .from("instagram_accounts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .maybeSingle();
  return data?.ig_user_id ? (data as any) : null;
}

/* ---------------- IA de texto ---------------- */

export async function aiJson(
  workspaceId: string,
  engine: Engine,
  prompt: string,
  schema: Record<string, unknown>,
  name: string,
) {
  const [o, g] = await Promise.all([
    getWorkspaceAiKey(workspaceId, "openai"),
    getWorkspaceAiKey(workspaceId, "gemini"),
  ]);
  // Chaves do cliente primeiro; se falharem (sem crédito, inválida), segue para a próxima opção.
  if ((engine === "chatgpt" || engine === "auto") && o) {
    try {
      return { json: await viaOpenAI(o, prompt), provider: "openai_own" };
    } catch (e) {
      console.warn("[instagram] chave OpenAI falhou:", errMsg(e));
    }
  }
  if ((engine === "gemini" || engine === "auto") && g) {
    try {
      return { json: await viaGemini(g, prompt), provider: "gemini_own" };
    } catch (e) {
      console.warn("[instagram] chave Gemini falhou:", errMsg(e));
    }
  }
  return { json: await viaGateway(prompt, schema, name), provider: "lovable_ai" };
}

const POST_ITEM = {
  type: "object",
  additionalProperties: false,
  required: [
    "format",
    "scheduled_at",
    "theme",
    "hook",
    "caption",
    "hashtags",
    "cta",
    "image_prompt",
    "slides",
  ],
  properties: {
    format: {
      type: "string",
      enum: ["feed_image", "feed_carousel", "reel", "story_image", "story_video"],
    },
    scheduled_at: { type: "string" },
    theme: { type: "string" },
    hook: { type: "string" },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
    image_prompt: { type: "string" },
    slides: { type: "array", items: { type: "string" } },
  },
};
const CALENDAR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["posts"],
  properties: { posts: { type: "array", items: POST_ITEM } },
};
const CAPTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caption", "hashtags", "cta"],
  properties: {
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
  },
};

export async function brandFor(brandId: string | null) {
  if (!brandId) return null;
  const s = await db();
  const { data } = await s.from("brands").select("*").eq("id", brandId).maybeSingle();
  return data;
}

export async function generateContentCalendar(
  workspaceId: string,
  planId: string,
  weeks: number,
  engine: Engine,
) {
  const s = await db();
  const { data: plan } = await s
    .from("ig_content_plans")
    .select("*")
    .eq("id", planId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!plan) throw new Error("Plano de conteúdo não encontrado.");
  const brand = await brandFor(plan.brand_id);
  if (!brand) throw new Error("Cadastre a marca em Brands antes (e vincule-a ao plano de conteúdo).");
  const start = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const prompt = [
    "Você é estrategista de conteúdo de Instagram no Brasil. Escreva em português do Brasil.",
    `Crie o calendário de ${weeks} semana(s) começando em ${start} (fuso America/Sao_Paulo, use ISO 8601 com -03:00).`,
    `Frequência semanal por formato: ${JSON.stringify(plan.posting_frequency)} (feed = feed_image ou feed_carousel; reels = reel; stories = story_image ou story_video).`,
    `Horários preferidos: ${JSON.stringify(plan.preferred_times)}.`,
    Array.isArray(plan.posting_days) && plan.posting_days.length && plan.posting_days.length < 7
      ? `Publique SOMENTE nestes dias da semana (0 = domingo): ${JSON.stringify(plan.posting_days)}.`
      : "",
    "Para cada post: format, scheduled_at, theme, hook, caption (com quebras de linha), hashtags (array JSON de 10 a 15 strings sem #, ex.: ['valinhos','choppgelado'], misturando nicho, amplas e locais),",
    "cta, image_prompt (briefing visual curto em português: o que deve aparecer; o diretor de arte transforma no prompt final), slides (3 a 7 prompts só para feed_carousel, senão vazio).",
    "Proporções: 1:1 feed, 4:5 carrossel, 9:16 reels/stories.",
    `Objetivo: ${plan.objective ?? "-"}. Tom de voz: ${plan.tone_of_voice ?? "-"}. Pilares: ${JSON.stringify(plan.content_pillars)}.`,
    plan.pillar_weights && Object.keys(plan.pillar_weights).length
      ? `Distribua os posts entre os pilares proporcionalmente a estes pesos (definidos pelo desempenho): ${JSON.stringify(plan.pillar_weights)}.`
      : "",
    `Estratégia de hashtags: ${JSON.stringify(plan.hashtag_strategy)}. CTA padrão: ${plan.cta_default ?? "-"}.`,
    brand ? `MARCA: ${JSON.stringify(brand)}` : "",
    'Devolva SOMENTE JSON estrito no formato {"posts":[...]}.',
  ].join("\n");
  const { json, provider } = await aiJson(
    workspaceId,
    engine,
    prompt,
    CALENDAR_SCHEMA,
    "ig_calendar",
  );
  const days: number[] = Array.isArray(plan.posting_days) && plan.posting_days.length ? plan.posting_days : [0, 1, 2, 3, 4, 5, 6];
  // Garante os dias escolhidos no plano mesmo se a IA errar (dia da semana em São Paulo).
  const posts = (Array.isArray(json?.posts) ? json.posts : []).filter((p: any) => {
    const t = new Date(p.scheduled_at).getTime();
    return isNaN(t) || days.includes(new Date(t - 3 * 3600e3).getUTCDay());
  });
  if (!posts.length) throw new Error("A IA não devolveu posts.");
  const rows = posts.map((p: any) => {
    const format = (Object.keys(ASPECT).includes(p.format) ? p.format : "feed_image") as IgFormat;
    const d = new Date(p.scheduled_at);
    return {
      workspace_id: workspaceId,
      plan_id: planId,
      format,
      status: "idea",
      scheduled_at: isNaN(d.getTime()) ? null : d.toISOString(),
      theme: asText(p.theme),
      hook: asText(p.hook),
      caption: asText(p.caption),
      hashtags: normalizeHashtags(p.hashtags),
      cta: asText(p.cta) ?? plan.cta_default ?? null,
      creative_brief: {
        prompt: asText(p.image_prompt) ?? "",
        slides: asList(p.slides).slice(0, 10),
        aspect_ratio: ASPECT[format],
      },
      ai_provider: provider,
      ai_generation_log: [{ at: new Date().toISOString(), step: "calendar", provider }],
    };
  });
  const { data, error } = await s
    .from("ig_posts")
    .insert(rows as never)
    .select("id");
  if (error) throw new Error(error.message);
  return { created: data?.length ?? 0, provider };
}

export async function regenerateCaption(
  workspaceId: string,
  postId: string,
  instructions: string | undefined,
  engine: Engine,
) {
  const post = await getPost(postId);
  if (post.workspace_id !== workspaceId) throw new Error("Post não encontrado.");
  const s = await db();
  const { data: plan } = post.plan_id
    ? await s.from("ig_content_plans").select("*").eq("id", post.plan_id).maybeSingle()
    : { data: null as any };
  const brand = await brandFor(plan?.brand_id ?? null);
  const prompt = [
    "Reescreva a legenda deste post de Instagram em português do Brasil.",
    `Formato: ${post.format}. Tema: ${post.theme ?? "-"}. Hook: ${post.hook ?? "-"}.`,
    `Legenda atual: ${post.caption ?? "-"}`,
    instructions ? `Instruções: ${instructions}` : "",
    plan
      ? `Tom: ${plan.tone_of_voice ?? "-"}. Hashtags: ${JSON.stringify(plan.hashtag_strategy)}.`
      : "",
    brand ? `MARCA: ${JSON.stringify(brand)}` : "",
    'Devolva SOMENTE JSON {"caption":"...","hashtags":["valinhos","choppgelado"] (array de 10 a 15 strings sem #),"cta":"..."}.',
  ].join("\n");
  const { json, provider } = await aiJson(
    workspaceId,
    engine,
    prompt,
    CAPTION_SCHEMA,
    "ig_caption",
  );
  await patchPost(postId, {
    caption: asText(json.caption),
    hashtags: normalizeHashtags(json.hashtags),
    cta: json.cta ?? post.cta,
    ai_generation_log: await appendLog(post, { step: "caption", provider, instructions }),
  });
  return { ok: true };
}

/* ---------------- Mídia ---------------- */

/**
 * Salva a mídia na Biblioteca (bucket creative-assets, padronizada no formato do post)
 * e devolve o item de mídia do post com largura/altura/duração reais.
 */
async function libraryItem(
  post: any,
  src: { sourceUrl?: string; bytes?: Uint8Array; mime?: string },
  order: number,
  provider: string,
  prompt: string | null,
  cost = 0,
  title?: string,
) {
  const { ingestAsset } = await import("@/lib/media/assets.server");
  const { targetForIgFormat } = await import("@/lib/media/formats");
  const video = src.mime ? src.mime.startsWith("video/") : isVideo(post.format as IgFormat);
  // 6.1 Toda mídia do Instagram fica ligada à marca do plano.
  let brandId: string | null = post._brandId ?? null;
  if (!brandId && post.plan_id) {
    const { data: plan } = await (await db()).from("ig_content_plans").select("brand_id").eq("id", post.plan_id).maybeSingle();
    brandId = (plan?.brand_id as string | null) ?? null;
    post._brandId = brandId;
  }
  const a = await ingestAsset({
    brandId,
    workspaceId: post.workspace_id,
    kind: video ? "video" : "image",
    targetFormat: targetForIgFormat(post.format),
    source: provider,
    sourceUrl: src.sourceUrl,
    bytes: src.bytes,
    mime: src.mime ?? null,
    title: title ?? post.theme ?? "Post do Instagram",
    prompt,
    provider,
    cost,
    igPostId: post.id,
  });
  return {
    url: a.url,
    type: a.kind,
    order,
    width: a.width,
    height: a.height,
    duration: a.duration_seconds,
    asset_id: a.id,
    ig_ready: a.ig_ready,
    issues: a.quality_report?.issues ?? [],
  };
}

type PendingJob = {
  provider: string;
  jobId: string;
  index: number;
  prompts: string[];
  media: any[];
  cost: number;
  instructions?: string | null;
  started_at: string;
};

const choiceFor = (id: string): ProviderChoice =>
  id === "higgsfield" || id === "chatgpt" || id === "gemini" ? id : "auto";

/**
 * Gera (ou continua gerando) a mídia a partir do slide `start`. Se o provedor responder
 * "generating", salva creative_brief.pending_job e mantém o post em "generating".
 */
async function continueAssets(
  post: any,
  provider: Awaited<ReturnType<typeof resolveProvider>>,
  prompts: string[],
  start: number,
  media: any[],
  cost: number,
  instructions?: string | null,
  extra: { referenceImages?: { bytes: Uint8Array; mime: string }[]; referenceUrls?: string[] } = {},
): Promise<{ ok: true; items: number; provider: string; pending?: boolean }> {
  const format = post.format as IgFormat;
  const s = await db();
  for (let i = start; i < prompts.length; i++) {
    const req = {
      finalPrompt:
        `${prompts[i]} ${format === "feed_carousel" ? `(slide ${i + 1} de ${prompts.length})` : ""}`.trim(),
      aspectRatio: ASPECT[format],
      kind: (isVideo(format) ? "video" : "image") as "image" | "video",
      ...(isVideo(format) ? {} : extra),
    };
    const r = isVideo(format)
      ? await provider.generateVideo(req)
      : await provider.generateImage(req);
    if (r.status === "generating" && r.externalJobId) {
      const pending: PendingJob = {
        provider: provider.id,
        jobId: r.externalJobId,
        index: i,
        prompts,
        media,
        cost,
        instructions: instructions ?? null,
        started_at: new Date().toISOString(),
      };
      await patchPost(post.id, {
        status: "generating",
        ai_provider: provider.id,
        creative_brief: { ...(post.creative_brief ?? {}), pending_job: pending },
      });
      return { ok: true, items: media.length, provider: provider.id, pending: true };
    }
    if (r.status !== "ready" || !r.assetUrl)
      throw new Error("O provedor não devolveu a mídia pronta.");
    cost += r.cost;
    const composed = format === "feed_carousel" ? await composeSlide(post, r.assetUrl, i, prompts.length) : null;
    const item = await libraryItem(
      post,
      composed ? { bytes: composed, mime: "image/jpeg" } : { sourceUrl: r.assetUrl },
      i,
      provider.id,
      req.finalPrompt,
      r.cost,
    );
    if (isVideo(format)) Object.assign(item, await videoCover(post, provider, req.finalPrompt, item.asset_id));
    media = [...media, item];
  }
  const req = await approvalRequired(post);
  const { pending_job: _drop, ...brief } = post.creative_brief ?? {};
  await patchPost(post.id, {
    media,
    creative_brief: brief,
    status: req === false ? "ready" : "pending_approval",
    last_error: null,
    ai_provider: provider.id,
    ai_generation_log: await appendLog(post, {
      step: "media",
      provider: provider.id,
      provider_log: providerLog(provider),
      items: media.length,
      cost,
      instructions,
    }),
  });
  return { ok: true, items: media.length, provider: provider.id };
}

async function brandOfPost(post: any) {
  if (post._brandId === undefined && post.plan_id) {
    const { data: plan } = await (await db()).from("ig_content_plans").select("brand_id").eq("id", post.plan_id).maybeSingle();
    post._brandId = (plan?.brand_id as string | null) ?? null;
  }
  return post._brandId ? brandFor(post._brandId) : null;
}

/** 5.3 Texto e logo aplicados por cima nos slides do carrossel (gancho no 1º, CTA no último, logo em todos). */
async function composeSlide(post: any, url: string, index: number, total: number): Promise<Uint8Array | null> {
  if (post.creative_brief?.compose === false) return null;
  try {
    const brand = await brandOfPost(post);
    const res = await fetch(url);
    if (!res.ok) return null;
    const image = new Uint8Array(await res.arrayBuffer());
    const { loadFont, loadLogo } = await import("@/lib/creative/refs.server");
    const { composeCreative } = await import("@/lib/creative/compose.server");
    const [font, logo] = await Promise.all([loadFont(brand?.id ?? null), loadLogo(brand?.id ?? null)]);
    const first = index === 0;
    const last = index === total - 1 && total > 1;
    const slideText = (post.creative_brief?.slide_texts as string[] | undefined)?.[index] ?? null;
    return await composeCreative({
      image,
      aspectRatio: ASPECT[post.format as IgFormat],
      layout: last ? "cta_rodape" : first || slideText ? "titulo_topo" : "limpo",
      title: first ? (post.hook ?? post.theme ?? null) : slideText,
      cta: last ? (post.cta ?? null) : null,
      logo,
      font,
      primary: brand?.primary_color ?? null,
      secondary: brand?.secondary_color ?? null,
    });
  } catch (e) {
    console.warn("[instagram] composição do slide falhou:", errMsg(e));
    return null;
  }
}

/** 5.3 Reels/Stories em vídeo: capa com logo, gancho e CTA (usada como capa do Reels). */
async function videoCover(post: any, provider: Awaited<ReturnType<typeof resolveProvider>>, prompt: string, assetId: string | null) {
  if (post.creative_brief?.compose === false) return {};
  try {
    const brand = await brandOfPost(post);
    const { buildVideoExtras } = await import("@/lib/creative/video-extras.server");
    const x = await buildVideoExtras({
      workspaceId: post.workspace_id,
      brand: brand as never,
      provider,
      visualPrompt: prompt,
      aspectRatio: "9:16",
      durationSec: 8,
      headline: post.hook ?? post.theme ?? null,
      cta: post.cta ?? null,
      captionText: post.hook ?? null,
      videoAssetId: assetId,
      campaignId: null,
      title: post.theme ?? "Reels",
      withCover: true,
    });
    return { cover_url: x.cover_url ?? null, captions_srt: x.captions_srt ?? null };
  } catch (e) {
    console.warn("[instagram] capa do vídeo falhou:", errMsg(e));
    return {};
  }
}

export async function generatePostAssets(
  workspaceId: string,
  postId: string,
  providerChoice: ProviderChoice = "auto",
  instructions?: string,
) {
  const post = await getPost(postId);
  if (post.workspace_id !== workspaceId) throw new Error("Post não encontrado.");
  const format = post.format as IgFormat;
  const s = await db();
  const { data: plan } = post.plan_id
    ? await s.from("ig_content_plans").select("brand_id").eq("id", post.plan_id).maybeSingle()
    : { data: null as any };
  const brand = await brandFor(plan?.brand_id ?? null);
  post._brandId = brand?.id ?? null;
  await patchPost(postId, { status: "generating", last_error: null });
  let used: Awaited<ReturnType<typeof resolveProvider>> | null = null;
  try {
    const provider = await resolveProvider(s as any, workspaceId, providerChoice);
    used = provider;
    const brief = post.creative_brief ?? {};
    const { buildVisualPrompt, providerPrompt } = await import("@/lib/creative/art-director.server");
    const { loadBrandRefs } = await import("@/lib/creative/refs.server");
    const vs = (brand?.visual_style ?? {}) as { referencias?: string[] };
    const refs = isVideo(format)
      ? []
      : await loadBrandRefs(brand?.id, { max: 4, ids: vs.referencias?.length ? vs.referencias : undefined });
    const base = brief.prompt || post.theme || "Post de Instagram";
    const briefs: string[] =
      format === "feed_carousel" ? (brief.slides?.length ? brief.slides : [base, base, base]).slice(0, 10) : [base];
    const artBrief = (userPrompt: string, i: number) => ({
      workspaceId,
      brand,
      theme: post.theme,
      hook: post.hook,
      offer: post.cta,
      userPrompt,
      aspectRatio: ASPECT[format],
      kind: (isVideo(format) ? "video" : "image") as "image" | "video",
      provider: provider.id,
      hasProductRef: refs.some((r) => r.tag === "produto"),
      adjust: instructions ?? null,
      previousPrompt: instructions ? (brief.visual_prompt ?? null) : null,
      slide: format === "feed_carousel" ? { index: i, total: briefs.length } : null,
    });
    // Prompt editado pelo usuário (sem novo ajuste) vale para o post de mídia única.
    const override = !instructions && format !== "feed_carousel" && brief.visual_prompt_override;
    const ads = await Promise.all(
      briefs.map(async (p, i) =>
        override && brief.art_direction
          ? { ...brief.art_direction, prompt_final: String(brief.visual_prompt_override) }
          : buildVisualPrompt(artBrief(p, i)),
      ),
    );
    const prompts = ads.map((ad) => providerPrompt(ad));
    post.creative_brief = {
      ...brief,
      art_direction: ads[0],
      art_directions: format === "feed_carousel" ? ads : undefined,
      visual_prompt: ads[0]!.prompt_final,
    };
    await patchPost(postId, { creative_brief: post.creative_brief });

    // Imagem única: variações + crítico + composição.
    if (!isVideo(format) && format !== "feed_carousel" && !provider.sandbox) {
      const { runImagePipeline } = await import("@/lib/creative/pipeline.server");
      const { targetForIgFormat } = await import("@/lib/media/formats");
      const layout = (brief.layout ?? "limpo") as import("@/lib/creative/visual-style").TextLayout;
      const res = await runImagePipeline({
        workspaceId,
        brand,
        provider,
        ad: ads[0]!,
        aspectRatio: ASPECT[format],
        targetFormat: targetForIgFormat(format),
        refs,
        variations: Number(brief.variations ?? 3),
        layout,
        text: { title: brief.headline ?? post.hook ?? null, price: brief.price ?? null, cta: post.cta ?? null },
        title: post.theme ?? "Post do Instagram",
        igPostId: post.id,
        rebuild: (motivo) =>
          buildVisualPrompt({ ...artBrief(base, 0), previousPrompt: ads[0]!.prompt_final, adjust: `Corrija: ${motivo}` }),
      });
      if (!res.pending) {
        const req = await approvalRequired(post);
        const media = [
          {
            url: res.finalUrl,
            type: "image",
            order: 0,
            width: res.width,
            height: res.height,
            duration: null,
            asset_id: res.finalAssetId,
            ig_ready: res.igReady,
            issues: [],
          },
        ];
        await patchPost(postId, {
          media,
          creative_brief: { ...post.creative_brief, art_direction: res.ad, visual_prompt: res.ad.prompt_final, variations: res.variations },
          status: req === false ? "ready" : "pending_approval",
          last_error: null,
          ai_provider: provider.id,
          ai_generation_log: await appendLog(post, {
            step: "media",
            provider: provider.id,
            provider_log: providerLog(provider),
            items: 1,
            variations: res.variations.length,
            best_score: res.winner.score?.total ?? null,
            cost: res.cost,
            instructions,
          }),
        });
        return { ok: true as const, items: 1, provider: provider.id };
      }
      // Provedor assíncrono: segue o fluxo de pendência de sempre.
      return await continueAssets(post, provider, prompts, 0, [], 0, instructions);
    }
    return await continueAssets(post, provider, prompts, 0, [], 0, instructions, {
      referenceImages: refs.map((r) => ({ bytes: r.bytes, mime: r.mime })),
      referenceUrls: refs.map((r) => r.url),
    });
  } catch (e) {
    console.error("[instagram] mídia falhou:", errMsg(e));
    await patchPost(postId, {
      status: "failed",
      last_error: errMsg(e),
      ai_generation_log: await appendLog(post, {
        step: "media",
        status: "failed",
        provider: used?.id ?? null,
        provider_log: used ? providerLog(used) : null,
        error: errMsg(e),
      }),
    });
    return { ok: false as const, error: errMsg(e) };
  }
}

/** Aprendizado: prompts dos posts no top 20% (alcance + salvamentos) viram exemplos da marca. */
export async function learnFromTopPosts() {
  const s = await db();
  const { data: rows } = await s
    .from("ig_post_metrics")
    .select("post_id, workspace_id, reach, saves, collected_at")
    .gte("collected_at", new Date(Date.now() - 60 * 864e5).toISOString())
    .limit(5000);
  const best = new Map<string, { ws: string; v: number }>();
  for (const r of (rows ?? []) as any[]) {
    const v = Number(r.reach ?? 0) + 5 * Number(r.saves ?? 0);
    if ((best.get(r.post_id)?.v ?? -1) < v) best.set(r.post_id, { ws: r.workspace_id, v });
  }
  const byWs = new Map<string, { id: string; v: number }[]>();
  for (const [id, b] of best) byWs.set(b.ws, [...(byWs.get(b.ws) ?? []), { id, v: b.v }]);
  let added = 0;
  for (const list of byWs.values()) {
    if (list.length < 5) continue;
    list.sort((a, b) => b.v - a.v);
    const top = list.slice(0, Math.max(1, Math.ceil(list.length * 0.2))).map((x) => x.id);
    const { data: posts } = await s.from("ig_posts").select("id, plan_id, creative_brief, updated_at").in("id", top);
    for (const p of (posts ?? []) as any[]) {
      const prompt = p.creative_brief?.art_direction?.prompt_final;
      if (!prompt || !p.plan_id) continue;
      const { data: plan } = await s.from("ig_content_plans").select("brand_id").eq("id", p.plan_id).maybeSingle();
      if (!plan?.brand_id) continue;
      const { data: brand } = await s.from("brands").select("visual_style").eq("id", plan.brand_id).maybeSingle();
      const vs = ((brand as any)?.visual_style ?? {}) as { exemplos_prompt?: string[] };
      const ex = Array.isArray(vs.exemplos_prompt) ? vs.exemplos_prompt : [];
      if (ex.includes(prompt)) continue;
      await s
        .from("brands")
        .update({ visual_style: { ...vs, exemplos_prompt: [...ex, prompt].slice(-10) } } as never)
        .eq("id", plan.brand_id);
      added++;
    }
  }
  return { added };
}

/** Consulta os provedores para posts com geração assíncrona pendente e conclui os prontos. */
export async function pollPendingMedia() {
  const s = await db();
  const { data } = await s.from("ig_posts").select("*").eq("status", "generating").limit(20);
  const out: { post: string; status: string; error?: string }[] = [];
  for (const post of (data ?? []) as any[]) {
    const pj = post.creative_brief?.pending_job as PendingJob | undefined;
    if (!pj?.jobId) continue;
    try {
      const provider = await resolveProvider(s as any, post.workspace_id, choiceFor(pj.provider));
      const r = await provider.getGenerationStatus(pj.jobId);
      if (r.status === "generating") {
        if (Date.now() - new Date(pj.started_at).getTime() > 60 * 60e3)
          throw new Error("O provedor não concluiu a mídia em 1 hora.");
        out.push({ post: post.id, status: "generating" });
        continue;
      }
      const assetUrl =
        r.assetUrl ?? (r.status === "ready" ? await provider.getAsset(pj.jobId) : null);
      if (r.status !== "ready" || !assetUrl)
        throw new Error("O provedor informou falha na geração da mídia.");
      const media = [
        ...pj.media,
        await libraryItem(
          post,
          { sourceUrl: assetUrl },
          pj.index,
          pj.provider,
          pj.prompts[pj.index] ?? null,
          r.cost ?? 0,
        ),
      ];
      const res = await continueAssets(
        post,
        provider,
        pj.prompts,
        pj.index + 1,
        media,
        pj.cost + (r.cost ?? 0),
        pj.instructions,
      );
      if (res.pending) {
        out.push({ post: post.id, status: "generating" });
        continue;
      }
      await afterMediaReady(post);
      out.push({ post: post.id, status: "ready" });
    } catch (e) {
      const { pending_job: _drop, ...brief } = post.creative_brief ?? {};
      await patchPost(post.id, { status: "failed", last_error: errMsg(e), creative_brief: brief });
      out.push({ post: post.id, status: "failed", error: errMsg(e) });
    }
  }
  return out;
}

/** Após mídia assíncrona pronta: no piloto automático sem aprovação, agenda no horário previsto. */
async function afterMediaReady(post: any) {
  if (post.automation) {
    const { scheduleAutomated } = await import("./auto-calendar.server");
    await scheduleAutomated(post.id).catch((e) => console.error("[instagram] agenda automática falhou:", errMsg(e)));
    return;
  }
  if (!post.plan_id) return;
  const s = await db();
  const { data: plan } = await s
    .from("ig_content_plans")
    .select("auto_publish, requires_approval, status")
    .eq("id", post.plan_id)
    .maybeSingle();
  const ap = await import("./autopilot.server");
  await ap.logEvent({
    workspace_id: post.workspace_id,
    plan_id: post.plan_id,
    post_id: post.id,
    kind: "media",
    message: "Mídia assíncrona concluída.",
  });
  if (
    plan?.auto_publish &&
    !plan.requires_approval &&
    post.scheduled_at &&
    new Date(post.scheduled_at) > new Date()
  ) {
    await schedulePost(post.workspace_id, post.id, post.scheduled_at).catch(() => null);
  }
}

/* ---------------- Aprovação e agenda ---------------- */

export async function approvePost(workspaceId: string, postId: string) {
  const post = await getPost(postId);
  if (post.workspace_id !== workspaceId) throw new Error("Post não encontrado.");
  if (!post.media?.length) throw new Error("Gere a mídia antes de aprovar.");
  await patchPost(postId, {
    status: "approved",
    rejection_reason: null,
    approved_at: new Date().toISOString(),
  });
  try {
    await (await import("./autopilot.server")).afterApproval(workspaceId, postId);
  } catch (e) {
    console.error("[instagram] agendamento pós-aprovação falhou:", errMsg(e));
  }
  return { ok: true };
}

export async function rejectPost(workspaceId: string, postId: string, reason: string) {
  const post = await getPost(postId);
  if (post.workspace_id !== workspaceId) throw new Error("Post não encontrado.");
  await patchPost(postId, { status: "cancelled", rejection_reason: reason });
  return { ok: true };
}

export async function schedulePost(workspaceId: string, postId: string, scheduledAt: string) {
  const post = await getPost(postId);
  if (post.workspace_id !== workspaceId) throw new Error("Post não encontrado.");
  if (!post.media?.length) throw new Error("Gere a mídia antes de agendar.");
  if (!["approved", "ready", "scheduled", "failed"].includes(post.status))
    throw new Error("O post precisa estar aprovado para ser agendado.");
  const s = await db();
  if ((await approvalRequired(post)) && !post.approved_at && post.status !== "approved")
    throw new Error("Este post exige aprovação antes de agendar.");
  await s
    .from("publishing_jobs")
    .update({ status: "cancelled" } as never)
    .eq("ig_post_id", postId)
    .eq("status", "pending");
  const acc = await liveAccount(workspaceId);
  const { error } = await s.from("publishing_jobs").insert({
    workspace_id: workspaceId,
    channel: "instagram_organic",
    ig_post_id: postId,
    target: "instagram",
    status: "pending",
    mode: acc ? "live" : "mock",
    run_at: scheduledAt,
  } as never);
  if (error) throw new Error(error.message);
  await patchPost(postId, { status: "scheduled", scheduled_at: scheduledAt, last_error: null });
  return { ok: true, sandbox: !acc };
}

/* ---------------- Publicação (Graph API) ---------------- */

/** Container ainda em processamento na Meta: a fila tenta de novo em 2 min sem contar tentativa. */
export class ContainerPending extends Error {}

const POLL_BUDGET_MS = 40_000;

async function waitContainer(containerId: string, deadline: number) {
  while (Date.now() < deadline) {
    const r = await graph<{ status_code?: string; status?: string }>(`/${containerId}`, {
      params: { fields: "status_code,status" },
    });
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED")
      throw new Error(`A Meta não processou o vídeo (${r.status_code}): ${r.status ?? ""}`);
    await sleep(
      Math.min(r.status_code === "IN_PROGRESS" ? 5_000 : 3_000, Math.max(0, deadline - Date.now())),
    );
  }
  throw new ContainerPending(
    "A Meta ainda está processando a mídia; nova verificação em 2 minutos.",
  );
}

function fullCaption(post: any) {
  const tags = normalizeHashtags(post.hashtags).map((h) => `#${h}`).join(" ");
  return [post.caption, post.cta, tags].filter(Boolean).join("\n\n").slice(0, 2200);
}

export class RateLimited extends Error {}
export class Guardrail extends Error {}

/** Mídia do gerador simulado (picsum) ou marcada como mock — nunca vai ao ar. */
export const isMockMedia = (m: { url?: string | null; provider?: string | null; source?: string | null }) =>
  m.provider === "mock" || m.source === "mock" || /picsum\.photos/i.test(m.url ?? "");

/** Confere que a URL da mídia responde publicamente (HEAD; alguns servidores só aceitam GET com Range). */
async function assertPublicUrl(url: string) {
  if (!/^https:\/\//i.test(url ?? "")) throw new Guardrail("Mídia sem URL pública válida (HTTPS).");
  let res = await fetch(url, { method: "HEAD" }).catch(() => null);
  if (!res || res.status === 405 || res.status === 403)
    res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } }).catch(() => null);
  if (!res || !(res.ok || res.status === 206))
    throw new Guardrail(
      `A mídia não está acessível publicamente (HTTP ${res?.status ?? "sem resposta"}).`,
    );
}

type PublishResult = { ok: boolean; sandbox: boolean; permalink?: string | null; error?: string };

export async function publishInstagramPost(postId: string): Promise<PublishResult> {
  const post = await getPost(postId);
  return runWithMetaWorkspace(post.workspace_id, () => publishInner(postId, post));
}

async function publishInner(postId: string, post: any): Promise<PublishResult> {
  const format = post.format as IgFormat;
  const media: any[] = [...(post.media ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!media.length) throw new Guardrail("Post sem mídia.");
  const s = await db();

  // Guardrail: nunca publicar sem aprovação quando o plano exige.
  if ((await approvalRequired(post)) && !post.approved_at)
    throw new Guardrail("Post não aprovado — publicação bloqueada.");
  // Guardrail: no máximo 25 publicações em 24h por conta (contagem local).
  const { count } = await s
    .from("ig_posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", post.workspace_id)
    .eq("status", "published")
    .gte("published_at", new Date(Date.now() - 24 * 3600e3).toISOString());
  if ((count ?? 0) >= DAILY_LIMIT)
    throw new RateLimited("Limite de 25 publicações em 24h atingido.");
  // Guardrail: mídia reprovada na validação de qualidade do Instagram não é publicada.
  const assetIds = media.map((m) => m.asset_id).filter(Boolean);
  if (assetIds.length) {
    const { data: assets } = await s
      .from("media_assets" as never)
      .select("id, ig_ready, quality_report, provider, source, url")
      .in("id", assetIds);
    if (((assets ?? []) as any[]).some(isMockMedia))
      throw new Guardrail("Mídia simulada (sem IA real) não pode ser publicada. Gere a mídia de novo com um provedor conectado.");
    const bad = ((assets ?? []) as any[]).find((a) => !a.ig_ready);
    if (bad)
      throw new Guardrail(
        `Mídia fora do padrão do Instagram: ${(bad.quality_report?.issues ?? []).join(" ") || "validação pendente."}`,
      );
  } else {
    const bad = media.find((m) => m.ig_ready === false);
    if (bad)
      throw new Guardrail(`Mídia fora do padrão do Instagram: ${(bad.issues ?? []).join(" ")}`);
  }
  // Guardrail: nunca publicar imagem simulada (foto aleatória de banco de imagens).
  if (media.some(isMockMedia))
    throw new Guardrail("Mídia simulada (sem IA real) não pode ser publicada. Gere a mídia de novo com um provedor conectado.");
  // Guardrail: toda mídia precisa de URL pública válida.
  for (const m of media) await assertPublicUrl(m.url);

  const acc = await liveAccount(post.workspace_id);
  const deadline = Date.now() + POLL_BUDGET_MS;

  // Retomada: container já criado numa execução anterior → só polling + media_publish.
  if (acc && post.ig_creation_id && post.status === "publishing") {
    return finishPublish(postId, acc.ig_user_id as string, post.ig_creation_id, deadline);
  }

  // Sem conta conectada não existe publicação: nunca marcar como publicado de mentira.
  if (!acc)
    throw new Guardrail("Nenhuma conta do Instagram conectada nesta empresa. Conecte em Instagram → Visão geral e agende de novo.");

  const ig = acc.ig_user_id as string;
  const limit = await graph<{ data?: { quota_usage?: number }[] }>(
    `/${ig}/content_publishing_limit`,
    { params: { fields: "quota_usage" } },
  ).catch((e) => {
    if (e instanceof MetaError && e.code === 190) throw e;
    return null;
  });
  if ((limit?.data?.[0]?.quota_usage ?? 0) >= DAILY_LIMIT)
    throw new RateLimited("Limite de 25 publicações em 24h atingido.");

  await patchPost(postId, { status: "publishing", last_error: null });
  const caption = fullCaption(post);
  let creationId: string;

  if (format === "feed_image") {
    creationId = (
      await graph<{ id: string }>(`/${ig}/media`, {
        method: "POST",
        params: { image_url: media[0].url, caption },
      })
    ).id;
  } else if (format === "feed_carousel") {
    const children: string[] = [];
    for (const m of media.slice(0, 10)) {
      const params: Record<string, unknown> = { is_carousel_item: "true" };
      if (m.type === "video") Object.assign(params, { media_type: "VIDEO", video_url: m.url });
      else params["image_url"] = m.url;
      const c = await graph<{ id: string }>(`/${ig}/media`, { method: "POST", params });
      if (m.type === "video") await waitContainer(c.id, deadline);
      children.push(c.id);
    }
    creationId = (
      await graph<{ id: string }>(`/${ig}/media`, {
        method: "POST",
        params: { media_type: "CAROUSEL", children: children.join(","), caption },
      })
    ).id;
  } else if (format === "reel") {
    creationId = (
      await graph<{ id: string }>(`/${ig}/media`, {
        method: "POST",
        params: {
          media_type: "REELS",
          video_url: media[0].url,
          caption,
          share_to_feed: "true",
          ...(media[0].cover_url ? { cover_url: media[0].cover_url } : {}),
        },
      })
    ).id;
  } else {
    const video = format === "story_video";
    creationId = (
      await graph<{ id: string }>(`/${ig}/media`, {
        method: "POST",
        params: { media_type: "STORIES", [video ? "video_url" : "image_url"]: media[0].url },
      })
    ).id;
  }

  // Salva o container antes do polling para poder retomar na próxima execução.
  await patchPost(postId, { ig_creation_id: creationId });
  return finishPublish(postId, ig, creationId, deadline);
}

async function finishPublish(postId: string, ig: string, creationId: string, deadline: number) {
  // Imagens também passam por processamento na Meta: espera o container ficar FINISHED.
  await waitContainer(creationId, deadline);
  const published = await graph<{ id: string }>(`/${ig}/media_publish`, {
    method: "POST",
    params: { creation_id: creationId },
  });
  const info = await graph<{ permalink?: string }>(`/${published.id}`, {
    params: { fields: "permalink" },
  }).catch(() => ({ permalink: undefined }));
  await patchPost(postId, {
    status: "published",
    published_at: new Date().toISOString(),
    ig_media_id: published.id,
    ig_permalink: info.permalink ?? null,
    ig_creation_id: null,
    last_error: null,
  });
  return { ok: true, sandbox: false, permalink: info.permalink ?? null };
}

/* ---------------- Métricas ---------------- */

// Métricas atuais da Graph API (v22+): impressions/plays/exits foram descontinuadas; "views" substitui.
const METRICS: Record<IgFormat, string[]> = {
  reel: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"],
  feed_image: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "profile_visits"],
  feed_carousel: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"],
  story_image: ["views", "reach", "replies", "shares", "total_interactions", "navigation"],
  story_video: ["views", "reach", "replies", "shares", "total_interactions", "navigation"],
};
const ESSENTIAL: Record<"story" | "post", string[]> = {
  story: ["views", "reach", "replies"],
  post: ["views", "reach", "likes", "comments", "saved", "shares"],
};

export async function collectPostMetrics(postId: string, label?: string) {
  const post = await getPost(postId);
  return runWithMetaWorkspace(post.workspace_id, () => metricsInner(postId, post, label));
}

async function metricsInner(postId: string, post: any, label?: string) {
  if (!post.ig_media_id) throw new Error("Post ainda não publicado.");
  if (String(post.ig_media_id).startsWith("sim_")) throw new Error("Post antigo do modo simulado: não existe no Instagram.");
  const s = await db();
  const values: Record<string, number> = {};
  const story = String(post.format).startsWith("story");
  let raw: any;
  try {
    raw = await graph(`/${post.ig_media_id}/insights`, { params: { metric: METRICS[post.format as IgFormat].join(",") } });
  } catch {
    // Alguma métrica não vale para este tipo de mídia/conta: tenta o conjunto essencial.
    raw = await graph(`/${post.ig_media_id}/insights`, { params: { metric: ESSENTIAL[story ? "story" : "post"].join(",") } });
  }
  for (const m of raw?.data ?? []) {
    if (m.name === "navigation") {
      // navigation vem quebrado por tipo (avançar, voltar, sair): guarda o total e cada parte.
      for (const b of m.total_value?.breakdowns?.[0]?.results ?? [])
        values[`navigation_${String(b.dimension_values?.[0] ?? "").toLowerCase()}`] = Number(b.value ?? 0);
      values["navigation"] = Number(m.total_value?.value ?? 0);
      continue;
    }
    values[m.name] = Number(m.values?.[0]?.value ?? m.total_value?.value ?? 0);
  }
  await s.from("ig_post_metrics").insert({
    workspace_id: post.workspace_id,
    post_id: postId,
    reach: values["reach"] ?? null,
    impressions: values["views"] ?? null,
    likes: values["likes"] ?? null,
    comments: values["comments"] ?? (story ? (values["replies"] ?? null) : null),
    saves: values["saved"] ?? null,
    shares: values["shares"] ?? null,
    plays: values["views"] ?? null,
    profile_visits: values["profile_visits"] ?? null,
    raw: { label: label ?? "manual", ...values, response: raw },
  } as never);
  if (label)
    await patchPost(postId, { metrics_collected: [...(post.metrics_collected ?? []), label] });
  return { ok: true, values };
}

const WINDOWS: [string, number][] = [
  ["1h", 3600e3],
  ["24h", 24 * 3600e3],
  ["7d", 7 * 24 * 3600e3],
];
// Stories somem em 24 h: coleta com 1 h e com 20 h (antes de expirar).
const STORY_WINDOWS: [string, number][] = [
  ["1h", 3600e3],
  ["20h", 20 * 3600e3],
];

export async function collectDueMetrics() {
  const s = await db();
  const since = new Date(Date.now() - 8 * 24 * 3600e3).toISOString();
  const { data } = await s
    .from("ig_posts")
    .select("id, format, published_at, metrics_collected, ig_media_id")
    .eq("status", "published")
    .gte("published_at", since)
    .limit(200);
  let done = 0;
  for (const p of (data ?? []) as any[]) {
    if (String(p.ig_media_id ?? "").startsWith("sim_")) continue;
    const age = Date.now() - new Date(p.published_at).getTime();
    const story = String(p.format).startsWith("story");
    if (story && age > 23.5 * 3600e3) continue;
    const due = (story ? STORY_WINDOWS : WINDOWS).filter(
      ([l, ms]) => age >= ms && !(p.metrics_collected ?? []).includes(l),
    ).pop();
    if (!due) continue;
    try {
      await collectPostMetrics(p.id, due[0]);
      done++;
    } catch (e) {
      console.error("[instagram] métricas falharam:", errMsg(e));
    }
  }
  return done;
}

/* ---------------- 5.2 Insights da conta ---------------- */

/** Seguidores e métricas diárias da conta (últimos 30 dias), salvos em ig_account_insights. */
export async function collectAccountInsights(workspaceId: string) {
  const acc = await liveAccount(workspaceId);
  if (!acc) return { skipped: "sem conta conectada" };
  return runWithMetaWorkspace(workspaceId, async () => {
    const ig = acc.ig_user_id as string;
    const s = await db();
    const profile = await graph<{ followers_count?: number; follows_count?: number; media_count?: number; username?: string }>(`/${ig}`, {
      params: { fields: "followers_count,follows_count,media_count,username" },
    });
    const until = Math.floor(Date.now() / 1000);
    const since = until - 29 * 86400;
    const daily: Record<string, Record<string, number>> = {};
    // reach e follower_count são séries diárias; views/profile_views/website_clicks vêm por dia com total_value.
    const series = await graph<{ data?: any[] }>(`/${ig}/insights`, {
      params: { metric: "reach,follower_count", period: "day", since, until },
    }).catch(() => ({ data: [] as any[] }));
    for (const m of series.data ?? [])
      for (const v of m.values ?? []) {
        const d = String(v.end_time ?? "").slice(0, 10);
        if (!d) continue;
        daily[d] = { ...(daily[d] ?? {}), [m.name]: Number(v.value ?? 0) };
      }
    // Métricas de total por dia: 1 chamada por dia e métrica, então só os dias que ainda faltam (máx. 7).
    const { count: have } = await s
      .from("ig_account_insights" as never)
      .select("date", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    const backDays = (have ?? 0) > 0 ? 2 : 7;
    for (const metric of ["views", "profile_views", "website_clicks", "accounts_engaged", "total_interactions"]) {
      for (let day = 0; day < backDays; day += 1) {
        const dSince = until - (backDays - day) * 86400;
        const r = await graph<{ data?: any[] }>(`/${ig}/insights`, {
          params: { metric, period: "day", metric_type: "total_value", since: dSince, until: dSince + 86400 },
        }).catch(() => null);
        const val = r?.data?.[0]?.total_value?.value;
        if (val === undefined) {
          if (day === 0) break; // métrica indisponível nesta conta
          continue;
        }
        const d = new Date((dSince + 86400) * 1000).toISOString().slice(0, 10);
        daily[d] = { ...(daily[d] ?? {}), [metric]: Number(val) };
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    daily[today] = { ...(daily[today] ?? {}), followers_total: Number(profile.followers_count ?? 0) };
    const rows = Object.entries(daily).map(([date, v]) => ({
      workspace_id: workspaceId,
      date,
      followers_total: v["followers_total"] ?? null,
      new_followers: v["follower_count"] ?? null,
      reach: v["reach"] ?? null,
      views: v["views"] ?? null,
      profile_views: v["profile_views"] ?? null,
      website_clicks: v["website_clicks"] ?? null,
      accounts_engaged: v["accounts_engaged"] ?? null,
      interactions: v["total_interactions"] ?? null,
    }));
    if (rows.length) {
      const { error } = await s.from("ig_account_insights" as never).upsert(rows as never, { onConflict: "workspace_id,date" });
      if (error) throw new Error(error.message);
    }
    return { days: rows.length, followers: profile.followers_count ?? null };
  });
}

export async function collectAllAccountInsights() {
  const s = await db();
  const { data } = await s.from("instagram_accounts").select("workspace_id").eq("status", "connected");
  const out: { workspace: string; days?: number; error?: string }[] = [];
  for (const r of (data ?? []) as { workspace_id: string }[]) {
    try {
      const x = await collectAccountInsights(r.workspace_id);
      out.push({ workspace: r.workspace_id, days: (x as { days?: number }).days ?? 0 });
    } catch (e) {
      out.push({ workspace: r.workspace_id, error: errMsg(e) });
    }
  }
  return out;
}

/* ---------------- Fila ---------------- */

export async function runPublishingQueue() {
  const s = await db();
  const now = new Date().toISOString();
  // Libera travas antigas (execução interrompida).
  await s
    .from("publishing_jobs")
    .update({ status: "pending", locked_at: null } as never)
    .eq("channel", "instagram_organic")
    .eq("status", "running")
    .lt("locked_at", new Date(Date.now() - 15 * 60e3).toISOString());

  const { data: jobs } = await s
    .from("publishing_jobs")
    .select("id, ig_post_id, attempts, log")
    .eq("channel", "instagram_organic")
    .eq("status", "pending")
    .lte("run_at", now)
    .order("run_at")
    // Poucos por execução: cada publicação pode levar até ~40 s de processamento na Meta.
    .limit(4);

  const results: { job: string; status: string; error?: string }[] = [];
  for (const job of (jobs ?? []) as any[]) {
    // Lock otimista: só segue se ninguém pegou antes.
    const { data: locked } = await s
      .from("publishing_jobs")
      .update({
        status: "running",
        locked_at: new Date().toISOString(),
        attempts: job.attempts + 1,
      } as never)
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id");
    if (!locked?.length) continue;
    const stamp = new Date().toISOString();
    try {
      const r = await publishInstagramPost(job.ig_post_id);
      await s
        .from("publishing_jobs")
        .update({
          status: "done",
          locked_at: null,
          mode: r.sandbox ? "mock" : "live",
          log: `${job.log ?? ""}\n[${stamp}] publicado ${r.permalink ?? ""}`.trim(),
        } as never)
        .eq("id", job.id);
      const pub = await getPost(job.ig_post_id).catch(() => null);
      if (pub)
        await (
          await import("./autopilot.server")
        ).logEvent({
          workspace_id: pub.workspace_id,
          plan_id: pub.plan_id,
          post_id: pub.id,
          kind: "publish",
          message: `Publicado no Instagram ${r.permalink ?? ""}`.trim(),
        });
      results.push({ job: job.id, status: "done" });
    } catch (e) {
      const msg = errMsg(e);
      if (e instanceof ContainerPending) {
        await s
          .from("publishing_jobs")
          .update({
            status: "pending",
            locked_at: null,
            attempts: job.attempts,
            run_at: new Date(Date.now() + 2 * 60e3).toISOString(),
            log: `${job.log ?? ""}\n[${stamp}] ${msg}`.trim(),
          } as never)
          .eq("id", job.id);
        results.push({ job: job.id, status: "processing" });
        continue;
      }
      const attempts = job.attempts + 1;
      const rate = e instanceof RateLimited;
      const tokenExpired = e instanceof MetaError && e.code === 190;
      const blocked = e instanceof Guardrail;
      const retry = !tokenExpired && !blocked && (rate || attempts < MAX_ATTEMPTS);
      const ap = await import("./autopilot.server");
      const failed = await getPost(job.ig_post_id).catch(() => null);
      if (tokenExpired && failed) await ap.handleTokenExpired(failed.workspace_id, msg);
      if (failed)
        await ap.logEvent({
          workspace_id: failed.workspace_id,
          plan_id: failed.plan_id,
          post_id: failed.id,
          kind: blocked ? "guardrail" : "failure",
          level: retry ? "warn" : "error",
          message: `${retry ? "Falha (nova tentativa)" : "Falha"} ao publicar: ${msg}`,
        });
      const delay = rate ? 60 * 60e3 : 5 * 60e3 * 2 ** (attempts - 1); // backoff 5, 10 min
      await s
        .from("publishing_jobs")
        .update({
          status: retry ? "pending" : "failed",
          locked_at: null,
          attempts: rate ? job.attempts : attempts,
          run_at: retry ? new Date(Date.now() + delay).toISOString() : undefined,
          log: `${job.log ?? ""}\n[${stamp}] ${msg}`.trim(),
        } as never)
        .eq("id", job.id);
      const post = await getPost(job.ig_post_id).catch(() => null);
      await patchPost(job.ig_post_id, {
        status: retry ? "scheduled" : "failed",
        last_error: msg,
        retry_count: (post?.retry_count ?? 0) + (rate ? 0 : 1),
        ...(retry ? { scheduled_at: new Date(Date.now() + delay).toISOString() } : {}),
      });
      results.push({ job: job.id, status: retry ? "retry" : "failed", error: msg });
    }
  }
  return results;
}

/* ---------------- Extras da interface ---------------- */

export async function suggestPillars(
  workspaceId: string,
  input: {
    brandId?: string | null | undefined;
    objective?: string | undefined;
    tone?: string | undefined;
    audience?: string | undefined;
  },
) {
  const brand = await brandFor(input.brandId ?? null);
  const prompt = [
    "Sugira 5 pilares de conteúdo para Instagram, em português do Brasil, curtos (2 a 4 palavras).",
    `Objetivo: ${input.objective ?? "-"}. Tom: ${input.tone ?? "-"}. Público: ${input.audience ?? "-"}.`,
    brand ? `MARCA: ${JSON.stringify(brand)}` : "",
    'Devolva SOMENTE JSON {"pillars":["..."]}.',
  ].join("\n");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["pillars"],
    properties: { pillars: { type: "array", items: { type: "string" } } },
  };
  const { json } = await aiJson(workspaceId, "auto", prompt, schema, "ig_pillars");
  return { pillars: ((json?.pillars ?? []) as string[]).slice(0, 5) };
}

export async function uploadOwnMedia(workspaceId: string, postId: string, file: File) {
  const post = await getPost(postId);
  if (post.workspace_id !== workspaceId) throw new Error("Post não encontrado.");
  const video = file.type.startsWith("video/");
  if (!video && !file.type.startsWith("image/"))
    throw new Error("Envie uma imagem ou um vídeo MP4.");
  if (file.size > 100 * 1024 * 1024) throw new Error("Arquivo acima de 100 MB.");
  const format = post.format as IgFormat;
  const current: any[] = format === "feed_carousel" ? (post.media ?? []) : [];
  const item = await libraryItem(
    post,
    { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type },
    current.length,
    "upload",
    null,
    0,
    file.name.replace(/\.[^.]+$/, ""),
  );
  const media = [...current, item];
  await patchPost(postId, {
    media,
    status: post.status === "idea" || post.status === "failed" ? "pending_approval" : post.status,
    ai_generation_log: await appendLog(post, { step: "upload", file: file.name }),
  });
  return { ok: true };
}

/* ---------------- Importar histórico ---------------- */

function formatFromMeta(mediaType?: string, product?: string): IgFormat {
  if (product === "STORY") return mediaType === "VIDEO" ? "story_video" : "story_image";
  if (mediaType === "CAROUSEL_ALBUM") return "feed_carousel";
  if (mediaType === "VIDEO" || product === "REELS") return "reel";
  return "feed_image";
}

/** Importa os últimos 30 itens publicados na conta e coleta os insights de cada um. */
export async function syncInstagramHistory(workspaceId: string) {
  return runWithMetaWorkspace(workspaceId, async () => {
    const acc = await liveAccount(workspaceId);
    if (!acc) throw new Error("Conecte uma conta do Instagram antes de importar o histórico.");
    const r = await graph<{ data?: any[] }>(`/${acc.ig_user_id}/media`, {
      params: {
        fields:
          "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url",
        limit: "30",
      },
    });
    const items = (r.data ?? []).slice(0, 30);
    const s = await db();
    const { data: existing } = await s
      .from("ig_posts")
      .select("id, ig_media_id")
      .eq("workspace_id", workspaceId)
      .in("ig_media_id", items.length ? items.map((i) => i.id) : ["-"]);
    const known = new Map((existing ?? []).map((e: any) => [e.ig_media_id, e.id]));
    const fresh = items.filter((i) => !known.has(i.id));
    let imported = 0;
    if (fresh.length) {
      const rows = fresh.map((i) => {
        const caption = String(i.caption ?? "");
        const hashtags = [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.slice(1)))].slice(0, 30);
        const video = i.media_type === "VIDEO";
        return {
          workspace_id: workspaceId,
          format: formatFromMeta(i.media_type, i.media_product_type),
          status: "published",
          source: "instagram_import",
          ig_media_id: i.id,
          ig_permalink: i.permalink ?? null,
          published_at: i.timestamp ?? new Date().toISOString(),
          caption: caption.replace(/#[\p{L}\p{N}_]+/gu, "").trim().slice(0, 2200) || null,
          hashtags,
          theme: caption.split("\n")[0]?.slice(0, 120) || "Post importado",
          media: [
            {
              url: i.media_url ?? i.thumbnail_url ?? null,
              thumbnail_url: i.thumbnail_url ?? null,
              type: video ? "video" : "image",
              order: 0,
            },
          ],
          creative_brief: { imported: true },
          metrics_collected: ["1h", "24h", "7d"],
        };
      });
      const { data: ins, error } = await s.from("ig_posts").insert(rows as never).select("id, ig_media_id");
      if (error) throw new Error(error.message);
      for (const x of (ins ?? []) as any[]) known.set(x.ig_media_id, x.id);
      imported = ins?.length ?? 0;
      // 6.5 Os posts antigos também entram na Biblioteca (o link do Instagram expira; o arquivo fica salvo).
      const { ingestAsset } = await import("@/lib/media/assets.server");
      const { targetForIgFormat } = await import("@/lib/media/formats");
      for (const i of fresh) {
        const url = i.media_url ?? i.thumbnail_url;
        if (!url) continue;
        try {
          const format = formatFromMeta(i.media_type, i.media_product_type);
          const video = i.media_type === "VIDEO" && !!i.media_url;
          await ingestAsset({
            workspaceId,
            kind: video ? "video" : "image",
            targetFormat: targetForIgFormat(format),
            source: "instagram",
            sourceUrl: url,
            title: String(i.caption ?? "Post do Instagram").split("\n")[0]!.slice(0, 120) || "Post do Instagram",
            prompt: null,
            provider: "instagram",
            igPostId: known.get(i.id) ?? null,
            normalize: false,
            status: "approved",
          });
        } catch (e) {
          console.warn("[ig-sync] mídia não foi para a biblioteca", i.id, errMsg(e));
        }
      }
    }
    let metrics = 0;
    for (const id of known.values()) {
      try {
        await collectPostMetrics(id, "import");
        metrics++;
      } catch (e) {
        console.error("[ig-sync] métricas", id, errMsg(e));
      }
    }
    return { ok: true as const, imported, total: items.length, metrics };
  });
}
