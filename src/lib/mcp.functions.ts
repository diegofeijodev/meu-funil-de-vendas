import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const connectSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: z.enum(["higgsfield", "meta"]),
  label: z.string().max(120).optional(),
  url: z.string().min(1),
  token: z.string().max(4000).optional(),
});

/** Conecta (ou reconecta) um servidor MCP, descobrindo as ferramentas disponíveis. */
export const mcpConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => connectSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { McpSession, validateMcpUrl } = await import("./mcp.server");
    const url = validateMcpUrl(data.url);

    let tools: { name: string; title?: string | undefined; description?: string | undefined }[] = [];
    let status = "connected";
    let lastError: string | null = null;

    try {
      const session = new McpSession(url, data.token ?? null);
      await session.initialize();
      tools = (await session.listTools()).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
      }));
    } catch (error) {
      status = "error";
      lastError = error instanceof Error ? error.message : "Falha ao conectar.";
    }

    const row: Record<string, unknown> = {
      workspace_id: data.workspaceId,
      provider: data.provider,
      label: data.label ?? data.provider,
      url,
      status,
      tools,
      last_error: lastError,
      last_checked_at: new Date().toISOString(),
    };
    if (data.token) row["auth_token"] = data.token;

    const { error } = await context.supabase
      .from("mcp_connections")
      .upsert(row as never, { onConflict: "workspace_id,provider" });

    if (error) throw new Error(error.message);

    return { status, tools, error: lastError };
  });

export const mcpDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("mcp_connections").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const runSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: z.enum(["higgsfield", "meta"]),
  intent: z.enum(["generate_image", "generate_video", "create_campaign", "publish_post"]),
  input: z.record(z.unknown()),
  toolName: z.string().optional(),
});

const INTENT_KEYWORDS: Record<string, string[]> = {
  generate_image: ["image", "imagem", "picture", "generate"],
  generate_video: ["video", "vídeo", "clip", "generate"],
  create_campaign: ["campaign", "campanha", "create", "ad"],
  publish_post: ["post", "publish", "publicar", "media"],
};

/** Executa uma ferramenta do servidor MCP conectado para a intenção pedida. */
export const mcpRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => runSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { McpSession, pickTool } = await import("./mcp.server");

    const { data: conn, error } = await context.supabase
      .from("mcp_connections")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .eq("provider", data.provider)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!conn || conn.status !== "connected") {
      throw new Error(
        `Nenhum servidor MCP conectado para ${data.provider}. Conecte em Configurações.`,
      );
    }

    const session = new McpSession(conn.url, conn.auth_token);
    await session.initialize();
    const tools = await session.listTools();

    const tool = data.toolName
      ? (tools.find((t) => t.name === data.toolName) ?? null)
      : pickTool(tools, INTENT_KEYWORDS[data.intent] ?? []);

    if (!tool) {
      throw new Error(
        `O servidor MCP conectado não expõe uma ferramenta compatível com "${data.intent}".`,
      );
    }

    const result = await session.callTool(tool.name, data.input as Record<string, unknown>);
    if (result.isError) throw new Error(result.text || "A ferramenta MCP retornou um erro.");

    return { tool: tool.name, text: result.text, url: result.url, provider: data.provider };
  });
