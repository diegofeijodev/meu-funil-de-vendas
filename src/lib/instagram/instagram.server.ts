/**
 * Publicação orgânica no Instagram (somente servidor).
 * Token da Meta vem do cofre (metaConfig) — nunca é salvo em instagram_accounts.
 */
import { graph, metaConfig, MetaError } from "@/lib/meta/graph.server";
import { getWorkspaceAiKey } from "@/lib/ai-keys.server";
import { viaGateway, viaGemini, viaOpenAI } from "@/lib/copy-ai.server";
import { resolveProvider, type ProviderChoice } from "@/lib/creative.server";

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
const ASPECT: Record<IgFormat, string> = {
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
  const { error } = await s.from("ig_posts").update(patch as never).eq("id", id);
  if (error) throw new Error(error.message);
}

async function appendLog(post: any, entry: Record<string, unknown>) {
  const log = Array.isArray(post.ai_generation_log) ? post.ai_generation_log : [];
  return [...log, { at: new Date().toISOString(), ...entry }].slice(-50);
}

/* ---------------- Conta ---------------- */

export async function connectInstagramAccount(workspaceId: string, pageIdOverride?: string | null) {
  const s = await db();
  const cfg = await metaConfig();
  const pageId = pageIdOverride || cfg.pageId;
  try {
    if (!cfg.token) throw new Error("Salve as credenciais da Meta em Integrações antes de conectar o Instagram.");
    if (!pageId) throw new Error("ID da Página do Facebook não configurado.");
    const page = await graph<{ instagram_business_account?: { id: string } }>(`/${pageId}`, {
      params: { fields: "instagram_business_account" },
    });
    const igId = page.instagram_business_account?.id;
    if (!igId) throw new Error("Esta Página não tem uma conta profissional do Instagram vinculada.");
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
    const { error } = await s.from("instagram_accounts").upsert(row as never, { onConflict: "workspace_id" });
    if (error) throw new Error(error.message);
    return { ok: true as const, username: row.username, igUserId: igId };
  } catch (e) {
    await s
      .from("instagram_accounts")
      .upsert({ workspace_id: workspaceId, facebook_page_id: pageId, status: "error", last_error: errMsg(e) } as never, {
        onConflict: "workspace_id",
      });
    return { ok: false as const, error: errMsg(e) };
  }
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

async function aiJson(workspaceId: string, engine: Engine, prompt: string, schema: Record<string, unknown>, name: string) {
  const [o, g] = await Promise.all([getWorkspaceAiKey(workspaceId, "openai"), getWorkspaceAiKey(workspaceId, "gemini")]);
  // Chaves do cliente primeiro; se falharem (sem crédito, inválida), segue para a próxima opção.
  if ((engine === "chatgpt" || engine === "auto") && o) {
    try { return { json: await viaOpenAI(o, prompt), provider: "openai_own" }; }
    catch (e) { console.warn("[instagram] chave OpenAI falhou:", errMsg(e)); }
  }
  if ((engine === "gemini" || engine === "auto") && g) {
    try { return { json: await viaGemini(g, prompt), provider: "gemini_own" }; }
    catch (e) { console.warn("[instagram] chave Gemini falhou:", errMsg(e)); }
  }
  return { json: await viaGateway(prompt, schema, name), provider: "lovable_ai" };
}

const POST_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["format", "scheduled_at", "theme", "hook", "caption", "hashtags", "cta", "image_prompt", "slides"],
  properties: {
    format: { type: "string", enum: ["feed_image", "feed_carousel", "reel", "story_image", "story_video"] },
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
  properties: { caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } }, cta: { type: "string" } },
};

async function brandFor(brandId: string | null) {
  if (!brandId) return null;
  const s = await db();
  const { data } = await s.from("brands").select("*").eq("id", brandId).maybeSingle();
  return data;
}

