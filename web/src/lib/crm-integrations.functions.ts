import { serverFnPost } from "@/lib/server-fn";

/** `POST /v1/crm-integrations/notify-meta-conversion` — API de Conversões da Meta; nunca lança depois do acesso. */
export const notifyMetaConversion = serverFnPost<
  { workspaceId: string; leadId: string; event: "Qualificado" | "Ganho" },
  { sent: boolean } | { skipped: true }
>("/v1/crm-integrations/notify-meta-conversion");

/** `POST /v1/crm-integrations/send-lead-email-now` (Task 8). */
export const sendLeadEmailNow = serverFnPost<{ workspaceId: string; leadId: string; subject: string; body: string }, { id: string }>(
  "/v1/crm-integrations/send-lead-email-now",
);

/** `POST /v1/crm-integrations/send-whats-app-message` (Task 8). */
export const sendWhatsAppMessage = serverFnPost<
  {
    workspaceId: string; leadId: string; kind: "text" | "image" | "audio" | "template"; body?: string; mediaUrl?: string;
    templateName?: string; templateLanguage?: string; templateParams?: string[];
  },
  { id: string; externalId: string | null }
>("/v1/crm-integrations/send-whats-app-message");

/** `POST /v1/crm-integrations/send-instagram-message` (Task 8). */
export const sendInstagramMessage = serverFnPost<{ workspaceId: string; leadId: string; body: string }, { id: string }>(
  "/v1/crm-integrations/send-instagram-message",
);

type Kind = "meta_lead_ads" | "whatsapp" | "instagram" | "site_form" | "email" | "calendar";
type Provider = "meta" | "whatsapp_cloud" | "zapi" | "evolution" | "site" | "resend" | "calcom";
export type ChannelSecretKey = "WHATSAPP_CLOUD_TOKEN" | "ZAPI_TOKEN" | "EVOLUTION_API_KEY" | "RESEND_API_KEY" | "CALCOM_API_KEY" | "WHATSAPP_WEBHOOK_SECRET";

/** `POST /v1/crm-integrations/save-integration` — gera webhook/verify token no primeiro salvamento. */
export const saveIntegration = serverFnPost<
  { workspaceId: string; kind: Kind; provider: Provider; config?: Record<string, unknown>; fieldMapping?: Record<string, string>; status?: "disconnected" | "connecting" | "connected" },
  { id: string; webhook_token: string; verify_token: string; status: string }
>("/v1/crm-integrations/save-integration");

/** `POST /v1/crm-integrations/test-integration` — `{ok:false}` (HTTP 200) com `missing`/`error`. */
export const testIntegration = serverFnPost<{ workspaceId: string; kind: Kind }, { ok: boolean; missing: string[]; error?: string }>("/v1/crm-integrations/test-integration");

export const disconnectIntegration = serverFnPost<{ workspaceId: string; kind: Kind }, { ok: true }>("/v1/crm-integrations/disconnect-integration");

export const loadMetaFormFields = serverFnPost<{ workspaceId: string; formId: string }, { name: string; fields: { key: string; label: string }[] }>("/v1/crm-integrations/load-meta-form-fields");

export const syncWhatsAppTemplates = serverFnPost<{ workspaceId: string }, { count: number }>("/v1/crm-integrations/sync-whats-app-templates");

export const importMetaCostsNow = serverFnPost<{ workspaceId: string }, { imported: number }>("/v1/crm-integrations/import-meta-costs-now");

/** Credencial do canal: vai para o cofre do servidor e nunca volta para a tela. */
export const saveChannelSecret = serverFnPost<{ workspaceId: string; key: ChannelSecretKey; value: string }, { ok: true }>("/v1/crm-integrations/save-channel-secret");

export const channelSecretsStatus = serverFnPost<{ workspaceId: string }, Record<ChannelSecretKey, "empresa" | "servidor" | "faltando">>("/v1/crm-integrations/channel-secrets-status");

export const listFailedEvents = serverFnPost<{ workspaceId: string }, { id: string; source: string; external_id: string | null; error_message: string | null; created_at: string }[]>("/v1/crm-integrations/list-failed-events");

export const reprocessEvent = serverFnPost<{ workspaceId: string; eventId: string }, { ok: true }>("/v1/crm-integrations/reprocess-event");
