import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { EDITORS, requireRole } from "@/lib/membership";

const ws = z.object({ workspaceId: z.string().uuid() });

/** 4.6 Envia uma mídia da biblioteca para os uploads do Canva da empresa. */
export const canvaSendAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ assetId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, EDITORS);
    const { data: a } = await context.supabase
      .from("media_assets")
      .select("id, url, title, workspace_id")
      .eq("id", data.assetId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (!a) throw new Error("Mídia não encontrada.");
    const { sendAssetToCanva } = await import("./canva.server");
    return sendAssetToCanva(context.supabase, data.workspaceId, { url: a.url as string, title: (a.title as string) ?? "Criativo" });
  });

/** Cria um design editável no Canva a partir da copy da campanha. */
export const canvaCreateFromBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ brief: z.string().min(10).max(4000), format: z.string().max(60).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, EDITORS);
    const { createCanvaDesign } = await import("./canva.server");
    return createCanvaDesign(context.supabase, data.workspaceId, data.brief, data.format ?? null);
  });

export const canvaListDesigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ query: z.string().max(100).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId);
    const { listCanvaDesigns } = await import("./canva.server");
    return listCanvaDesigns(context.supabase, data.workspaceId, data.query ?? null);
  });

/** Traz um design do Canva (PNG/MP4) para a biblioteca, ligado à marca e campanha. */
export const canvaImportDesign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ws
      .extend({
        designId: z.string().trim(),
        title: z.string().max(200).nullable().optional(),
        brandId: z.string().uuid().nullable().optional(),
        campaignId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, EDITORS);
    const designId = /D[A-Za-z0-9_-]{10}/.exec(data.designId)?.[0] ?? data.designId;
    const { importCanvaDesign } = await import("./canva.server");
    const asset = await importCanvaDesign(context.supabase, data.workspaceId, {
      designId,
      title: data.title ?? null,
      brandId: data.brandId ?? null,
      campaignId: data.campaignId ?? null,
      createdBy: context.userId,
    });
    return { id: asset.id, url: asset.url };
  });
