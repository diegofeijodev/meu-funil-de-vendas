import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const providerSchema = z.enum(["higgsfield", "meta"]);

const connectInput = z.object({
  workspaceId: z.string().uuid(),
  provider: providerSchema,
  serverUrl: z.string().min(4),
  accessToken: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
});

function originFromRequest() {
  const req = getRequest();
  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return forwardedHost ? `${proto}://${forwardedHost}` : url.origin;
}

/** Salva/testa a conexão MCP do workspace e descobre as ferramentas disponíveis. */
export const mcpConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectInput.parse(d))
  .handler(async ({ data, context }) => {
    const { probeConnection } = await import("./mcp-auth.server");
    const token = data.accessToken?.trim() ? data.accessToken.trim() : null;

    const { data: existing } = await context.supabase
      .from("mcp_connections")
      .select("id, access_token")
      .eq("workspace_id", data.workspaceId)
      .eq("provider", data.provider)
      .maybeSingle();

    const effectiveToken = token ?? existing?.access_token ?? null;
    const probe = await probeConnection(data.serverUrl, effectiveToken);

    const row = {
      workspace_id: data.workspaceId,
      provider: data.provider,
      label: data.label ?? null,
      server_url: data.serverUrl,
      access_token: effectiveToken,
      status: probe.status,
      tools: probe.tools,
      last_error: probe.error,
      connected_at: probe.status === "connected" ? new Date().toISOString() : null,
    };

    const query = existing
      ? context.supabase.from("mcp_connections").update(row).eq("id", existing.id)
      : context.supabase.from("mcp_connections").insert(row);
    const { error } = await query;
    if (error) throw new Error(error.message);

    return {
      status: probe.status,
      tools: probe.tools,
      error: probe.error,
      needsAuth: probe.needsAuth,
    };
  });

/** Inicia o login OAuth (PKCE) no servidor MCP e devolve a URL de autorização. */
export const mcpOAuthStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        provider: providerSchema,
        serverUrl: z.string().min(4),
        label: z.string().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const {
      discoverAuthServer,
      registerClient,
      pkcePair,
      randomToken,
      buildAuthorizationUrl,
    } = await import("./mcp.server");

    const redirectUri = `${originFromRequest()}/api/public/mcp/callback`;
    const discovery = await discoverAuthServer(data.serverUrl);

    const { data: existing } = await context.supabase
      .from("mcp_connections")
      .select("id, oauth_client_id, oauth_client_secret")
      .eq("workspace_id", data.workspaceId)
      .eq("provider", data.provider)
      .maybeSingle();

    let clientId = existing?.oauth_client_id ?? null;
    let clientSecret = existing?.oauth_client_secret ?? null;
    if (!clientId) {
      if (!discovery.metadata.registration_endpoint) {
        throw new Error(
          "Este servidor MCP não aceita registro automático de aplicativo. Informe uma chave de acesso manualmente.",
        );
      }
      const reg = await registerClient(discovery.metadata.registration_endpoint, redirectUri);
      clientId = reg.clientId;
      clientSecret = reg.clientSecret;
    }

    const { verifier, challenge } = await pkcePair();
    const state = randomToken(24);

    const row = {
      workspace_id: data.workspaceId,
      provider: data.provider,
      label: data.label ?? null,
      server_url: data.serverUrl,
      status: "connecting",
      last_error: null,
      oauth_client_id: clientId,
      oauth_client_secret: clientSecret,
      oauth_state: state,
      oauth_code_verifier: verifier,
      oauth_authorization_endpoint: discovery.metadata.authorization_endpoint,
      oauth_token_endpoint: discovery.metadata.token_endpoint,
      oauth_scope: discovery.scope ?? null,
      oauth_resource: discovery.resource,
    };

    const query = existing
      ? context.supabase.from("mcp_connections").update(row).eq("id", existing.id)
      : context.supabase.from("mcp_connections").insert(row);
    const { error } = await query;
    if (error) throw new Error(error.message);

    return {
      authUrl: buildAuthorizationUrl({
        authorizationEndpoint: discovery.metadata.authorization_endpoint,
        clientId,
        redirectUri,
        state,
        challenge,
        scope: discovery.scope,
        resource: discovery.resource,
      }),
    };
  });

export const mcpDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: z.string().uuid(), provider: providerSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("mcp_connections")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("provider", data.provider);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Executa uma ferramenta MCP do provedor conectado ao workspace. */
export const mcpRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        provider: providerSchema,
        keywords: z.array(z.string()).default([]),
        toolName: z.string().optional().nullable(),
        args: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { callTool, pickTool } = await import("./mcp.server");
    const { getLiveConnection } = await import("./mcp-auth.server");

    const conn = await getLiveConnection(context.supabase, data.workspaceId, data.provider);
    if (!conn || conn.status !== "connected") {
      throw new Error("Nenhuma conexão MCP ativa para este provedor.");
    }

    const tools = (conn.tools ?? []) as { name: string; description?: string | undefined }[];
    const tool = data.toolName
      ? tools.find((t) => t.name === data.toolName) ?? { name: data.toolName }
      : pickTool(tools, data.keywords);
    if (!tool) throw new Error("O servidor MCP não expôs nenhuma ferramenta utilizável.");

    const result = await callTool(conn.server_url, conn.access_token, tool.name, data.args);
    return { tool: tool.name, ...result };
  });
