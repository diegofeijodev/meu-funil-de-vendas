import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily routine: imports Meta campaign costs and runs due cadence steps.
 * Protected by the CRM_CRON_SECRET header — never call it from the browser.
 */
export const Route = createFileRoute("/api/public/cron/crm-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["CRM_CRON_SECRET"];
        const provided = request.headers.get("x-cron-secret");
        if (!expected || provided !== expected) return new Response("Unauthorized", { status: 401 });

        const { admin } = await import("@/lib/crm/integrations.server");
        const { importCampaignCosts } = await import("@/lib/crm/meta.server");
        const db = await admin();

        const results: { workspace_id: string; imported?: number; error?: string }[] = [];
        const { data: integrations } = await db
          .from("crm_integrations")
          .select("*")
          .eq("kind", "meta_lead_ads")
          .eq("status", "connected");

        for (const integration of integrations ?? []) {
          try {
            const imported = await importCampaignCosts(integration as never);
            results.push({ workspace_id: integration.workspace_id as string, imported });
          } catch (err) {
            const detail = err instanceof Error ? err.message : "erro desconhecido";
            console.error("[crm-daily] custos falharam:", detail);
            results.push({ workspace_id: integration.workspace_id as string, error: detail });
          }
        }

        const cadenceSteps = await runDueCadences();
        return Response.json({ costs: results, cadence_steps: cadenceSteps });
      },
    },
  },
});

/** Executes cadence steps whose schedule is due. */
async function runDueCadences() {
  const { admin, addInteraction } = await import("@/lib/crm/integrations.server");
  const db = await admin();
  const { data: runs } = await db
    .from("crm_cadence_runs")
    .select("*, crm_cadences(steps, is_active), crm_leads(id, name, phone, unsubscribed, ai_active)")
    .eq("status", "running")
    .lte("next_run_at", new Date().toISOString())
    .limit(200);

  let executed = 0;
  for (const run of runs ?? []) {
    const cadence = (run as Record<string, unknown>)["crm_cadences"] as { steps?: unknown[]; is_active?: boolean } | null;
    const lead = (run as Record<string, unknown>)["crm_leads"] as
      | { id: string; name: string; phone: string | null; unsubscribed: boolean; ai_active: boolean }
      | null;
    if (!cadence?.is_active || !lead || lead.unsubscribed || !lead.ai_active) {
      await db.from("crm_cadence_runs").update({ status: "stopped" }).eq("id", run.id as string);
      continue;
    }
    const steps = (cadence.steps ?? []) as { delay_minutes?: number; message?: string }[];
    const step = steps[run.step_index as number];
    if (!step) {
      await db.from("crm_cadence_runs").update({ status: "done" }).eq("id", run.id as string);
      continue;
    }
    try {
      const message = step.message ?? "";
      if (message && lead.phone) {
        const { data: integration } = await db
          .from("crm_integrations")
          .select("*")
          .eq("workspace_id", run.workspace_id as string)
          .eq("kind", "whatsapp")
          .eq("status", "connected")
          .maybeSingle();
        if (integration) {
          const { ensureConversation, sendAndStore } = await import("@/lib/crm/whatsapp.server");
          const conversation = await ensureConversation({
            integration: integration as never,
            phone: lead.phone,
            leadId: lead.id,
          });
          await sendAndStore({
            integration: integration as never,
            conversationId: (conversation as Record<string, unknown>)["id"] as string,
            leadId: lead.id,
            message: { to: lead.phone, kind: "text", body: message },
            authorType: "ai",
          });
        }
      }
      await addInteraction({
        workspaceId: run.workspace_id as string,
        leadId: lead.id,
        kind: "ai_action",
        authorType: "ai",
        content: message || "Passo da cadência executado.",
      });
      executed += 1;
      const nextIndex = (run.step_index as number) + 1;
      const nextStep = steps[nextIndex];
      await db
        .from("crm_cadence_runs")
        .update({
          step_index: nextIndex,
          status: nextStep ? "running" : "done",
          next_run_at: new Date(Date.now() + (nextStep?.delay_minutes ?? 0) * 60_000).toISOString(),
        })
        .eq("id", run.id as string);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "erro desconhecido";
      console.error("[crm-daily] cadência falhou:", detail);
      await db.from("crm_cadence_runs").update({ status: "failed", last_error: detail }).eq("id", run.id as string);
    }
  }
  return executed;
}