export async function generateContentCalendar(workspaceId: string, planId: string, weeks: number, engine: Engine) {
  const s = await db();
  const { data: plan } = await s.from("ig_content_plans").select("*").eq("id", planId).eq("workspace_id", workspaceId).maybeSingle();
  if (!plan) throw new Error("Plano de conteúdo não encontrado.");
  const brand = await brandFor(plan.brand_id);
  const start = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const prompt = [
    "Você é estrategista de conteúdo de Instagram no Brasil. Escreva em português do Brasil.",
    `Crie o calendário de ${weeks} semana(s) começando em ${start} (fuso America/Sao_Paulo, use ISO 8601 com -03:00).`,
    `Frequência semanal por formato: ${JSON.stringify(plan.posting_frequency)} (feed = feed_image ou feed_carousel; reels = reel; stories = story_image ou story_video).`,
    `Horários preferidos: ${JSON.stringify(plan.preferred_times)}.`,
    "Para cada post: format, scheduled_at, theme, hook, caption (com quebras de linha), hashtags (15 a 25, sem #, misturando nicho, amplas e locais),",
    "cta, image_prompt (prompt visual detalhado; para reels/story_video descreva o vídeo cena a cena), slides (3 a 7 prompts só para feed_carousel, senão vazio).",
    "Proporções: 1:1 feed, 4:5 carrossel, 9:16 reels/stories.",
    `Objetivo: ${plan.objective ?? "-"}. Tom de voz: ${plan.tone_of_voice ?? "-"}. Pilares: ${JSON.stringify(plan.content_pillars)}.`,
    plan.pillar_weights && Object.keys(plan.pillar_weights).length
      ? `Distribua os posts entre os pilares proporcionalmente a estes pesos (definidos pelo desempenho): ${JSON.stringify(plan.pillar_weights)}.`
      : "",
    `Estratégia de hashtags: ${JSON.stringify(plan.hashtag_strategy)}. CTA padrão: ${plan.cta_default ?? "-"}.`,
    brand ? `MARCA: ${JSON.stringify(brand)}` : "",
    'Devolva SOMENTE JSON estrito no formato {"posts":[...]}.',
  ].join("\n");
  const { json, provider } = await aiJson(workspaceId, engine, prompt, CALENDAR_SCHEMA, "ig_calendar");
  const posts = Array.isArray(json?.posts) ? json.posts : [];
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
      theme: p.theme ?? null,
      hook: p.hook ?? null,
      caption: p.caption ?? null,
      hashtags: (p.hashtags ?? []).map((h: string) => String(h).replace(/^#/, "")).slice(0, 30),
      cta: p.cta ?? plan.cta_default ?? null,
      creative_brief: { prompt: p.image_prompt ?? "", slides: p.slides ?? [], aspect_ratio: ASPECT[format] },
      ai_provider: provider,
      ai_generation_log: [{ at: new Date().toISOString(), step: "calendar", provider }],
    };
  });
  const { data, error } = await s.from("ig_posts").insert(rows as never).select("id");
  if (error) throw new Error(error.message);
  return { created: data?.length ?? 0, provider };
}

