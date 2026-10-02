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
