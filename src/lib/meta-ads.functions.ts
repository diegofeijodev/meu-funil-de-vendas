import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Ctx = { supabase: any; userId: string };

async function requireMember(ctx: Ctx, workspaceId: string, edit = false) {
  const { data } = await ctx.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!data) throw new Error("Você não tem acesso a esta área de trabalho.");
  if (edit && data.role === "viewer") throw new Error("Seu perfil não pode alterar campanhas.");
}

const ws = z.object({ workspaceId: z.string().uuid() });

/** Salva as credenciais da Meta no cofre do servidor (nunca legíveis pelo navegador). */
export const metaAdsSaveCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ws.extend({
      appId: z.string().trim().min(4, "Informe o ID do app."),
      appSecret: z.string().trim().min(8, "Informe a chave secreta do app."),
      systemUserToken: z.string().trim().min(20, "Informe o token do usuário do sistema."),
      adAccountId: z.string().trim().min(4, "Informe o ID da conta de anúncios (act_...)."),
      pageId: z.string().trim().min(4, "Informe o ID da Página do Facebook."),
      instagramId: z.string().trim().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId, true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = [
      { key: "META_APP_ID", value: data.appId },
      { key: "META_APP_SECRET", value: data.appSecret },
      { key: "META_SYSTEM_USER_TOKEN", value: data.systemUserToken },
      { key: "META_AD_ACCOUNT_ID", value: data.adAccountId },
      { key: "META_PAGE_ID", value: data.pageId },
    ];
    if (data.instagramId?.trim()) rows.push({ key: "META_INSTAGRAM_ACCOUNT_ID", value: data.instagramId.trim() });
    const { error } = await supabaseAdmin
      .from("app_credentials")
      .upsert(
        rows.map((r) => ({ ...r, workspace_id: data.workspaceId, updated_at: new Date().toISOString() })) as never,
        { onConflict: "workspace_id,key" },
      );
    if (error) throw new Error(error.message);
    const { missingSecrets } = await import("./meta/graph.server");
    const missing = await missingSecrets(data.workspaceId);
    return { ok: true, configured: missing.length === 0, missing };
  });

/** Status leve: só diz se os segredos existem (sem chamar a Meta). */
export const metaAdsStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId);
    const { missingSecrets } = await import("./meta/graph.server");
    const missing = await missingSecrets(data.workspaceId);
    return { configured: missing.length === 0, missing };
  });

export const metaAdsTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId);
    const { testConnection } = await import("./meta/meta-ads.server");
    const { runWithMetaWorkspace } = await import("./meta/graph.server");
    return runWithMetaWorkspace(data.workspaceId, () => testConnection());
  });

export const metaAdsList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId);
    const { listStructure } = await import("./meta/meta-ads.server");
    const { runWithMetaWorkspace } = await import("./meta/graph.server");
    return runWithMetaWorkspace(data.workspaceId, () => listStructure());
  });

export const metaAdsInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ws.extend({
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      campaignId: z.string().uuid().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId);
    let metaCampaignId: string | null = null;
    if (data.campaignId) {
      const { data: c } = await context.supabase.from("campaigns").select("meta_campaign_id").eq("id", data.campaignId).maybeSingle();
      metaCampaignId = c?.meta_campaign_id ?? null;
      if (!metaCampaignId) throw new Error("Esta campanha ainda não foi publicada na Meta.");
    }
    const { fetchInsights } = await import("./meta/meta-ads.server");
    const { runWithMetaWorkspace } = await import("./meta/graph.server");
    return runWithMetaWorkspace(data.workspaceId, () =>
      fetchInsights({ since: data.since, until: data.until, campaignId: metaCampaignId }),
    );
  });

