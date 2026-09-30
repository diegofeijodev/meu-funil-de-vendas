import { createFileRoute } from "@tanstack/react-router";

/** Callback OAuth dos servidores MCP (Higgsfield/Meta). Roda só no servidor. */
export const Route = createFileRoute("/api/public/mcp/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");

        if (oauthError) return page(false, "O provedor recusou a autorização.");
        if (!code || !state) return page(false, "Retorno de autenticação incompleto.");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { exchangeCode } = await import("@/lib/mcp.server");
        const { probeConnection, errMessage } = await import("@/lib/mcp-auth.server");

        const { data: conn } = await supabaseAdmin
          .from("mcp_connections")
          .select("*")
          .eq("oauth_state", state)
          .maybeSingle();
        if (!conn) return page(false, "Sessão de conexão não encontrada ou expirada.");

        try {
          const tokens = await exchangeCode({
            tokenEndpoint: conn.oauth_token_endpoint!,
            code,
            codeVerifier: conn.oauth_code_verifier!,
            clientId: conn.oauth_client_id!,
            clientSecret: conn.oauth_client_secret,
            redirectUri: (conn as any).oauth_redirect_uri ?? `${publicOrigin(request, url)}/api/public/mcp/callback`,
            resource: conn.oauth_resource,
          });

          const probe = await probeConnection(conn.server_url, tokens.accessToken);

          await supabaseAdmin
            .from("mcp_connections")
            .update({
              access_token: tokens.accessToken,
              refresh_token: tokens.refreshToken,
              expires_at: tokens.expiresAt,
              status: probe.status,
              tools: probe.tools,
              last_error: probe.error,
              connected_at: probe.status === "connected" ? new Date().toISOString() : null,
              oauth_state: null,
              oauth_code_verifier: null,
            })
            .eq("id", conn.id);

          return page(probe.status === "connected", probe.error ?? "Integração conectada com sucesso.");
        } catch (e) {
          console.error("[mcp-oauth] falha ao concluir autorização", e);
          await supabaseAdmin
            .from("mcp_connections")
            .update({ status: "error", last_error: errMessage(e), oauth_state: null })
            .eq("id", conn.id);
          return page(false, "Não foi possível concluir a conexão. Tente novamente.");
        }
      },
    },
  },
});

function page(ok: boolean, message: string) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${ok ? "Conectado" : "Falha na conexão"}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0d12;color:#e8eaf0;display:grid;place-items:center;height:100vh;margin:0}
.card{max-width:420px;text-align:center;padding:32px;border:1px solid #232838;border-radius:16px;background:#11141c}</style></head>
<body><div class="card"><h1>${ok ? "Integração conectada" : "Não foi possível conectar"}</h1>
<p>${message}</p><p>Você já pode fechar esta janela.</p></div>
<script>try{window.opener&&window.opener.postMessage({type:"mcp-oauth",ok:${ok}},"*");setTimeout(function(){window.close()},1200)}catch(e){}</script>
</body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function publicOrigin(req: Request, url: URL) {
  const host = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return host ? `${proto}://${host}` : url.origin;
}
