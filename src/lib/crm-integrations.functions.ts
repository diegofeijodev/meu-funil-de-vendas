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

type CrmKind = "meta_lead_ads" | "whatsapp" | "instagram" | "site_form" | "email" | "calendar";
type CrmProvider = "meta" | "whatsapp_cloud" | "zapi" | "evolution" | "site" | "resend" | "calcom";

function friendly(err: unknown, fallback: string) {
  console.error("[crm-integrations]", err);
  return new Error(fallback);
}

/** Creates or updates the workspace integration (never stores credentials). */
export const saveIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    workspaceId: string;
    kind: CrmKind;
    provider: CrmProvider;
    config?: Record<string, unknown>;
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
  .inputValidator((input: { workspaceId: string; kind: CrmKind }) => input)
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

    // Mesma leitura de credenciais do resto do app: cofre (Integrações) da empresa/global, depois ambiente.
    const { metaConfig, runWithMetaWorkspace, graph } = await import("@/lib/meta/graph.server");
    const { workspaceSecret } = await import("@/lib/crm/integrations.server");
    const meta = await metaConfig(data.workspaceId);
    const missing: string[] = [];
    if (data.kind === "meta_lead_ads") {
      if (!meta.appSecret) missing.push("META_APP_SECRET");
      if (!meta.token) missing.push("META_SYSTEM_USER_TOKEN");
    } else if (data.kind === "instagram") {
      if (!meta.appSecret) missing.push("META_APP_SECRET");
      if (!meta.token) missing.push("META_SYSTEM_USER_TOKEN");
      if (!meta.pageId) missing.push("META_PAGE_ID");
    } else if (data.kind === "email") {
      if (!(await workspaceSecret(data.workspaceId, "RESEND_API_KEY"))) missing.push("RESEND_API_KEY");
    } else if (data.kind === "calendar") {
      if (!(await workspaceSecret(data.workspaceId, "CALCOM_API_KEY"))) missing.push("CALCOM_API_KEY");
    } else if (data.kind === "site_form") {
      // Formulário próprio do app: não depende de credenciais externas.
    } else if (integration.provider === "whatsapp_cloud") {
      if (!(await workspaceSecret(data.workspaceId, "WHATSAPP_CLOUD_TOKEN"))) missing.push("WHATSAPP_CLOUD_TOKEN");
      if (!meta.appSecret) missing.push("META_APP_SECRET");
    } else if (integration.provider === "zapi") {
      if (!(await workspaceSecret(data.workspaceId, "ZAPI_TOKEN"))) missing.push("ZAPI_TOKEN");
    } else if (integration.provider === "evolution") {
      if (!(await workspaceSecret(data.workspaceId, "EVOLUTION_API_KEY"))) missing.push("EVOLUTION_API_KEY");
    }

    if (missing.length) {
      await supabaseAdmin
        .from("crm_integrations")
        .update({ status: "error", last_error: `Credenciais ausentes: ${missing.join(", ")}` })
        .eq("id", integration.id);
      return { ok: false, missing };
    }

    try {
      if (data.kind === "meta_lead_ads" || data.kind === "instagram") {
        // Teste real: o token precisa responder na Graph API e a Página é inscrita no app (3.6).
        await runWithMetaWorkspace(data.workspaceId, () => graph("/me", { params: { fields: "id,name" } }));
        const { subscribePage } = await import("@/lib/crm/meta.server");
        await subscribePage(data.workspaceId, data.kind === "instagram" ? ["messages", "feed"] : ["leadgen"]);
      }
      if (data.kind === "email") {
        const { testEmail } = await import("@/lib/crm/email.server");
        const domains = await testEmail(data.workspaceId);
        const from = String((integration.config as Record<string, unknown>)["from_email"] ?? "");
        const domain = from.split("@")[1]?.toLowerCase();
        const ok = domains.find((d) => d.name.toLowerCase() === domain);
        if (!ok) throw new Error(`O domínio ${domain || "do remetente"} não está cadastrado no Resend.`);
        if (ok.status !== "verified") throw new Error(`O domínio ${domain} ainda não foi verificado no Resend (status: ${ok.status}).`);
      }
      if (data.kind === "calendar") {
        const { testCalendar } = await import("@/lib/crm/calendar.server");
        await testCalendar(data.workspaceId, String((integration.config as Record<string, unknown>)["event_type_id"] ?? ""));
      }
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
      return { ok: false, missing: [] as string[], error: detail };
    }
  });

export const disconnectIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; kind: CrmKind }) => input)
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
      const { runWithMetaWorkspace } = await import("@/lib/meta/graph.server");
      return await runWithMetaWorkspace(data.workspaceId, () => listFormFields(data.formId));
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

    // Um humano respondeu: a IA é pausada e as cadências são encerradas.
    await supabaseAdmin.from("crm_leads").update({ ai_active: false }).eq("id", lead.id);
    const { stopCadences } = await import("@/lib/crm/cadence.server");
    await stopCadences(lead.id as string, "human_takeover");

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
      const { runWithMetaWorkspace } = await import("@/lib/meta/graph.server");
      await runWithMetaWorkspace(data.workspaceId, () => sendConversionEvent({
        integration: integration as never,
        eventName: data.event,
        phone: lead.phone,
        email: lead.email,
        value: Number(lead.estimated_value ?? 0),
      }));
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
      const { runWithMetaWorkspace } = await import("@/lib/meta/graph.server");
      const imported = await runWithMetaWorkspace(data.workspaceId, () => importCampaignCosts(integration as never, "last_7d"));
      return { imported };
    } catch (err) {
      throw friendly(err, "Não foi possível importar os custos das campanhas.");
    }
  });

