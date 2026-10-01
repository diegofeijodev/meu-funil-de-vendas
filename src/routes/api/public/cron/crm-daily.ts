import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily routine: imports Meta campaign costs.
 * Cadence execution lives in /api/public/cron/crm-cadences (every 5 minutes).
 * Protected by CRM_CRON_SECRET or the crm_daily token (pg_cron) — never call it from the browser.
 */
export const Route = createFileRoute("/api/public/cron/crm-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isCronAuthorized, heartbeat } = await import("@/lib/cron-auth.server");
        if (!(await isCronAuthorized(request, ["crm_daily"]))) return new Response("Unauthorized", { status: 401 });

        const { admin } = await import("@/lib/crm/integrations.server");
        const { importCampaignCosts } = await import("@/lib/crm/meta.server");
        const { runWithMetaWorkspace } = await import("@/lib/meta/graph.server");
        const db = await admin();

        const results: { workspace_id: string; imported?: number; error?: string }[] = [];
        const { data: integrations } = await db
          .from("crm_integrations")
          .select("*")
          .eq("kind", "meta_lead_ads")
          .eq("status", "connected");

        for (const integration of integrations ?? []) {
          try {
            // Credenciais da própria empresa (com fallback para as globais).
            const imported = await runWithMetaWorkspace(integration.workspace_id as string, () =>
              importCampaignCosts(integration as never),
            );
            results.push({ workspace_id: integration.workspace_id as string, imported });
          } catch (err) {
            const detail = err instanceof Error ? err.message : "erro desconhecido";
            console.error("[crm-daily] custos falharam:", detail);
            results.push({ workspace_id: integration.workspace_id as string, error: detail });
          }
        }

        await heartbeat("crm-daily", results.some((r) => r.error) ? "error" : "ok", results.find((r) => r.error)?.error ?? null);
        return Response.json({ costs: results });
      },
    },
  },
});
