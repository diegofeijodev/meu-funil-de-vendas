import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { EDITORS, requireRole } from "@/lib/membership";

const byCampaign = z.object({ campaignId: z.string().uuid() });

async function campaignOf(ctx: { supabase: any }, campaignId: string) {
  const { data } = await ctx.supabase.from("campaigns").select("id, workspace_id, brand_id, name, objective").eq("id", campaignId).maybeSingle();
  if (!data) throw new Error("Campanha não encontrada.");
  return data as { id: string; workspace_id: string; brand_id: string | null; name: string; objective: string };
}

/** 1.1 Gera (ou regera) a estratégia com IA e salva uma nova versão em rascunho. */
export const generateCampaignStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => byCampaign.parse(d))
  .handler(async ({ data, context }) => {
    const c = await campaignOf(context, data.campaignId);
    await requireRole(context, c.workspace_id, EDITORS);
    const { generateStrategyAI } = await import("./strategist.server");
    const content = await generateStrategyAI(context.supabase, c.id);
    const { data: last } = await context.supabase
      .from("campaign_strategies")
      .select("version")
      .eq("campaign_id", c.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (last?.version ?? 0) + 1;
    const { error } = await context.supabase.from("campaign_strategies").insert({
      workspace_id: c.workspace_id,
      campaign_id: c.id,
      content,
      status: "draft",
      version,
    });
    if (error) throw new Error(error.message);
    await context.supabase.from("activity_logs").insert({
      workspace_id: c.workspace_id,
      actor_id: context.userId,
      action: "campaign.strategy_generated",
      entity_type: "campaign",
      metadata: { campaign_id: c.id, version } as never,
    });
    return { version, content };
  });

/** 1.2 Aprova a versão: ela passa a ser o briefing de copy, criativos, vídeos e públicos. */
export const approveCampaignStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ strategyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: s } = await context.supabase
      .from("campaign_strategies")
      .select("id, workspace_id, campaign_id, version")
      .eq("id", data.strategyId)
      .maybeSingle();
    if (!s) throw new Error("Estratégia não encontrada.");
    await requireRole(context, s.workspace_id, EDITORS);
    await context.supabase
      .from("campaign_strategies")
      .update({ status: "superseded" })
      .eq("campaign_id", s.campaign_id)
      .eq("status", "approved");
    const { error } = await context.supabase.from("campaign_strategies").update({ status: "approved" }).eq("id", s.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("activity_logs").insert({
      workspace_id: s.workspace_id,
      actor_id: context.userId,
      action: "campaign.strategy_approved",
      entity_type: "campaign",
      metadata: { campaign_id: s.campaign_id, version: s.version } as never,
    });
    return { ok: true };
  });

/** 1.3 Cria o plano de conteúdo do Instagram a partir da estratégia (pilares, pesos, temas, frequência). */
export const createIgPlanFromStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => byCampaign.parse(d))
  .handler(async ({ data, context }) => {
    const c = await campaignOf(context, data.campaignId);
    await requireRole(context, c.workspace_id, EDITORS);
    const { currentStrategy } = await import("./strategist.server");
    const s = await currentStrategy(context.supabase, c.id);
    if (!s) throw new Error("Gere a estratégia da campanha primeiro.");
    const plan = s.plano_instagram;
    const pillars = (plan?.pilares ?? []).map((p) => p.nome).filter(Boolean);
    if (!pillars.length) throw new Error("Esta versão da estratégia não tem plano do Instagram. Regere a estratégia.");
    const total = (plan?.pilares ?? []).reduce((acc, p) => acc + (Number(p.peso) || 0), 0) || 1;
    const weights = Object.fromEntries((plan?.pilares ?? []).map((p) => [p.nome, Math.round(((Number(p.peso) || 0) / total) * 100) / 100]));
    const { data: brand } = c.brand_id
      ? await context.supabase.from("brands").select("tone_of_voice").eq("id", c.brand_id).maybeSingle()
      : { data: null };
    const freq = plan?.frequencia ?? { feed: 3, reels: 2, stories: 7 };
    const { data: created, error } = await context.supabase
      .from("ig_content_plans")
      .insert({
        workspace_id: c.workspace_id,
        brand_id: c.brand_id,
        name: `Instagram · ${c.name}`,
        objective: s.objetivo_smart || s.big_idea,
        tone_of_voice: brand?.tone_of_voice ?? null,
        content_pillars: pillars,
        pillar_weights: weights,
        posting_frequency: {
          feed_image: Math.max(1, Math.round(Number(freq.feed) * 0.6)),
          feed_carousel: Math.max(0, Math.round(Number(freq.feed) * 0.4)),
          feed: Number(freq.feed) || 3,
          reels: Number(freq.reels) || 2,
          stories: Number(freq.stories) || 7,
        },
        hashtag_strategy: { notes: `Temas da campanha: ${(plan?.temas ?? []).join("; ")}`, audience: s.icp },
        cta_default: s.briefing_criativo?.cta ?? null,
        requires_approval: true,
        auto_publish: false,
        status: "draft",
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { planId: (created as { id: string }).id };
  });
