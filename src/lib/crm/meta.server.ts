/** Meta Graph API: lead retrieval, ad insights (costs) and Conversions API. */
import { createHash } from "crypto";
import {
  admin,
  addInteraction,
  findLead,
  firstStage,
  normalizePhone,
  pickOwner,
  secret,
  startCadence,
  type Integration,
} from "./integrations.server";

/** Usa o cliente oficial (token do usuário do sistema + appsecret_proof). */
async function graph(path: string, init?: RequestInit & { token?: string }) {
  const { graph: call } = await import("@/lib/meta/graph.server");
  const [p, qs] = path.split("?");
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(qs ?? ""));
  if (init?.body && typeof init.body === "string") {
    try {
      Object.assign(params, JSON.parse(init.body));
    } catch {
      /* corpo não-JSON ignorado */
    }
  }
  return call(p!, { method: (init?.method as "GET" | "POST") ?? "GET", params, ...(init?.token ? { token: init.token } : {}) });
}

type LeadField = { name: string; values: string[] };

/** Applies the workspace field mapping (meta field name -> crm field). */
function applyMapping(fields: LeadField[], mapping: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const target = mapping[f.name] ?? defaultTarget(f.name);
    if (!target) continue;
    const value = (f.values ?? []).join(", ");
    if (value) out[target] = value;
  }
  return out;
}

function defaultTarget(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("mail")) return "email";
  if (n.includes("phone") || n.includes("telefone") || n.includes("whats")) return "phone";
  if (n.includes("name") || n.includes("nome")) return "name";
  if (n.includes("city") || n.includes("cidade")) return "city";
  return null;
}

/** Fetches a leadgen record and creates/updates the CRM lead. */
export async function ingestLeadgen(integration: Integration, leadgenId: string) {
  const db = await admin();
  const lead = (await graph(
    `/${leadgenId}?fields=created_time,field_data,form_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name`,
  )) as {
    field_data?: LeadField[];
    form_id?: string;
    campaign_name?: string;
    adset_name?: string;
    ad_name?: string;
    ad_id?: string;
  };

  const mapped = applyMapping(lead.field_data ?? [], integration.field_mapping ?? {});
  const phone = normalizePhone(mapped["phone"] ?? null);
  const email = mapped["email"]?.toLowerCase() ?? null;
  const name = mapped["name"] ?? "Lead sem nome";

  const existing = await findLead(integration.workspace_id, phone, email);
  if (existing) {
    await addInteraction({
      workspaceId: integration.workspace_id,
      leadId: existing.id as string,
      kind: "ai_action",
      authorType: "system",
      content: `Novo envio de formulário Meta (${lead.ad_name ?? "anúncio"}) recebido para um lead já existente.`,
      metadata: { leadgen_id: leagenSafe(leadgenId), campaign: lead.campaign_name },
    });
    return { leadId: existing.id as string, duplicated: true };
  }

  const { pipelineId, stageId } = await firstStage(integration.workspace_id);
  const ownerId = await pickOwner(integration.workspace_id);

  const { data: created, error } = await db
    .from("crm_leads")
    .insert({
      workspace_id: integration.workspace_id,
      pipeline_id: pipelineId,
      stage_id: stageId,
      name,
      phone,
      email,
      city: mapped["city"] ?? null,
      source: "meta_lead_ads",
      campaign_name: lead.campaign_name ?? null,
      adset_name: lead.adset_name ?? null,
      ad_name: lead.ad_name ?? null,
      form_id: lead.form_id ?? null,
      external_id: leadgenId,
      owner_id: ownerId,
      lgpd_consent: true,
      lgpd_consent_at: new Date().toISOString(),
      raw_payload: lead as never,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const leadId = created.id as string;
  if (stageId) {
    await db.from("crm_stage_history").insert({
      workspace_id: integration.workspace_id,
      lead_id: leadId,
      from_stage_id: null,
      to_stage_id: stageId,
    });
  }
  await addInteraction({
    workspaceId: integration.workspace_id,
    leadId,
    kind: "ai_action",
    authorType: "system",
    content: `Lead recebido do formulário Meta Lead Ads (${lead.ad_name ?? "anúncio"}).`,
    metadata: { leadgen_id: leadgenId },
  });
  await startCadence(integration.workspace_id, leadId, "meta_lead_ads");
  return { leadId, duplicated: false };
}

function leagenSafe(id: string) {
  return id.slice(0, 40);
}

/** Daily cost import per campaign (Marketing API insights). */
export async function importCampaignCosts(integration: Integration, datePreset = "yesterday") {
  const adAccountId = String((integration.config as Record<string, unknown>)["ad_account_id"] ?? "");
  if (!adAccountId) throw new Error("ad_account_id não configurado");
  const db = await admin();
  const json = (await graph(
    `/${adAccountId}/insights?level=campaign&date_preset=${datePreset}&time_increment=1&fields=campaign_id,campaign_name,spend,impressions,clicks`,
  )) as { data?: Record<string, string>[] };

  const rows = (json.data ?? []).map((r) => ({
    workspace_id: integration.workspace_id,
    date: r["date_start"] ?? new Date().toISOString().slice(0, 10),
    campaign_id: r["campaign_id"] ?? "",
    campaign_name: r["campaign_name"] ?? null,
    spend: Number(r["spend"] ?? 0),
    impressions: Number(r["impressions"] ?? 0),
    clicks: Number(r["clicks"] ?? 0),
  }));
  if (!rows.length) return 0;
  const { error } = await db
    .from("crm_campaign_costs")
    .upsert(rows as never, { onConflict: "workspace_id,date,campaign_id" });
  if (error) throw new Error(error.message);
  return rows.length;
}

const sha256 = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

/** Conversions API: sends Qualified / Won as offline conversions for optimisation. */
export async function sendConversionEvent(args: {
  integration: Integration;
  eventName: "Qualificado" | "Ganho";
  phone: string | null;
  email: string | null;
  value?: number;
}) {
  const pixelId = String((args.integration.config as Record<string, unknown>)["pixel_id"] ?? "");
  if (!pixelId) return { skipped: "pixel_id não configurado" };
  const userData: Record<string, string[]> = {};
  if (args.email) userData["em"] = [sha256(args.email)];
  if (args.phone) userData["ph"] = [sha256(args.phone.replace(/\D/g, ""))];
  if (!Object.keys(userData).length) return { skipped: "sem dados de contato" };

  await graph(`/${pixelId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        {
          event_name: args.eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "system_generated",
          user_data: userData,
          custom_data: args.value ? { value: args.value, currency: "BRL" } : undefined,
        },
      ],
    }),
  });
  return { sent: true };
}

/** Lists the fields of a Meta lead form, for the mapping screen. */
export async function listFormFields(formId: string) {
  const json = (await graph(`/${formId}?fields=name,questions`)) as {
    name?: string;
    questions?: { key?: string; label?: string }[];
  };
  return {
    name: json.name ?? formId,
    fields: (json.questions ?? []).map((q) => ({ key: q.key ?? "", label: q.label ?? q.key ?? "" })),
  };
}

export async function listForms(pageId: string, pageToken?: string) {
  const json = (await graph(`/${pageId}/leadgen_forms?fields=id,name,status`, pageToken ? { token: pageToken } : {})) as {
    data?: { id: string; name: string; status: string }[];
  };
  return json.data ?? [];
}
