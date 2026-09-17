import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type Authed = SupabaseClient<Database>;

/** Confirms the caller is an owner/admin of the workspace before privileged work. */
async function assertAdmin(supabase: Authed, workspaceId: string) {
  const { data } = await supabase.rpc("has_workspace_role", {
    _ws: workspaceId,
    _roles: ["owner", "admin"],
  });
  if (!data) throw new Error("Sem permissão para alterar integrações deste workspace.");
}

async function assertMember(supabase: Authed, workspaceId: string) {
  const { data } = await supabase.rpc("is_workspace_member", { _ws: workspaceId });
  if (!data) throw new Error("Workspace inválido.");
}

function friendly(err: unknown, fallback: string) {
  console.error("[crm-integrations]", err);
  return new Error(fallback);
}

/** Creates or updates the workspace integration (never stores credentials). */
export const saveIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    workspaceId: string;
    kind: "meta_lead_ads" | "whatsapp";
    provider: "meta" | "whatsapp_cloud" | "zapi" | "evolution";
    config?: Record<string, string>;
    fieldMapping?: Record<string, string>;
    status?: "disconnected" | "connecting" | "connected";
  }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("crm_integrations")
      .select("id, config, field_mapping")
      .eq("workspace_id", data.workspaceId)
      .eq("kind", data.kind)
      .maybeSingle();

    const row = {
      workspace_id: data.workspaceId,
      kind: data.kind,
      provider: data.provider,
      status: data.status ?? "connecting",
      config: { ...((existing?.config as object) ?? {}), ...(data.config ?? {}) },
      field_mapping: { ...((existing?.field_mapping as object) ?? {}), ...(data.fieldMapping ?? {}) },
      last_error: null,
    };
    const { data: saved, error } = await supabaseAdmin
      .from("crm_integrations")
      .upsert(row as never, { onConflict: "workspace_id,kind" })
      .select("id, webhook_token, verify_token, status")
      .single();
    if (error) throw friendly(error, "Não foi possível salvar a integração.");
    return saved;
  });

/** Checks credentials and marks the integration as connected or error. */
export const testIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; kind: "meta_lead_ads" | "whatsapp" }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: integration } = await supabaseAdmin
      .from("crm_integrations")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .eq("kind", data.kind)
      .maybeSingle();
    if (!integration) throw new Error("Configure a integração antes de testar.");

    const missing: string[] = [];
    if (data.kind === "meta_lead_ads") {
      if (!process.env["META_APP_SECRET"]) missing.push("META_APP_SECRET");
      if (!process.env["META_GRAPH_TOKEN"]) missing.push("META_GRAPH_TOKEN");
    } else if (integration.provider === "whatsapp_cloud") {
      if (!process.env["WHATSAPP_CLOUD_TOKEN"]) missing.push("WHATSAPP_CLOUD_TOKEN");
      if (!process.env["META_APP_SECRET"]) missing.push("META_APP_SECRET");
    } else if (integration.provider === "zapi") {
      if (!process.env["ZAPI_TOKEN"]) missing.push("ZAPI_TOKEN");
    } else if (integration.provider === "evolution") {
      if (!process.env["EVOLUTION_API_KEY"]) missing.push("EVOLUTION_API_KEY");
    }

    if (missing.length) {
      await supabaseAdmin
        .from("crm_integrations")
        .update({ status: "error", last_error: `Credenciais ausentes: ${missing.join(", ")}` })
        .eq("id", integration.id);
      return { ok: false, missing };
    }

    try {
      if (data.kind === "whatsapp" && integration.provider === "whatsapp_cloud") {
        const { providerFor } = await import("@/lib/crm/whatsapp.server");
        await providerFor(integration as never).listTemplates(integration as never);
      }
      await supabaseAdmin
        .from("crm_integrations")
        .update({ status: "connected", last_error: null, last_event_at: new Date().toISOString() })
        .eq("id", integration.id);
      return { ok: true, missing: [] as string[] };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "erro desconhecido";
      console.error("[crm-integrations] teste falhou:", detail);
      await supabaseAdmin
        .from("crm_integrations")
        .update({ status: "error", last_error: detail })
        .eq("id", integration.id);
      return { ok: false, missing: [] as string[] };
    }
  });

export const disconnectIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; kind: "meta_lead_ads" | "whatsapp" }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("crm_integrations")
      .update({ status: "disconnected", last_error: null })
      .eq("workspace_id", data.workspaceId)
      .eq("kind", data.kind);
    return { ok: true };
  });

/** Lists the fields of a Meta lead form so the user can map them. */
export const loadMetaFormFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; formId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    try {
      const { listFormFields } = await import("@/lib/crm/meta.server");
      return await listFormFields(data.formId);
    } catch (err) {
      throw friendly(err, "Não foi possível carregar os campos do formulário.");
    }
  });

