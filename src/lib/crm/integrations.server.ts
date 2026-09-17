/**
 * Server-only helpers shared by the CRM integrations (Meta Lead Ads + WhatsApp).
 * Credentials are read from project secrets, never from the database or client.
 */
import { createHmac, timingSafeEqual } from "crypto";

export type Integration = {
  id: string;
  workspace_id: string;
  kind: "meta_lead_ads" | "whatsapp";
  provider: "meta" | "whatsapp_cloud" | "zapi" | "evolution";
  status: string;
  config: Record<string, unknown>;
  field_mapping: Record<string, string>;
  webhook_token: string;
  verify_token: string;
};

export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export function secret(name: string): string | null {
  const value = process.env[name];
  return value && value.length ? value : null;
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8) return null;
  if (digits.startsWith("55")) return `+${digits}`;
  if (digits.length <= 11) return `+55${digits}`;
  return `+${digits}`;
}

export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  const appSecret = secret("META_APP_SECRET");
  if (!appSecret) return false;
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function integrationByToken(token: string, kind: Integration["kind"]) {
  const db = await admin();
  const { data } = await db
    .from("crm_integrations")
    .select("*")
    .eq("webhook_token", token)
    .eq("kind", kind)
    .maybeSingle();
  return (data as Integration | null) ?? null;
}

export async function logEvent(args: {
  workspaceId: string | null;
  source: string;
  externalId?: string | null;
  payload?: unknown;
  status?: string;
  error?: string | null;
}) {
  const db = await admin();
  const { error } = await db.from("crm_webhook_events").insert({
    workspace_id: args.workspaceId,
    source: args.source,
    external_id: args.externalId ?? null,
    payload: (args.payload ?? null) as never,
    status: args.status ?? "processed",
    error_message: args.error ?? null,
  });
  // Unique violation on external_id means we already handled this event.
  return !error;
}

export async function touchIntegration(id: string, patch: { status?: string; last_error?: string | null }) {
  const db = await admin();
  await db
    .from("crm_integrations")
    .update({ last_event_at: new Date().toISOString(), ...patch })
    .eq("id", id);
}

/** Round-robin or fixed owner, according to crm_settings. */
export async function pickOwner(workspaceId: string): Promise<string | null> {
  const db = await admin();
  const [{ data: settings }, { data: members }] = await Promise.all([
    db.from("crm_settings").select("distribution, default_owner_id").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId),
  ]);
  if (settings?.distribution === "fixed") return (settings.default_owner_id as string | null) ?? null;
  const ids = (members ?? []).map((m) => m.user_id as string);
  if (!ids.length) return null;
  const { count } = await db
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  return ids[(count ?? 0) % ids.length] ?? null;
}

export async function firstStage(workspaceId: string) {
  const db = await admin();
  const { data: pipeline } = await db
    .from("crm_pipelines")
    .select("id")
    .eq("workspace_id", workspaceId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!pipeline) return { pipelineId: null, stageId: null };
  const { data: stage } = await db
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", pipeline.id)
    .order("position")
    .limit(1)
    .maybeSingle();
  return { pipelineId: pipeline.id as string, stageId: (stage?.id as string) ?? null };
}

/** Dedup by phone/email inside the workspace. */
export async function findLead(workspaceId: string, phone: string | null, email: string | null) {
  const db = await admin();
  const filters: string[] = [];
  if (phone) filters.push(`phone.eq.${phone}`);
  if (email) filters.push(`email.eq.${email}`);
  if (!filters.length) return null;
  const { data } = await db
    .from("crm_leads")
    .select("*")
    .eq("workspace_id", workspaceId)
    .or(filters.join(","))
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function addInteraction(args: {
  workspaceId: string;
  leadId: string;
  kind: string;
  authorType: "user" | "ai" | "system" | "contact";
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const db = await admin();
  await db.from("crm_interactions").insert({
    workspace_id: args.workspaceId,
    lead_id: args.leadId,
    kind: args.kind,
    author_type: args.authorType === "contact" ? "system" : args.authorType,
    content: args.content,
    metadata: (args.metadata ?? {}) as never,
  });
  await db
    .from("crm_leads")
    .update({ last_interaction_at: new Date().toISOString() })
    .eq("id", args.leadId);
}

/** Starts the cadence configured for a lead source, if any is active. */
export async function startCadence(workspaceId: string, leadId: string, source: string) {
  const db = await admin();
  const { data: cadence } = await db
    .from("crm_cadences")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("source", source)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!cadence) return;
  const { data: existing } = await db
    .from("crm_cadence_runs")
    .select("id")
    .eq("lead_id", leadId)
    .eq("cadence_id", cadence.id)
    .maybeSingle();
  if (existing) return;
  await db.from("crm_cadence_runs").insert({
    workspace_id: workspaceId,
    cadence_id: cadence.id,
    lead_id: leadId,
    step_index: 0,
    next_run_at: new Date().toISOString(),
  });
}

export const OPT_OUT_WORDS = ["sair", "parar", "descadastrar", "stop"];

export function isOptOut(text: string | null | undefined) {
  if (!text) return false;
  return OPT_OUT_WORDS.includes(text.trim().toLowerCase().replace(/[.!]/g, ""));
}
