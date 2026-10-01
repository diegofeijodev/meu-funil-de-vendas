import { createFileRoute } from "@tanstack/react-router";

/**
 * Runs every 5 minutes (pg_cron): executes due cadence steps and SLA alerts.
 * Protected by the CRM_CRON_SECRET header — never call it from the browser.
 */
export const Route = createFileRoute("/api/public/cron/crm-cadences")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isCronAuthorized } = await import("@/lib/cron-auth.server");
        const authorized = await isCronAuthorized(request, ["crm_cadences"]);
        if (!authorized) return new Response("Unauthorized", { status: 401 });

        try {
          const { runDueCadenceSteps, createSlaAlerts, applyStageAndTagTriggers } = await import(
            "@/lib/crm/cadence.server",
          );
          const triggered = await applyStageAndTagTriggers();
          const result = await runDueCadenceSteps();
          const slaTasks = await createSlaAlerts();
          return Response.json({ ...result, triggered, sla_tasks: slaTasks });
        } catch (err) {
          console.error("[cron/crm-cadences]", err);
          return Response.json({ error: "cadence run failed" }, { status: 500 });
        }
      },
    },
  },
});
