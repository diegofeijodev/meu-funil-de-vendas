/**
 * Cliente MCP (Model Context Protocol) — Streamable HTTP / JSON-RPC.
 * Roda apenas no servidor: o token do workspace nunca chega ao navegador.
 */

export type McpTool = { name: string; description?: string | undefined; inputSchema?: unknown };

type JsonRpcResponse = { result?: any; error?: { code: number; message: string } };

function assertUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Endereço do servidor MCP inválido.");
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new Error("Use um endereço https:// para o servidor MCP.");
  }
  return parsed.toString();
}

async function rpc(url: string, token: string | null, method: string, params?: unknown, sessionId?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(url, {
    method: "POST",
    headers,
    redirect: "error",
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? {} }),
  });

  const newSession = res.headers.get("Mcp-Session-Id") ?? sessionId;
  const text = await res.text();
  if (!res.ok) throw new Error(`Servidor MCP respondeu ${res.status}: ${text.slice(0, 200)}`);
  if (!text.trim()) return { payload: {} as JsonRpcResponse, sessionId: newSession };

  let payload: JsonRpcResponse;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const dataLine = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .pop();
    payload = dataLine ? JSON.parse(dataLine) : {};
  } else {
    payload = JSON.parse(text);
  }
  if (payload.error) throw new Error(payload.error.message);
  return { payload, sessionId: newSession };
}

async function notify(url: string, token: string | null, method: string, sessionId?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  await fetch(url, {
    method: "POST",
    headers,
    redirect: "error",
    body: JSON.stringify({ jsonrpc: "2.0", method }),
  }).catch(() => undefined);
}

export async function openSession(rawUrl: string, token: string | null) {
  const url = assertUrl(rawUrl);
  const init = await rpc(url, token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "ai-marketing-os", version: "1.0.0" },
  });
  await notify(url, token, "notifications/initialized", init.sessionId ?? undefined);
  return { url, token, sessionId: init.sessionId ?? undefined };
}

export async function listTools(rawUrl: string, token: string | null): Promise<McpTool[]> {
  const s = await openSession(rawUrl, token);
  const res = await rpc(s.url, token, "tools/list", {}, s.sessionId);
  const tools = (res.payload.result?.tools ?? []) as McpTool[];
  return tools.map((t) => ({ name: t.name, description: t.description }));
}

export type McpCallResult = { text: string; mediaUrl: string | null; structured: string | null };

export async function callTool(
  rawUrl: string,
  token: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const s = await openSession(rawUrl, token);
  const res = await rpc(s.url, token, "tools/call", { name, arguments: args }, s.sessionId);
  const result = res.payload.result ?? {};
  if (result.isError) {
    const msg = (result.content ?? []).map((c: any) => c?.text).filter(Boolean).join(" ");
    throw new Error(msg || `A ferramenta ${name} retornou erro.`);
  }
  const content: any[] = result.content ?? [];
  const text = content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
  let mediaUrl: string | null = null;
  for (const c of content) {
    if (c?.type === "image" && typeof c.data === "string") {
      mediaUrl = c.data.startsWith("http") ? c.data : `data:${c.mimeType ?? "image/png"};base64,${c.data}`;
      break;
    }
    if (c?.type === "resource" && typeof c.resource?.uri === "string" && c.resource.uri.startsWith("http")) {
      mediaUrl = c.resource.uri;
      break;
    }
  }
  if (!mediaUrl) {
    const found = /https?:\/\/\S+\.(png|jpe?g|webp|gif|mp4|mov)/i.exec(text);
    if (found) mediaUrl = found[0];
  }
  return {
    text,
    mediaUrl,
    structured: result.structuredContent ? JSON.stringify(result.structuredContent) : null,
  };
}

/** Escolhe a ferramenta mais provável para uma intenção (geração de imagem, vídeo, publicação). */
export function pickTool(tools: McpTool[], keywords: string[]): McpTool | null {
  const lower = tools.map((t) => ({ t, hay: `${t.name} ${t.description ?? ""}`.toLowerCase() }));
  for (const kw of keywords) {
    const hit = lower.find((x) => x.hay.includes(kw));
    if (hit) return hit.t;
  }
  return tools[0] ?? null;
}
