/**
 * Cliente MCP (Streamable HTTP / JSON-RPC) mínimo, executado sempre no servidor.
 * Nunca expomos a credencial do servidor MCP ao navegador.
 */
export type McpTool = {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  inputSchema?: Record<string, unknown> | undefined;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: number | string;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
};

const PROTOCOL_VERSION = "2025-06-18";

function parseBody(text: string, contentType: string): JsonRpcResponse | null {
  if (contentType.includes("text/event-stream")) {
    const lines = text.split("\n").filter((l) => l.startsWith("data:"));
    for (const line of lines.reverse()) {
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) return parsed;
      } catch {
        /* ignora frames não-JSON */
      }
    }
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class McpSession {
  private sessionId: string | null = null;
  private id = 0;

  constructor(
    private url: string,
    private token?: string | null,
  ) {}

  private async rpc(method: string, params?: Record<string, unknown>, notify = false) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const body: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params) body["params"] = params;
    if (!notify) body["id"] = ++this.id;

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
    });

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (notify) return null;

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Servidor MCP respondeu ${res.status}: ${text.slice(0, 300) || res.statusText}`,
      );
    }
    const parsed = parseBody(text, res.headers.get("content-type") ?? "");
    if (!parsed) throw new Error("Resposta do servidor MCP não pôde ser lida.");
    if (parsed.error) throw new Error(parsed.error.message);
    return parsed.result;
  }

  async initialize() {
    await this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "ai-marketing-os", version: "1.0.0" },
    });
    await this.rpc("notifications/initialized", {}, true);
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.rpc("tools/list", {});
    const tools = (result?.tools ?? []) as McpTool[];
    return tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>) {
    const result = await this.rpc("tools/call", { name, arguments: args });
    const content = (result?.content ?? []) as Array<Record<string, any>>;
    const text = content
      .filter((c) => c["type"] === "text")
      .map((c) => String(c["text"] ?? ""))
      .join("\n");
    const media = content.find((c) => c["type"] === "image" || c["type"] === "resource");
    const url =
      media?.["url"] ??
      media?.["resource"]?.["uri"] ??
      (typeof result?.structuredContent?.url === "string" ? result.structuredContent.url : null) ??
      firstUrlIn(text);
    return {
      isError: Boolean(result?.isError),
      text,
      url: url as string | null,
      structuredContent: result?.structuredContent ?? null,
    };
  }
}

function firstUrlIn(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"')]+/);
  return match ? match[0] : null;
}

export function validateMcpUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Endereço inválido. Use a URL completa do servidor MCP.");
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new Error("Por segurança, apenas endereços https são aceitos.");
  }
  return parsed.toString();
}

/** Escolhe a ferramenta mais adequada a uma intenção, por palavras-chave. */
export function pickTool(tools: McpTool[], keywords: string[]): McpTool | null {
  const score = (t: McpTool) => {
    const hay = `${t.name} ${t.title ?? ""} ${t.description ?? ""}`.toLowerCase();
    return keywords.reduce((acc, k) => acc + (hay.includes(k) ? 1 : 0), 0);
  };
  const ranked = [...tools].map((t) => ({ t, s: score(t) })).sort((a, b) => b.s - a.s);
  const best = ranked[0];
  return best && best.s > 0 ? best.t : null;
}
