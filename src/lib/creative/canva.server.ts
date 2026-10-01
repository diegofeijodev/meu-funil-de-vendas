/**
 * Canva pelo MCP oficial (somente servidor). A conta Canva da empresa é conectada por OAuth
 * em Integrações (igual ao Higgsfield). Fluxo: criativo do app → biblioteca do Canva →
 * edição no Canva → exportar → volta para a biblioteca do app.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLiveConnection } from "@/lib/mcp-auth.server";
import { callTool } from "@/lib/mcp.server";

type DB = SupabaseClient<any, any, any>;

export const CANVA_MCP_URL = "https://mcp.canva.com/mcp";

async function conn(db: DB, workspaceId: string) {
  const c = await getLiveConnection(db, workspaceId, "canva");
  if (!c || c.status !== "connected") throw new Error("Canva não está conectado nesta empresa. Conecte em Integrações.");
  return c;
}

async function call(db: DB, workspaceId: string, tool: string, args: Record<string, unknown>) {
  const c = await conn(db, workspaceId);
  return callTool(c.server_url, c.access_token, tool, { ...args, user_intent: "Meu Funil: levar criativos da agência para o Canva e de volta" });
}

const blob = (r: { text: string; structured: string | null }) => `${r.structured ?? ""}\n${r.text}`;

/** Envia uma mídia da biblioteca para os uploads do Canva. */
export async function sendAssetToCanva(db: DB, workspaceId: string, asset: { url: string; title: string }) {
  if (!/^https:\/\//.test(asset.url)) throw new Error("A mídia precisa de um link público HTTPS.");
  const r = await call(db, workspaceId, "upload-asset-from-url", { url: asset.url, name: asset.title.slice(0, 200) });
  const mediaId = /"(?:media_id|id)"\s*:\s*"([^"]+)"/.exec(blob(r))?.[1] ?? null;
  return { mediaId, message: r.text.slice(0, 300) };
}

/** Cria um design editável no Canva a partir da copy/briefing da campanha. */
export async function createCanvaDesign(db: DB, workspaceId: string, brief: string, format?: string | null) {
  const start = await call(db, workspaceId, "create-design", { brief: brief.slice(0, 4000), ...(format ? { format } : {}) });
  const b = blob(start);
  const jobId = /"job_id"\s*:\s*"([^"]+)"/.exec(b)?.[1];
  let token = /"continuation_token"\s*:\s*"([^"]+)"/.exec(b)?.[1];
  if (!jobId || !token) throw new Error("O Canva não confirmou a criação do design.");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const wait = Number(/"wait_seconds"\s*:\s*(\d+)/.exec(b)?.[1] ?? 5);
    await new Promise((r) => setTimeout(r, Math.min(15, Math.max(2, wait)) * 1000));
    const st = await call(db, workspaceId, "get-create-design-async-job", { job_id: jobId, continuation_token: token });
    const sb = blob(st);
    token = /"continuation_token"\s*:\s*"([^"]+)"/.exec(sb)?.[1] ?? token;
    const designId = /"(?:design_id|id)"\s*:\s*"(D[A-Za-z0-9_-]{10})"/.exec(sb)?.[1];
    const editUrl = /https:\/\/www\.canva\.com\/design\/[^\s"'\\]+/.exec(sb)?.[0] ?? null;
    if (designId || editUrl) return { designId: designId ?? null, editUrl };
    if (/"status"\s*:\s*"(failed|error)"/i.test(sb)) throw new Error("O Canva não conseguiu gerar o design.");
  }
  return { designId: null, editUrl: null, pending: true };
}

/** Designs recentes da conta Canva (para escolher qual trazer de volta). */
export async function listCanvaDesigns(db: DB, workspaceId: string, query?: string | null) {
  const r = await call(db, workspaceId, "search-designs", {
    limit: 20,
    ...(query ? { query, sort_by: "relevance" } : { sort_by: "modified_descending" }),
  });
  let parsed: any = null;
  try {
    parsed = JSON.parse(r.structured ?? r.text);
  } catch {
    parsed = null;
  }
  const items: any[] = parsed?.designs ?? parsed?.items ?? [];
  if (items.length)
    return items
      .map((d) => ({ id: String(d.design_id ?? d.id ?? ""), title: String(d.title ?? "Sem título"), thumbnail: d.thumbnail?.url ?? null, url: d.urls?.edit_url ?? d.url ?? null }))
      .filter((d) => /^D/.test(d.id));
  // Formato desconhecido: extrai os IDs do texto.
  return [...new Set([...blob(r).matchAll(/\b(D[A-Za-z0-9_-]{10})\b/g)].map((m) => m[1]!))].map((id) => ({ id, title: id, thumbnail: null, url: null }));
}

/** Exporta um design do Canva (PNG ou MP4) e salva na biblioteca do app. */
export async function importCanvaDesign(
  db: DB,
  workspaceId: string,
  input: { designId: string; title?: string | null; brandId?: string | null; campaignId?: string | null; createdBy?: string | null },
) {
  if (!/^D[A-Za-z0-9_-]{10}$/.test(input.designId)) throw new Error("ID de design do Canva inválido (começa com D e tem 11 caracteres).");
  const formats = blob(await call(db, workspaceId, "get-export-formats", { design_id: input.designId }));
  const video = /"mp4"/i.test(formats) && !/"png"/i.test(formats);
  const exp = await call(db, workspaceId, "export-design", {
    design_id: input.designId,
    format: video ? { type: "mp4", quality: "vertical_1080p" } : { type: "png", export_quality: "pro", pages: [1] },
  });
  const url = exp.mediaUrl ?? /https:\/\/[^\s"'\\]+/.exec(blob(exp))?.[0];
  if (!url) throw new Error("O Canva não devolveu o arquivo exportado.");
  const { ingestAsset } = await import("@/lib/media/assets.server");
  const asset = await ingestAsset({
    workspaceId,
    kind: video ? "video" : "image",
    targetFormat: "other",
    source: "canva",
    sourceUrl: url,
    title: input.title || `Canva ${input.designId}`,
    provider: "canva",
    brandId: input.brandId ?? null,
    campaignId: input.campaignId ?? null,
    createdBy: input.createdBy ?? null,
    normalize: false,
  });
  return asset;
}
