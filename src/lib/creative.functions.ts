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
  prompt: z.string().default(""),
  copyText: z.string().default(""),
});

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
    const { buildBrandBrainPrompt, runGeneration } = await import("./creative.server");
    const supabase = context.supabase;

    const { brand, campaign, finalPrompt, brandContext } = await buildBrandBrainPrompt(supabase, data);

    const { data: job, error: jobError } = await supabase
      .from("creative_generation_jobs")
      .insert({
        workspace_id: data.workspaceId,
        brand_id: brand?.id ?? null,
        campaign_id: campaign?.id ?? null,
        provider: "pending",
        type: data.type,
        prompt: data.prompt,
        final_prompt: finalPrompt,
        aspect_ratio: data.aspectRatio,
        status: "queued",
        created_by: context.userId,
      })
      .select()
      .single();
    if (jobError) throw new Error(jobError.message);

    return runGeneration(supabase, {
      jobId: job.id,
      workspaceId: data.workspaceId,
      brandId: brand?.id ?? null,
      campaignId: campaign?.id ?? null,
      title: data.title || campaign?.name || "Criativo sem título",
      type: data.type,
      aspectRatio: data.aspectRatio,
      prompt: data.prompt,
      finalPrompt,
      copyText: data.copyText,
      kind: VIDEO_TYPES.has(data.type) ? "video" : "image",
      brandContext,
    });
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
    });
  });
