import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

const num = z.coerce.number();
const nullNum = num.nullish();

/** Linha de `media_assets` com os embeds que a tela usa (`brands(name)`, `campaigns(name)`). */
export const mediaAsset = z
  .object({
    id: z.string(),
    title: z.string(),
    kind: z.enum(["image", "video"]),
    source: z.string(),
    url: z.string().nullable(),
    thumbnail_url: z.string().nullable(),
    mime: z.string().nullable(),
    width: nullNum.transform((v) => v ?? null),
    height: nullNum.transform((v) => v ?? null),
    duration_seconds: nullNum.transform((v) => v ?? null),
    size_bytes: nullNum.transform((v) => v ?? null),
    target_format: z.string(),
    ig_ready: z.boolean(),
    quality_report: z
      .object({ issues: z.array(z.string()).optional(), checks: z.record(z.string(), z.unknown()).optional(), backfill: z.boolean().optional() })
      .passthrough()
      .nullable(),
    tags: z.array(z.string()),
    folder: z.string().nullable(),
    status: z.enum(["draft", "approved", "rejected", "archived"]),
    prompt: z.string().nullable(),
    provider: z.string().nullable(),
    cost: nullNum.transform((v) => v ?? null),
    brand_id: z.string().nullable(),
    campaign_id: z.string().nullable(),
    parent_id: z.string().nullable(),
    created_at: z.string(),
    brands: z.object({ name: z.string() }).nullable(),
    campaigns: z.object({ name: z.string() }).nullable(),
    creative_id: z.string().nullable(),
    angle: z.string().nullish(),
  })
  .passthrough();
export type MediaAssetRow = z.infer<typeof mediaAsset>;

const base = (ws: string) => `/v1/workspaces/${ws}`;

export type MediaFilters = {
  q: string;
  brand: string;
  campaign: string;
  kind: string;
  format: string;
  status: string;
  tag: string;
  folder: string;
  source: string;
  period: string;
  sort: string;
};

/**
 * `media_assets select *, brands(name), campaigns(name)` com `count: exact` e os filtros/ordem/`range(0, pages*60-1)` da tela
 * (a busca, o `or(title,prompt)` e a sanitização acontecem na API).
 */
export async function listMedia(ws: string, f: Partial<MediaFilters>, limit: number): Promise<{ assets: MediaAssetRow[]; total: number }> {
  const params: Record<string, string | number> = { limit };
  if (f.q?.trim()) params["search"] = f.q.trim();
  if (f.brand) params["brand_id"] = f.brand;
  if (f.campaign) params["campaign_id"] = f.campaign;
  if (f.kind) params["kind"] = f.kind;
  if (f.format) params["target_format"] = f.format;
  if (f.status) params["status"] = f.status;
  if (f.tag) params["tag"] = f.tag;
  if (f.folder) params["folder"] = f.folder;
  if (f.source) params["source"] = f.source;
  if (f.period) params["period"] = Number(f.period);
  if (f.sort) params["sort"] = f.sort;
  const { data } = await api.get(`${base(ws)}/media-assets`, { params });
  const parsed = z.object({ rows: z.array(mediaAsset), count: z.number() }).parse(data);
  return { assets: parsed.rows, total: parsed.count };
}

/** `select tags, folder` limit 5000 (a tela tira as tags e pastas únicas). */
export async function listMediaFacets(ws: string): Promise<{ tags: string[] | null; folder: string | null }[]> {
  const { data } = await api.get(`${base(ws)}/media-assets/facets`);
  return z.array(z.object({ tags: z.array(z.string()).nullable(), folder: z.string().nullable() })).parse(data);
}

/** `update({status|folder}).in('id', picked)`. */
export async function bulkUpdateMedia(ws: string, ids: string[], patch: { status?: string; folder?: string | null }): Promise<void> {
  await api.patch(`${base(ws)}/media-assets/bulk`, { ids, ...patch });
}

/** `update({tags}).eq('id', id)`. */
export async function setMediaTags(ws: string, id: string, tags: string[]): Promise<void> {
  await api.patch(`${base(ws)}/media-assets/${id}`, { tags });
}

const copyRow = z
  .object({
    id: z.string(),
    version: z.number(),
    status: z.string(),
    angle: z.string().nullable(),
    created_at: z.string(),
    content: z.unknown(),
    campaigns: z.object({ name: z.string(), brand_id: z.string().nullable() }).nullable(),
  })
  .passthrough();
export type CopyRow = z.infer<typeof copyRow>;

/** Aba "Textos": `copies select id,version,status,angle,created_at,content,campaigns(name,brand_id)` order created_at desc limit 300. */
export async function listCopies(ws: string): Promise<CopyRow[]> {
  const { data } = await api.get(`${base(ws)}/copies`);
  return z.array(copyRow).parse(data);
}
