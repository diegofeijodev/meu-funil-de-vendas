import { createFileRoute } from "@tanstack/react-router";

/**
 * pg_cron:
 * - a cada 5 min (sem task): piloto automático (mídia/agenda/regra 2h), fila de publicação e métricas.
 * - task=weekly (domingo 18h BRT): gera o calendário da próxima semana.
 * - task=optimize (segunda): agente de otimização.
 * Protegido pelo token "instagram" em cron_tokens (ou CRM_CRON_SECRET).
 */
export const Route = createFileRoute("/api/public/cron/instagram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret");
        if (!provided) return new Response("Unauthorized", { status: 401 });
        const envSecret = process.env["CRM_CRON_SECRET"];
        let ok = !!envSecret && provided === envSecret;
        if (!ok) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data } = await supabaseAdmin.from("cron_tokens").select("token").eq("name", "instagram").maybeSingle();
          ok = !!data?.token && data.token === provided;
        }
        if (!ok) return new Response("Unauthorized", { status: 401 });
        const body = (await request.json().catch(() => ({}))) as { task?: string };
        const ap = await import("@/lib/instagram/autopilot.server");
        if (body.task === "weekly") return Response.json({ weekly: await ap.runWeeklyAutopilot() });
        if (body.task === "optimize") return Response.json({ optimize: await ap.runOptimizer() });
        const { runPublishingQueue, collectDueMetrics } = await import("@/lib/instagram/instagram.server");
        const autopilot = await ap.autopilotTick().catch((e) => ({ error: String(e) }));
        const queue = await runPublishingQueue();
        const metrics = await collectDueMetrics();
        return Response.json({ autopilot, queue, metrics });
      },
    },
  },
});
