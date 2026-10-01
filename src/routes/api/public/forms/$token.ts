import { createFileRoute } from "@tanstack/react-router";

/**
 * Formulário do site.
 * GET  -> página do formulário (usada no iframe ou como link direto)
 * POST -> recebe o lead (JSON ou formulário), também de ferramentas externas
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/public/forms/$token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async ({ params }) => {
        const { integrationByToken } = await import("@/lib/crm/integrations.server");
        const { formConfig, renderFormHtml } = await import("@/lib/crm/site-form.server");
        const integration = await integrationByToken(params.token, "site_form");
        if (!integration || integration.status === "disconnected") return new Response("Formulário não encontrado", { status: 404 });
        return new Response(renderFormHtml(params.token, formConfig(integration)), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      },

      POST: async ({ request, params }) => {
        const { integrationByToken, touchIntegration } = await import("@/lib/crm/integrations.server");
        const { formConfig, ingestSiteLead, FormError } = await import("@/lib/crm/site-form.server");
        const integration = await integrationByToken(params.token, "site_form");
        if (!integration || integration.status === "disconnected")
          return Response.json({ error: "Formulário não encontrado." }, { status: 404, headers: CORS });

        const type = request.headers.get("content-type") ?? "";
        let body: Record<string, unknown> = {};
        try {
          if (type.includes("application/json")) body = (await request.json()) as Record<string, unknown>;
          else body = Object.fromEntries((await request.formData()).entries()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "Dados inválidos." }, { status: 400, headers: CORS });
        }
        const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
        try {
          await ingestSiteLead(integration, body, ip);
          await touchIntegration(integration.id, { status: "connected", last_error: null });
          const cfg = formConfig(integration);
          // Envio de formulário HTML comum (sem JS): redireciona para a página de obrigado.
          if (!type.includes("application/json") && cfg.redirect_url) {
            return Response.redirect(cfg.redirect_url, 303);
          }
          return Response.json({ ok: true, redirect: cfg.redirect_url }, { headers: CORS });
        } catch (e) {
          if (e instanceof FormError) return Response.json({ error: e.message }, { status: e.status, headers: CORS });
          console.error("[site-form]", e);
          return Response.json({ error: "Não foi possível enviar agora." }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
