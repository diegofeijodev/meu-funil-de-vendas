import { createFileRoute } from "@tanstack/react-router";

/**
 * pg_cron do gestor de tráfego:
 * - task=sync (a cada 3 h): desempenho real da Meta → performance_daily.
 * - task=rules (1x por dia): sincroniza e roda as regras automáticas das campanhas.
 * Protegido pelo token "ads" em cron_tokens (ou CRM_CRON_SECRET).
 */
export const Route = createFileRoute("/api/public/cron/ads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isCronAuthorized } = await import("@/lib/cron-auth.server");
        if (!(await isCronAuthorized(request, ["ads"]))) return new Response("Unauthorized", { status: 401 });
        const body = (await request.json().catch(() => ({}))) as { task?: string };
        const ops = await import("@/lib/meta/ads-ops.server");
        const out: Record<string, unknown> = { sync: await ops.syncAllInsights() };
        if (body.task === "rules") out["rules"] = await ops.runAllRules();
        return Response.json(out);
      },
    },
  },
});
