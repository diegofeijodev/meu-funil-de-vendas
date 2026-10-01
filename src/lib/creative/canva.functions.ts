import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { EDITORS, MANAGERS, requireRole } from "@/lib/membership";

const ws = z.object({ workspaceId: z.string().uuid() });

export const canvaGetStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId);
    const { canvaStatus } = await import("./canva.server");
    return canvaStatus(data.workspaceId);
  });

export const canvaSaveApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ws.extend({ clientId: z.string().trim().min(4).max(200), clientSecret: z.string().trim().max(500).nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, MANAGERS);
    const { saveCanvaApp } = await import("./canva.server");
    await saveCanvaApp(data.workspaceId, data.clientId, data.clientSecret ?? null);
    return { ok: true };
  });

export const canvaOAuthStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, MANAGERS);
    const { startCanvaOAuth } = await import("./canva.server");
    return { authUrl: await startCanvaOAuth(data.workspaceId) };
  });

export const canvaTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId);
    const { testCanva } = await import("./canva.server");
    return testCanva(data.workspaceId);
  });

export const canvaDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, MANAGERS);
    const { disconnectCanva } = await import("./canva.server");
    await disconnectCanva(data.workspaceId);
    return { ok: true };
  });

async function loadAsset(context: any, workspaceId: string, assetId: string) {
  const { data: a } = await context.supabase
    .from("media_assets")
    .select("id, url, title, workspace_id")
    .eq("id", assetId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!a) throw new Error("Mídia não encontrada.");
  return { url: a.url as string, title: (a.title as string) ?? "Criativo" };
}

/** Envia uma mídia da biblioteca para os uploads do Canva da empresa. */
export const canvaSendAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ assetId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, EDITORS);
    const asset = await loadAsset(context, data.workspaceId, data.assetId);
    const { sendAssetToCanva } = await import("./canva.server");
    return sendAssetToCanva(data.workspaceId, asset);
  });

/** Cria um design editável no Canva (com mídia opcional) e devolve o link de edição. */
export const canvaCreateFromBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ws
      .extend({
        title: z.string().min(1).max(250),
        size: z.enum(["square", "portrait", "story", "landscape"]).nullable().optional(),
        assetId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, EDITORS);
    const { createCanvaDesign, sendAssetToCanva } = await import("./canva.server");
    let canvaAssetId: string | null = null;
    if (data.assetId) canvaAssetId = (await sendAssetToCanva(data.workspaceId, await loadAsset(context, data.workspaceId, data.assetId))).assetId;
    return createCanvaDesign(data.workspaceId, { title: data.title, size: data.size ?? "portrait", assetId: canvaAssetId });
  });

export const canvaListDesigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ query: z.string().max(100).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId);
    const { listCanvaDesigns } = await import("./canva.server");
    return listCanvaDesigns(data.workspaceId, data.query ?? null);
  });

/** Traz um design do Canva (PNG/JPG/MP4) para a biblioteca, ligado à marca e campanha. */
export const canvaImportDesign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ws
      .extend({
        designId: z.string().trim().min(3),
        title: z.string().max(200).nullable().optional(),
        format: z.enum(["png", "jpg", "mp4"]).nullable().optional(),
        brandId: z.string().uuid().nullable().optional(),
        campaignId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, EDITORS);
    const designId = /design\/([A-Za-z0-9_-]+)/.exec(data.designId)?.[1] ?? data.designId;
    const { importCanvaDesign } = await import("./canva.server");
    const asset = await importCanvaDesign(data.workspaceId, {
      designId,
      title: data.title ?? null,
      format: data.format ?? "png",
      brandId: data.brandId ?? null,
      campaignId: data.campaignId ?? null,
      createdBy: context.userId,
    });
    return { id: asset.id, url: asset.url };
  });
