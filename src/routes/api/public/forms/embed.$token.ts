import { createFileRoute } from "@tanstack/react-router";

/** Script do formulário para colar no site: <script src=".../api/public/forms/embed/TOKEN"></script> */
export const Route = createFileRoute("/api/public/forms/embed/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { embedScript } = await import("@/lib/crm/site-form.server");
        const origin = new URL(request.url).origin;
        return new Response(embedScript(params.token, origin), {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
    },
  },
});
