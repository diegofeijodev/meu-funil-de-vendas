import { createFileRoute } from "@tanstack/react-router";

/** Retorno do "Entrar com Facebook": salva o token da empresa e volta para Integrações. */
export const Route = createFileRoute("/api/public/meta/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const back = (q: string) => Response.redirect(`${url.origin}/integrations?${q}`, 302);
        const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");
        if (err) return back(`meta_erro=${encodeURIComponent(err)}`);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return back("meta_erro=retorno_incompleto");
        try {
          const { handleCallback } = await import("@/lib/meta/oauth.server");
          await handleCallback(code, state, url.origin);
          return back("meta=conectado");
        } catch (e) {
          return back(`meta_erro=${encodeURIComponent(e instanceof Error ? e.message : "falhou")}`);
        }
      },
    },
  },
});
