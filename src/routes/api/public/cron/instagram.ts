import { createFileRoute } from "@tanstack/react-router";

/**
 * A cada 5 minutos (pg_cron): publica posts agendados do Instagram e coleta métricas (1h, 24h, 7d).
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
        const { runPublishingQueue, collectDueMetrics } = await import("@/lib/instagram/instagram.server");
        const queue = await runPublishingQueue();
        const metrics = await collectDueMetrics();
        return Response.json({ queue, metrics });
      },
    },
  },
});
