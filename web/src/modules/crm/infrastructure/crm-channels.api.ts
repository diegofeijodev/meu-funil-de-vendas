import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

const base = (ws: string) => `/v1/workspaces/${ws}/crm`;
const str = z.string().nullish();

const inboxRowSchema = z.object({
  id: z.string(), phone: z.string(), unread_count: z.coerce.number(), last_message_at: str, last_message_preview: str, lead_id: str,
  crm_leads: z.object({ id: z.string(), name: str, owner_id: str, unsubscribed: z.boolean().nullish(), phone: str }).nullish(),
});
const conversationSchema = z.object({ id: z.string(), window_expires_at: str, unread_count: z.coerce.number(), provider: z.string() });
const messageSchema = z.object({ id: z.string(), direction: z.enum(["in", "out"]), message_type: z.string(), body: str, media_url: str, status: z.string(), created_at: z.string() });
const templateSchema = z.object({ name: z.string(), language: z.string(), status: z.string(), body_preview: str });
const quickReplySchema = z.object({ id: z.string(), title: z.string(), body: z.string() });
const integrationSchema = z.object({
  id: z.string(), kind: z.string(), provider: z.string(), status: z.string(), config: z.record(z.string(), z.unknown()).default({}),
  field_mapping: z.record(z.string(), z.string()).default({}), webhook_token: z.string(), verify_token: z.string(), last_event_at: str, last_error: str,
});
const stepsSchema = z.array(z.record(z.string(), z.unknown())).default([]);
const cadenceSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().default(""), trigger_type: z.string(), trigger_value: str, is_active: z.boolean(),
  steps: stepsSchema, exit_rules: z.record(z.string(), z.boolean()).default({}),
}).passthrough();

export type InboxRow = z.infer<typeof inboxRowSchema>;
export type ChatMessage = z.infer<typeof messageSchema> & { kind: string };
export type CrmIntegrationRow = z.infer<typeof integrationSchema>;
export type CadenceRowData = z.infer<typeof cadenceSchema>;

export async function listConversations(ws: string): Promise<InboxRow[]> {
  const { data } = await api.get(`${base(ws)}/conversations`);
  return z.array(inboxRowSchema).parse(data);
}
/** `null` quando o lead ainda não tem conversa no canal (o protótipo usava `maybeSingle`). */
export async function getLeadConversation(ws: string, leadId: string, channel: "whatsapp" | "instagram") {
  const { data } = await api.get(`${base(ws)}/leads/${leadId}/conversation`, { params: { channel } });
  return data ? conversationSchema.parse(data) : null;
}
export async function listMessages(ws: string, conversationId: string): Promise<ChatMessage[]> {
  const { data } = await api.get(`${base(ws)}/conversations/${conversationId}/messages`);
  return z.array(messageSchema).parse(data).map((m) => ({ ...m, kind: m.message_type }));
}
export async function listWaTemplates(ws: string, onlyApproved: boolean) {
  const { data } = await api.get(`${base(ws)}/wa-templates`, { params: onlyApproved ? { status: "APPROVED" } : {} });
  return z.array(templateSchema).parse(data);
}
export async function listQuickReplies(ws: string) {
  const { data } = await api.get(`${base(ws)}/quick-replies`);
  return z.array(quickReplySchema).parse(data);
}
export async function listIntegrations(ws: string): Promise<CrmIntegrationRow[]> {
  const { data } = await api.get(`${base(ws)}/integrations`);
  return z.array(integrationSchema).parse(data);
}
export async function listCadences(ws: string): Promise<CadenceRowData[]> {
  const { data } = await api.get(`${base(ws)}/cadences`);
  return z.array(cadenceSchema).parse(data);
}
export async function listCadenceEvents(ws: string) {
  const { data } = await api.get(`${base(ws)}/cadence-events`);
  return z.array(z.object({ cadence_id: z.string(), step_index: z.number(), event: z.string(), message_id: str })).parse(data);
}
export async function listCadenceRuns(ws: string) {
  const { data } = await api.get(`${base(ws)}/cadence-runs`);
  return z.array(z.object({ cadence_id: z.string(), status: z.string(), stop_reason: str, step_index: z.number(), next_run_at: str })).parse(data);
}
