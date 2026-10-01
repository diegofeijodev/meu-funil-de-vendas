import { createFileRoute } from "@tanstack/react-router";
import type { IgInbound } from "@/lib/crm/instagram-dm.server";

/**
 * Webhook do Instagram (objeto "instagram" no app da Meta).
 * GET  -> verificação (hub.verify_token)
 * POST -> mensagens do Direct e comentários (assinatura x-hub-signature-256)
 */
export const Route = createFileRoute("/api/public/webhooks/instagram/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { integrationByToken } = await import("@/lib/crm/integrations.server");
        const url = new URL(request.url);
        const integration = await integrationByToken(params.token, "instagram");
        if (
          !integration ||
          url.searchParams.get("hub.mode") !== "subscribe" ||
          url.searchParams.get("hub.verify_token") !== integration.verify_token
        ) {
          return new Response("Forbidden", { status: 403 });
        }
        return new Response(url.searchParams.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain" } });
      },

      POST: async ({ request, params }) => {
        const { integrationByToken, verifyMetaSignatureFor, claimEvent, finishEvent, touchIntegration } =
          await import("@/lib/crm/integrations.server");
        const raw = await request.text();
        const integration = await integrationByToken(params.token, "instagram");
        if (!integration) return new Response("Not found", { status: 404 });
        const ok = await verifyMetaSignatureFor(raw, request.headers.get("x-hub-signature-256"), integration.workspace_id);
        if (!ok) return new Response("Invalid signature", { status: 401 });

        let payload: { entry?: IgEntry[] };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const events: { id: string; msg: IgInbound }[] = [];
        for (const entry of payload.entry ?? []) {
          const ownId = String(entry.id ?? "");
          for (const m of entry.messaging ?? []) {
            const sender = String(m.sender?.id ?? "");
            if (!m.message || m.message.is_echo || !sender || sender === ownId) continue;
            const att = m.message.attachments?.[0];
            events.push({
              id: String(m.message.mid ?? `${sender}:${m.timestamp}`),
              msg: {
                kind: "dm",
                igsid: sender,
                mid: String(m.message.mid ?? ""),
                text: m.message.text ?? null,
                attachmentUrl: att?.payload?.url ?? null,
                attachmentType: att?.type ?? null,
              },
            });
          }
          for (const ch of entry.changes ?? []) {
            if (ch.field !== "comments" || !ch.value?.id) continue;
            const from = ch.value.from;
            if (!from?.id || from.id === ownId) continue;
            events.push({
              id: `comment:${ch.value.id}`,
              msg: {
                kind: "comment",
                igsid: String(from.id),
                username: from.username ?? null,
                commentId: String(ch.value.id),
                text: String(ch.value.text ?? ""),
                mediaId: ch.value.media?.id ?? null,
              },
            });
          }
        }

        const { handleInstagramInbound } = await import("@/lib/crm/instagram-dm.server");
        let failed = false;
        for (const ev of events) {
          const eventId = await claimEvent({
            workspaceId: integration.workspace_id,
            source: "instagram",
            externalId: ev.id,
            payload: ev.msg,
          });
          if (!eventId) continue;
          try {
            await handleInstagramInbound(integration, ev.msg);
            await finishEvent(eventId, null);
            await touchIntegration(integration.id, { status: "connected", last_error: null });
          } catch (err) {
            const detail = err instanceof Error ? err.message : "erro desconhecido";
            console.error("[instagram-webhook]", detail);
            failed = true;
            await finishEvent(eventId, detail);
            await touchIntegration(integration.id, { status: "error", last_error: detail });
          }
        }
        return failed ? new Response("retry later", { status: 500 }) : new Response("ok");
      },
    },
  },
});

type IgEntry = {
  id?: string;
  messaging?: {
    sender?: { id?: string };
    timestamp?: number;
    message?: {
      mid?: string;
      text?: string;
      is_echo?: boolean;
      attachments?: { type?: string; payload?: { url?: string } }[];
    };
  }[];
  changes?: {
    field?: string;
    value?: { id?: string; text?: string; from?: { id?: string; username?: string }; media?: { id?: string } };
  }[];
};
