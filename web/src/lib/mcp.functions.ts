import { serverFnPost } from "@/lib/server-fn";
import type { McpProvider } from "@/lib/mcp-client";

type Tool = { name: string; description: string | null };

/** `POST /v1/mcp/mcp-connect` — salva/testa a conexão MCP do workspace e descobre as ferramentas (dono/admin). */
export const mcpConnect = serverFnPost<
  { workspaceId: string; provider: McpProvider; serverUrl: string; accessToken?: string | null; label?: string | null },
  { status: string; tools: Tool[]; error: string | null; needsAuth: boolean }
>("/v1/mcp/mcp-connect");

/** `POST /v1/mcp/mcp-o-auth-start` — inicia o login OAuth (PKCE) no servidor MCP e devolve a URL de autorização. */
export const mcpOAuthStart = serverFnPost<{ workspaceId: string; provider: McpProvider; serverUrl: string; label?: string | null }, { authUrl: string }>(
  "/v1/mcp/mcp-o-auth-start",
);

/** `POST /v1/mcp/mcp-disconnect` */
export const mcpDisconnect = serverFnPost<{ workspaceId: string; provider: McpProvider }, { ok: true }>("/v1/mcp/mcp-disconnect");

/** `POST /v1/mcp/mcp-run` — executa uma ferramenta MCP do provedor conectado (editores). */
export const mcpRun = serverFnPost<
  { workspaceId: string; provider: McpProvider; keywords?: string[]; toolName?: string | null; args?: Record<string, unknown> },
  { tool: string; text: string; mediaUrl: string | null; structured: string | null }
>("/v1/mcp/mcp-run");
