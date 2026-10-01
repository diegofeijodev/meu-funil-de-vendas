/**
 * WhatsApp provider layer: official Cloud API (Meta) or Z-API / Evolution API.
 * Selected per workspace through crm_integrations.provider.
 */
import { stopCadences } from "./cadence.server";
import {
  admin,
  addInteraction,
  findLead,
  firstStage,
  isOptOut,
  normalizePhone,
  pickOwner,
  secret,
  startCadence,
  type Integration,
} from "./integrations.server";

const GRAPH = "https://graph.facebook.com/v21.0";
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type OutgoingMessage = {
  to: string;
  kind: "text" | "image" | "audio" | "template";
  body?: string;
  mediaUrl?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
};

export type SendResult = { externalId: string | null };

export interface WhatsAppProvider {
  readonly name: string;
  send(integration: Integration, message: OutgoingMessage): Promise<SendResult>;
  listTemplates(integration: Integration): Promise<
    { name: string; language: string; category: string | null; status: string; body: string | null; variables: number }[]
  >;
}

/* ------------------------- Cloud API (official) ------------------------- */

const cloudProvider: WhatsAppProvider = {
  name: "whatsapp_cloud",
  async send(integration, message) {
    const token = secret("WHATSAPP_CLOUD_TOKEN");
    if (!token) throw new Error("WHATSAPP_CLOUD_TOKEN ausente");
    const phoneNumberId = String((integration.config as Record<string, unknown>)["phone_number_id"] ?? "");
    if (!phoneNumberId) throw new Error("phone_number_id não configurado");

    const to = message.to.replace(/\D/g, "");
    let payload: Record<string, unknown>;
    if (message.kind === "template") {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: message.templateName,
          language: { code: message.templateLanguage ?? "pt_BR" },
          ...(message.templateParams?.length
            ? {
                components: [
                  {
                    type: "body",
                    parameters: message.templateParams.map((text) => ({ type: "text", text })),
                  },
                ],
              }
            : {}),
        },
      };
    } else if (message.kind === "text") {
      payload = { messaging_product: "whatsapp", to, type: "text", text: { body: message.body ?? "" } };
    } else {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: message.kind,
        [message.kind]: { link: message.mediaUrl },
      };
    }

    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`WhatsApp Cloud API [${res.status}]: ${text}`);
    const json = JSON.parse(text) as { messages?: { id: string }[] };
    return { externalId: json.messages?.[0]?.id ?? null };
  },
  async listTemplates(integration) {
    const token = secret("WHATSAPP_CLOUD_TOKEN");
    if (!token) throw new Error("WHATSAPP_CLOUD_TOKEN ausente");
    const wabaId = String((integration.config as Record<string, unknown>)["waba_id"] ?? "");
    if (!wabaId) throw new Error("waba_id não configurado");
    const res = await fetch(`${GRAPH}/${wabaId}/message_templates?limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`WhatsApp Cloud API [${res.status}]: ${text}`);
    const json = JSON.parse(text) as {
      data?: { name: string; language: string; category?: string; status: string; components?: { type: string; text?: string }[] }[];
    };
    return (json.data ?? []).map((t) => {
      const body = t.components?.find((c) => c.type === "BODY")?.text ?? null;
      return {
        name: t.name,
        language: t.language,
        category: t.category ?? null,
        status: t.status,
        body,
        variables: body ? (body.match(/\{\{\d+\}\}/g) ?? []).length : 0,
      };
    });
  },
};

/* --------------------------- Z-API / Evolution -------------------------- */

/** Texto final de uma mensagem (template sem API oficial: corpo com {{1}}, {{2}}... preenchidos). */
function templateText(message: OutgoingMessage) {
  let text = message.body ?? "";
  (message.templateParams ?? []).forEach((v, i) => {
    text = text.split(`{{${i + 1}}}`).join(v);
  });
  return text;
}

function unofficialBase(integration: Integration) {
  const cfg = integration.config as Record<string, unknown>;
  const base = String(cfg["base_url"] ?? "").replace(/\/$/, "");
  if (!base) throw new Error("base_url não configurada");
  return base;
}

const zapiProvider: WhatsAppProvider = {
  name: "zapi",
  async send(integration, message) {
    const token = secret("ZAPI_TOKEN");
    if (!token) throw new Error("ZAPI_TOKEN ausente");
    const base = unofficialBase(integration);
    // Z-API não tem templates oficiais: template vira texto com o corpo já preenchido.
    const asText = message.kind === "text" || message.kind === "template";
    const path = asText ? "send-text" : message.kind === "image" ? "send-image" : "send-audio";
    const body =
      asText
        ? { phone: message.to.replace(/\D/g, ""), message: templateText(message) }
        : { phone: message.to.replace(/\D/g, ""), [message.kind]: message.mediaUrl, caption: message.body ?? "" };
    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Client-Token": token },
      body: JSON.stringify(body),
      redirect: "follow",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Z-API [${res.status}]: ${text}`);
    const json = (text ? JSON.parse(text) : {}) as { messageId?: string; id?: string };
    return { externalId: json.messageId ?? json.id ?? null };
  },
  async listTemplates() {
    return [];
  },
};

