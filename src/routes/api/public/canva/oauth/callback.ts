import { createFileRoute } from "@tanstack/react-router";

/** Retorno do login do Canva (Connect API). Valida o state, troca o code e volta para Integrações. */
export const Route = createFileRoute("/api/public/canva/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const back = (status: string, msg?: string) => {
          const to = new URL("/integrations", url.origin);
          to.searchParams.set("canva", status);
          if (msg) to.searchParams.set("msg", msg.slice(0, 200));
          return new Response(null, { status: 302, headers: { Location: to.toString() } });
        };
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (url.searchParams.get("error")) return back("error", "O Canva recusou a autorização.");
        if (!code || !state) return back("error", "Retorno do Canva incompleto.");
        try {
          const { finishCanvaOAuth } = await import("@/lib/creative/canva.server");
          await finishCanvaOAuth(state, code);
          return back("ok");
        } catch (e) {
          console.error("[canva-oauth]", e);
          return back("error", e instanceof Error ? e.message : "Não foi possível concluir o login.");
        }
      },
    },
  },
});
