import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

const num = z.coerce.number();
const str = z.string().nullish();

const brandSchema = z
  .object({
    id: z.string(),
    workspace_id: z.string(),
    name: z.string(),
    description: str,
    website: str,
    segment: str,
    differentials: str,
    target_audience: str,
    competitors: str,
    tone_of_voice: str,
    preferred_words: z.array(z.string()).nullish(),
    banned_words: z.array(z.string()).nullish(),
    primary_color: str,
    secondary_color: str,
    typography: str,
    logo_url: str,
    region: str,
    past_campaigns: str,
    visual_style: z.record(z.string(), z.unknown()).nullish(),
    updated_at: z.string().nullish(),
  })
  .passthrough();
export type Brand = z.infer<typeof brandSchema>;

/** `campaigns(count)` / `products(count)` do PostgREST: `[{ count }]`. */
const brandWithCounts = brandSchema.extend({
  campaigns: z.array(z.object({ count: num })).optional(),
  products: z.array(z.object({ count: num })).optional(),
});
export type BrandWithCounts = z.infer<typeof brandWithCounts>;

const product = z
  .object({ id: z.string(), name: z.string(), description: str, price: num.nullish(), margin_percent: num.nullish() })
  .passthrough();
const persona = z
  .object({ id: z.string(), name: z.string(), age_range: str, location: str, interests: str, pains: str, desires: str, segment_type: str })
  .passthrough();
const asset = z.object({ id: z.string(), kind: z.string(), name: str, url: str, tag: str, storage_path: str }).passthrough();
const learning = z
  .object({ id: z.string(), category: z.string(), value: z.string(), metric: str, score: num.nullish() })
  .passthrough();

export type Product = z.infer<typeof product>;
export type Persona = z.infer<typeof persona>;
export type BrandAsset = z.infer<typeof asset>;
export type Learning = z.infer<typeof learning>;

const base = (ws: string) => `/v1/workspaces/${ws}/brands`;

// ---- marcas
export async function listBrands(ws: string): Promise<BrandWithCounts[]> {
  const { data } = await api.get(base(ws));
  return z.array(brandWithCounts).parse(data);
}
export async function createBrand(ws: string, body: { name: string; segment: string }): Promise<Brand> {
  const { data } = await api.post(base(ws), body);
  return brandSchema.parse(data);
}
export async function getBrand(ws: string, id: string): Promise<Brand> {
  const { data } = await api.get(`${base(ws)}/${id}`);
  return brandSchema.parse(data);
}
export async function updateBrand(ws: string, id: string, body: Record<string, unknown>): Promise<Brand> {
  const { data } = await api.patch(`${base(ws)}/${id}`, body);
  return brandSchema.parse(data);
}
export async function deleteBrand(ws: string, id: string): Promise<void> {
  await api.delete(`${base(ws)}/${id}`);
}

// ---- produtos
export async function listProducts(ws: string, brandId: string): Promise<Product[]> {
  const { data } = await api.get(`${base(ws)}/${brandId}/products`);
  return z.array(product).parse(data);
}
export async function addProduct(ws: string, brandId: string, body: { name: string; price: number; margin_percent: number }) {
  await api.post(`${base(ws)}/${brandId}/products`, body);
}
export async function saveProduct(ws: string, brandId: string, id: string, body: Record<string, unknown>) {
  await api.patch(`${base(ws)}/${brandId}/products/${id}`, body);
}
export async function removeProduct(ws: string, brandId: string, id: string) {
  await api.delete(`${base(ws)}/${brandId}/products/${id}`);
}

// ---- personas
export async function listPersonas(ws: string, brandId: string): Promise<Persona[]> {
  const { data } = await api.get(`${base(ws)}/${brandId}/personas`);
  return z.array(persona).parse(data);
}
export async function addPersona(ws: string, brandId: string, body: { name: string }) {
  await api.post(`${base(ws)}/${brandId}/personas`, body);
}
export async function savePersona(ws: string, brandId: string, id: string, body: Record<string, unknown>) {
  await api.patch(`${base(ws)}/${brandId}/personas/${id}`, body);
}
export async function removePersona(ws: string, brandId: string, id: string) {
  await api.delete(`${base(ws)}/${brandId}/personas/${id}`);
}

// ---- aprendizados
export async function listLearnings(ws: string, brandId: string): Promise<Learning[]> {
  const { data } = await api.get(`${base(ws)}/${brandId}/learnings`);
  return z.array(learning).parse(data);
}

// ---- arquivos da marca
export async function listAssets(ws: string, brandId: string): Promise<BrandAsset[]> {
  const { data } = await api.get(`${base(ws)}/${brandId}/assets`);
  return z.array(asset).parse(data);
}

const uploaded = z.object({ key: z.string(), url: z.string() });

/**
 * Envio de um arquivo da marca: o navegador manda o arquivo para `POST /v1/workspaces/:ws/files?kind=brands`
 * (era `storage.upload` direto no bucket) e registra o resultado em `brand_assets` (a API assina a URL de 5 anos
 * e, para o logo, também atualiza `brands.logo_url`). Devolve `false` se o upload falhar.
 */
export async function uploadBrandAsset(
  ws: string,
  brandId: string,
  file: File,
  kind: string,
  tag: string | null,
): Promise<boolean> {
  const form = new FormData();
  form.append("file", file, file.name);
  let key: string;
  try {
    const { data } = await api.post(`/v1/workspaces/${ws}/files`, form, { params: { kind: "brands" } });
    key = uploaded.parse(data).key;
  } catch {
    return false;
  }
  await api.post(`${base(ws)}/${brandId}/assets`, { kind, name: file.name, storage_path: key, ...(tag ? { tag } : {}) });
  return true;
}
export async function removeAsset(ws: string, brandId: string, id: string) {
  await api.delete(`${base(ws)}/${brandId}/assets/${id}`);
}