export async function regenerateCaption(workspaceId: string, postId: string, instructions: string | undefined, engine: Engine) {
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
    plan ? `Tom: ${plan.tone_of_voice ?? "-"}. Hashtags: ${JSON.stringify(plan.hashtag_strategy)}.` : "",
    brand ? `MARCA: ${JSON.stringify(brand)}` : "",
    'Devolva SOMENTE JSON {"caption":"...","hashtags":[15 a 25 sem #],"cta":"..."}.',
  ].join("\n");
  const { json, provider } = await aiJson(workspaceId, engine, prompt, CAPTION_SCHEMA, "ig_caption");
  await patchPost(postId, {
    caption: json.caption,
    hashtags: (json.hashtags ?? []).map((h: string) => String(h).replace(/^#/, "")),
    cta: json.cta ?? post.cta,
    ai_generation_log: await appendLog(post, { step: "caption", provider, instructions }),
  });
  return { ok: true };
}

/* ---------------- Mídia ---------------- */

async function storeToIgMedia(workspaceId: string, postId: string, sourceUrl: string, video: boolean) {
  const res = await fetch(sourceUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`Não foi possível baixar a mídia gerada (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? (video ? "video/mp4" : "image/jpeg");
  const ext = video ? "mp4" : ct.includes("png") ? "png" : "jpg";
  const path = `${workspaceId}/${postId}/${crypto.randomUUID()}.${ext}`;
  const s = await db();
  const { error } = await s.storage.from(BUCKET).upload(path, bytes, { contentType: video ? "video/mp4" : ct, upsert: false });
  if (error) throw new Error(`Falha ao salvar a mídia: ${error.message}`);
  // Bucket privado: link assinado de 1 ano é público para a Graph API buscar.
  const { data, error: e2 } = await s.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  if (e2 || !data) throw new Error("Falha ao gerar o link da mídia.");
  return data.signedUrl;
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
): Promise<{ ok: true; items: number; provider: string; pending?: boolean }> {
  const format = post.format as IgFormat;
  const s = await db();
  const [w, h] = ASPECT[format] === "1:1" ? [1080, 1080] : ASPECT[format] === "4:5" ? [1080, 1350] : [1080, 1920];
  for (let i = start; i < prompts.length; i++) {
    const req = {
      finalPrompt: `${prompts[i]} ${format === "feed_carousel" ? `(slide ${i + 1} de ${prompts.length})` : ""}`.trim(),
      aspectRatio: ASPECT[format],
      kind: (isVideo(format) ? "video" : "image") as "image" | "video",
    };
    const r = isVideo(format) ? await provider.generateVideo(req) : await provider.generateImage(req);
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
    if (r.status !== "ready" || !r.assetUrl) throw new Error("O provedor não devolveu a mídia pronta.");
    cost += r.cost;
    const url = await storeToIgMedia(post.workspace_id, post.id, r.assetUrl, isVideo(format));
    media = [
      ...media,
      { url, type: isVideo(format) ? "video" : "image", order: i, width: w, height: h, duration: isVideo(format) ? 8 : null },
    ];
  }
  const { data: plan } = post.plan_id
    ? await s.from("ig_content_plans").select("requires_approval").eq("id", post.plan_id).maybeSingle()
    : { data: null as any };
  const { pending_job: _drop, ...brief } = post.creative_brief ?? {};
  await patchPost(post.id, {
    media,
    creative_brief: brief,
    status: plan?.requires_approval === false ? "ready" : "pending_approval",
    ai_provider: provider.id,
    ai_generation_log: await appendLog(post, {
      step: "media",
      provider: provider.id,
      items: media.length,
      cost,
      instructions,
    }),
  });
  return { ok: true, items: media.length, provider: provider.id };
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
  await patchPost(postId, { status: "generating", last_error: null });
  try {
    const provider = await resolveProvider(s as any, workspaceId, providerChoice);
    const brief = post.creative_brief ?? {};
    const base = [brief.prompt || post.theme || "Post de Instagram", instructions, brand ? `Marca: ${brand.name}.` : null]
      .filter(Boolean)
      .join(" ");
    const prompts: string[] =
      format === "feed_carousel" ? (brief.slides?.length ? brief.slides : [base, base, base]).slice(0, 10) : [base];
    return await continueAssets(post, provider, prompts, 0, [], 0, instructions);
  } catch (e) {
    console.error("[instagram] mídia falhou:", errMsg(e));
    await patchPost(postId, { status: "failed", last_error: errMsg(e) });
    return { ok: false as const, error: errMsg(e) };
  }
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
      const assetUrl = r.assetUrl ?? (r.status === "ready" ? await provider.getAsset(pj.jobId) : null);
      if (r.status !== "ready" || !assetUrl) throw new Error("O provedor informou falha na geração da mídia.");
      const format = post.format as IgFormat;
      const [w, h] = ASPECT[format] === "1:1" ? [1080, 1080] : ASPECT[format] === "4:5" ? [1080, 1350] : [1080, 1920];
      const url = await storeToIgMedia(post.workspace_id, post.id, assetUrl, isVideo(format));
      const media = [
        ...pj.media,
        { url, type: isVideo(format) ? "video" : "image", order: pj.index, width: w, height: h, duration: isVideo(format) ? 8 : null },
      ];
      const res = await continueAssets(post, provider, pj.prompts, pj.index + 1, media, pj.cost + (r.cost ?? 0), pj.instructions);
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
  if (plan?.auto_publish && !plan.requires_approval && post.scheduled_at && new Date(post.scheduled_at) > new Date()) {
    await schedulePost(post.workspace_id, post.id, post.scheduled_at).catch(() => null);
  }
}

/* ---------------- Aprovação e agenda ---------------- */

export async function approvePost(workspaceId: string, postId: string) {
  const post = await getPost(postId);
  if (post.workspace_id !== workspaceId) throw new Error("Post não encontrado.");
  if (!post.media?.length) throw new Error("Gere a mídia antes de aprovar.");
  await patchPost(postId, { status: "approved", rejection_reason: null, approved_at: new Date().toISOString() });
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
  if (post.plan_id) {
    const { data: plan } = await s.from("ig_content_plans").select("requires_approval").eq("id", post.plan_id).maybeSingle();
    if (plan?.requires_approval && !post.approved_at && post.status !== "approved")
      throw new Error("Este plano exige aprovação antes de agendar.");
  }
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

async function waitContainer(containerId: string) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const r = await graph<{ status_code?: string; status?: string }>(`/${containerId}`, { params: { fields: "status_code,status" } });
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED")
      throw new Error(`A Meta não processou o vídeo (${r.status_code}): ${r.status ?? ""}`);
    await sleep(r.status_code === "IN_PROGRESS" ? 5_000 : 3_000);
  }
  throw new Error("A Meta demorou mais de 5 minutos para processar o vídeo.");
}

function fullCaption(post: any) {
  const tags = (post.hashtags ?? []).map((h: string) => `#${h}`).join(" ");
  return [post.caption, post.cta, tags].filter(Boolean).join("\n\n").slice(0, 2200);
}

export class RateLimited extends Error {}
export class Guardrail extends Error {}

/** Confere que a URL da mídia responde publicamente (HEAD; alguns servidores só aceitam GET com Range). */
async function assertPublicUrl(url: string) {
  if (!/^https:\/\//i.test(url ?? "")) throw new Guardrail("Mídia sem URL pública válida (HTTPS).");
  let res = await fetch(url, { method: "HEAD" }).catch(() => null);
  if (!res || res.status === 405 || res.status === 403)
    res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } }).catch(() => null);
  if (!res || !(res.ok || res.status === 206)) throw new Guardrail(`A mídia não está acessível publicamente (HTTP ${res?.status ?? "sem resposta"}).`);
}

