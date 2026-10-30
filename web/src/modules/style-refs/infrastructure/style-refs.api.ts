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
  created_at: z.string(),
});
const listSchema = z.object({
  refs: z.array(refSchema),
  sources: z.array(z.object({ id: z.string(), url: z.string(), title: z.string().nullable(), last_synced_at: z.string().nullable(), last_error: z.string().nullable() })),
  limits: z.object({ campaign: z.number(), brand: z.number(), in_campaign: z.number(), pinterest: z.boolean() }),
});
export type StyleRef = z.infer<typeof refSchema>;
export type StyleRefsList = z.infer<typeof listSchema>;

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
