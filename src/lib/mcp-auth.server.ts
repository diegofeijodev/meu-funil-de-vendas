/**
 * Resolução e renovação de credenciais MCP no servidor.
 * Nada aqui pode ser importado pelo navegador.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAccessToken, listTools, McpAuthRequiredError } from "@/lib/mcp.server";

export type McpConnectionRow = {
  id: string;
  provider: string;
  server_url: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  status: string;
  tools: unknown;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
  oauth_token_endpoint: string | null;
  oauth_resource: string | null;
};

/** Busca a conexão do workspace e renova o token quando estiver perto de expirar. */
export async function getLiveConnection(
  supabase: SupabaseClient<any, any, any>,
  workspaceId: string,
  provider: string,
): Promise<McpConnectionRow | null> {
  const { data } = await supabase
    .from("mcp_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data) return null;
  let conn = data as McpConnectionRow;

  const expiringSoon = conn.expires_at ? new Date(conn.expires_at).getTime() - Date.now() < 60_000 : false;
  if (expiringSoon && conn.refresh_token && conn.oauth_token_endpoint && conn.oauth_client_id) {
    try {
      const tokens = await refreshAccessToken({
        tokenEndpoint: conn.oauth_token_endpoint,
        refreshToken: conn.refresh_token,
        clientId: conn.oauth_client_id,
        clientSecret: conn.oauth_client_secret,
        resource: conn.oauth_resource,
      });
      await supabase
        .from("mcp_connections")
        .update({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken ?? conn.refresh_token,
          expires_at: tokens.expiresAt,
          status: "connected",
          last_error: null,
        })
        .eq("id", conn.id);
      conn = { ...conn, access_token: tokens.accessToken, expires_at: tokens.expiresAt, status: "connected" };
    } catch (e) {
      await supabase
        .from("mcp_connections")
        .update({ status: "expired", last_error: errMessage(e) })
        .eq("id", conn.id);
      conn = { ...conn, status: "expired" };
    }
  } else if (expiringSoon && !conn.refresh_token) {
    await supabase.from("mcp_connections").update({ status: "expired" }).eq("id", conn.id);
    conn = { ...conn, status: "expired" };
  }
  return conn;
}

/** Testa a conexão listando as ferramentas; devolve status pronto para gravar. */
export async function probeConnection(serverUrl: string, token: string | null) {
  try {
    const found = await listTools(serverUrl, token);
    const tools = found.map((t) => ({ name: t.name, description: t.description ?? null }));
    return { status: "connected", tools, error: null as string | null, needsAuth: false, resourceMetadata: null as string | null };
  } catch (e) {
    if (e instanceof McpAuthRequiredError) {
      return { status: "error", tools: [] as { name: string; description: string | null }[], error: e.message, needsAuth: true, resourceMetadata: e.resourceMetadataUrl };
    }
    return { status: "error", tools: [] as { name: string; description: string | null }[], error: errMessage(e), needsAuth: false, resourceMetadata: null };
  }
}

export function errMessage(e: unknown) {
  return e instanceof Error ? e.message : "Erro desconhecido na integração.";
}
