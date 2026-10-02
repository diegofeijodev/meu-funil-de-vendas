import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

export type McpProvider = "higgsfield" | "meta" | "canva";

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

const tool = z.object({ name: z.string(), description: z.string().nullish() });
const view = z.object({
  id: z.string(),
  provider: z.string(),
  label: z.string().nullable(),
  server_url: z.string(),
  status: z.string(),
  tools: z.array(tool).nullish(),
  last_error: z.string().nullable(),
  connected_at: z.string().nullable(),
  expires_at: z.string().nullable(),
});

/** Lê as conexões MCP do workspace sem nunca expor o token ao navegador (a API não devolve as colunas de token). */
export async function fetchMcpConnections(workspaceId: string): Promise<McpConnectionView[]> {
  const { data } = await api.get(`/v1/workspaces/${workspaceId}/mcp-connections`);
  return z.array(view).parse(data).map((c) => ({
    id: c.id,
    provider: c.provider as McpProvider,
    label: c.label,
    server_url: c.server_url,
    status: c.status,
    tools: (c.tools ?? []).map((t) => ({ name: t.name, description: t.description ?? undefined })),
    last_error: c.last_error,
    connected_at: c.connected_at,
    expires_at: c.expires_at,
    hasToken: c.status === "connected",
  }));
}

export async function isMcpConnected(workspaceId: string, provider: McpProvider) {
  return (await fetchMcpConnections(workspaceId)).some((c) => c.provider === provider && c.status === "connected");
}

/** Status de um provedor em todas as empresas do usuário (`select workspace_id, provider, status`). */
export async function fetchMcpStatusAllWorkspaces(provider: McpProvider): Promise<{ workspace_id: string; provider: string; status: string }[]> {
  const { data } = await api.get(`/v1/mcp/status/${provider}`);
  return z.array(z.object({ workspace_id: z.string(), provider: z.string(), status: z.string() })).parse(data);
}
