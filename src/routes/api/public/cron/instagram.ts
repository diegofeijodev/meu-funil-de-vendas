import { createFileRoute } from "@tanstack/react-router";

/**
 * pg_cron (a cada 5 min):
 * - task=queue: conclui mídias assíncronas pendentes + fila de publicação.
 * - task=media: piloto automático (gera mídia, agenda, regra das 2h).
 * - task=metrics: coleta de métricas 1h/24h/7d.
 * - task=weekly (domingo 18h BRT) e task=optimize (segunda).
 * - task=account (diária): seguidores e métricas da conta.
 * - sem task: executa queue + media + metrics (compatibilidade).
 * Protegido pelo token "instagram" em cron_tokens (ou CRM_CRON_SECRET).
 */
export const Route = createFileRoute("/api/public/cron/instagram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isCronAuthorized, heartbeat } = await import("@/lib/cron-auth.server");
        const ok = await isCronAuthorized(request, ["instagram"]);
        if (!ok) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json().catch(() => ({}))) as { task?: string };
        const task = body.task;
        await heartbeat(`instagram-${task ?? "all"}`);
        const ap = await import("@/lib/instagram/autopilot.server");
        if (task === "weekly") return Response.json({ weekly: await ap.runWeeklyAutopilot() });
        if (task === "optimize") return Response.json({ optimize: await ap.runOptimizer() });
        if (task === "account") {
          const ig = await import("@/lib/instagram/instagram.server");
          return Response.json({ account: await ig.collectAllAccountInsights() });
        }

        const ig = await import("@/lib/instagram/instagram.server");
        const out: Record<string, unknown> = {};
        const all = !task;
        if (all || task === "queue") {
          out["pendingMedia"] = await ig.pollPendingMedia().catch((e) => ({ error: String(e) }));
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { pollPendingCreatives } = await import("@/lib/creative.server");
          out["pendingCreatives"] = await pollPendingCreatives(supabaseAdmin as never).catch(
            (e) => ({
              error: String(e),
            }),
          );
          out["queue"] = await ig.runPublishingQueue();
        }
        if (all || task === "media") {
          const { revalidateBackfill } = await import("@/lib/media/library.server");
          out["revalidate"] = await revalidateBackfill(20).catch((e) => ({ error: String(e) }));
          out["autopilot"] = await ap.autopilotTick().catch((e) => ({ error: String(e) }));
        }
        if (all || task === "metrics") {
          out["metrics"] = await ig.collectDueMetrics();
          out["learning"] = await ig.learnFromTopPosts().catch((e) => ({ error: String(e) }));
        }
        return Response.json(out);
      },
    },
  },
});
