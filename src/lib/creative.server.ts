/**
 * Núcleo da geração de criativos (somente servidor).
 * Monta o prompt final com o Brand Brain, escolhe o provedor e persiste tudo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLiveConnection, errMessage } from "./mcp-auth.server";
import { createHiggsfieldProvider } from "./providers/higgsfield.server";
import { createChatgptProvider, createGeminiProvider } from "./providers/lovable-ai.server";
import { getWorkspaceAiKey } from "./ai-keys.server";
import {
  type CreativeKind,
  type GenerationResult,
  type ServerCreativeProvider,
} from "./providers/creative-provider.server";

type DB = SupabaseClient<any, any, any>;

export async function buildBrandBrainPrompt(
  supabase: DB,
  input: {
    workspaceId: string;
    campaignId?: string | null | undefined;
    brandId?: string | null | undefined;
    prompt: string;
    title: string;
    type: string;
    aspectRatio: string;
    copyText: string;
  },
) {
  const { data: campaign } = input.campaignId
    ? await supabase.from("campaigns").select("*").eq("id", input.campaignId).maybeSingle()
    : { data: null as any };

  const brandId = input.brandId ?? campaign?.brand_id ?? null;
  const { data: brand } = brandId
    ? await supabase.from("brands").select("*").eq("id", brandId).maybeSingle()
    : { data: null as any };

  const [personas, products, assets, copies] = await Promise.all([
    brandId
      ? supabase.from("personas").select("name, age_range, pains, desires, interests").eq("brand_id", brandId).limit(3)
      : Promise.resolve({ data: [] as any[] }),
    brandId
      ? supabase.from("products").select("name, description, price").eq("brand_id", brandId).limit(3)
      : Promise.resolve({ data: [] as any[] }),
    brandId
      ? supabase.from("brand_assets").select("kind, name, url").eq("brand_id", brandId).limit(5)
      : Promise.resolve({ data: [] as any[] }),
    input.campaignId
      ? supabase
          .from("copies")
          .select("content")
          .eq("campaign_id", input.campaignId)
          .order("version", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const brandContext: Record<string, unknown> = {
    marca: brand?.name,
    segmento: brand?.segment,
    diferenciais: brand?.differentials,
    publico: brand?.target_audience,
    tom_de_voz: brand?.tone_of_voice,
    cores: [brand?.primary_color, brand?.secondary_color].filter(Boolean),
    tipografia: brand?.typography,
    logo: brand?.logo_url,
    palavras_proibidas: brand?.banned_words,
    palavras_preferidas: brand?.preferred_words,
    campanhas_anteriores: brand?.past_campaigns,
    personas: personas.data ?? [],
    produtos: products.data ?? [],
    referencias: (assets.data ?? []).map((a: any) => a.url),
    campanha: campaign
      ? {
          nome: campaign.name,
          objetivo: campaign.objective,
          oferta: campaign.offer_product,
          promessa: campaign.offer_promise,
          preco: campaign.offer_price,
          publico: campaign.audience,
        }
      : null,
    copy: input.copyText || (copies.data?.[0]?.content ? JSON.stringify(copies.data[0].content).slice(0, 600) : null),
  };

  const lines = [
    input.prompt || input.title || "Criativo publicitário de alta performance",
    brand ? `Marca: ${brand.name}${brand.segment ? ` (${brand.segment})` : ""}.` : null,
    brand?.tone_of_voice ? `Tom de voz: ${brand.tone_of_voice}.` : null,
    brand?.primary_color ? `Paleta: ${brand.primary_color} e ${brand.secondary_color ?? ""}.` : null,
    brand?.typography ? `Tipografia: ${brand.typography}.` : null,
    brand?.differentials ? `Diferenciais: ${brand.differentials}.` : null,
    brand?.target_audience ? `Público: ${brand.target_audience}.` : null,
    campaign?.objective ? `Objetivo da campanha: ${campaign.objective}.` : null,
    campaign?.offer_promise ? `Promessa da oferta: ${campaign.offer_promise}.` : null,
    (personas.data ?? []).length
      ? `Persona principal: ${personas.data![0].name} — dores: ${personas.data![0].pains ?? ""}.`
      : null,
    brandContext["copy"] ? `Copy associada: ${String(brandContext["copy"]).slice(0, 300)}.` : null,
    brand?.banned_words?.length ? `Evite: ${brand.banned_words.join(", ")}.` : null,
    `Formato: ${input.type}. Proporção: ${input.aspectRatio}.`,
  ].filter(Boolean);

  return { brand, campaign, brandContext, finalPrompt: lines.join(" ") };
}

export type ProviderChoice = "auto" | "higgsfield" | "chatgpt" | "gemini";

const CREDIT_ERR = /\b(402|429)\b|cr[ée]dito|saldo|quota|cota|limite|esgotad|rate.?limit|insufficient|billing/i;
export const isCreditError = (e: unknown) => CREDIT_ERR.test(errMessage(e));

/** Provedor que tenta a lista em ordem, passando ao próximo só em falha de crédito/limite. */
function chainProviders(list: ServerCreativeProvider[]): ServerCreativeProvider & { log: string[] } {
  let current = list[0]!;
  const log: string[] = [];
  const run = async (fn: (p: ServerCreativeProvider) => Promise<GenerationResult>) => {
    let lastErr: unknown = null;
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      try {
        const r = await fn(p);
        current = p;
        const msg = `Usado: ${r.note ?? p.label}`;
        if (log[log.length - 1] !== msg) log.push(msg);
        return r;
      } catch (e) {
        lastErr = e;
        if (i === list.length - 1) throw e;
        console.warn(`[creative-chain] ${p.id} falhou, tentando o próximo:`, errMessage(e));
        log.push(`${p.label}: ${errMessage(e)} → tentando o próximo`);
        list = list.slice(i); // não volta para quem já falhou
        list.shift();
        i = -1;
      }
    }
    throw lastErr;
  };
  return {
    get id() { return current.id; },
    get label() { return current.label; },
    get sandbox() { return current.sandbox; },
    log,
    generateImage: (req) => run((p) => p.generateImage(req)),
    generateVideo: (req) => run((p) => p.generateVideo(req)),
    getGenerationStatus: (id) => current.getGenerationStatus(id),
    getAsset: (id) => current.getAsset(id),
  } as ServerCreativeProvider & { log: string[] };
}

