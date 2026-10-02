/**
 * Calendário automático do Instagram (somente servidor).
 *
 * O usuário escolhe período (pode começar hoje), dias da semana, horários, formatos e modo.
 * 1) computeSlots calcula cada horário exato (fuso de São Paulo) — a data nunca fica a cargo da IA.
 * 2) A IA estrategista preenche o conteúdo de cada horário em lotes (fillAutoRun).
 * 3) O piloto (autopilotTick) gera os criativos dos mais próximos primeiro; scheduleAutomated
 *    agenda na fila de publicação (modo "publish") ou espera a aprovação (modo "approval").
 */
import { normalizeHashtags, asText, asList } from "./normalize";
import { aiJson, brandFor, ASPECT, schedulePost, type IgFormat } from "./instagram.server";
import { logEvent } from "./autopilot.server";
import { buildRunStrategy, validatePosts, brandContext, fullDate, DATE_RULES, isCreditFailure, type RunStrategy, type Verdict } from "./content-strategy.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "erro desconhecido");

/** Brasil sem horário de verão desde 2019: São Paulo é sempre UTC-3. */
const TZ = "-03:00";
const MIN = 60e3;
const CHUNK = 8;
const MAX_SLOTS = 120;
const MAX_DAYS = 92;
/** Antecedência mínima para gerar a mídia a tempo. */
const LEAD_IMAGE_MIN = 20;
const LEAD_VIDEO_MIN = 60;

export type AutoMode = "publish" | "approval";
export type Slot = { index: number; at: string; format: IgFormat; kind: "main" | "story" };
export type AutoConfig = {
  startDate: string;
  endDate: string;
  weekdays: number[];
  times: string[];
  storyTimes: string[];
  formats: IgFormat[];
  asap?: boolean | undefined;
};