/** Syncs approved WhatsApp templates from the Cloud API. */
export const syncWhatsAppTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: integration } = await supabaseAdmin
      .from("crm_integrations")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .eq("kind", "whatsapp")
      .maybeSingle();
    if (!integration || integration.provider !== "whatsapp_cloud") {
      throw new Error("Templates existem apenas na API oficial do WhatsApp.");
    }
    try {
      const { providerFor } = await import("@/lib/crm/whatsapp.server");
      const templates = await providerFor(integration as never).listTemplates(integration as never);
      if (templates.length) {
        await supabaseAdmin.from("crm_wa_templates").upsert(
          templates.map((t) => ({
            workspace_id: data.workspaceId,
            name: t.name,
            language: t.language,
            category: t.category,
            status: t.status,
            body_preview: t.body,
            variables: t.variables,
            synced_at: new Date().toISOString(),
          })) as never,
          { onConflict: "workspace_id,name,language" },
        );
      }
      return { count: templates.length };
    } catch (err) {
      throw friendly(err, "Não foi possível sincronizar os templates.");
    }
  });

/** Sends a WhatsApp message from the lead chat, respecting opt-out and the 24h window. */
export const sendWhatsAppMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    workspaceId: string;
    leadId: string;
    kind: "text" | "image" | "audio" | "template";
    body?: string;
    mediaUrl?: string;
    templateName?: string;
    templateLanguage?: string;
    templateParams?: string[];
  }) => input)
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: integration }, { data: lead }] = await Promise.all([
      supabaseAdmin.from("crm_integrations").select("*").eq("workspace_id", data.workspaceId).eq("kind", "whatsapp").maybeSingle(),
      supabaseAdmin.from("crm_leads").select("id, phone, unsubscribed").eq("id", data.leadId).maybeSingle(),
    ]);
    if (!integration || integration.status !== "connected") throw new Error("Conecte o WhatsApp nas integrações do CRM.");
    if (!lead?.phone) throw new Error("Este lead não tem telefone cadastrado.");
    if (lead.unsubscribed) throw new Error("Lead descadastrado: envios bloqueados.");

    const { ensureConversation, sendAndStore, windowOpen } = await import("@/lib/crm/whatsapp.server");
    const conversation = await ensureConversation({
      integration: integration as never,
      phone: lead.phone,
      leadId: lead.id,
    });

    const official = integration.provider === "whatsapp_cloud";
    if (official && data.kind !== "template" && !windowOpen(conversation as never)) {
      throw new Error("Fora da janela de 24 horas: envie um template aprovado.");
    }

    const result = await sendAndStore({
      integration: integration as never,
      conversationId: conversation["id"] as string,
      leadId: lead.id,
      message: {
        to: lead.phone,
        kind: data.kind,
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.mediaUrl !== undefined ? { mediaUrl: data.mediaUrl } : {}),
        ...(data.templateName !== undefined ? { templateName: data.templateName } : {}),
        ...(data.templateLanguage !== undefined ? { templateLanguage: data.templateLanguage } : {}),
        ...(data.templateParams !== undefined ? { templateParams: data.templateParams } : {}),
      },
      sentBy: context.userId,
      authorType: "user",
    });

    await supabaseAdmin.from("crm_interactions").insert({
      workspace_id: data.workspaceId,
      lead_id: lead.id,
      kind: "message_out",
      author_type: "user",
      content: data.body ?? data.templateName ?? "Mídia enviada",
    });
    return result;
  });

/** Sends Qualified/Won to the Meta Conversions API. */
export const notifyMetaConversion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; leadId: string; event: "Qualificado" | "Ganho" }) => input)
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: integration }, { data: lead }] = await Promise.all([
      supabaseAdmin.from("crm_integrations").select("*").eq("workspace_id", data.workspaceId).eq("kind", "meta_lead_ads").maybeSingle(),
      supabaseAdmin.from("crm_leads").select("phone, email, estimated_value").eq("id", data.leadId).maybeSingle(),
    ]);
    if (!integration || integration.status !== "connected" || !lead) return { skipped: true };
    try {
      const { sendConversionEvent } = await import("@/lib/crm/meta.server");
      await sendConversionEvent({
        integration: integration as never,
        eventName: data.event,
        phone: lead.phone,
        email: lead.email,
        value: Number(lead.estimated_value ?? 0),
      });
      return { sent: true };
    } catch (err) {
      console.error("[crm-integrations] CAPI falhou:", err);
      return { sent: false };
    }
  });

/** Manual cost import button. */
export const importMetaCostsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: integration } = await supabaseAdmin
      .from("crm_integrations")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .eq("kind", "meta_lead_ads")
      .maybeSingle();
    if (!integration) throw new Error("Conecte o Meta Lead Ads primeiro.");
    try {
      const { importCampaignCosts } = await import("@/lib/crm/meta.server");
      const imported = await importCampaignCosts(integration as never, "last_7d");
      return { imported };
    } catch (err) {
      throw friendly(err, "Não foi possível importar os custos das campanhas.");
    }
  });
