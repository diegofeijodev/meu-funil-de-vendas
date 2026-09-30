import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const EDIT = ["owner", "admin", "marketing"];
const TARGETS = [
  "ig_feed_square",
  "ig_feed_portrait",
  "ig_story",
  "ig_reel",
  "meta_ad_square",
  "meta_ad_vertical",
  "meta_ad_landscape",
  "other",
] as const;

async function requireMember(ctx: { supabase: any; userId: string }, workspaceId: string, roles?: string[]) {
  const { data } = await ctx.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!data) throw new Error("Você não tem acesso a esta área de trabalho.");
  if (roles && !roles.includes(data.role)) throw new Error("Seu papel não permite esta ação.");
}

const lib = () => import("./library.server");
const ws = z.string().uuid();
const ids = z.array(z.string().uuid()).min(1).max(100);

export const downloadAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: ws, assetId: z.string().uuid(), format: z.enum(["original", "png", "jpg"]).default("original") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    return (await lib()).downloadAsset(data.workspaceId, data.assetId, data.format);
  });

export const exportPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: ws, assetIds: ids, layout: z.enum(["one_per_page", "contact_sheet"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    return (await lib()).exportPdf(data.workspaceId, data.assetIds, data.layout);
  });

export const exportZip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: ws, assetIds: ids }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    return (await lib()).exportZip(data.workspaceId, data.assetIds);
  });

export const uploadMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error("Envio inválido.");
    const file = d.get("file");
    if (!(file instanceof File)) throw new Error("Arquivo ausente.");
    return {
      workspaceId: ws.parse(d.get("workspaceId")),
      target: z.enum(TARGETS).parse(d.get("target") ?? "other"),
      brandId: (d.get("brandId") as string) || null,
      file,
    };
  })
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, EDIT);
    const a = await (await lib()).uploadToLibrary(data.workspaceId, data.file, data.target, context.userId, {
      brandId: data.brandId,
    });
    return { id: a.id, igReady: a.ig_ready, issues: a.quality_report?.issues ?? [] };
  });

export const reformatMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: ws, assetId: z.string().uuid(), targets: z.array(z.enum(TARGETS)).min(1).max(8) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, EDIT);
    return { ids: await (await lib()).reformat(data.workspaceId, data.assetId, data.targets, context.userId) };
  });

export const useMediaInInstagram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: ws, assetIds: ids }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, EDIT);
    return (await lib()).useInInstagram(data.workspaceId, data.assetIds);
  });

export const useMediaInCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: ws, assetIds: ids, campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, EDIT);
    return (await lib()).useInCampaign(data.workspaceId, data.assetIds, data.campaignId);
  });

/** Anexa uma mídia da biblioteca a um post do Instagram (substitui a mídia atual). */
export const attachMediaToPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: ws, postId: z.string().uuid(), assetIds: ids }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, EDIT);
    const { supabaseAdmin: s } = await import("@/integrations/supabase/client.server");
    const { data: post } = await s.from("ig_posts").select("id, format").eq("id", data.postId).eq("workspace_id", data.workspaceId).maybeSingle();
    if (!post) throw new Error("Post não encontrado.");
    const { data: rows } = await s.from("media_assets" as never).select("*").eq("workspace_id", data.workspaceId).in("id", data.assetIds);
    const assets = data.assetIds.map((id) => ((rows ?? []) as any[]).find((r) => r.id === id)).filter(Boolean) as any[];
    const bad = assets.filter((a) => !a.ig_ready);
    if (bad.length) throw new Error(`Mídia não está pronta para o Instagram: ${(bad[0].quality_report?.issues ?? []).join(" ") || "sem validação."}`);
    const media = assets.slice(0, post.format === "feed_carousel" ? 10 : 1).map((a, i) => ({
      url: a.url,
      type: a.kind,
      order: i,
      width: a.width,
      height: a.height,
      duration: a.duration_seconds,
      asset_id: a.id,
      ig_ready: a.ig_ready,
    }));
    await s.from("ig_posts").update({ media } as never).eq("id", data.postId);
    await s.from("media_assets" as never).update({ ig_post_id: data.postId } as never).in("id", data.assetIds);
    return { ok: true, items: media.length };
  });