export async function resolveProvider(supabase: DB, workspaceId: string, choice: ProviderChoice = "auto"): Promise<ServerCreativeProvider> {
  if (choice === "chatgpt") return createChatgptProvider(await getWorkspaceAiKey(workspaceId, "openai"));
  if (choice === "gemini") return createGeminiProvider(await getWorkspaceAiKey(workspaceId, "gemini"));
  const conn = await getLiveConnection(supabase, workspaceId, "higgsfield");
  const higgs =
    conn && conn.status === "connected"
      ? createHiggsfieldProvider({
          serverUrl: conn.server_url,
          accessToken: conn.access_token,
          tools: (conn.tools ?? []) as { name: string; description?: string | undefined }[],
        })
      : null;
  if (choice === "higgsfield") {
    if (!higgs) throw new Error("Higgsfield não está conectado nesta empresa. Conecte em Integrações.");
    return higgs;
  }
  // Automático: ChatGPT (chave) → Gemini (chave) → Higgsfield → créditos do app.
  const [gKey, oKey] = await Promise.all([getWorkspaceAiKey(workspaceId, "gemini"), getWorkspaceAiKey(workspaceId, "openai")]);
  const list: ServerCreativeProvider[] = [];
  if (oKey) list.push(createChatgptProvider(oKey, { strict: true }));
  if (gKey) list.push(createGeminiProvider(gKey, { strict: true }));
  if (higgs) list.push(higgs);
  // Sem conexões próprias: créditos de IA do app. Nunca cai no gerador simulado (foto aleatória).
  const app: ServerCreativeProvider = { ...createGeminiProvider(null), label: "Créditos de IA do app" };
  if (!list.length) return app;
  list.push(app);
  return chainProviders(list);
}

