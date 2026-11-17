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
  origin: z.enum(["own", "selection"]).default("own"),
  created_at: z.string(),
});
const listSchema = z.object({
  refs: z.array(refSchema),
  sources: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      title: z.string().nullable(),
      last_synced_at: z.string().nullable(),
      last_error: z.string().nullable(),
      refs_count: z.number().default(0),
      origin: z.enum(["own", "selection"]).default("own"),
    }),
  ),
  limits: z.object({
    campaign: z.number(),
    brand: z.number(),
    in_campaign: z.number(),
    // `in_brand` conta só as próprias (P25); `in_selection` = referências da Seleção na marca.
    in_brand: z.number().default(0),
    in_selection: z.number().default(0),
    pinterest: z.boolean(),
  }),
});
export type StyleRef = z.infer<typeof refSchema>;
export type StyleRefsList = z.infer<typeof listSchema>;

/** Registro por peça (P6): `creatives.style_refs` / `ig_posts.style_refs`. `null` = peça antiga ou prompt à mão. */
export const styleRefsRecordSchema = z.object({
  own: z.array(z.string()).default([]),
  library: z.array(z.string()).default([]),
  brand_id: z.string().nullable().default(null),
});

/** Seleção do Meu Funil (P34): 404 com a Seleção desligada; quem chama só consulta com `features.style_library`. Defaults deixam o web novo conviver com a API antiga. */
const selectionViewSchema = z.object({
  segment: z.string().nullable().default(null),
  segment_label: z.string().nullable().default(null),
  segment_source: z.enum(["auto", "chosen", "none"]).default("auto"),
  brand_segment: z.string().nullable().default(null),
  options: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  enabled: z.boolean().default(true),
  needs_ai_key: z.boolean().default(false),
  ai_credit: z.enum(["no_credit", "daily_limit"]).nullable().default(null),
  daily_left: z.number().default(12),
  sources_count: z.number().default(0),
  count: z.number().default(0),
  reading: z.number().default(0),
  own_ready: z.number().default(0),
  in_use: z.boolean().default(false),
});
export type StyleSelectionView = z.infer<typeof selectionViewSchema>;

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

/** `promoted` (P36): a pasta ou o Pin colado já vinha da Seleção e virou da própria marca. Colar um Pin devolve também o item. */
const pinterestAddedSchema = z
  .object({
    kind: z.string(),
    added: z.number().default(0),
    promoted: z.boolean().default(false),
    item: refSchema.nullish().catch(null),
  })
  .passthrough();
export type PinterestAdded = z.infer<typeof pinterestAddedSchema>;

export async function addPinterestRef(ws: string, brandId: string, url: string, campaignId: string | null): Promise<PinterestAdded> {
  const { data } = await api.post(`${base(ws, brandId)}/pinterest`, { url, campaign_id: campaignId });
  return pinterestAddedSchema.parse(data);
}

export async function removeStyleRef(ws: string, brandId: string, id: string): Promise<void> {
  await api.delete(`${base(ws, brandId)}/${id}`);
}

export async function removeStyleSource(ws: string, brandId: string, sourceId: string): Promise<void> {
  await api.delete(`${base(ws, brandId)}/sources/${sourceId}`);
}

export async function getStyleLibrary(ws: string, brandId: string): Promise<StyleSelectionView> {
  const { data } = await api.get(`${base(ws, brandId)}/library`);
  return selectionViewSchema.parse(data);
}
