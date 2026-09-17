/**
 * Cadence engine (server-only).
 * Steps run through the scheduled route /api/public/cron/crm-cadences.
 */
import { admin, addInteraction, type Integration } from "./integrations.server";
import type { CadenceChannel, CadenceStep, ExitRules } from "./cadence-types";

export type { CadenceChannel, CadenceStep, ExitRules };

const TZ = "America/Sao_Paulo";
const DEFAULT_WINDOW = { days: [1, 2, 3, 4, 5], start: "08:00", end: "20:00" };

/* --------------------------------- Vars --------------------------------- */

export function renderVariables(
  text: string,
  vars: { nome?: string | null; cidade?: string | null; empresa?: string | null; responsavel?: string | null },
) {
  return text.replace(/\{\{\s*(nome|cidade|empresa|responsavel)\s*\}\}/gi, (_m, key: string) => {
    const value = vars[key.toLowerCase() as keyof typeof vars];
    return value ? String(value) : "";
  });
}

/* -------------------------------- Window -------------------------------- */

function localParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: dayMap[String(parts["weekday"])] ?? 0,
    minutes: Number(parts["hour"]) * 60 + Number(parts["minute"]),
  };
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

export function inWindow(step: CadenceStep, at: Date) {
  const w = step.window ?? DEFAULT_WINDOW;
  if (!w.days?.length) return true;
  const { day, minutes } = localParts(at);
  if (!w.days.includes(day)) return false;
  return minutes >= toMinutes(w.start) && minutes <= toMinutes(w.end);
}

/** Next instant inside the step window, scanning in 15-minute hops (max 7 days). */
export function nextWindowSlot(step: CadenceStep, from: Date) {
  let cursor = from.getTime();
  for (let i = 0; i < 4 * 24 * 7; i += 1) {
    cursor += 15 * 60_000;
    if (inWindow(step, new Date(cursor))) return new Date(cursor);
  }
  return new Date(from.getTime() + 60 * 60_000);
}

/* ------------------------------- Enrolment ------------------------------ */

export async function enrollLead(args: { workspaceId: string; cadenceId: string; leadId: string }) {
  const db = await admin();
  const { data: existing } = await db
    .from("crm_cadence_runs")
    .select("id, status")
    .eq("cadence_id", args.cadenceId)
    .eq("lead_id", args.leadId)
    .maybeSingle();
  if (existing && existing.status === "running") return { skipped: true };

  const { data: lead } = await db
    .from("crm_leads")
    .select("stage_id, unsubscribed")
    .eq("id", args.leadId)
    .maybeSingle();
  if (!lead || lead.unsubscribed) return { skipped: true };

  const row = {
    workspace_id: args.workspaceId,
    cadence_id: args.cadenceId,
    lead_id: args.leadId,
    step_index: 0,
    status: "running",
    stop_reason: null,
    entered_at: new Date().toISOString(),
    entry_stage_id: lead.stage_id,
    next_run_at: new Date().toISOString(),
  };
  if (existing) {
    await db.from("crm_cadence_runs").update(row as never).eq("id", existing.id);
  } else {
    await db.from("crm_cadence_runs").insert(row as never);
  }
  return { enrolled: true };
}

export async function stopCadences(leadId: string, reason: string) {
  const db = await admin();
  const { data: runs } = await db
    .from("crm_cadence_runs")
    .select("id, workspace_id, cadence_id, step_index")
    .eq("lead_id", leadId)
    .eq("status", "running");
  if (!runs?.length) return 0;
  await db
    .from("crm_cadence_runs")
    .update({ status: "stopped", stop_reason: reason })
    .eq("lead_id", leadId)
    .eq("status", "running");
  for (const run of runs) {
    await logCadenceEvent({
      workspaceId: run.workspace_id as string,
      cadenceId: run.cadence_id as string,
      runId: run.id as string,
      leadId,
      stepIndex: run.step_index as number,
      event: reason === "opt_out" ? "opt_out" : reason === "replied" ? "replied" : "exited",
      detail: reason,
    });
  }
  return runs.length;
}

export async function logCadenceEvent(args: {
  workspaceId: string;
  cadenceId: string;
  runId?: string | null;
  leadId?: string | null;
  stepIndex: number;
  channel?: CadenceChannel;
  event: string;
  messageId?: string | null;
  detail?: string | null;
}) {
  const db = await admin();
  await db.from("crm_cadence_events").insert({
    workspace_id: args.workspaceId,
    cadence_id: args.cadenceId,
    run_id: args.runId ?? null,
    lead_id: args.leadId ?? null,
    step_index: args.stepIndex,
    channel: args.channel ?? "wa_text",
    event: args.event,
    message_id: args.messageId ?? null,
    detail: args.detail ?? null,
  } as never);
}