export const providerLog = (p: ServerCreativeProvider, r?: GenerationResult | null) => {
  const log = (p as { log?: string[] }).log;
  if (log?.length) return log.join("\n");
  return r?.note ? `Usado: ${r.note}` : `Usado: ${p.label}`;
};

export type RunGenerationInput = {
  jobId: string;
  workspaceId: string;
  brandId: string | null;
  campaignId: string | null;
  title: string;
  type: string;
  aspectRatio: string;
  prompt: string;
  finalPrompt: string;
  copyText: string;
  kind: CreativeKind;
  brandContext: Record<string, unknown>;
  existingCreativeId?: string | null;
  providerChoice?: ProviderChoice;
  targetFormat?: string | null | undefined;
  angle?: string | null | undefined;
  /** Vídeo: começa pela foto real do produto/marca (imagem → vídeo). Padrão: sim, se houver foto. */
  useBrandImage?: boolean | undefined;
  /** Vídeo: capa com logo/CTA e legendas (persistido no job para o cron). */
  videoOptions?: { coverWithLogo?: boolean; headline?: string | null; cta?: string | null; captionText?: string | null } | null | undefined;
};

export async function runGeneration(supabase: DB, input: RunGenerationInput) {
  return finalizeWith(supabase, null, input);
}

async function finalizeWith(supabase: DB, injected: ServerCreativeProvider | null, input: RunGenerationInput) {
  let provider: ServerCreativeProvider;
  try {
    if (injected) provider = injected;
    else provider = await resolveProvider(supabase, input.workspaceId, input.providerChoice);
  } catch (e) {
    await supabase
      .from("creative_generation_jobs")
      .update({ status: "failed", provider: input.providerChoice ?? "auto", error_message: errMessage(e), completed_at: new Date().toISOString() })
      .eq("id", input.jobId);
    return {
      jobId: input.jobId,
      creativeId: input.existingCreativeId ?? null,
      status: "failed" as const,
      assetUrl: null as string | null,
      provider: input.providerChoice ?? "auto",
      sandbox: false,
      error: errMessage(e),
    };
  }

  await supabase
    .from("creative_generation_jobs")
    .update({ status: "generating", provider: provider.id })
    .eq("id", input.jobId);

  try {
    const req: import("./providers/creative-provider.server").GenerationRequest = {
      finalPrompt: input.finalPrompt,
      aspectRatio: input.aspectRatio,
      kind: input.kind,
      brandContext: input.brandContext,
    };
    if (input.kind === "video" && !injected) {
      // Vídeo em segundo plano: espera até 25 s; se não terminar, o cron conclui e o criativo aparece sozinho.
      req.maxWaitMs = 25_000;
      if (input.useBrandImage !== false && input.brandId) {
        const { loadBrandRefs } = await import("./creative/refs.server");
        const refs = await loadBrandRefs(input.brandId, { max: 1 }).catch(() => []);
        if (refs.length) {
          req.referenceImages = refs.map((r) => ({ bytes: r.bytes, mime: r.mime }));
          req.referenceUrls = refs.map((r) => r.url);
        }
      }
    }
    const result =
      input.kind === "video" ? await provider.generateVideo(req) : await provider.generateImage(req);
    await supabase
      .from("creative_generation_jobs")
      .update({ provider: provider.id, provider_log: providerLog(provider, result) } as never)
      .eq("id", input.jobId);

    // Geração assíncrona: guarda o job externo e deixa o poller concluir depois.
    if (result.status === "generating" && result.externalJobId) {
      await supabase
        .from("creative_generation_jobs")
        .update({ status: "generating", provider: provider.id, external_job_id: result.externalJobId, creative_id: input.existingCreativeId ?? null })
        .eq("id", input.jobId);
      return {
        jobId: input.jobId,
        creativeId: input.existingCreativeId ?? null,
        status: "generating" as const,
        assetUrl: null as string | null,
        provider: provider.id,
        sandbox: provider.sandbox,
        error: null as string | null,
      };
    }
    if (result.status !== "ready" || !result.assetUrl) {
      throw new Error("O provedor não devolveu um ativo pronto.");
    }

    // Biblioteca de mídia: baixa do provedor, padroniza no formato de destino e salva no bucket.
    let assetId: string | null = null;
    if (!provider.sandbox) {
      try {
        const { ingestAsset, guessTarget } = await import("./media/assets.server");
        const asset = await ingestAsset({
          workspaceId: input.workspaceId,
          kind: input.kind === "video" ? "video" : "image",
          targetFormat: guessTarget(input.aspectRatio, input.kind === "video", input.targetFormat),
          source: provider.id,
          sourceUrl: result.assetUrl,
          title: input.title,
          prompt: input.finalPrompt,
          provider: provider.id,
          cost: result.cost,
          brandId: input.brandId,
          campaignId: input.campaignId,
          angle: input.angle ?? null,
        });
        assetId = asset.id;
        result.assetUrl = asset.url;
        result.thumbnailUrl = asset.thumbnail_url ?? asset.url;
      } catch (e) {
        console.error("[creative-generation] biblioteca de mídia falhou", errMessage(e));
      }
    }

    let creativeId = input.existingCreativeId ?? null;
    let version = 1;

    if (creativeId) {
      const { data: cr } = await supabase.from("creatives").select("version").eq("id", creativeId).maybeSingle();
      version = (cr?.version ?? 0) + 1;
      await supabase
        .from("creatives")
        .update({
          status: "ready",
          preview_url: result.assetUrl,
          thumbnail_url: result.thumbnailUrl,
          provider: provider.id,
          version,
          error_message: null,
          external_job_id: result.externalJobId,
          real_cost: result.cost,
        })
        .eq("id", creativeId);
    } else {
      const { data: created, error } = await supabase
        .from("creatives")
        .insert({
          workspace_id: input.workspaceId,
          campaign_id: input.campaignId,
          brand_id: input.brandId,
          title: input.title,
          type: input.type,
          prompt: input.prompt,
          final_prompt: input.finalPrompt,
          aspect_ratio: input.aspectRatio,
          copy_text: input.copyText,
          status: "ready",
          provider: provider.id,
          estimated_cost: result.cost,
          real_cost: result.cost,
          preview_url: result.assetUrl,
          thumbnail_url: result.thumbnailUrl,
          external_job_id: result.externalJobId,
          version: 1,
          angle: input.angle ?? null,
        } as never)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      creativeId = (created as { id: string }).id;
    }

    if (assetId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("media_assets" as never).update({ creative_id: creativeId } as never).eq("id", assetId);
    }

    // 4.2 Vídeo pronto: legendas (.vtt/.srt) e, se pedido, capa com logo e CTA.
    if (input.kind === "video" && creativeId) {
      try {
        const opts = input.videoOptions ?? {};
        const { buildVideoExtras } = await import("./creative/video-extras.server");
        const { data: brandRow } = input.brandId
          ? await supabase.from("brands").select("id, primary_color, secondary_color").eq("id", input.brandId).maybeSingle()
          : { data: null };
        const coverProvider = opts.coverWithLogo
          ? await resolveProvider(supabase, input.workspaceId, choiceForProvider(provider.id)).catch(() => null)
          : null;
        const extras = await buildVideoExtras({
          workspaceId: input.workspaceId,
          brand: brandRow as never,
          provider: coverProvider,
          visualPrompt: input.finalPrompt,
          aspectRatio: input.aspectRatio,
          durationSec: provider.id === "higgsfield" ? 10 : 8,
          headline: opts.headline ?? null,
          cta: opts.cta ?? null,
          captionText: opts.captionText ?? input.copyText ?? null,
          videoAssetId: assetId,
          campaignId: input.campaignId,
          title: input.title,
          withCover: !!opts.coverWithLogo,
        });
        await supabase.from("creatives").update({ extras } as never).eq("id", creativeId);
      } catch (e) {
        console.error("[video-extras] falhou", errMessage(e));
      }
    }

    await supabase.from("creative_versions").insert({
      workspace_id: input.workspaceId,
      creative_id: creativeId,
      version,
      prompt: input.finalPrompt,
      preview_url: result.assetUrl,
    });

    await supabase
      .from("creative_generation_jobs")
      .update({
        status: "ready",
        creative_id: creativeId,
        asset_url: result.assetUrl,
        thumbnail_url: result.thumbnailUrl,
        external_job_id: result.externalJobId,
        estimated_cost: result.cost,
        actual_cost: result.cost,
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.jobId);

    return {
      jobId: input.jobId,
      creativeId,
      status: "ready" as const,
      assetUrl: result.assetUrl,
      provider: provider.id,
      sandbox: provider.sandbox,
      error: null as string | null,
    };
  } catch (e) {
    // Detalhe técnico só no log do servidor; o usuário recebe mensagem simples.
    console.error("[creative-generation] falhou", {
      jobId: input.jobId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      provider: provider.id,
      at: new Date().toISOString(),
      error: e,
    });
    await supabase
      .from("creative_generation_jobs")
      .update({
        status: "failed",
        provider: provider.id,
        error_message: errMessage(e),
        provider_log: providerLog(provider),
        completed_at: new Date().toISOString(),
      } as never)
      .eq("id", input.jobId);

    return {
      jobId: input.jobId,
      creativeId: input.existingCreativeId ?? null,
      status: "failed" as const,
      assetUrl: null as string | null,
      provider: provider.id,
      sandbox: provider.sandbox,
      error: errMessage(e),
    };
  }
}

const choiceForProvider = (id: string): ProviderChoice =>
  id === "higgsfield" || id === "chatgpt" || id === "gemini" ? id : "auto";

/** Conclui jobs do Creative Studio que ficaram "generating" com job externo (chamado pelo cron). */
export async function pollPendingCreatives(supabase: DB) {
  const { data } = await supabase
    .from("creative_generation_jobs")
    .select("*")
    .eq("status", "generating")
    .not("external_job_id", "is", null)
    .limit(20);
  const out: { job: string; status: string }[] = [];
  for (const job of (data ?? []) as any[]) {
    try {
      const provider = await resolveProvider(supabase, job.workspace_id, choiceForProvider(job.provider));
      const r = await provider.getGenerationStatus(job.external_job_id);
      if (r.status === "generating") {
        if (Date.now() - new Date(job.created_at).getTime() > 60 * 60e3) throw new Error("Tempo esgotado no provedor.");
        out.push({ job: job.id, status: "generating" });
        continue;
      }
      const assetUrl = r.assetUrl ?? (r.status === "ready" ? await provider.getAsset(job.external_job_id) : null);
      if (r.status !== "ready" || !assetUrl) throw new Error("O provedor informou falha na geração.");
      const kind: CreativeKind = /video|reel|story_video/i.test(job.type ?? "") ? ("video" as CreativeKind) : ("image" as CreativeKind);
      const fixed: ServerCreativeProvider = {
        ...provider,
        generateImage: async () => ({ ...r, status: "ready", assetUrl, externalJobId: job.external_job_id }),
        generateVideo: async () => ({ ...r, status: "ready", assetUrl, externalJobId: job.external_job_id }),
      };
      const res = await finalizeWith(supabase, fixed, {
        jobId: job.id,
        workspaceId: job.workspace_id,
        brandId: job.brand_id,
        campaignId: job.campaign_id,
        title: String(job.prompt ?? "Criativo").slice(0, 80),
        type: job.type,
        aspectRatio: job.aspect_ratio ?? "1:1",
        prompt: job.prompt ?? "",
        finalPrompt: job.final_prompt ?? job.prompt ?? "",
        copyText: "",
        kind,
        brandContext: {},
        existingCreativeId: job.creative_id,
        videoOptions: (job.options ?? null) as RunGenerationInput["videoOptions"],
      });
      out.push({ job: job.id, status: res.status });
    } catch (e) {
      await supabase
        .from("creative_generation_jobs")
        .update({ status: "failed", error_message: errMessage(e), completed_at: new Date().toISOString() })
        .eq("id", job.id);
      out.push({ job: job.id, status: "failed" });
    }
  }
  return out;
}

/* ---------------- Direção de arte (imagens) ---------------- */

export type ArtInput = {
  workspaceId: string;
  brand: any | null;
  campaign: any | null;
  title: string;
  type: string;
  prompt: string;
  copyText: string;
  aspectRatio: string;
  targetFormat?: string | null | undefined;
  providerChoice: ProviderChoice;
  kind: CreativeKind;
  visualPrompt?: string | null | undefined;
  artDirection?: Record<string, unknown> | null | undefined;
  adjust?: string | null | undefined;
  layout: import("./creative/visual-style").TextLayout;
  variations: number;
  headline?: string | null | undefined;
  price?: string | null | undefined;
  cta?: string | null | undefined;
  angle?: string | null | undefined;
  useBrandImage?: boolean | undefined;
  coverWithLogo?: boolean | undefined;
  userId: string;
};

/** Monta (ou reaproveita, se o usuário editou) a direção de arte. */
export async function directArt(supabase: DB, input: Omit<ArtInput, "layout" | "variations" | "userId">, providerId: string) {
  const { buildVisualPrompt } = await import("./creative/art-director.server");
  const { data: products } = input.brand?.id
    ? await supabase.from("products").select("name, description").eq("brand_id", input.brand.id).limit(3)
    : { data: [] as any[] };
  const { count } = input.brand?.id
    ? await supabase
        .from("brand_assets")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", input.brand.id)
        .in("kind", ["reference", "photo"])
        .eq("tag", "produto")
    : { count: 0 };
  // A estratégia aprovada da campanha (big idea, ângulo, direção visual) orienta o diretor de arte.
  const { currentStrategy, strategyBrief } = await import("./ai/strategist.server");
  const strategy = strategyBrief(await currentStrategy(supabase, input.campaign?.id), input.angle);
  const brief = {
    workspaceId: input.workspaceId,
    brand: input.brand,
    campaign: input.campaign,
    strategy,
    products: products ?? [],
    theme: input.title,
    hook: input.copyText || null,
    offer: input.campaign?.offer_product ?? null,
    userPrompt: input.prompt,
    aspectRatio: input.aspectRatio,
    kind: input.kind,
    provider: providerId,
    hasProductRef: (count ?? 0) > 0,
  };
  if (input.visualPrompt && input.artDirection && !input.adjust) {
    return { ad: { ...(input.artDirection as any), prompt_final: input.visualPrompt }, brief };
  }
  const ad = await buildVisualPrompt({
    ...brief,
    adjust: input.adjust ?? null,
    previousPrompt: input.visualPrompt ?? null,
  });
  return { ad, brief };
}

export async function runArtDirected(supabase: DB, input: ArtInput) {
  const { buildVisualPrompt, providerPrompt } = await import("./creative/art-director.server");
  const provider = await resolveProvider(supabase, input.workspaceId, input.providerChoice);
  const { ad, brief } = await directArt(supabase, input, provider.id);
  const finalPrompt = providerPrompt(ad);
  const videoOptions =
    input.kind === "video"
      ? { coverWithLogo: !!input.coverWithLogo, headline: input.headline ?? null, cta: input.cta ?? null, captionText: input.copyText || null }
      : null;
  const { data: job, error: jobError } = await supabase
    .from("creative_generation_jobs")
    .insert({
      workspace_id: input.workspaceId,
      brand_id: input.brand?.id ?? null,
      campaign_id: input.campaign?.id ?? null,
      provider: provider.id,
      type: input.type,
      prompt: input.prompt,
      final_prompt: finalPrompt,
      aspect_ratio: input.aspectRatio,
      status: "generating",
      created_by: input.userId,
      options: videoOptions,
    } as never)
    .select()
    .single();
  if (jobError) throw new Error(jobError.message);

  const base: RunGenerationInput = {
    jobId: job.id,
    workspaceId: input.workspaceId,
    brandId: input.brand?.id ?? null,
    campaignId: input.campaign?.id ?? null,
    title: input.title || input.campaign?.name || "Criativo sem título",
    type: input.type,
    aspectRatio: input.aspectRatio,
    targetFormat: input.targetFormat ?? null,
    prompt: input.prompt,
    finalPrompt,
    copyText: input.copyText,
    kind: input.kind,
    brandContext: { art_direction: ad },
    providerChoice: input.providerChoice,
    angle: input.angle ?? null,
    useBrandImage: input.useBrandImage,
    videoOptions,
  };

  // Vídeo e simulado: só o prompt do diretor de arte, fluxo de sempre.
  if (input.kind === "video" || provider.sandbox) {
    const r = await finalizeWith(supabase, provider, base);
    return { ...r, artDirection: ad, variations: [] as import("./creative/visual-style").Variation[] };
  }

  try {
    const { runImagePipeline } = await import("./creative/pipeline.server");
    const { loadBrandRefs } = await import("./creative/refs.server");
    const { guessTarget } = await import("./media/assets.server");
    const vs = (input.brand?.visual_style ?? {}) as { referencias?: string[] };
    const refs = await loadBrandRefs(input.brand?.id, { max: 4, ids: vs.referencias?.length ? vs.referencias : undefined });
    const res = await runImagePipeline({
      workspaceId: input.workspaceId,
      brand: input.brand,
      provider,
      ad,
      aspectRatio: input.aspectRatio,
      targetFormat: guessTarget(input.aspectRatio, false, input.targetFormat),
      refs,
      variations: input.variations,
      layout: input.layout,
      text: { title: input.headline ?? input.copyText ?? null, price: input.price ?? null, cta: input.cta ?? null },
      title: base.title,
      campaignId: base.campaignId,
      angle: input.angle ?? null,
      createdBy: input.userId,
      rebuild: (motivo) =>
        buildVisualPrompt({ ...brief, previousPrompt: ad.prompt_final, adjust: `Corrija este problema apontado pelo crítico: ${motivo}` }),
    });
    if (res.pending) {
      const fixed: ServerCreativeProvider = { ...provider, generateImage: async () => res.pending };
      const r = await finalizeWith(supabase, fixed, base);
      return { ...r, artDirection: ad, variations: [] };
    }
    const { data: created, error } = await supabase
      .from("creatives")
      .insert({
        workspace_id: input.workspaceId,
        campaign_id: base.campaignId,
        brand_id: base.brandId,
        title: base.title,
        type: input.type,
        prompt: input.prompt,
        final_prompt: providerPrompt(res.ad),
        aspect_ratio: input.aspectRatio,
        copy_text: input.copyText,
        status: "ready",
        provider: provider.id,
        estimated_cost: res.cost,
        real_cost: res.cost,
        preview_url: res.finalUrl,
        thumbnail_url: res.finalThumb,
        version: 1,
        angle: input.angle ?? null,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("media_assets" as never)
      .update({ creative_id: created.id } as never)
      .in("id", [res.finalAssetId, ...res.variations.map((v) => v.assetId)]);
    await supabase.from("creative_versions").insert({
      workspace_id: input.workspaceId,
      creative_id: created.id,
      version: 1,
      prompt: providerPrompt(res.ad),
      preview_url: res.finalUrl,
    });
    await supabase
      .from("creative_generation_jobs")
      .update({
        status: "ready",
        creative_id: created.id,
        final_prompt: providerPrompt(res.ad),
        asset_url: res.finalUrl,
        thumbnail_url: res.finalThumb,
        provider: provider.id,
        provider_log: providerLog(provider),
        estimated_cost: res.cost,
        actual_cost: res.cost,
        completed_at: new Date().toISOString(),
      } as never)
      .eq("id", job.id);
    return {
      jobId: job.id,
      creativeId: created.id as string | null,
      status: "ready" as const,
      assetUrl: res.finalUrl as string | null,
      provider: provider.id,
      sandbox: false,
      error: null as string | null,
      artDirection: res.ad,
      variations: res.variations,
    };
  } catch (e) {
    console.error("[art-pipeline] falhou", e);
    await supabase
      .from("creative_generation_jobs")
      .update({ status: "failed", provider: provider.id, error_message: errMessage(e), provider_log: providerLog(provider), completed_at: new Date().toISOString() } as never)
      .eq("id", job.id);
    return {
      jobId: job.id,
      creativeId: null,
      status: "failed" as const,
      assetUrl: null,
      provider: provider.id,
      sandbox: false,
      error: errMessage(e),
      artDirection: ad,
      variations: [],
    };
  }
}