/** Publica a campanha aprovada na Meta — tudo PAUSADO. */
export const metaAdsPublish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId, true);
    const db = context.supabase;
    const { data: c } = await db.from("campaigns").select("*").eq("id", data.campaignId).eq("workspace_id", data.workspaceId).maybeSingle();
    if (!c) throw new Error("Campanha não encontrada.");
    if (c.status !== "approved" && c.status !== "active") throw new Error("A campanha precisa ser aprovada em Aprovações antes de ir para a Meta.");
    if (c.meta_campaign_id) throw new Error("Esta campanha já foi enviada para a Meta. Use Ativar/Pausar.");
    if (!c.landing_url) throw new Error("Preencha a página de destino (URL) da campanha antes de publicar.");

    const [{ data: creatives }, { data: copies }] = await Promise.all([
      db.from("creatives").select("id,title,preview_url,thumbnail_url,status").eq("campaign_id", c.id).eq("status", "approved"),
      db.from("copies").select("content").eq("campaign_id", c.id).order("version", { ascending: false }).limit(1),
    ]);
    if (!creatives?.length) throw new Error("Aprove pelo menos um criativo desta campanha antes de publicar.");
    const copy = (copies?.[0]?.content ?? {}) as any;
    const sep = c.landing_url.includes("?") ? "&" : "?";
    const landing = `${c.landing_url}${sep}utm_source=meta&utm_medium=paid&utm_campaign=${encodeURIComponent(c.name)}`;

    const { publishPaused } = await import("./meta/meta-ads.server");
    let result;
    try {
      result = await publishPaused({
        name: c.name,
        objective: c.objective,
        dailyBudget: Number(c.budget_daily ?? 0) || 20,
        landingUrl: landing,
        primaryText: String(copy.meta_ad ?? copy.primary_text ?? c.offer_promise ?? c.name),
        headline: String(copy.headline ?? copy.headlines?.[0] ?? c.offer_product ?? c.name).slice(0, 40),
        audience: (c.audience ?? {}) as Record<string, unknown>,
        creatives: creatives.map((x: any) => ({ id: x.id, title: x.title, url: x.preview_url, thumb: x.thumbnail_url })),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao publicar na Meta.";
      await db.from("publishing_jobs").insert({ workspace_id: data.workspaceId, campaign_id: c.id, target: "meta", status: "failed", mode: "live", log: msg });
      throw new Error(msg);
    }
    await db.from("campaigns").update({
      meta_campaign_id: result.campaignId,
      meta_adset_id: result.adsetId,
      meta_ad_ids: result.adIds,
      meta_delivery_status: "PAUSED",
    }).eq("id", c.id);
    await db.from("publishing_jobs").insert({
      workspace_id: data.workspaceId,
      campaign_id: c.id,
      target: "meta",
      status: result.steps.some((s) => s.status === "failed") ? "partial" : "done",
      mode: "live",
      log: result.steps.map((s) => `${s.label}: ${s.detail}`).join("\n"),
    });
    return result;
  });

/** Ativa/pausa na Meta — somente campanhas aprovadas. */
export const metaAdsSetStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ campaignId: z.string().uuid(), status: z.enum(["ACTIVE", "PAUSED"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId, true);
    const db = context.supabase;
    const { data: c } = await db.from("campaigns").select("*").eq("id", data.campaignId).eq("workspace_id", data.workspaceId).maybeSingle();
    if (!c?.meta_campaign_id) throw new Error("Campanha ainda não publicada na Meta.");
    if (data.status === "ACTIVE" && c.status !== "approved" && c.status !== "active")
      throw new Error("Só é possível ativar depois da aprovação em Aprovações.");
    const { setDeliveryStatus } = await import("./meta/meta-ads.server");
    await setDeliveryStatus({ campaignId: c.meta_campaign_id, adsetId: c.meta_adset_id, adIds: c.meta_ad_ids ?? [] }, data.status);
    await db.from("campaigns").update({
      meta_delivery_status: data.status,
      status: data.status === "ACTIVE" ? "active" : c.status === "active" ? "approved" : c.status,
    }).eq("id", c.id);
    return { ok: true };
  });