/* ------------------------------- Execution ------------------------------ */

type RunRow = Record<string, unknown>;

/** Checks the cadence exit rules; returns the stop reason when the lead must leave. */
async function exitReason(run: RunRow, rules: ExitRules) {
  const db = await admin();
  const leadId = run["lead_id"] as string;
  const { data: lead } = await db
    .from("crm_leads")
    .select("id, name, city, phone, stage_id, owner_id, unsubscribed, ai_active")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { reason: "lead_removido", lead: null };
  if (lead.unsubscribed && rules.on_opt_out !== false) return { reason: "opt_out", lead };
  if (!lead.ai_active && rules.on_human_takeover !== false) return { reason: "human_takeover", lead };

  if (lead.stage_id) {
    if (rules.on_stage_change !== false && run["entry_stage_id"] && lead.stage_id !== run["entry_stage_id"]) {
      return { reason: "stage_change", lead };
    }
    if (rules.on_won_lost !== false) {
      const { data: stage } = await db
        .from("crm_stages")
        .select("is_won, is_lost")
        .eq("id", lead.stage_id)
        .maybeSingle();
      if (stage?.is_won || stage?.is_lost) return { reason: "won_lost", lead };
    }
  }

  if (rules.on_reply !== false) {
    const { count } = await db
      .from("crm_messages")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("direction", "in")
      .gt("created_at", (run["entered_at"] as string) ?? new Date(0).toISOString());
    if ((count ?? 0) > 0) return { reason: "replied", lead };
  }
  return { reason: null as string | null, lead };
}

async function hourlyBudget(workspaceId: string) {
  const db = await admin();
  const [{ data: settings }, { count }] = await Promise.all([
    db.from("crm_settings").select("wa_hourly_limit").eq("workspace_id", workspaceId).maybeSingle(),
    db
      .from("crm_messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("direction", "out")
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString()),
  ]);
  const limit = (settings?.wa_hourly_limit as number | undefined) ?? 30;
  return Math.max(0, limit - (count ?? 0));
}

/** Runs every cadence step whose schedule is due. Called by the 5-minute cron. */
export async function runDueCadenceSteps(limit = 200) {
  const db = await admin();
  const now = new Date();
  const { data: runs } = await db
    .from("crm_cadence_runs")
    .select("*, crm_cadences(steps, is_active, exit_rules)")
    .eq("status", "running")
    .lte("next_run_at", now.toISOString())
    .order("next_run_at")
    .limit(limit);

  const budgets = new Map<string, number>();
  let executed = 0;
  let skipped = 0;

  for (const run of (runs ?? []) as RunRow[]) {
    const workspaceId = run["workspace_id"] as string;
    const cadence = run["crm_cadences"] as { steps?: CadenceStep[]; is_active?: boolean; exit_rules?: ExitRules } | null;
    const runId = run["id"] as string;

    if (!cadence?.is_active) {
      await db.from("crm_cadence_runs").update({ status: "stopped", stop_reason: "cadencia_inativa" }).eq("id", runId);
      continue;
    }

    const { reason, lead } = await exitReason(run, cadence.exit_rules ?? {});
    if (reason) {
      await db.from("crm_cadence_runs").update({ status: "stopped", stop_reason: reason }).eq("id", runId);
      await logCadenceEvent({
        workspaceId,
        cadenceId: run["cadence_id"] as string,
        runId,
        leadId: run["lead_id"] as string,
        stepIndex: run["step_index"] as number,
        event: reason === "opt_out" ? "opt_out" : reason === "replied" ? "replied" : "exited",
        detail: reason,
      });
      if (reason === "replied") await handOverToOwner(workspaceId, run["lead_id"] as string);
      continue;
    }

    const steps = cadence.steps ?? [];
    const index = run["step_index"] as number;
    const step = steps[index];
    if (!step) {
      await db.from("crm_cadence_runs").update({ status: "done" }).eq("id", runId);
      continue;
    }

    if (!inWindow(step, now)) {
      await db
        .from("crm_cadence_runs")
        .update({ next_run_at: nextWindowSlot(step, now).toISOString() })
        .eq("id", runId);
      skipped += 1;
      continue;
    }

    if (!budgets.has(workspaceId)) budgets.set(workspaceId, await hourlyBudget(workspaceId));
    const needsSend = step.channel === "wa_text" || step.channel === "wa_template";
    if (needsSend && (budgets.get(workspaceId) ?? 0) <= 0) {
      await db
        .from("crm_cadence_runs")
        .update({ next_run_at: new Date(now.getTime() + 20 * 60_000).toISOString() })
        .eq("id", runId);
      skipped += 1;
      continue;
    }

    try {
      await executeStep({ run, step, index, lead: lead as Record<string, unknown> });
      if (needsSend) budgets.set(workspaceId, (budgets.get(workspaceId) ?? 1) - 1);
      executed += 1;
      const nextIndex = index + 1;
      const nextStep = steps[nextIndex];
      await db
        .from("crm_cadence_runs")
        .update({
          step_index: nextIndex,
          status: nextStep ? "running" : "done",
          last_step_at: now.toISOString(),
          last_error: null,
          next_run_at: nextStep
            ? new Date(now.getTime() + (nextStep.delay_minutes ?? 0) * 60_000).toISOString()
            : now.toISOString(),
        })
        .eq("id", runId);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "erro desconhecido";
      console.error("[cadence] passo falhou:", detail);
      await db
        .from("crm_cadence_runs")
        .update({ status: "failed", last_error: detail })
        .eq("id", runId);
      await logCadenceEvent({
        workspaceId,
        cadenceId: run["cadence_id"] as string,
        runId,
        leadId: run["lead_id"] as string,
        stepIndex: index,
        channel: step.channel,
        event: "failed",
        detail,
      });
    }
  }
  return { executed, skipped };
}

