import { createFileRoute } from "@tanstack/react-router";
import type { InboundMessage as Inbound } from "@/lib/crm/whatsapp.server";

/**
 * WhatsApp webhook for every provider.
 * GET  -> Cloud API subscription verification.
 * POST -> inbound messages and delivery/read receipts (Cloud API, Z-API, Evolution).
 */
export const Route = createFileRoute("/api/public/webhooks/whatsapp/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { integrationByToken } = await import("@/lib/crm/integrations.server");
        const url = new URL(request.url);
        const integration = await integrationByToken(params.token, "whatsapp");
        if (
          !integration ||
          url.searchParams.get("hub.mode") !== "subscribe" ||
          url.searchParams.get("hub.verify_token") !== integration.verify_token
        ) {
          return new Response("Forbidden", { status: 403 });
        }
        return new Response(url.searchParams.get("hub.challenge") ?? "", {
          headers: { "Content-Type": "text/plain" },
        });
      },

      POST: async ({ request, params }) => {
        const { integrationByToken, verifyMetaSignature, logEvent, touchIntegration } = await import(
          "@/lib/crm/integrations.server"
        );
        const { handleInbound, applyStatusUpdate } = await import("@/lib/crm/whatsapp.server");

        const raw = await request.text();
        const integration = await integrationByToken(params.token, "whatsapp");
        if (!integration) return new Response("Not found", { status: 404 });

        if (integration.provider === "whatsapp_cloud") {
          if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"))) {
            console.error("[whatsapp] assinatura inválida");
            return new Response("Invalid signature", { status: 401 });
          }
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const inbound: Inbound[] = [];
        const statuses: { id: string; status: string }[] = [];

        if (integration.provider === "whatsapp_cloud") {
          const entries = (payload["entry"] as { changes?: { value?: CloudValue }[] }[]) ?? [];
          for (const entry of entries) {
            for (const change of entry.changes ?? []) {
              const value = change.value ?? {};
              const contact = value.contacts?.[0];
              for (const m of value.messages ?? []) {
                inbound.push({
                  externalId: m.id ?? null,
                  from: m.from ?? "",
                  waId: contact?.wa_id ?? null,
                  profileName: contact?.profile?.name ?? null,
                  type: normalizeType(m.type),
                  body: m.text?.body ?? m.button?.text ?? m[m.type ?? ""]?.caption ?? null,
                  mediaUrl: null,
                  referral: m.referral
                    ? {
                        adId: m.referral.source_id ?? null,
                        campaignName: m.referral.headline ?? null,
                        sourceUrl: m.referral.source_url ?? null,
                      }
                    : null,
                });
              }
              for (const s of value.statuses ?? []) {
                if (s.id && s.status) statuses.push({ id: s.id, status: s.status });
              }
            }
          }
        } else {
          // Z-API / Evolution: single message payloads with provider-specific shapes.
          const data = (payload["data"] as Record<string, unknown>) ?? payload;
          const phone = String(
            data["phone"] ?? data["from"] ?? (data["key"] as Record<string, unknown> | undefined)?.["remoteJid"] ?? "",
          ).split("@")[0];
          const text =
            (data["text"] as { message?: string } | undefined)?.message ??
            (data["message"] as { conversation?: string } | undefined)?.conversation ??
            (typeof data["body"] === "string" ? (data["body"] as string) : null);
          const fromMe = Boolean(data["fromMe"] ?? (data["key"] as Record<string, unknown> | undefined)?.["fromMe"]);
          if (phone && !fromMe) {
            inbound.push({
              externalId: String(
                data["messageId"] ?? data["id"] ?? (data["key"] as Record<string, unknown> | undefined)?.["id"] ?? "",
              ) || null,
              from: phone,
              profileName: (data["senderName"] as string) ?? (data["pushName"] as string) ?? null,
              type: data["image"] ? "image" : data["audio"] ? "audio" : "text",
              body: text ?? null,
              mediaUrl:
                ((data["image"] as { imageUrl?: string } | undefined)?.imageUrl ??
                  (data["audio"] as { audioUrl?: string } | undefined)?.audioUrl) ||
                null,
              referral: null,
            });
          }
        }

        for (const msg of inbound) {
          const fresh = await logEvent({
            workspaceId: integration.workspace_id,
            source: "whatsapp_message",
            externalId: msg.externalId,
            payload: msg as unknown,
          });
          if (!fresh) continue;
          try {
            await handleInbound(integration, msg);
            await touchIntegration(integration.id, { status: "connected", last_error: null });
          } catch (err) {
            const detail = err instanceof Error ? err.message : "erro desconhecido";
            console.error("[whatsapp] falha ao processar mensagem:", detail);
            await touchIntegration(integration.id, { status: "error", last_error: detail });
          }
        }

        for (const s of statuses) {
          await applyStatusUpdate(integration.workspace_id, s.id, s.status);
        }

        return new Response("ok");
      },
    },
  },
});

type CloudValue = {
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: (Record<string, { caption?: string } | undefined> & {
    id?: string;
    from?: string;
    type?: string;
    text?: { body?: string };
    button?: { text?: string };
    referral?: { source_id?: string; headline?: string; source_url?: string };
  })[];
  statuses?: { id?: string; status?: string }[];
};

function normalizeType(type: string | undefined) {
  const allowed = ["text", "image", "audio", "video", "document", "sticker"] as const;
  return (allowed as readonly string[]).includes(type ?? "")
    ? (type as (typeof allowed)[number])
    : ("other" as const);
}
