import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const generateInput = z.object({
  workspaceId: z.string().uuid(),
  campaignId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  title: z.string().default(""),
  type: z.string().default("static_image"),
  aspectRatio: z.string().default("1:1"),
  targetFormat: z.string().nullable().optional(),
  prompt: z.string().default(""),
  copyText: z.string().default(""),
  provider: z.enum(["auto", "higgsfield", "chatgpt", "gemini"]).default("auto"),
  visualPrompt: z.string().max(4000).nullable().optional(),
  artDirection: z.record(z.string(), z.unknown()).nullable().optional(),
  adjust: z.string().max(300).nullable().optional(),
  layout: z.enum(["limpo", "titulo_topo", "preco_destaque", "cta_rodape"]).default("limpo"),
  variations: z.number().int().min(1).max(4).default(3),
  headline: z.string().max(120).nullable().optional(),
  price: z.string().max(40).nullable().optional(),
  cta: z.string().max(40).nullable().optional(),
});
const CHOICES = new Set(["higgsfield", "chatgpt", "gemini"]);

const VIDEO_TYPES = new Set(["video", "ugc", "reels", "story"]);

/**
 * Gera um criativo ponta a ponta:
 * Brand Brain + campanha → prompt final → provedor (Higgsfield MCP ou simulado)
 * → job registrado → criativo salvo no banco.
 */
export const generateCreative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => generateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { buildBrandBrainPrompt, runArtDirected } = await import("./creative.server");
    const supabase = context.supabase;
    const { brand, campaign } = await buildBrandBrainPrompt(supabase, data);
    return runArtDirected(supabase, {
      ...data,
      brand,
      campaign,
      title: data.title || campaign?.name || "Criativo sem título",
      providerChoice: data.provider,
      kind: VIDEO_TYPES.has(data.type) ? "video" : "image",
      userId: context.userId,
    });
  });

/** Mostra o prompt visual do diretor de arte antes de gerar (editável na tela). */
export const previewVisualPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => generateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { buildBrandBrainPrompt, directArt } = await import("./creative.server");
    const supabase = context.supabase;
    const { brand, campaign } = await buildBrandBrainPrompt(supabase, data);
    const target = data.provider === "auto" ? "higgsfield ou IA padrão" : data.provider;
    const { ad } = await directArt(
      supabase,
      {
        ...data,
        brand,
        campaign,
        title: data.title || campaign?.name || "",
        providerChoice: data.provider,
        kind: VIDEO_TYPES.has(data.type) ? "video" : "image",
      },
      target,
    );
    return { artDirection: ad };
  });

/** Analisa as fotos de referência e sugere o guia visual (o usuário revisa antes de salvar). */
export const generateBrandGuide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ brandId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: brand } = await context.supabase
      .from("brands")
      .select("id, workspace_id, name, segment, primary_color, secondary_color")
      .eq("id", data.brandId)
      .maybeSingle();
    if (!brand) throw new Error("Marca não encontrada.");
    const { loadBrandRefs } = await import("./creative/refs.server");
    const { visionJSON } = await import("./creative/llm.server");
    const refs = await loadBrandRefs(brand.id, { max: 6 });
    if (!refs.length) throw new Error("Envie ao menos uma foto de referência (produto, ambiente ou equipe).");
    const arr = { type: "array", items: { type: "string" } };
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["estilo_fotografico", "iluminacao", "paleta_hex", "ambientes", "elementos_obrigatorios", "elementos_proibidos", "fonte_titulo", "fonte_corpo"],
      properties: {
        estilo_fotografico: { type: "string" },
        iluminacao: { type: "string" },
        paleta_hex: arr,
        ambientes: arr,
        elementos_obrigatorios: arr,
        elementos_proibidos: arr,
        fonte_titulo: { type: "string" },
        fonte_corpo: { type: "string" },
      },
    };
    const prompt = [
      `Você é diretor de arte. Estas são fotos reais da marca "${brand.name}" (${brand.segment ?? "segmento não informado"}).`,
      "Monte o guia visual em português do Brasil, curto e objetivo:",
      "estilo_fotografico (ex.: fotografia gastronômica realista, close, fundo de bar de madeira), iluminacao,",
      "paleta_hex (4 a 6 cores #RRGGBB tiradas das fotos), ambientes (2 a 4), elementos_obrigatorios (o que deve aparecer),",
      "elementos_proibidos (inclua sempre: texto gerado pela IA, marcas de concorrentes), fonte_titulo e fonte_corpo (sugestões de Google Fonts coerentes).",
    ].join("\n");
    const guide = await visionJSON(brand.workspace_id, prompt, refs, schema, "brand_guide");
    return { guide, referencias: refs.map((r) => r.id) };
  });