async function executeStep(args: {
  run: RunRow;
  step: CadenceStep;
  index: number;
  lead: Record<string, unknown>;
}) {
  const db = await admin();
  const { run, step, index, lead } = args;
  const workspaceId = run["workspace_id"] as string;
  const leadId = lead["id"] as string;

  let ownerName: string | null = null;
  if (lead["owner_id"]) {
    const { data: profile } = await db
      .from("profiles")
      .select("full_name")
      .eq("id", lead["owner_id"] as string)
      .maybeSingle();
    ownerName = (profile?.full_name as string | null) ?? null;
  }
  const vars = {
    nome: (lead["name"] as string | null) ?? "",
    cidade: (lead["city"] as string | null) ?? "",
    empresa: (lead["company"] as string | null) ?? "",
    responsavel: ownerName ?? "",
  };
  const body = renderVariables(step.message ?? "", vars);

  const logBase = {
    workspaceId,
    cadenceId: run["cadence_id"] as string,
    runId: run["id"] as string,
    leadId,
    stepIndex: index,
    channel: step.channel,
  };

  if (step.channel === "call_task" || step.channel === "email") {
    await db.from("crm_tasks").insert({
      workspace_id: workspaceId,
      lead_id: leadId,
      title:
        step.channel === "call_task"
          ? `Ligar para ${vars.nome || "o lead"}`
          : `Enviar e-mail: ${step.subject || "follow-up"} — ${vars.nome || "lead"}`,
      assignee_id: (lead["owner_id"] as string | null) ?? null,
      due_at: new Date().toISOString(),
      status: "open",
    } as never);
    await addInteraction({
      workspaceId,
      leadId,
      kind: "ai_action",
      authorType: "system",
      content: body || "Tarefa da cadência criada.",
    });
    await logCadenceEvent({ ...logBase, event: "task" });
    return;
  }

  const { data: integration } = await db
    .from("crm_integrations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("kind", "whatsapp")
    .eq("status", "connected")
    .maybeSingle();
  if (!integration) throw new Error("WhatsApp não conectado neste workspace.");

  const phone = lead["phone"] as string | null;
  if (!phone) throw new Error("Lead sem telefone.");

  const { ensureConversation, sendAndStore, windowOpen } = await import("./whatsapp.server");
  const conversation = await ensureConversation({
    integration: integration as unknown as Integration,
    phone,
    leadId,
  });
  const open = windowOpen(conversation as { window_expires_at: string | null });

  let message: {
    to: string;
    kind: "text" | "template";
    body?: string;
    templateName?: string;
    templateLanguage?: string;
    templateParams?: string[];
  };
  if (step.channel === "wa_template" || !open) {
    const templateName = step.channel === "wa_template" ? step.template_name : step.fallback_template;
    if (!templateName) {
      await logCadenceEvent({ ...logBase, event: "skipped", detail: "fora da janela de 24h e sem template" });
      return;
    }
    message = {
      to: phone,
      kind: "template",
      templateName,
      templateLanguage: step.template_language ?? "pt_BR",
      templateParams: (step.template_params ?? []).map((p) => renderVariables(p, vars)),
    };
  } else {
    message = { to: phone, kind: "text", body };
  }

  const sent = await sendAndStore({
    integration: integration as unknown as Integration,
    conversationId: (conversation as Record<string, unknown>)["id"] as string,
    leadId,
    message,
    authorType: "ai",
  });
  await addInteraction({
    workspaceId,
    leadId,
    kind: "message_out",
    authorType: "ai",
    content: body || message.templateName || "Passo da cadência",
    metadata: { cadence_id: run["cadence_id"], step_index: index },
  });
  await logCadenceEvent({ ...logBase, event: "sent", messageId: sent.id });
}

/** When a lead replies, hand the conversation to the SDR agent or the owner. */
async function handOverToOwner(workspaceId: string, leadId: string) {
  const db = await admin();
  const { data: lead } = await db
    .from("crm_leads")
    .select("owner_id, ai_active, name")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return;
  const { data: agent } = await db
    .from("crm_sdr_agents")
    .select("is_active")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (agent?.is_active && lead.ai_active) return; // SDR agent already answers inbound messages.
  await db.from("crm_tasks").insert({
    workspace_id: workspaceId,
    lead_id: leadId,
    title: `Responder ${lead.name ?? "lead"} — respondeu à cadência`,
    assignee_id: (lead.owner_id as string | null) ?? null,
    due_at: new Date().toISOString(),
    status: "open",
  } as never);
}

/* ------------------------------ Auto triggers --------------------------- */

/** Enrols leads that match stage-entry or tag cadences (idempotent). */
export async function applyStageAndTagTriggers() {
  const db = await admin();
  const { data: cadences } = await db
    .from("crm_cadences")
    .select("id, workspace_id, trigger_type, trigger_value")
    .eq("is_active", true)
    .in("trigger_type", ["stage", "tag", "campaign"]);

  let enrolled = 0;
  for (const cadence of cadences ?? []) {
    const value = cadence.trigger_value as string | null;
    if (!value) continue;
    let query = db
      .from("crm_leads")
      .select("id")
      .eq("workspace_id", cadence.workspace_id as string)
      .eq("unsubscribed", false)
      .limit(200);
    if (cadence.trigger_type === "stage") query = query.eq("stage_id", value);
    else if (cadence.trigger_type === "tag") query = query.contains("tags", [value]);
    else query = query.eq("campaign_name", value);

    const { data: leads } = await query;
    for (const lead of leads ?? []) {
      const { data: run } = await db
        .from("crm_cadence_runs")
        .select("id")
        .eq("cadence_id", cadence.id as string)
        .eq("lead_id", lead.id as string)
        .maybeSingle();
      if (run) continue;
      const result = await enrollLead({
        workspaceId: cadence.workspace_id as string,
        cadenceId: cadence.id as string,
        leadId: lead.id as string,
      });
      if ("enrolled" in result) enrolled += 1;
    }
  }
  return enrolled;
}

/* ------------------------------ SLA watchdog ---------------------------- */

/** Creates a task/alert for leads stalled beyond the stage SLA. */
export async function createSlaAlerts(limit = 500) {
  const db = await admin();
  const { data: leads } = await db
    .from("crm_leads")
    .select("id, name, owner_id, workspace_id, stage_id, stage_entered_at, crm_stages(name, sla_hours, is_won, is_lost)")
    .not("stage_id", "is", null)
    .limit(limit);

  let created = 0;
  for (const lead of (leads ?? []) as Record<string, unknown>[]) {
    const stage = lead["crm_stages"] as { name: string; sla_hours: number; is_won: boolean; is_lost: boolean } | null;
    if (!stage || stage.is_won || stage.is_lost || !stage.sla_hours) continue;
    const entered = new Date((lead["stage_entered_at"] as string) ?? Date.now()).getTime();
    if (Date.now() - entered < stage.sla_hours * 3_600_000) continue;

    const title = `SLA estourado em ${stage.name} — ${lead["name"] as string}`;
    const { data: existing } = await db
      .from("crm_tasks")
      .select("id")
      .eq("lead_id", lead["id"] as string)
      .eq("title", title)
      .maybeSingle();
    if (existing) continue;

    await db.from("crm_tasks").insert({
      workspace_id: lead["workspace_id"] as string,
      lead_id: lead["id"] as string,
      title,
      assignee_id: (lead["owner_id"] as string | null) ?? null,
      due_at: new Date().toISOString(),
      status: "open",
    } as never);
    await addInteraction({
      workspaceId: lead["workspace_id"] as string,
      leadId: lead["id"] as string,
      kind: "ai_action",
      authorType: "system",
      content: `Lead parado além do SLA da etapa ${stage.name}. Tarefa criada para o responsável.`,
    });
    created += 1;
  }
  return created;
}
