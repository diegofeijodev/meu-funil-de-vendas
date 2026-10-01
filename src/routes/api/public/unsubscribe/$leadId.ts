import { createFileRoute } from "@tanstack/react-router";

/** Link de descadastro dos e-mails do CRM (assinado por lead). */
export const Route = createFileRoute("/api/public/unsubscribe/$leadId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const token = new URL(request.url).searchParams.get("t") ?? "";
        const { verifyUnsubscribe } = await import("@/lib/crm/email.server");
        const page = (msg: string) =>
          new Response(
            `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Descadastro</title><body style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;text-align:center"><p style="font-size:17px">${msg}</p></body></html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        if (!(await verifyUnsubscribe(params.leadId, token))) return page("Link inválido ou expirado.");
        const { admin, addInteraction } = await import("@/lib/crm/integrations.server");
        const { stopCadences } = await import("@/lib/crm/cadence.server");
        const db = await admin();
        const { data: lead } = await db.from("crm_leads").select("id, workspace_id").eq("id", params.leadId).maybeSingle();
        if (!lead) return page("Pronto. Você não receberá mais nossos e-mails.");
        await db.from("crm_leads").update({ unsubscribed: true, ai_active: false }).eq("id", lead.id);
        await stopCadences(lead.id as string, "opt_out");
        await addInteraction({
          workspaceId: lead.workspace_id as string,
          leadId: lead.id as string,
          kind: "ai_action",
          authorType: "system",
          content: "Lead se descadastrou pelo link do e-mail. Envios automáticos bloqueados.",
        });
        return page("Pronto. Você não receberá mais nossos e-mails.");
      },
    },
  },
});