export function todaySP(now = Date.now()) {
  return new Date(now - 3 * 3600e3).toISOString().slice(0, 10);
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const isVideoFormat = (f: IgFormat) => f === "reel" || f === "story_video";
const normTime = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` : null;
};
const uniqTimes = (list: string[]) =>
  [...new Set(list.map(normTime).filter((t): t is string => !!t))].sort();

/**
 * Horários exatos do período. Pula o que já passou ou está perto demais para gerar a mídia;
 * vídeo perto do horário vira imagem para dar tempo de ficar pronto.
 */
export function computeSlots(cfg: AutoConfig, now = Date.now()) {
  const times = uniqTimes(cfg.times);
  const storyTimes = uniqTimes(cfg.storyTimes);
  const main = cfg.formats.filter((f) => !f.startsWith("story_"));
  const stories = cfg.formats.filter((f) => f.startsWith("story_"));
  if (!main.length && times.length) throw new Error("Escolha ao menos um formato de feed ou Reels para os horários principais.");
  const storyFormats: IgFormat[] = stories.length ? stories : ["story_image"];
  const start = cfg.startDate < todaySP(now) ? todaySP(now) : cfg.startDate;
  if (cfg.endDate < start) throw new Error("A data final precisa ser igual ou depois da inicial (e não pode estar no passado).");
  const out: Omit<Slot, "index">[] = [];
  let skipped = 0;
  let dayIdx = 0;
  for (let d = start; d <= cfg.endDate; d = addDays(d, 1), dayIdx++) {
    if (dayIdx >= MAX_DAYS) throw new Error(`O período pode ter no máximo ${MAX_DAYS} dias.`);
    if (!cfg.weekdays.includes(weekday(d))) continue;
    const push = (t: string, format: IgFormat, kind: Slot["kind"]) => {
      const at = new Date(`${d}T${t}:00${TZ}`).getTime();
      const lead = (at - now) / MIN;
      if (lead < LEAD_IMAGE_MIN) return void skipped++;
      let f = format;
      if (isVideoFormat(f) && lead < LEAD_VIDEO_MIN) f = f === "reel" ? "feed_image" : "story_image";
      out.push({ at: new Date(at).toISOString(), format: f, kind });
    };
    // Gira os formatos por dia para o mesmo horário não ter sempre o mesmo formato.
    times.forEach((t, i) => push(t, main[(i + dayIdx) % main.length]!, "main"));
    storyTimes.forEach((t, i) => push(t, storyFormats[(i + dayIdx) % storyFormats.length]!, "story"));
  }
  if (cfg.asap && start === todaySP(now) && cfg.weekdays.includes(weekday(start))) {
    // "O quanto antes": daqui a ~25 min, arredondado para 5 min; imagem para ficar pronta a tempo.
    const at = Math.ceil((now + 25 * MIN) / (5 * MIN)) * 5 * MIN;
    const f: IgFormat = main.length ? (main.find((x) => !isVideoFormat(x)) ?? "feed_image") : "story_image";
    out.push({ at: new Date(at).toISOString(), format: f, kind: main.length ? "main" : "story" });
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  if (out.length > MAX_SLOTS)
    throw new Error(`Isso daria ${out.length} posts. O limite por programação é ${MAX_SLOTS}: diminua o período ou os horários.`);
  return { slots: out.map((s, index) => ({ ...s, index })) as Slot[], skipped };
}

/** Sem plano escolhido: a estrategista cria um plano básico a partir do DNA da marca. */
async function ensurePlan(workspaceId: string, planId: string | null | undefined, brandId: string | null | undefined, mode: AutoMode) {
  const s = await db();
  if (planId) {
    const { data } = await s.from("ig_content_plans").select("id").eq("id", planId).eq("workspace_id", workspaceId).maybeSingle();
    if (!data) throw new Error("Plano de conteúdo não encontrado.");
    return planId;
  }
  if (!brandId) throw new Error("Escolha um plano de conteúdo ou uma marca.");
  const brand = await brandFor(brandId);
  if (!brand || brand.workspace_id !== workspaceId) throw new Error("Marca não encontrada.");
  const { suggestPillars } = await import("./instagram.server");
  const { pillars } = await suggestPillars(workspaceId, { brandId, tone: brand.tone_of_voice ?? undefined, audience: brand.target_audience ?? undefined });
  const { data, error } = await s
    .from("ig_content_plans")
    .insert({
      workspace_id: workspaceId,
      brand_id: brandId,
      name: `Instagram · ${brand.name}`,
      objective: "Crescer audiência qualificada e gerar contatos",
      tone_of_voice: brand.tone_of_voice ?? null,
      content_pillars: pillars,
      requires_approval: mode === "approval",
      auto_publish: false,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function createAutoRun(
  workspaceId: string,
  userId: string,
  input: AutoConfig & {
    planId?: string | null | undefined;
    brandId?: string | null | undefined;
    campaignId?: string | null | undefined;
    focus?: string | undefined;
    mode: AutoMode;
    recurring?: boolean | undefined;
  },
) {
  const { slots, skipped } = computeSlots(input);
  if (!slots.length)
    throw new Error(
      skipped
        ? "Todos os horários escolhidos já passaram ou estão a menos de 20 minutos. Escolha horários mais tarde ou marque \"o quanto antes\"."
        : "Nenhum horário no período: confira os dias da semana e os horários.",
    );
  const planId = await ensurePlan(workspaceId, input.planId, input.brandId, input.mode);
  const s = await db();
  const { data, error } = await s
    .from("ig_auto_runs")
    .insert({
      workspace_id: workspaceId,
      plan_id: planId,
      created_by: userId,
      campaign_id: input.campaignId || null,
      start_date: input.startDate < todaySP() ? todaySP() : input.startDate,
      end_date: input.endDate,
      weekdays: input.weekdays,
      times: uniqTimes(input.times),
      story_times: uniqTimes(input.storyTimes),
      formats: input.formats,
      focus: input.focus?.trim() || null,
      mode: input.mode,
      recurring: !!input.recurring,
      slots,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await logEvent({
    workspace_id: workspaceId,
    plan_id: planId,
    kind: "generation",
    message: `Programação criada: ${slots.length} posts de ${fmtDate(slots[0]!.at)} a ${fmtDate(slots[slots.length - 1]!.at)} (${input.mode === "publish" ? "publica sozinho" : "com aprovação"}).${skipped ? ` ${skipped} horário(s) já passado(s) ignorado(s).` : ""}`,
  });
  return { runId: data.id as string, planId, total: slots.length, skipped };
}

const ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["index", "theme", "pillar", "funnel_stage", "hook", "headline", "caption", "hashtags", "cta", "image_prompt", "slides"],
  properties: {
    index: { type: "integer" },
    theme: { type: "string" },
    pillar: { type: "string" },
    funnel_stage: { type: "string", enum: ["atracao", "conexao", "conversao"] },
    hook: { type: "string" },
    headline: { type: "string" },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
    image_prompt: { type: "string" },
    slides: { type: "array", items: { type: "string" } },
  },
};
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["posts"],
  properties: { posts: { type: "array", items: ITEM } },
};

const FORMAT_GUIDE: Record<IgFormat, string> = {
  feed_image: "post de imagem única: uma ideia forte; headline curta aplicada na arte",
  feed_carousel: "carrossel: 4 a 7 slides em 'slides' (1º = gancho, meio = conteúdo, último = CTA); headline do 1º slide",
  reel: "Reels: image_prompt descreve a cena em movimento de 5 a 8 s; gancho nos 2 primeiros segundos; legenda completa",
  story_image: "story de imagem: headline curta e direta na arte; legenda curta (stories não exibem legenda) e CTA de interação (responder, enquete, link)",
  story_video: "story em vídeo curto: cena simples de 5 s; headline curta; CTA de interação",
};

function weekdayName(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

/** Preenche a programação: 1) estratégia do período (aprovada pelo usuário); 2) posts em lotes, validados. */
export async function fillAutoRun(runId: string) {
  const s = await db();
  const nowIso = new Date().toISOString();
  const { data: claimed } = await s
    .from("ig_auto_runs")
    .update({ locked_until: new Date(Date.now() + 240e3).toISOString() })
    .eq("id", runId)
    .eq("status", "planning")
    .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
    .select("*")
    .maybeSingle();
  if (!claimed) {
    const { data: r } = await s.from("ig_auto_runs").select("status, filled, slots, strategy_status").eq("id", runId).maybeSingle();
    return {
      filled: r?.filled ?? 0,
      total: (r?.slots ?? []).length,
      done: r?.status !== "planning",
      busy: r?.status === "planning" && r?.strategy_status !== "review",
      strategyReview: r?.strategy_status === "review",
    };
  }
  const run = claimed as any;
  const all = (run.slots ?? []) as Slot[];
  const release = (extra: Record<string, unknown> = {}) =>
    s.from("ig_auto_runs").update({ locked_until: null, updated_at: new Date().toISOString(), ...extra }).eq("id", runId);
  try {
    const ctx = await runContext(run);
    // Passo "Estratégia": criada antes dos posts e revisada pelo usuário.
    if (!run.strategy || run.strategy_status === "pending") {
      const { strategy } = await buildRunStrategy({ workspaceId: run.workspace_id, objective: ctx.objective, brand: ctx.brand, products: ctx.products, personas: ctx.personas, plan: ctx.plan, slots: all });
      await release({ strategy, strategy_status: "review", last_error: null, paused_reason: null });
      await logEvent({ workspace_id: run.workspace_id, plan_id: run.plan_id, kind: "generation", message: "Estratégia do período pronta: revise e aprove para gerar os posts." });
      return { filled: run.filled, total: all.length, done: false, busy: false, strategyReview: true };
    }
    if (run.strategy_status !== "approved") {
      await release();
      return { filled: run.filled, total: all.length, done: false, busy: false, strategyReview: true };
    }
    // Horários que já passaram enquanto a programação esperava são descartados.
    const chunk = all.slice(run.filled, run.filled + CHUNK);
    const usable = chunk.filter((sl) => new Date(sl.at).getTime() > Date.now() + 10 * MIN);
    if (usable.length) await writeChunk(run, usable, ctx);
    const filled = run.filled + chunk.length;
    const done = filled >= all.length;
    await release({ filled, status: done ? "active" : "planning", last_error: null, paused_reason: null });
    if (done)
      await logEvent({
        workspace_id: run.workspace_id,
        plan_id: run.plan_id,
        kind: "generation",
        message: `Estrategista concluiu os conteúdos da programação (${all.length} posts). Criativos sendo gerados, começando pelos mais próximos.`,
      });
    return { filled, total: all.length, done, busy: false, strategyReview: false };
  } catch (e) {
    const credit = isCreditFailure(errMsg(e));
    await release({ last_error: errMsg(e), paused_reason: credit ? "Créditos de IA esgotados — programação pausada" : null });
    await logEvent({
      workspace_id: run.workspace_id,
      plan_id: run.plan_id,
      kind: "failure",
      level: "error",
      message: credit
        ? "Créditos de IA esgotados — programação pausada. Retoma sozinha quando houver crédito."
        : `Estrategista falhou num lote da programação (tenta de novo em 5 min): ${errMsg(e)}`,
    });
    throw e;
  }
}

/** Marca, produtos, personas, plano e objetivo da programação. Sem marca, nada roda. */
async function runContext(run: any) {
  const s = await db();
  const { data: plan } = await s.from("ig_content_plans").select("*").eq("id", run.plan_id).maybeSingle();
  if (!plan) throw new Error("Plano de conteúdo não encontrado.");
  if (!plan.brand_id) throw new Error("Cadastre a marca em Brands antes.");
  const brand = await brandFor(plan.brand_id);
  if (!brand) throw new Error("Cadastre a marca em Brands antes.");
  const [products, personas] = await Promise.all([
    s.from("products").select("id, name, description, price").eq("brand_id", brand.id).limit(20),
    s.from("personas").select("name, age_range, pains, desires, interests").eq("brand_id", brand.id).limit(6),
  ]);
  const objective = (run.focus || plan.objective || "").trim();
  if (!objective) throw new Error("Informe o objetivo deste período na programação.");
  let campaign: unknown = null;
  if (run.campaign_id) {
    const { currentStrategy, strategyBrief } = await import("@/lib/ai/strategist.server");
    campaign = strategyBrief(await currentStrategy(s, run.campaign_id));
  }
  return { plan, brand, products: (products.data ?? []) as any[], personas: (personas.data ?? []) as any[], objective, campaign };
}
type RunCtx = Awaited<ReturnType<typeof runContext>>;

async function askPosts(run: any, slots: Slot[], ctx: RunCtx, fixes: Map<number, string>) {
  const s = await db();
  const { plan, brand, products, personas, objective, campaign } = ctx;
  const strategy = run.strategy as RunStrategy;
  const { data: recent } = await s
    .from("ig_posts")
    .select("theme")
    .eq("workspace_id", run.workspace_id)
    .not("theme", "is", null)
    .order("created_at", { ascending: false })
    .limit(40);
  const used = [...new Set(((recent ?? []) as any[]).map((r) => r.theme as string))];
  const prompt = [
    "Você é a estrategista de conteúdo sênior de uma agência de marketing no Brasil. Escreva em português do Brasil.",
    "Escreva o conteúdo de Instagram de CADA horário abaixo. Data, horário e formato já estão definidos: não mude.",
    "ORDEM DE PRIORIDADE (nunca inverta):",
    `1. OBJETIVO DO PERÍODO (fonte principal, cada post precisa servir a ele): ${objective}`,
    `2. ESTRATÉGIA APROVADA: ${JSON.stringify(strategy.texto_editado ? { ...strategy, ajustes_do_cliente: strategy.texto_editado } : strategy)}`,
    `3. DNA DA MARCA: ${JSON.stringify(brandContext(brand))}`,
    `4. PRODUTOS (únicos preços válidos; cite pelo nome exato): ${JSON.stringify(products.map((p) => ({ nome: p.name, descricao: p.description, preco: p.price })))}`,
    `   PERSONAS: ${JSON.stringify(personas.map((p) => p.name))}`,
    `5. PLANO: tom ${plan.tone_of_voice ?? brand.tone_of_voice ?? "-"}; hashtags ${JSON.stringify(plan.hashtag_strategy)}; CTA padrão ${plan.cta_default ?? "-"}.`,
    campaign ? `CAMPANHA LIGADA: ${JSON.stringify(campaign)}` : "",
    "PROIBIDO: falar de outro negócio ou de temas fora do segmento da marca; inventar preço, promoção ou número fora dos produtos/DNA; usar palavras proibidas da marca; CTA fora da lista de CTAs da estratégia.",
    DATE_RULES,
    used.length ? `Temas já usados (não repita): ${JSON.stringify(used.slice(0, 40))}.` : "",
    "Guia por formato:",
    ...Object.entries(FORMAT_GUIDE).map(([k, v]) => `- ${k}: ${v}.`),
    "Campos: index, theme, pillar (um dos pilares da estratégia), persona, product_name (nome exato do produto citado ou vazio), funnel_stage (atracao|consideracao|conversao), objective_link (uma frase ligando o post ao objetivo), hook, headline (até 7 palavras, sem hashtags), caption (com quebras de linha), hashtags (array JSON de 10 a 15 strings sem #, ex.: ['valinhos','choppgelado']), cta (um dos CTAs da estratégia), image_prompt (briefing visual em português do que aparece, SEM texto na imagem), slides (só carrossel, senão vazio).",
    "HORÁRIOS (data real, fuso America/Sao_Paulo):",
    ...slots.map((sl) => `- index ${sl.index}: ${fullDate(sl.at)} · ${sl.format}${fixes.get(sl.index) ? ` · REFAÇA, reprovado antes por: ${fixes.get(sl.index)}` : ""}`),
    'Devolva SOMENTE JSON estrito {"posts":[...]} com um item por horário.',
  ].filter(Boolean).join("\n");
  const { json, provider } = await aiJson(run.workspace_id, "auto", prompt, SCHEMA, "ig_auto_calendar");
  const list = Array.isArray(json?.posts) ? (json.posts as any[]) : [];
  return { items: new Map<number, any>(list.filter((p) => p && typeof p === "object").map((p) => [Number(p.index), p])), provider };
}

async function writeChunk(run: any, slots: Slot[], ctx: RunCtx) {
  const s = await db();
  const { plan, products } = ctx;
  const strategy = run.strategy as RunStrategy;
  const final = new Map<number, { p: any; verdict: Verdict | null; attempts: number; provider: string; issues: string[] }>();
  let pending = slots;
  const fixes = new Map<number, string>();
  let provider = "lovable_ai";
  // Gera, valida e regera só os reprovados (até 2 novas tentativas).
  for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
    const r = await askPosts(run, pending, ctx, fixes);
    provider = r.provider;
    if (!r.items.size && attempt === 0) throw new Error("A IA não devolveu conteúdos.");
    const verdicts = await validatePosts({
      workspaceId: run.workspace_id,
      brand: ctx.brand,
      objective: ctx.objective,
      strategy,
      products,
      posts: pending.map((sl) => {
        const p = r.items.get(sl.index) ?? {};
        return { index: sl.index, at: sl.at, theme: asText(p.theme), hook: asText(p.hook), caption: asText(p.caption), headline: asText(p.headline), cta: asText(p.cta) };
      }),
    });
    const next: Slot[] = [];
    for (const sl of pending) {
      const p = r.items.get(sl.index);
      const v = verdicts.get(sl.index) ?? null;
      const issues = p ? [] : ["a IA não devolveu conteúdo para este horário"];
      if (p && p.hashtags != null && !Array.isArray(p.hashtags)) issues.push("hashtags vieram como texto e foram normalizadas");
      const prev = final.get(sl.index);
      final.set(sl.index, { p: p ?? prev?.p ?? {}, verdict: v, attempts: attempt + 1, provider, issues });
      if (!p || (v && !v.aprovado)) {
        fixes.set(sl.index, v?.motivo || "conteúdo ausente");
        next.push(sl);
      }
    }
    pending = next;
  }
  const productId = (name: unknown) => {
    const n = (asText(name) ?? "").toLowerCase();
    return n ? (products.find((x) => x.name?.toLowerCase() === n || n.includes(x.name?.toLowerCase()))?.id ?? null) : null;
  };
  const stage = (v: unknown) => {
    const t = (asText(v) ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return t.startsWith("conv") ? "conversao" : t.startsWith("cons") || t.startsWith("cone") ? "consideracao" : "atracao";
  };
  const rows = slots.map((sl) => {
    const f = final.get(sl.index)!;
    const p = f.p ?? {};
    const soon = new Date(sl.at).getTime() - Date.now() < 90 * MIN;
    const rejected = !!f.verdict && !f.verdict.aprovado;
    const empty = !asText(p.caption) && !asText(p.theme);
    const needsReview = rejected || empty;
    const at = new Date().toISOString();
    return {
      workspace_id: run.workspace_id,
      plan_id: run.plan_id,
      run_id: run.id,
      automation: run.mode,
      format: sl.format,
      status: needsReview ? "needs_review" : "idea",
      review_reason: needsReview ? (f.verdict?.motivo || "A IA não devolveu conteúdo para este horário.") : null,
      review_score: f.verdict?.nota ?? null,
      scheduled_at: sl.at,
      theme: asText(p.theme) ?? `Post de ${weekdayName(sl.at)}`,
      hook: asText(p.hook),
      caption: asText(p.caption),
      hashtags: normalizeHashtags(p.hashtags),
      cta: asText(p.cta) || plan.cta_default || null,
      objective_link: asText(p.objective_link),
      pillar: asText(p.pillar),
      persona: asText(p.persona),
      product_id: productId(p.product_name),
      funnel_stage: stage(p.funnel_stage),
      creative_brief: {
        prompt: asText(p.image_prompt) || asText(p.theme) || "",
        slides: sl.format === "feed_carousel" ? asList(p.slides).slice(0, 10) : [],
        aspect_ratio: ASPECT[sl.format],
        headline: asText(p.headline),
        pillar: asText(p.pillar),
        funnel_stage: stage(p.funnel_stage),
        product_name: asText(p.product_name),
        campaign_id: run.campaign_id ?? null,
        // Perto do horário: uma variação só, para a mídia ficar pronta a tempo.
        variations: soon ? 1 : 3,
      },
      ai_provider: f.provider,
      ai_generation_log: [
        {
          at,
          step: "auto_calendar",
          provider: f.provider,
          run_id: run.id,
          attempts: f.attempts,
          review: f.verdict,
          ...(f.issues.length ? { warnings: f.issues } : {}),
          ...(needsReview ? { status: "needs_review" } : {}),
        },
      ],
    };
  });
  const { error } = await s.from("ig_posts").insert(rows);
  if (error) throw new Error(error.message);
}

/** Usuário aprova (e opcionalmente ajusta em texto) a estratégia: libera a geração dos posts. */
export async function approveRunStrategy(runId: string, editedText?: string | null) {
  const s = await db();
  const { data: run } = await s.from("ig_auto_runs").select("id, strategy").eq("id", runId).maybeSingle();
  if (!run?.strategy) throw new Error("A estratégia ainda não foi gerada.");
  const strategy = { ...run.strategy, texto_editado: editedText?.trim() || run.strategy.texto_editado || null };
  await s.from("ig_auto_runs").update({ strategy, strategy_status: "approved", locked_until: null }).eq("id", runId);
  return { ok: true };
}

/** Pede uma nova estratégia (descarta a atual). */
export async function redoRunStrategy(runId: string) {
  const s = await db();
  await s.from("ig_auto_runs").update({ strategy: null, strategy_status: "pending", locked_until: null }).eq("id", runId).eq("status", "planning");
  return { ok: true };
}
/**
 * Agenda um post automático com mídia pronta. No modo "approval" só agenda depois de aprovado.
 * Se a mídia ficou pronta depois do horário, publica o quanto antes (até 12 h de atraso);
 * mais que isso, passa para o mesmo horário do dia seguinte.
 */
export async function scheduleAutomated(postId: string) {
  const s = await db();
  const { data: post } = await s.from("ig_posts").select("*").eq("id", postId).maybeSingle();
  if (!post?.automation || !post.media?.length) return { skipped: "sem mídia" };
  if (!["ready", "approved"].includes(post.status)) return { skipped: post.status };
  if (post.automation === "approval" && !post.approved_at) return { skipped: "aguardando aprovação" };
  let at = post.scheduled_at ? new Date(post.scheduled_at).getTime() : Date.now();
  const late = Date.now() - at;
  let msg: string;
  if (late <= 0) msg = `Agendado para ${fmtDate(new Date(at).toISOString())}.`;
  else if (late <= 12 * 3600e3) {
    at = Date.now() + MIN;
    msg = "A mídia ficou pronta depois do horário: publicando agora.";
  } else {
    while (at < Date.now() + 30 * MIN) at += 86400e3;
    msg = `Horário perdido: reagendado para ${fmtDate(new Date(at).toISOString())}.`;
  }
  await schedulePost(post.workspace_id, postId, new Date(at).toISOString());
  await logEvent({ workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: postId, kind: "schedule", message: msg });
  return { scheduled: new Date(at).toISOString() };
}

/** A cada 5 min (junto do piloto): preenche programações, agenda prontos, protege aprovação e renova as recorrentes. */
export async function autoCalendarTick() {
  const s = await db();
  const out: Record<string, unknown> = {};

  // 1) Lotes pendentes da estrategista (o usuário pode ter fechado a página).
  const { data: planning } = await s.from("ig_auto_runs").select("id").eq("status", "planning").order("created_at").limit(1);
  let filled = 0;
  for (const r of (planning ?? []) as any[]) {
    await fillAutoRun(r.id).then(() => filled++).catch(() => null);
  }
  out["filled"] = filled;

  // 2) Mídia pronta e ainda não agendada (ou aprovada agora): vai para a fila.
  const { data: ready } = await s
    .from("ig_posts")
    .select("id")
    .not("automation", "is", null)
    .in("status", ["ready", "approved"])
    .order("scheduled_at")
    .limit(20);
  let scheduled = 0;
  for (const p of (ready ?? []) as any[]) {
    const r = await scheduleAutomated(p.id).catch(async (e) => {
      await s.from("ig_posts").update({ last_error: errMsg(e) }).eq("id", p.id);
      return null;
    });
    if (r && "scheduled" in r) scheduled++;
  }
  out["scheduled"] = scheduled;

  // 2b) Falha na geração do criativo: uma nova tentativa automática (volta para "ideia").
  const { data: failed } = await s
    .from("ig_posts")
    .select("id, creative_brief")
    .not("automation", "is", null)
    .eq("status", "failed")
    .gt("scheduled_at", new Date(Date.now() - 12 * 3600e3).toISOString())
    .limit(10);
  for (const p of (failed ?? []) as any[]) {
    if (p.creative_brief?.auto_retried) continue;
    await s
      .from("ig_posts")
      .update({ status: "idea", creative_brief: { ...(p.creative_brief ?? {}), auto_retried: true, variations: 1 } })
      .eq("id", p.id)
      .eq("status", "failed");
  }

  // 2c) Modo automático cujo criativo não ficou pronto a tempo (até 12 h): gera agora e publica em seguida.
  const { data: overdue } = await s
    .from("ig_posts")
    .select("id, workspace_id, plan_id")
    .eq("automation", "publish")
    .eq("status", "idea")
    .lte("scheduled_at", new Date().toISOString())
    .gt("scheduled_at", new Date(Date.now() - 12 * 3600e3).toISOString())
    .order("scheduled_at")
    .limit(1);
  for (const p of (overdue ?? []) as any[]) {
    const { generatePostAssets } = await import("./instagram.server");
    const r = await generatePostAssets(p.workspace_id, p.id, "auto");
    if (r.ok && !("pending" in r && r.pending)) await scheduleAutomated(p.id).catch(() => null);
  }

  // 3) Modo com aprovação: sem aprovação até 10 min antes → mesmo horário do dia seguinte.
  const { data: late } = await s
    .from("ig_posts")
    .select("id, workspace_id, plan_id, scheduled_at")
    .eq("automation", "approval")
    .in("status", ["idea", "generating", "pending_approval", "ready"])
    .is("approved_at", null)
    .lt("scheduled_at", new Date(Date.now() + 10 * MIN).toISOString())
    .limit(50);
  for (const p of (late ?? []) as any[]) {
    let next = new Date(p.scheduled_at).getTime() + 86400e3;
    while (next < Date.now() + 30 * MIN) next += 86400e3;
    const iso = new Date(next).toISOString();
    await s.from("ig_posts").update({ scheduled_at: iso }).eq("id", p.id);
    await logEvent({
      workspace_id: p.workspace_id,
      plan_id: p.plan_id,
      post_id: p.id,
      kind: "reschedule",
      level: "warn",
      message: `Não foi aprovado a tempo: reagendado para ${fmtDate(iso)}.`,
    });
  }
  out["rescheduled"] = (late ?? []).length;

  // 4) Programações recorrentes: mantém sempre a próxima semana planejada.
  out["recurring"] = await renewRecurring().catch((e) => ({ error: errMsg(e) }));

  // 5) Programações concluídas: todos os posts publicados, cancelados ou com falha.
  const { data: active } = await s.from("ig_auto_runs").select("id").eq("status", "active").limit(50);
  for (const r of (active ?? []) as any[]) {
    const { count } = await s
      .from("ig_posts")
      .select("id", { count: "exact", head: true })
      .eq("run_id", r.id)
      .not("status", "in", "(published,cancelled,failed)");
    if (count === 0) await s.from("ig_auto_runs").update({ status: "done" }).eq("id", r.id);
  }
  return out;
}

/** Recorrente: quando faltam 7 dias para acabar, cria a semana seguinte com a mesma configuração. */
export async function renewRecurring() {
  const s = await db();
  const { data: roots } = await s
    .from("ig_auto_runs")
    .select("*")
    .eq("recurring", true)
    .is("parent_id", null)
    .in("status", ["planning", "active", "done"])
    .limit(50);
  let created = 0;
  for (const root of (roots ?? []) as any[]) {
    const { data: kids } = await s
      .from("ig_auto_runs")
      .select("end_date")
      .eq("parent_id", root.id)
      .order("end_date", { ascending: false })
      .limit(1);
    const lastEnd = (kids?.[0]?.end_date as string | undefined) ?? root.end_date;
    if (lastEnd >= addDays(todaySP(), 7)) continue;
    const start = addDays(lastEnd < todaySP() ? addDays(todaySP(), -1) : lastEnd, 1);
    const end = addDays(start, 6);
    try {
      const { slots } = computeSlots({
        startDate: start,
        endDate: end,
        weekdays: root.weekdays,
        times: root.times,
        storyTimes: root.story_times,
        formats: root.formats,
      });
      if (!slots.length) continue;
      const { error } = await s.from("ig_auto_runs").insert({
        workspace_id: root.workspace_id,
        plan_id: root.plan_id,
        parent_id: root.id,
        created_by: root.created_by,
        campaign_id: root.campaign_id,
        start_date: start,
        end_date: end,
        weekdays: root.weekdays,
        times: root.times,
        story_times: root.story_times,
        formats: root.formats,
        focus: root.focus,
        mode: root.mode,
        recurring: false,
        slots,
      });
      if (error) continue; // já criada (índice único)
      created++;
      await logEvent({
        workspace_id: root.workspace_id,
        plan_id: root.plan_id,
        kind: "generation",
        message: `Programação recorrente: semana de ${start} a ${end} criada (${slots.length} posts).`,
      });
    } catch (e) {
      await logEvent({
        workspace_id: root.workspace_id,
        plan_id: root.plan_id,
        kind: "failure",
        level: "error",
        message: `Falha ao renovar a programação recorrente: ${errMsg(e)}`,
      });
    }
  }
  return { created };
}

/** Cancela a programação (e as semanas recorrentes dela): posts não publicados saem da fila. */
export async function cancelAutoRun(workspaceId: string, runId: string) {
  const s = await db();
  const { data: run } = await s.from("ig_auto_runs").select("id, plan_id").eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
  if (!run) throw new Error("Programação não encontrada.");
  const { data: kids } = await s.from("ig_auto_runs").select("id").eq("parent_id", runId);
  const ids = [runId, ...((kids ?? []) as any[]).map((k) => k.id)];
  await s.from("ig_auto_runs").update({ status: "cancelled", recurring: false, locked_until: null }).in("id", ids);
  const { data: posts } = await s
    .from("ig_posts")
    .select("id")
    .in("run_id", ids)
    .not("status", "in", "(published,publishing,cancelled)");
  const postIds = ((posts ?? []) as any[]).map((p) => p.id);
  if (postIds.length) {
    await s.from("publishing_jobs").update({ status: "cancelled", locked_at: null }).in("ig_post_id", postIds).eq("status", "pending");
    await s.from("ig_posts").update({ status: "cancelled" }).in("id", postIds);
  }
  await logEvent({ workspace_id: workspaceId, plan_id: run.plan_id, kind: "guardrail", message: `Programação cancelada: ${postIds.length} post(s) retirados da fila.` });
  return { cancelled: postIds.length };
}