export async function publishInstagramPost(postId: string): Promise<{ ok: boolean; sandbox: boolean; permalink?: string | null; error?: string }> {
  const post = await getPost(postId);
  const format = post.format as IgFormat;
  const media: any[] = [...(post.media ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!media.length) throw new Guardrail("Post sem mídia.");
  const s = await db();

  // Guardrail: nunca publicar sem aprovação quando o plano exige.
  if (post.plan_id) {
    const { data: plan } = await s.from("ig_content_plans").select("requires_approval").eq("id", post.plan_id).maybeSingle();
    if (plan?.requires_approval && !post.approved_at) throw new Guardrail("Post não aprovado — publicação bloqueada.");
  }
  // Guardrail: no máximo 25 publicações em 24h por conta (contagem local).
  const { count } = await s
    .from("ig_posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", post.workspace_id)
    .eq("status", "published")
    .gte("published_at", new Date(Date.now() - 24 * 3600e3).toISOString());
  if ((count ?? 0) >= DAILY_LIMIT) throw new RateLimited("Limite de 25 publicações em 24h atingido.");
  // Guardrail: toda mídia precisa de URL pública válida.
  for (const m of media) await assertPublicUrl(m.url);

  const acc = await liveAccount(post.workspace_id);

  if (!acc) {
    const fake = `sim_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await patchPost(postId, { status: "published", published_at: new Date().toISOString(), ig_media_id: fake, ig_permalink: null, last_error: null });
    return { ok: true, sandbox: true };
  }

  const ig = acc.ig_user_id as string;
  const limit = await graph<{ data?: { quota_usage?: number }[] }>(`/${ig}/content_publishing_limit`, { params: { fields: "quota_usage" } }).catch((e) => {
    if (e instanceof MetaError && e.code === 190) throw e;
    return null;
  });
  if ((limit?.data?.[0]?.quota_usage ?? 0) >= DAILY_LIMIT) throw new RateLimited("Limite de 25 publicações em 24h atingido.");


  await patchPost(postId, { status: "publishing", last_error: null });
  const caption = fullCaption(post);
  let creationId: string;

  if (format === "feed_image") {
    creationId = (await graph<{ id: string }>(`/${ig}/media`, { method: "POST", params: { image_url: media[0].url, caption } })).id;
  } else if (format === "feed_carousel") {
    const children: string[] = [];
    for (const m of media.slice(0, 10)) {
      const params: Record<string, unknown> = { is_carousel_item: "true" };
      if (m.type === "video") Object.assign(params, { media_type: "VIDEO", video_url: m.url });
      else params["image_url"] = m.url;
      const c = await graph<{ id: string }>(`/${ig}/media`, { method: "POST", params });
      if (m.type === "video") await waitContainer(c.id);
      children.push(c.id);
    }
    creationId = (await graph<{ id: string }>(`/${ig}/media`, { method: "POST", params: { media_type: "CAROUSEL", children: children.join(","), caption } })).id;
  } else if (format === "reel") {
    creationId = (await graph<{ id: string }>(`/${ig}/media`, { method: "POST", params: { media_type: "REELS", video_url: media[0].url, caption, share_to_feed: "true" } })).id;
    await waitContainer(creationId);
  } else {
    const video = format === "story_video";
    creationId = (await graph<{ id: string }>(`/${ig}/media`, { method: "POST", params: { media_type: "STORIES", [video ? "video_url" : "image_url"]: media[0].url } })).id;
    if (video) await waitContainer(creationId);
  }

  // Imagens também passam por processamento na Meta: espera o container ficar FINISHED.
  await waitContainer(creationId);
  const published = await graph<{ id: string }>(`/${ig}/media_publish`, { method: "POST", params: { creation_id: creationId } });
  const info = await graph<{ permalink?: string }>(`/${published.id}`, { params: { fields: "permalink" } }).catch(() => ({ permalink: undefined }));
  await patchPost(postId, {
    status: "published",
    published_at: new Date().toISOString(),
    ig_media_id: published.id,
    ig_permalink: info.permalink ?? null,
    last_error: null,
  });
  return { ok: true, sandbox: false, permalink: info.permalink ?? null };
}

/* ---------------- Métricas ---------------- */

const METRICS: Record<IgFormat, string[]> = {
  reel: ["plays", "reach", "likes", "comments", "saved", "shares"],
  feed_image: ["impressions", "reach", "saved", "likes", "comments", "shares"],
  feed_carousel: ["impressions", "reach", "saved", "likes", "comments", "shares"],
  story_image: ["reach", "impressions", "exits", "replies"],
  story_video: ["reach", "impressions", "exits", "replies"],
};

export async function collectPostMetrics(postId: string, label?: string) {
  const post = await getPost(postId);
  if (!post.ig_media_id) throw new Error("Post ainda não publicado.");
  const s = await db();
  const values: Record<string, number> = {};
  let raw: any = { sandbox: true };
  if (!String(post.ig_media_id).startsWith("sim_")) {
    const metrics = METRICS[post.format as IgFormat];
    try {
      raw = await graph(`/${post.ig_media_id}/insights`, { params: { metric: metrics.join(",") } });
    } catch {
      // Métricas antigas (impressions/plays) foram descontinuadas em algumas versões: tenta o conjunto essencial.
      raw = await graph(`/${post.ig_media_id}/insights`, { params: { metric: "reach,likes,comments,saved,shares,views" } });
    }
    for (const m of raw?.data ?? []) values[m.name] = Number(m.values?.[0]?.value ?? m.total_value?.value ?? 0);
  }
  await s.from("ig_post_metrics").insert({
    workspace_id: post.workspace_id,
    post_id: postId,
    reach: values["reach"] ?? null,
    impressions: values["impressions"] ?? values["views"] ?? null,
    likes: values["likes"] ?? null,
    comments: values["comments"] ?? null,
    saves: values["saved"] ?? null,
    shares: values["shares"] ?? null,
    plays: values["plays"] ?? values["views"] ?? null,
    profile_visits: values["profile_visits"] ?? null,
    raw: { label: label ?? "manual", ...values, response: raw },
  } as never);
  if (label) await patchPost(postId, { metrics_collected: [...(post.metrics_collected ?? []), label] });
  return { ok: true, values };
}

const WINDOWS: [string, number][] = [
  ["1h", 3600e3],
  ["24h", 24 * 3600e3],
  ["7d", 7 * 24 * 3600e3],
];

export async function collectDueMetrics() {
  const s = await db();
  const since = new Date(Date.now() - 8 * 24 * 3600e3).toISOString();
  const { data } = await s
    .from("ig_posts")
    .select("id, published_at, metrics_collected")
    .eq("status", "published")
    .gte("published_at", since)
    .limit(200);
  let done = 0;
  for (const p of (data ?? []) as any[]) {
    const age = Date.now() - new Date(p.published_at).getTime();
    const due = WINDOWS.filter(([l, ms]) => age >= ms && !(p.metrics_collected ?? []).includes(l)).pop();
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
    .limit(10);

  const results: { job: string; status: string; error?: string }[] = [];
  for (const job of (jobs ?? []) as any[]) {
    // Lock otimista: só segue se ninguém pegou antes.
    const { data: locked } = await s
      .from("publishing_jobs")
      .update({ status: "running", locked_at: new Date().toISOString(), attempts: job.attempts + 1 } as never)
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id");
    if (!locked?.length) continue;
    const stamp = new Date().toISOString();
    try {
      const r = await publishInstagramPost(job.ig_post_id);
      await s
        .from("publishing_jobs")
        .update({ status: "done", locked_at: null, mode: r.sandbox ? "mock" : "live", log: `${job.log ?? ""}\n[${stamp}] publicado ${r.permalink ?? ""}`.trim() } as never)
        .eq("id", job.id);
      const pub = await getPost(job.ig_post_id).catch(() => null);
      if (pub)
        await (await import("./autopilot.server")).logEvent({
          workspace_id: pub.workspace_id,
          plan_id: pub.plan_id,
          post_id: pub.id,
          kind: "publish",
          message: r.sandbox ? "Publicado em modo simulado (sem conta conectada)." : `Publicado no Instagram ${r.permalink ?? ""}`.trim(),
        });
      results.push({ job: job.id, status: "done" });
    } catch (e) {
      const msg = errMsg(e);
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

export async function suggestPillars(workspaceId: string, input: { brandId?: string | null | undefined; objective?: string | undefined; tone?: string | undefined; audience?: string | undefined }) {
  const brand = await brandFor(input.brandId ?? null);
  const prompt = [
    "Sugira 5 pilares de conteúdo para Instagram, em português do Brasil, curtos (2 a 4 palavras).",
    `Objetivo: ${input.objective ?? "-"}. Tom: ${input.tone ?? "-"}. Público: ${input.audience ?? "-"}.`,
    brand ? `MARCA: ${JSON.stringify(brand)}` : "",
    'Devolva SOMENTE JSON {"pillars":["..."]}.',
  ].join("\n");
  const schema = { type: "object", additionalProperties: false, required: ["pillars"], properties: { pillars: { type: "array", items: { type: "string" } } } };
  const { json } = await aiJson(workspaceId, "auto", prompt, schema, "ig_pillars");
  return { pillars: ((json?.pillars ?? []) as string[]).slice(0, 5) };
}

export async function uploadOwnMedia(workspaceId: string, postId: string, file: File) {
  const post = await getPost(postId);
  if (post.workspace_id !== workspaceId) throw new Error("Post não encontrado.");
  const video = file.type.startsWith("video/");
  if (!video && !file.type.startsWith("image/")) throw new Error("Envie uma imagem ou um vídeo MP4.");
  if (file.size > 100 * 1024 * 1024) throw new Error("Arquivo acima de 100 MB.");
  const ext = video ? "mp4" : file.type.includes("png") ? "png" : "jpg";
  const path = `${workspaceId}/${postId}/${crypto.randomUUID()}.${ext}`;
  const s = await db();
  const { error } = await s.storage.from(BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (error) throw new Error(`Falha ao salvar: ${error.message}`);
  const { data } = await s.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  if (!data) throw new Error("Falha ao gerar o link.");
  const format = post.format as IgFormat;
  const current: any[] = format === "feed_carousel" ? post.media ?? [] : [];
  const media = [...current, { url: data.signedUrl, type: video ? "video" : "image", order: current.length, width: null, height: null, duration: null }];
  await patchPost(postId, {
    media,
    status: post.status === "idea" || post.status === "failed" ? "pending_approval" : post.status,
    ai_generation_log: await appendLog(post, { step: "upload", file: file.name }),
  });
  return { ok: true };
}
