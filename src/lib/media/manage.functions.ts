import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { EDITORS, requireRole } from "@/lib/membership";

const ws = z.object({ workspaceId: z.string().uuid() });

/** 6.4 Exclui de verdade (arquivo + registro). Versões filhas ficam soltas, não somem. */
export const deleteMediaAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ assetIds: z.array(z.string().uuid()).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, EDITORS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { MEDIA_BUCKET } = await import("./assets.server");
    const { data: rows } = await supabaseAdmin
      .from("media_assets")
      .select("id, storage_path, thumbnail_path")
      .eq("workspace_id", data.workspaceId)
      .in("id", data.assetIds);
    const list = (rows ?? []) as { id: string; storage_path: string | null; thumbnail_path: string | null }[];
    if (!list.length) return { deleted: 0 };
    const paths = list.flatMap((r) => [r.storage_path, r.thumbnail_path]).filter(Boolean) as string[];
    if (paths.length) await supabaseAdmin.storage.from(MEDIA_BUCKET).remove(paths);
    await supabaseAdmin.from("media_assets").update({ parent_id: null }).in("parent_id", list.map((r) => r.id));
    const { error } = await supabaseAdmin.from("media_assets").delete().in("id", list.map((r) => r.id));
    if (error) throw new Error(error.message);
    return { deleted: list.length };
  });

/** 6.4 Renomeia (ou remove, com "to" vazio) uma tag em todas as mídias da empresa. */
export const renameMediaTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ from: z.string().min(1).max(60), to: z.string().max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, EDITORS);
    const { data: rows } = await context.supabase
      .from("media_assets")
      .select("id, tags")
      .eq("workspace_id", data.workspaceId)
      .contains("tags", [data.from]);
    const to = data.to.trim();
    for (const r of (rows ?? []) as { id: string; tags: string[] }[]) {
      const next = [...new Set(r.tags.map((t) => (t === data.from ? to : t)).filter(Boolean))];
      await context.supabase.from("media_assets").update({ tags: next }).eq("id", r.id);
    }
    return { updated: rows?.length ?? 0 };
  });

/** 6.4 Renomeia uma pasta (ou desfaz, com "to" vazio) em todas as mídias da empresa. */
export const renameMediaFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ from: z.string().min(1).max(120), to: z.string().max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, EDITORS);
    const { data: rows, error } = await context.supabase
      .from("media_assets")
      .update({ folder: data.to.trim() || null })
      .eq("workspace_id", data.workspaceId)
      .eq("folder", data.from)
      .select("id");
    if (error) throw new Error(error.message);
    return { updated: rows?.length ?? 0 };
  });

/** 6.2 Resultados da mídia nos anúncios (pelo criativo ligado a ela). */
export const mediaAdResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ creativeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId);
    const { data: rows } = await context.supabase
      .from("performance_daily")
      .select("spend, impressions, clicks, leads, conversions, revenue, campaign_id, campaigns(name)")
      .eq("workspace_id", data.workspaceId)
      .eq("source", "meta")
      .eq("creative_id", data.creativeId);
    const t = { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0, revenue: 0, campaigns: new Set<string>() };
    for (const r of (rows ?? []) as any[]) {
      t.spend += Number(r.spend);
      t.impressions += Number(r.impressions);
      t.clicks += Number(r.clicks);
      t.leads += Number(r.leads);
      t.conversions += Number(r.conversions);
      t.revenue += Number(r.revenue);
      if (r.campaigns?.name) t.campaigns.add(r.campaigns.name);
    }
    return { ...t, campaigns: [...t.campaigns], days: rows?.length ?? 0 };
  });