/** Reprocessa um job que falhou, mantendo o mesmo prompt final. */
export const retryCreativeJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { runGeneration } = await import("./creative.server");
    const supabase = context.supabase;

    const { data: job, error } = await supabase
      .from("creative_generation_jobs")
      .select("*")
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Job de geração não encontrado.");

    await supabase
      .from("creative_generation_jobs")
      .update({ status: "queued", error_message: null })
      .eq("id", job.id);

    return runGeneration(supabase, {
      jobId: job.id,
      workspaceId: job.workspace_id,
      brandId: job.brand_id,
      campaignId: job.campaign_id,
      title: "Criativo (nova tentativa)",
      type: job.type,
      aspectRatio: job.aspect_ratio ?? "1:1",
      prompt: job.prompt ?? "",
      finalPrompt: job.final_prompt ?? job.prompt ?? "",
      copyText: "",
      kind: VIDEO_TYPES.has(job.type) ? "video" : "image",
      brandContext: {},
      existingCreativeId: job.creative_id,
      providerChoice: (CHOICES.has(job.provider) ? job.provider : "auto") as "auto",
    });
  });

/** Nova versão de um criativo existente, pelo mesmo provedor real do servidor (nunca simulado). */
export const newCreativeVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ creativeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { runGeneration } = await import("./creative.server");
    const supabase = context.supabase;
    const { data: cr, error } = await supabase.from("creatives").select("*").eq("id", data.creativeId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!cr) throw new Error("Criativo não encontrado.");
    const base = cr.final_prompt || cr.prompt || cr.title || "Criativo publicitário";
    const finalPrompt = `${base}\nNova variação (versão ${(cr.version ?? 1) + 1}): mude composição, enquadramento e cena, mantendo a identidade da marca.`;
    const providerChoice = (CHOICES.has(cr.provider ?? "") ? cr.provider : "auto") as "auto";
    const { data: job, error: jobError } = await supabase
      .from("creative_generation_jobs")
      .insert({
        workspace_id: cr.workspace_id,
        brand_id: cr.brand_id,
        campaign_id: cr.campaign_id,
        creative_id: cr.id,
        provider: providerChoice,
        type: cr.type,
        prompt: cr.prompt,
        final_prompt: finalPrompt,
        aspect_ratio: cr.aspect_ratio,
        status: "generating",
        created_by: context.userId,
      })
      .select()
      .single();
    if (jobError) throw new Error(jobError.message);
    return runGeneration(supabase, {
      jobId: job.id,
      workspaceId: cr.workspace_id,
      brandId: cr.brand_id,
      campaignId: cr.campaign_id,
      title: cr.title ?? "Criativo",
      type: cr.type,
      aspectRatio: cr.aspect_ratio ?? "1:1",
      prompt: cr.prompt ?? "",
      finalPrompt,
      copyText: cr.copy_text ?? "",
      kind: VIDEO_TYPES.has(cr.type) ? "video" : "image",
      brandContext: {},
      existingCreativeId: cr.id,
      providerChoice,
    });
  });
