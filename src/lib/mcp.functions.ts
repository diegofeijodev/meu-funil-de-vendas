import { createServerFn } from "@tanstack/react-start";
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

/** Salva/testa a conexão MCP do workspace e descobre as ferramentas disponíveis. */
export const mcpConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectInput.parse(d))
  .handler(async ({ data, context }) => {
    const { listTools } = await import("./mcp.server");
    const token = data.accessToken?.trim() ? data.accessToken.trim() : null;

    let tools: { name: string; description?: string }[] = [];
    let status = "connected";
    let lastError: string | null = null;
    try {
      tools = await listTools(data.serverUrl, token);
    } catch (e) {
      status = "error";
      lastError = e instanceof Error ? e.message : "Falha ao conectar no servidor MCP.";
    }

    const { data: existing } = await context.supabase
      .from("mcp_connections")
      .select("id, access_token")
      .eq("workspace_id", data.workspaceId)
      .eq("provider", data.provider)
      .maybeSingle();

    const row = {
      workspace_id: data.workspaceId,
      provider: data.provider,
      label: data.label ?? null,
      server_url: data.serverUrl,
      access_token: token ?? existing?.access_token ?? null,
      status,
      tools,
      last_error: lastError,
      connected_at: status === "connected" ? new Date().toISOString() : null,
    };

    const query = existing
      ? context.supabase.from("mcp_connections").update(row).eq("id", existing.id)
      : context.supabase.from("mcp_connections").insert(row);
    const { error } = await query;
    if (error) throw new Error(error.message);

    return { status, tools, error: lastError };
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
    const { data: conn, error } = await context.supabase
      .from("mcp_connections")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .eq("provider", data.provider)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conn || conn.status !== "connected") {
      throw new Error("Nenhuma conexão MCP ativa para este provedor.");
    }

    const tools = (conn.tools ?? []) as { name: string; description?: string }[];
    const tool = data.toolName
      ? tools.find((t) => t.name === data.toolName) ?? { name: data.toolName }
      : pickTool(tools, data.keywords);
    if (!tool) throw new Error("O servidor MCP não expôs nenhuma ferramenta utilizável.");

    const result = await callTool(conn.server_url, conn.access_token, tool.name, data.args);
    return { tool: tool.name, ...result };
  });
