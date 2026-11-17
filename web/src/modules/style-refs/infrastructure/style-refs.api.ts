import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

/** Estilo das artes (Fatias 5/6): referências viram notas de estilo em texto; a imagem nunca é publicada nem vai ao gerador. */
const refSchema = z.object({
  id: z.string(),
  source: z.enum(["upload", "pinterest"]),
  source_url: z.string().nullable(),
  title: z.string().nullable(),
  status: z.enum(["processing", "ready", "failed"]),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  image_url: z.string().nullable(),
  campaign_id: z.string().nullable(),
  from_source: z.boolean(),
  campaign_name: z.string().nullable().default(null),
  source_title: z.string().nullable().default(null),
  attempts: z.number().default(0),
  created_at: z.string(),
});
const listSchema = z.object({
  refs: z.array(refSchema),
  sources: z.array(z.object({ id: z.string(), url: z.string(), title: z.string().nullable(), last_synced_at: z.string().nullable(), last_error: z.string().nullable(), refs_count: z.number().default(0) })),
  limits: z.object({ campaign: z.number(), brand: z.number(), in_campaign: z.number(), in_brand: z.number().default(0), pinterest: z.boolean() }),
});
export type StyleRef = z.infer<typeof refSchema>;
export type StyleRefsList = z.infer<typeof listSchema>;

/** Registro por peça (P6): `creatives.style_refs` / `ig_posts.style_refs`. `null` = peça antiga ou prompt à mão. */
export const styleRefsRecordSchema = z.object({
  own: z.array(z.string()).default([]),
  library: z.array(z.string()).default([]),
  brand_id: z.string().nullable().default(null),
});

/** Seleção do Meu Funil (P11): 404 fora da chave; quem chama só consulta com `features.style_library`. */
const libraryViewSchema = z.object({
  segment: z.string().nullable(),
  segment_label: z.string().nullable(),
  segment_source: z.enum(["auto", "chosen", "none"]),
  brand_segment: z.string().nullable(),
  options: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  count: z.number().default(0),
  descriptions: z.array(z.string()).default([]),
  enabled: z.boolean(),
  own_ready: z.number().default(0),
  in_use: z.boolean(),
});
export type StyleLibraryView = z.infer<typeof libraryViewSchema>;

const base = (ws: string, brandId: string) => `/v1/workspaces/${ws}/brands/${brandId}/style-refs`;

export async function listStyleRefs(ws: string, brandId: string, campaignId: string | null): Promise<StyleRefsList> {
  const { data } = await api.get(base(ws, brandId), { params: campaignId ? { campaign_id: campaignId } : {} });
  return listSchema.parse(data);
}

export async function uploadStyleRef(ws: string, brandId: string, file: File, campaignId: string | null): Promise<void> {
  const form = new FormData();
  form.append("file", file, file.name);
  await api.post(`${base(ws, brandId)}/upload`, form, { params: campaignId ? { campaign_id: campaignId } : {} });
}

export async function addPinterestRef(ws: string, brandId: string, url: string, campaignId: string | null): Promise<{ kind: string; added: number }> {
  const { data } = await api.post(`${base(ws, brandId)}/pinterest`, { url, campaign_id: campaignId });
  return z.object({ kind: z.string(), added: z.number() }).passthrough().parse(data);
}

export async function removeStyleRef(ws: string, brandId: string, id: string): Promise<void> {
  await api.delete(`${base(ws, brandId)}/${id}`);
}

export async function removeStyleSource(ws: string, brandId: string, sourceId: string): Promise<void> {
  await api.delete(`${base(ws, brandId)}/sources/${sourceId}`);
}

export async function getStyleLibrary(ws: string, brandId: string): Promise<StyleLibraryView> {
  const { data } = await api.get(`${base(ws, brandId)}/library`);
  return libraryViewSchema.parse(data);
}