const evolutionProvider: WhatsAppProvider = {
  name: "evolution",
  async send(integration, message) {
    const key = secret("EVOLUTION_API_KEY");
    if (!key) throw new Error("EVOLUTION_API_KEY ausente");
    const base = unofficialBase(integration);
    const instance = String((integration.config as Record<string, unknown>)["instance"] ?? "");
    if (!instance) throw new Error("instance não configurada");
    const number = message.to.replace(/\D/g, "");
    const asText = message.kind === "text" || message.kind === "template";
    const path = asText ? `/message/sendText/${instance}` : `/message/sendMedia/${instance}`;
    const body =
      asText
        ? { number, text: templateText(message) }
        : { number, mediatype: message.kind, media: message.mediaUrl, caption: message.body ?? "" };
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key },
      body: JSON.stringify(body),
      redirect: "follow",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Evolution API [${res.status}]: ${text}`);
    const json = (text ? JSON.parse(text) : {}) as { key?: { id?: string } };
    return { externalId: json.key?.id ?? null };
  },
  async listTemplates() {
    return [];
  },
};

export function providerFor(integration: Integration): WhatsAppProvider {
  if (integration.provider === "whatsapp_cloud") return cloudProvider;
  if (integration.provider === "zapi") return zapiProvider;
  if (integration.provider === "evolution") return evolutionProvider;
  throw new Error("Provedor de WhatsApp não suportado");
}

/* ------------------------------ Conversations --------------------------- */

export async function ensureConversation(args: {
  integration: Integration;
  phone: string;
  waId?: string | null;
  leadId?: string | null;
}) {
  const db = await admin();
  const { data: existing } = await db
    .from("crm_conversations")
    .select("*")
    .eq("workspace_id", args.integration.workspace_id)
    .eq("phone", args.phone)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await db
    .from("crm_conversations")
    .insert({
      workspace_id: args.integration.workspace_id,
      lead_id: args.leadId ?? null,
      phone: args.phone,
      wa_id: args.waId ?? null,
      provider: args.integration.provider,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export function windowOpen(conversation: { window_expires_at: string | null }) {
  return !!conversation.window_expires_at && new Date(conversation.window_expires_at).getTime() > Date.now();
}

/** Persists an outgoing message and sends it through the workspace provider. */
export async function sendAndStore(args: {
  integration: Integration;
  conversationId: string;
  leadId: string | null;
  message: OutgoingMessage;
  sentBy?: string | null;
  authorType?: "user" | "ai" | "system";
}) {
  const db = await admin();

  // Defesa em profundidade: nunca enviar para quem pediu para sair,
  // nem texto livre fora da janela de 24h na API oficial.
  if (args.leadId) {
    const { data: lead } = await db
      .from("crm_leads")
      .select("unsubscribed")
      .eq("id", args.leadId)
      .maybeSingle();
    if (lead?.unsubscribed) throw new Error("Lead descadastrado: envios bloqueados.");
  }
  if (args.integration.provider === "whatsapp_cloud" && args.message.kind !== "template") {
    const { data: conv } = await db
      .from("crm_conversations")
      .select("window_expires_at")
      .eq("id", args.conversationId)
      .maybeSingle();
    const expires = conv?.window_expires_at ? new Date(conv.window_expires_at).getTime() : 0;
    if (expires <= Date.now()) {
      throw new Error("Fora da janela de 24 horas: envie um template aprovado.");
    }
  }

  const { data: row, error } = await db
    .from("crm_messages")
    .insert({
      workspace_id: args.integration.workspace_id,
      conversation_id: args.conversationId,
      lead_id: args.leadId,
      direction: "out",
      message_type: args.message.kind === "template" ? "template" : args.message.kind,
      body: args.message.body ?? null,
      media_url: args.message.mediaUrl ?? null,
      template_name: args.message.templateName ?? null,
      status: "queued",
      sent_by: args.sentBy ?? null,
      author_type: args.authorType ?? "user",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  try {
    const { externalId } = await providerFor(args.integration).send(args.integration, args.message);
    await db.from("crm_messages").update({ status: "sent", external_id: externalId }).eq("id", row.id);
    await db
      .from("crm_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: args.message.body ?? args.message.templateName ?? "Mídia",
      })
      .eq("id", args.conversationId);
    return { id: row.id as string, externalId };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[whatsapp] falha ao enviar:", detail);
    await db.from("crm_messages").update({ status: "failed", error_message: detail }).eq("id", row.id);
    throw new Error("Não foi possível enviar a mensagem.");
  }
}

/* -------------------------- Inbound normalisation ----------------------- */

export type InboundMessage = {
  externalId: string | null;
  from: string;
  waId?: string | null;
  profileName?: string | null;
  type: "text" | "image" | "audio" | "video" | "document" | "sticker" | "other";
  body: string | null;
  mediaUrl?: string | null;
  referral?: { adId?: string | null; campaignName?: string | null; sourceUrl?: string | null } | null;
};

/** Stores an inbound message, creating the lead when the number is unknown. */
export async function handleInbound(integration: Integration, msg: InboundMessage) {
  const db = await admin();
  const phone = normalizePhone(msg.from);
  if (!phone) return { ignored: "telefone inválido" };

  let lead = await findLead(integration.workspace_id, phone, null);
  if (!lead) {
    const { pipelineId, stageId } = await firstStage(integration.workspace_id);
    const ownerId = await pickOwner(integration.workspace_id);
    const { data: created, error } = await db
      .from("crm_leads")
      .insert({
        workspace_id: integration.workspace_id,
        pipeline_id: pipelineId,
        stage_id: stageId,
        name: msg.profileName || phone,
        phone,
        wa_id: msg.waId ?? null,
        source: msg.referral?.adId ? "click_to_whatsapp" : "whatsapp",
        campaign_name: msg.referral?.campaignName ?? null,
        referral_ad_id: msg.referral?.adId ?? null,
        owner_id: ownerId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    lead = created;
    if (stageId) {
      await db.from("crm_stage_history").insert({
        workspace_id: integration.workspace_id,
        lead_id: created.id,
        from_stage_id: null,
        to_stage_id: stageId,
      });
    }
    await startCadence(integration.workspace_id, created.id as string, created.source as string);
  } else if (msg.referral?.adId && !lead["referral_ad_id"]) {
    await db
      .from("crm_leads")
      .update({
        referral_ad_id: msg.referral.adId,
        campaign_name: msg.referral.campaignName ?? (lead["campaign_name"] as string | null),
        source: "click_to_whatsapp",
      })
      .eq("id", lead["id"] as string);
  }

  const leadId = lead["id"] as string;
  const conversation = await ensureConversation({ integration, phone, waId: msg.waId ?? null, leadId });

  await db.from("crm_messages").insert({
    workspace_id: integration.workspace_id,
    conversation_id: conversation["id"] as string,
    lead_id: leadId,
    direction: "in",
    message_type: msg.type === "other" ? "other" : msg.type,
    body: msg.body,
    media_url: msg.mediaUrl ?? null,
    status: "received",
    external_id: msg.externalId,
    author_type: "system",
  });

  await db
    .from("crm_conversations")
    .update({
      lead_id: leadId,
      unread_count: ((conversation["unread_count"] as number) ?? 0) + 1,
      last_message_at: new Date().toISOString(),
      last_message_preview: msg.body ?? "Mídia recebida",
      window_expires_at: new Date(Date.now() + WINDOW_MS).toISOString(),
    })
    .eq("id", conversation["id"] as string);

  await addInteraction({
    workspaceId: integration.workspace_id,
    leadId,
    kind: "message_in",
    authorType: "system",
    content: msg.body ?? `Mídia recebida (${msg.type})`,
  });

  const patch: { first_response_at?: string; unsubscribed?: boolean; ai_active?: boolean } = {};
  if (!lead["first_response_at"]) patch["first_response_at"] = new Date().toISOString();
  if (isOptOut(msg.body)) {
    patch["unsubscribed"] = true;
    patch["ai_active"] = false;
    await stopCadences(leadId, "opt_out");
    await addInteraction({
      workspaceId: integration.workspace_id,
      leadId,
      kind: "ai_action",
      authorType: "system",
      content: "Lead pediu para sair. Envios automáticos bloqueados.",
    });
  }
  if (Object.keys(patch).length) await db.from("crm_leads").update(patch).eq("id", leadId);

  // Lead respondeu: a cadência para e a conversa volta para a IA ou para o responsável.
  if (!patch["unsubscribed"]) await stopCadences(leadId, "replied");

  const conversationId = conversation["id"] as string;
  if (!patch["unsubscribed"]) {
    await triggerSdrAgent(integration, leadId, conversationId, msg.body ?? "");
  }

  return { leadId, conversationId };
}

/** Runs the SDR agent for the inbound message and replies on WhatsApp. */
async function triggerSdrAgent(
  integration: Integration,
  leadId: string,
  conversationId: string,
  inboundText: string,
) {
  if (!inboundText.trim()) return;
  try {
    const { runSdrAgent } = await import("./sdr.server");
    const result = await runSdrAgent({
      workspaceId: integration.workspace_id,
      leadId,
      conversationId,
      inboundText,
    });
    const reply = ("reply" in result && result.reply) || null;
    if (!reply) return;
    const db = await admin();
    const { data: lead } = await db.from("crm_leads").select("phone").eq("id", leadId).maybeSingle();
    if (!lead?.phone) return;
    await sendAndStore({
      integration,
      conversationId,
      leadId,
      message: { to: lead.phone, kind: "text", body: reply },
      authorType: "ai",
    });
  } catch (err) {
    console.error("[sdr] falha ao responder o lead:", err);
  }
}

/** Delivery/read receipts from the Cloud API. */
export async function applyStatusUpdate(workspaceId: string, externalId: string, status: string) {
  const db = await admin();
  const map: Record<string, string> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
  const mapped = map[status];
  if (!mapped) return;
  await db.from("crm_messages").update({ status: mapped }).eq("workspace_id", workspaceId).eq("external_id", externalId);
}
