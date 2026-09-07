import { supabase } from "@/integrations/supabase/client";

export type McpProvider = "higgsfield" | "meta";

export type McpConnectionView = {
  id: string;
  provider: McpProvider;
  label: string | null;
  server_url: string;
  status: string;
  tools: { name: string; description?: string }[];
  last_error: string | null;
  connected_at: string | null;
  expires_at: string | null;
  hasToken: boolean;
};

/** Lê as conexões MCP do workspace sem nunca expor o token ao navegador. */
export async function fetchMcpConnections(workspaceId: string): Promise<McpConnectionView[]> {
  const { data, error } = await supabase
    .from("mcp_connections")
    .select("id, provider, label, server_url, status, tools, last_error, connected_at, expires_at")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id,
    provider: c.provider as McpProvider,
    label: c.label,
    server_url: c.server_url,
    status: c.status,
    tools: (c.tools ?? []) as { name: string; description?: string }[],
    last_error: c.last_error,
    connected_at: c.connected_at,
    expires_at: c.expires_at,
    hasToken: c.status === "connected",
  }));
}

export async function isMcpConnected(workspaceId: string, provider: McpProvider) {
  const { data } = await supabase
    .from("mcp_connections")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  return data?.status === "connected";
}
