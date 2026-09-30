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
  mockServerProvider,
  type CreativeKind,
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

export async function resolveProvider(supabase: DB, workspaceId: string, choice: ProviderChoice = "auto") {
  if (choice === "chatgpt") return createChatgptProvider(await getWorkspaceAiKey(workspaceId, "openai"));
  if (choice === "gemini") return createGeminiProvider(await getWorkspaceAiKey(workspaceId, "gemini"));
  const conn = await getLiveConnection(supabase, workspaceId, "higgsfield");
  if (conn && conn.status === "connected") {
    return createHiggsfieldProvider({
      serverUrl: conn.server_url,
      accessToken: conn.access_token,
      tools: (conn.tools ?? []) as { name: string; description?: string | undefined }[],
    });
  }
  if (choice === "higgsfield") throw new Error("Higgsfield não está conectado. Conecte em Integrações.");
  return mockServerProvider;
}

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
};

export async function runGeneration(supabase: DB, input: RunGenerationInput) {
  let provider: ServerCreativeProvider;
  try {
    provider = await resolveProvider(supabase, input.workspaceId, input.providerChoice);
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
    const req = {
      finalPrompt: input.finalPrompt,
      aspectRatio: input.aspectRatio,
      kind: input.kind,
      brandContext: input.brandContext,
    };
    const result =
      input.kind === "video" ? await provider.generateVideo(req) : await provider.generateImage(req);

    if (result.status !== "ready" || !result.assetUrl) {
      throw new Error("O provedor não devolveu um ativo pronto.");
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
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      creativeId = created.id;
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
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.jobId);

    return {
      jobId: input.jobId,
      creativeId: input.existingCreativeId ?? null,
      status: "failed" as const,
      assetUrl: null as string | null,
      provider: provider.id,
      sandbox: provider.sandbox,
      error: "Não foi possível gerar este criativo. Tente novamente.",
    };
  }
}
