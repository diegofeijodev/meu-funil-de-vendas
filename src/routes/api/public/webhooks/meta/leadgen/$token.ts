import { createFileRoute } from "@tanstack/react-router";

/**
 * Meta Lead Ads webhook.
 * GET  -> subscription verification (hub.verify_token)
 * POST -> leadgen events (signature verified with META_APP_SECRET)
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
        const { integrationByToken, verifyMetaSignature, logEvent, touchIntegration } = await import(
          "@/lib/crm/integrations.server"
        );
        const raw = await request.text();
        const integration = await integrationByToken(params.token, "meta_lead_ads");
        if (!integration) return new Response("Not found", { status: 404 });
        if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"))) {
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
        for (const entry of payload.entry ?? []) {
          for (const change of entry.changes ?? []) {
            const leadgenId = String(change.value?.["leadgen_id"] ?? "");
            if (!leadgenId) continue;
            const fresh = await logEvent({
              workspaceId: integration.workspace_id,
              source: "meta_leadgen",
              externalId: leadgenId,
              payload: change.value,
            });
            if (!fresh) continue; // already processed
            try {
              await ingestLeadgen(integration, leadgenId);
              await touchIntegration(integration.id, { status: "connected", last_error: null });
            } catch (err) {
              const detail = err instanceof Error ? err.message : "erro desconhecido";
              console.error("[meta-leadgen] falha ao processar lead:", detail);
              await touchIntegration(integration.id, { status: "error", last_error: detail });
            }
          }
        }
        return new Response("ok");
      },
    },
  },
});
