import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";
import type { FullStrategy } from "@/lib/ai/strategy-types";
import type { CopyContent } from "@/lib/ai/agents";

const num = z.coerce.number();

/** `creatives select *, campaigns(name)` (só o que o Studio lê; o resto passa). */
const creativeRow = z
  .object({
    id: z.string(),
    title: z.string(),
    type: z.string(),
    status: z.string(),
    version: z.number().nullish(),
    preview_url: z.string().nullable(),
    real_cost: num.nullish(),
    angle: z.string().nullish(),
    extras: z.unknown().optional(),
    campaigns: z.object({ name: z.string() }).nullable(),
  })
  .passthrough();
export type CreativeRow = z.infer<typeof creativeRow>;

/** `creative_generation_jobs select *`. */
const jobRow = z
  .object({
    id: z.string(),
    prompt: z.string().nullable(),
    final_prompt: z.string().nullable(),
    provider: z.string(),
    status: z.string(),
    error_message: z.string().nullable(),
    provider_log: z.string().nullish(),
  })
  .passthrough();
export type JobRow = z.infer<typeof jobRow>;

const versioned = z.object({ content: z.unknown(), status: z.string(), version: z.number() });

const base = (ws: string) => `/v1/workspaces/${ws}`;

export async function listCreatives(ws: string): Promise<CreativeRow[]> {
  const { data } = await api.get(`${base(ws)}/creatives`);
  return z.array(creativeRow).parse(data);
}

/** `update({status}).eq(id)` (a API grava `creative.<status>` na atividade). */
export async function setCreativeStatus(ws: string, id: string, status: string): Promise<void> {
  await api.patch(`${base(ws)}/creatives/${id}`, { status });
}

/** `creative_generation_jobs` order created_at desc limit 12. */
export async function listJobs(ws: string, limit = 12): Promise<JobRow[]> {
  const { data } = await api.get(`${base(ws)}/creative-generation-jobs`, { params: { limit } });
  return z.array(jobRow).parse(data);
}

/**
 * Estratégia e copy da campanha para o Studio (`["studio-brief", campaignId]`): as 10 últimas versões de cada;
 * a tela fica com a aprovada, senão a primeira.
 */
export async function getCampaignBrief(ws: string, campaignId: string): Promise<{ strategy: FullStrategy | null; copy: CopyContent | null }> {
  const { data } = await api.get(`${base(ws)}/campaigns/${campaignId}/brief`);
  const parsed = z.object({ strategies: z.array(versioned), copies: z.array(versioned) }).parse(data);
  const pick = (rows: z.infer<typeof versioned>[]) => (rows.find((r) => r.status === "approved") ?? rows[0])?.content;
  return {
    strategy: (pick(parsed.strategies) as FullStrategy | undefined) ?? null,
    copy: (pick(parsed.copies) as CopyContent | undefined) ?? null,
  };
}