/** Credenciais dos canais salvas por empresa (nunca voltam para o navegador). */
const CHANNEL_SECRETS = ["WHATSAPP_CLOUD_TOKEN", "ZAPI_TOKEN", "EVOLUTION_API_KEY", "RESEND_API_KEY", "CALCOM_API_KEY"] as const;

export const saveChannelSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; key: (typeof CHANNEL_SECRETS)[number]; value: string }) => {
    if (!(CHANNEL_SECRETS as readonly string[]).includes(input.key)) throw new Error("Credencial inválida.");
    if (!input.value || input.value.trim().length < 8) throw new Error("Valor muito curto.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { writeCredentials } = await import("@/lib/credentials.server");
    try {
      await writeCredentials(data.workspaceId, { [data.key]: data.value.trim() });
    } catch (error) {
      throw friendly(error, "Não foi possível salvar a credencial.");
    }
    return { ok: true };
  });

/** Quais credenciais de canal esta empresa já tem (só sim/não). */
export const channelSecretsStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("app_credentials")
      .select("key")
      .eq("workspace_id", data.workspaceId)
      .in("key", CHANNEL_SECRETS as unknown as string[]);
    const own = new Set(((rows ?? []) as { key: string }[]).map((r) => r.key));
    return Object.fromEntries(
      CHANNEL_SECRETS.map((k) => [k, own.has(k) ? "empresa" : process.env[k] ? "servidor" : "faltando"]),
    ) as Record<(typeof CHANNEL_SECRETS)[number], "empresa" | "servidor" | "faltando">;
  });

/** Eventos de webhook que falharam (3.6), para revisar e reprocessar. */
export const listFailedEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("crm_webhook_events")
      .select("id, source, external_id, error_message, created_at")
      .eq("workspace_id", data.workspaceId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(50);
    return rows ?? [];
  });

export const reprocessEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; eventId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ev } = await supabaseAdmin
      .from("crm_webhook_events")
      .select("*")
      .eq("id", data.eventId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (!ev) throw new Error("Evento não encontrado.");
    const kindBySource: Record<string, CrmKind> = { meta_leadgen: "meta_lead_ads", whatsapp_message: "whatsapp", instagram: "instagram" };
    const kind = kindBySource[ev.source as string];
    if (!kind) throw new Error("Este tipo de evento não pode ser reprocessado.");
    const { data: integration } = await supabaseAdmin
      .from("crm_integrations")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .eq("kind", kind)
      .maybeSingle();
    if (!integration) throw new Error("Integração não encontrada.");
    const { finishEvent } = await import("@/lib/crm/integrations.server");
    try {
      if (kind === "meta_lead_ads") {
        const { ingestLeadgen } = await import("@/lib/crm/meta.server");
        const { runWithMetaWorkspace } = await import("@/lib/meta/graph.server");
        await runWithMetaWorkspace(data.workspaceId, () => ingestLeadgen(integration as never, String(ev.external_id)));
      } else if (kind === "whatsapp") {
        const { handleInbound } = await import("@/lib/crm/whatsapp.server");
        await handleInbound(integration as never, ev.payload as never);
      } else {
        const { handleInstagramInbound } = await import("@/lib/crm/instagram-dm.server");
        await handleInstagramInbound(integration as never, ev.payload as never);
      }
      await finishEvent(ev.id as string, null);
      return { ok: true };
    } catch (e) {
      const detail = e instanceof Error ? e.message : "falhou";
      await finishEvent(ev.id as string, detail);
      throw new Error(detail);
    }
  });

/** Responde no Direct do Instagram pela tela do lead (pausa a IA, como no WhatsApp). */
export const sendInstagramMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; leadId: string; body: string }) => {
    if (!input.body?.trim()) throw new Error("Escreva a mensagem.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, data.workspaceId);
    const { sendInstagramAndStore } = await import("@/lib/crm/instagram-dm.server");
    const r = await sendInstagramAndStore({
      workspaceId: data.workspaceId,
      leadId: data.leadId,
      text: data.body.trim(),
      sentBy: context.userId,
      authorType: "user",
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("crm_leads").update({ ai_active: false }).eq("id", data.leadId);
    const { stopCadences } = await import("@/lib/crm/cadence.server");
    await stopCadences(data.leadId, "human_takeover");
    return r;
  });

/** Envia um e-mail avulso para o lead pela tela do lead. */
export const sendLeadEmailNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; leadId: string; subject: string; body: string }) => {
    if (!input.subject?.trim() || !input.body?.trim()) throw new Error("Preencha assunto e mensagem.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, data.workspaceId);
    const { sendLeadEmail } = await import("@/lib/crm/email.server");
    return sendLeadEmail({ workspaceId: data.workspaceId, leadId: data.leadId, subject: data.subject.trim(), body: data.body.trim(), authorType: "user" });
  });
