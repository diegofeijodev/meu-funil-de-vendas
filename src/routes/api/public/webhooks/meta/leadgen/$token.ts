import { createFileRoute } from "@tanstack/react-router";

/**
 * Meta Lead Ads webhook.
 * GET  -> subscription verification (hub.verify_token)
 * POST -> leadgen events (signature verified with the Meta App Secret)
 */
export const Route = createFileRoute("/api/public/webhooks/meta/leadgen/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { integrationByToken } = await import("@/lib/crm/integrations.server");
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge") ?? "";
        const integration = await integrationByToken(params.token, "meta_lead_ads");
        if (!integration || mode !== "subscribe" || token !== integration.verify_token) {
          return new Response("Forbidden", { status: 403 });
        }
        return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
      },

      POST: async ({ request, params }) => {
        const { integrationByToken, verifyMetaSignatureFor, claimEvent, finishEvent, touchIntegration } = await import(
          "@/lib/crm/integrations.server"
        );
        const raw = await request.text();
        const integration = await integrationByToken(params.token, "meta_lead_ads");
        if (!integration) return new Response("Not found", { status: 404 });
        if (!(await verifyMetaSignatureFor(raw, request.headers.get("x-hub-signature-256"), integration.workspace_id))) {
          console.error("[meta-leadgen] assinatura inválida");
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: { entry?: { changes?: { value?: Record<string, unknown> }[] }[] };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const { ingestLeadgen } = await import("@/lib/crm/meta.server");
        const { runWithMetaWorkspace } = await import("@/lib/meta/graph.server");
        let failed = false;
        for (const entry of payload.entry ?? []) {
          for (const change of entry.changes ?? []) {
            const leadgenId = String(change.value?.["leadgen_id"] ?? "");
            if (!leadgenId) continue;
            // Só marca como processado depois de criar o lead: se falhar, o reenvio da Meta reprocessa.
            const eventId = await claimEvent({
              workspaceId: integration.workspace_id,
              source: "meta_leadgen",
              externalId: leadgenId,
              payload: change.value,
            });
            if (!eventId) continue; // já processado
            try {
              await runWithMetaWorkspace(integration.workspace_id, () => ingestLeadgen(integration, leadgenId));
              await finishEvent(eventId, null);
              await touchIntegration(integration.id, { status: "connected", last_error: null });
            } catch (err) {
              const detail = err instanceof Error ? err.message : "erro desconhecido";
              console.error("[meta-leadgen] falha ao processar lead:", detail);
              failed = true;
              await finishEvent(eventId, detail);
              await touchIntegration(integration.id, { status: "error", last_error: detail });
            }
          }
        }
        // Erro 500 faz a Meta reenviar o evento mais tarde.
        if (failed) return new Response("retry later", { status: 500 });
        return new Response("ok");
      },
    },
  },
});
