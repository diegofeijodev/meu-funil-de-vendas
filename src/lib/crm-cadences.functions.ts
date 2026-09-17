import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { CadenceStep, ExitRules } from "@/lib/crm/cadence-types";

type Authed = SupabaseClient<Database>;

async function assertMember(supabase: Authed, workspaceId: string) {
  const { data } = await supabase.rpc("is_workspace_member", { _ws: workspaceId });
  if (!data) throw new Error("Workspace inválido.");
}

async function assertAdmin(supabase: Authed, workspaceId: string) {
  const { data } = await supabase.rpc("has_workspace_role", { _ws: workspaceId, _roles: ["owner", "admin"] });
  if (!data) throw new Error("Sem permissão para alterar cadências deste workspace.");
}

function friendly(err: unknown, fallback: string) {
  console.error("[crm-cadences]", err);
  return new Error(fallback);
}

type CadenceInput = {
  workspaceId: string;
  id?: string | null;
  name: string;
  description?: string;
  triggerType: "source" | "campaign" | "stage" | "tag" | "manual";
  triggerValue?: string | null;
  isActive: boolean;
  steps: CadenceStep[];
  exitRules: ExitRules;
  templateKey?: string | null;
};

/** Creates or updates a cadence. */
export const saveCadence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CadenceInput) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    if (!data.name.trim()) throw new Error("Informe o nome da cadência.");
    if (!data.steps.length) throw new Error("Adicione ao menos um passo.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = {
      workspace_id: data.workspaceId,
      name: data.name.trim(),
      description: data.description ?? "",
      source: data.triggerType === "source" ? (data.triggerValue ?? "manual") : "manual",
      trigger_type: data.triggerType,
      trigger_value: data.triggerValue ?? null,
      is_active: data.isActive,
      steps: data.steps as never,
      exit_rules: data.exitRules as never,
      template_key: data.templateKey ?? null,
    };
    try {
      if (data.id) {
        const { error } = await supabaseAdmin.from("crm_cadences").update(row as never).eq("id", data.id);
        if (error) throw error;
        return { id: data.id };
      }
      const { data: created, error } = await supabaseAdmin
        .from("crm_cadences")
        .insert(row as never)
        .select("id")
        .single();
      if (error) throw error;
      return { id: created.id as string };
    } catch (err) {
      throw friendly(err, "Não foi possível salvar a cadência.");
    }
  });

export const deleteCadence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crm_cadences")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", data.workspaceId);
    if (error) throw friendly(error, "Não foi possível excluir a cadência.");
    return { ok: true };
  });

/** Installs the ready-made templates that are missing in the workspace. */
export const installCadenceTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { CADENCE_TEMPLATES, DEFAULT_EXIT_RULES } = await import("@/lib/crm/cadence-templates");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("crm_cadences")
      .select("template_key")
      .eq("workspace_id", data.workspaceId);
    const installed = new Set((existing ?? []).map((c) => c.template_key as string | null));
    const rows = CADENCE_TEMPLATES.filter((t) => !installed.has(t.key)).map((t) => ({
      workspace_id: data.workspaceId,
      name: t.name,
      description: t.description,
      source: t.trigger_type === "source" ? (t.trigger_value ?? "manual") : "manual",
      trigger_type: t.trigger_type,
      trigger_value: t.trigger_value,
      is_active: false,
      steps: t.steps as never,
      exit_rules: DEFAULT_EXIT_RULES as never,
      template_key: t.key,
    }));
    if (!rows.length) return { created: 0 };
    const { error } = await supabaseAdmin.from("crm_cadences").insert(rows as never);
    if (error) throw friendly(error, "Não foi possível instalar os modelos.");
    return { created: rows.length };
  });

/** Enrols one or many leads manually. */
export const enrollLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; cadenceId: string; leadIds: string[] }) => input)
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, data.workspaceId);
    const { enrollLead } = await import("@/lib/crm/cadence.server");
    let enrolled = 0;
    for (const leadId of data.leadIds.slice(0, 500)) {
      const result = await enrollLead({ workspaceId: data.workspaceId, cadenceId: data.cadenceId, leadId });
      if ("enrolled" in result) enrolled += 1;
    }
    return { enrolled };
  });

export const stopLeadCadences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; leadId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, data.workspaceId);
    const { stopCadences } = await import("@/lib/crm/cadence.server");
    const stopped = await stopCadences(data.leadId, "manual");
    return { stopped };
  });

/** Runs due steps on demand (useful to validate a cadence without waiting the cron). */
export const runCadencesNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { runDueCadenceSteps, createSlaAlerts } = await import("@/lib/crm/cadence.server");
    const result = await runDueCadenceSteps();
    const slaTasks = await createSlaAlerts();
    return { ...result, slaTasks };
  });
