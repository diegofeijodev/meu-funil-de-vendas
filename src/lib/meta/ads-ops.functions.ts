import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { EDITORS, MANAGERS, requireRole } from "@/lib/membership";
import { readAdsConfig, readRules } from "./ads-config";

const ws = z.object({ workspaceId: z.string().uuid() });

/** 2.1 Sincroniza agora os resultados da Meta desta empresa. */
export const syncAdsInsightsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId);
    const { syncWorkspaceInsights, syncExternalChannels } = await import("./ads-ops.server");
    const meta = await syncWorkspaceInsights(data.workspaceId, 30);
    const ext = await syncExternalChannels(data.workspaceId, 30).catch(() => ({ rows: 0 }));
    return { campaigns: meta.campaigns, rows: meta.rows + ext.rows };
  });

/** 1.4 Recomendações da IA com os resultados reais (uma campanha ou todas as publicadas). */
export const generateAdsRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ campaignId: z.string().uuid().nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, EDITORS);
    const { generateRecommendationsAI } = await import("./ads-ops.server");
    let q = context.supabase.from("campaigns").select("id, name").eq("workspace_id", data.workspaceId).not("meta_campaign_id", "is", null);
    if (data.campaignId) q = q.eq("id", data.campaignId);
    const { data: camps } = await q;
    let created = 0;
    const errors: string[] = [];
    for (const c of (camps ?? []) as { id: string; name: string }[]) {
      try {
        created += (await generateRecommendationsAI(c.id)).created;
      } catch (e) {
        errors.push(`${c.name}: ${e instanceof Error ? e.message : "falhou"}`);
      }
    }
    if (!camps?.length) errors.push("Nenhuma campanha publicada na Meta ainda.");
    return { created, errors };
  });

/** 2.2 Aplica (executa na Meta) ou descarta uma recomendação. Só dono/admin. */
export const decideAdsRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), decision: z.enum(["apply", "dismiss"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rec } = await context.supabase.from("ai_recommendations").select("id, workspace_id, status").eq("id", data.id).maybeSingle();
    if (!rec) throw new Error("Recomendação não encontrada.");
    await requireRole(context, rec.workspace_id, MANAGERS);
    if (data.decision === "dismiss") {
      await context.supabase.from("ai_recommendations").update({ status: "dismissed" }).eq("id", data.id);
      return { result: "Descartada." };
    }
    const { applyRecommendation } = await import("./ads-ops.server");
    return applyRecommendation(data.id, context.userId);
  });

/** Salva a configuração de anúncios (2.4–2.6) e as regras automáticas (2.3) da campanha. */
export const saveCampaignAdsSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        campaignId: z.string().uuid(),
        adsConfig: z.record(z.string(), z.unknown()),
        rules: z.record(z.string(), z.unknown()),
        privacyUrl: z.string().url().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: c } = await context.supabase.from("campaigns").select("id, workspace_id, ads_config").eq("id", data.campaignId).maybeSingle();
    if (!c) throw new Error("Campanha não encontrada.");
    await requireRole(context, c.workspace_id, EDITORS);
    const cfg = { ...readAdsConfig(data.adsConfig), privacyUrl: data.privacyUrl ?? null };
    const { error } = await context.supabase
      .from("campaigns")
      .update({ ads_config: cfg, automation_rules: readRules(data.rules) } as never)
      .eq("id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Públicos personalizados da conta de anúncios (para escolher na campanha). */
export const listMetaAudiences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId);
    const { runWithMetaWorkspace } = await import("./graph.server");
    const { listCustomAudiences } = await import("./meta-ads.server");
    return runWithMetaWorkspace(data.workspaceId, () => listCustomAudiences());
  });

/** Cria/atualiza na Meta o público "Clientes do CRM" com e-mails e telefones (hash SHA-256). */
export const syncCrmCustomerAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ onlyWon: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, MANAGERS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("crm_leads")
      .select("email, phone, stage_id")
      .eq("workspace_id", data.workspaceId)
      .eq("unsubscribed", false)
      .limit(50000);
    if (data.onlyWon) {
      const { data: won } = await supabaseAdmin.from("crm_stages").select("id").eq("workspace_id", data.workspaceId).eq("is_won", true);
      const ids = ((won ?? []) as { id: string }[]).map((s) => s.id);
      if (!ids.length) throw new Error("Nenhuma etapa marcada como ganho no funil do CRM.");
      q = q.in("stage_id", ids);
    }
    const { data: leads } = await q;
    const contacts = ((leads ?? []) as { email: string | null; phone: string | null }[]).filter((l) => l.email || l.phone);
    if (!contacts.length) throw new Error("Nenhum lead com e-mail ou telefone no CRM.");
    const key = data.onlyWon ? "META_AUDIENCE_CRM_WON" : "META_AUDIENCE_CRM_ALL";
    const { data: saved } = await supabaseAdmin
      .from("app_credentials")
      .select("value")
      .eq("workspace_id", data.workspaceId)
      .eq("key", key)
      .maybeSingle();
    const { runWithMetaWorkspace } = await import("./graph.server");
    const { upsertCustomerListAudience } = await import("./meta-ads.server");
    const r = await runWithMetaWorkspace(data.workspaceId, () =>
      upsertCustomerListAudience(data.onlyWon ? "Clientes do CRM (ganhos)" : "Leads do CRM", (saved?.value as string) ?? null, contacts),
    );
    await supabaseAdmin
      .from("app_credentials")
      .upsert({ workspace_id: data.workspaceId, key, value: r.id, updated_at: new Date().toISOString() } as never, {
        onConflict: "workspace_id,key",
      });
    return r;
  });
