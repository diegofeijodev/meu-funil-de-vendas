import { supabase } from "@/integrations/supabase/client";

/** Retorna true quando existe um servidor MCP conectado para o provedor no workspace. */
export async function isMcpConnected(workspaceId: string, provider: "higgsfield" | "meta") {
  const { data } = await supabase
    .from("mcp_connections")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  return data?.status === "connected";
}
