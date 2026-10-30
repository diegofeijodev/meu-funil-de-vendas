import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

/** Piloto do estrategista (contrato §29). A tela só mostra o que o servidor decide e conta. */
const base = (ws: string, campaignId: string) => `/v1/workspaces/${ws}/campaigns/${campaignId}/pilot`;

const slotSchema = z
  .object({
    slot: z.number(),
    kind: z.enum(["image", "video"]),
    angle: z.string(),
    status: z.string(),
    job_id: z.string().nullish(),
    creative_id: z.string().nullish(),
    score: z.number().nullish(),
    error: z.string().nullish(),
  })
  .passthrough();
export type PilotSlot = z.infer<typeof slotSchema>;

const stepSchema = z
  .object({
    status: z.string(),
    attempts: z.number().default(0),
    error_code: z.string().nullish(),
    error: z.string().nullish(),
    note: z.string().nullish(),
    ref: z.string().nullish(),
    started_at: z.string().nullish(),
    finished_at: z.string().nullish(),
    slots: z.array(slotSchema).optional(),
  })
  .passthrough();
export type PilotStepState = z.infer<typeof stepSchema>;

const igOptions = z.object({
  enabled: z.boolean(),
  mode: z.enum(["approval", "publish"]),
  weekdays: z.array(z.number()),
  times: z.array(z.string()),
  story_times: z.array(z.string()),
  formats: z.array(z.enum(["feed_image", "feed_carousel", "reel", "story_image", "story_video"])),
});
export const pilotOptionsSchema = z.object({
  max_angles: z.number(),
  images_per_angle: z.number(),
  variations: z.number(),
  videos: z.number(),
  instagram: igOptions,
  meta: z.object({ enabled: z.boolean(), review_creatives: z.boolean() }),
  max_credits: z.number(),
});
export type PilotOptions = z.infer<typeof pilotOptionsSchema>;

const summarySchema = z.object({
  status: z.string(),
  current_step: z.string().nullable(),
  first_block_code: z.string().nullable(),
  counts: z.object({ done: z.number(), total: z.number() }),
});
export const pilotSummarySchema = summarySchema;

export const pilotRunSchema = z
  .object({
    id: z.string(),
    status: z.enum(["planning", "running", "blocked", "done", "failed", "cancelled"]),
    current_step: z.string().nullable(),
    steps: z.record(z.string(), stepSchema).default({}),
    options: z.unknown(),
    strategy_version: z.number().nullable(),
    approved_at: z.string().nullable(),
    created_at: z.string(),
    estimated_credits: z.number().nullable(),
    max_credits: z.number().nullable(),
    spent_credits: z.number(),
    summary: summarySchema.nullable(),
    suggested_options: pilotOptionsSchema.nullable(),
  })
  .passthrough();
export type PilotRun = z.infer<typeof pilotRunSchema>;

const itemSchema = z.object({ label: z.string(), formula: z.string(), value: z.number(), source: z.string() });
export type EstimateItem = z.infer<typeof itemSchema>;
const estimateSchema = z.object({
  estimate: z.object({ items: z.array(itemSchema), total: z.number(), instagram: itemSchema.nullable() }),
  blockers: z.array(z.object({ code: z.string(), message: z.string(), action: z.string() })),
  can_approve: z.boolean(),
});
export type PilotEstimate = z.infer<typeof estimateSchema>;

export async function getPilot(ws: string, campaignId: string): Promise<PilotRun | null> {
  const { data } = await api.get(base(ws, campaignId));
  return z.object({ run: pilotRunSchema.nullable() }).parse(data).run;
}

export async function createPilot(ws: string, campaignId: string, idempotencyKey: string): Promise<PilotRun> {
  const { data } = await api.post(base(ws, campaignId), { idempotency_key: idempotencyKey });
  return pilotRunSchema.parse(data);
}

export async function estimatePilot(ws: string, campaignId: string, options: PilotOptions): Promise<PilotEstimate> {
  const { data } = await api.post(`${base(ws, campaignId)}/estimate`, { options });
  return estimateSchema.parse(data);
}

export async function approvePilot(ws: string, campaignId: string, runId: string, body: { strategy_version: number; options: PilotOptions }): Promise<PilotRun> {
  const { data } = await api.post(`${base(ws, campaignId)}/${runId}/approve`, body);
  return pilotRunSchema.parse(data);
}

export async function resumePilot(
  ws: string, campaignId: string, runId: string, body: { action: "retry" | "proceed_partial" | "raise_cap"; max_credits?: number },
): Promise<PilotRun> {
  const { data } = await api.post(`${base(ws, campaignId)}/${runId}/resume`, body);
  return pilotRunSchema.parse(data);
}

export async function cancelPilot(ws: string, campaignId: string, runId: string, cancelInstagram: boolean): Promise<PilotRun> {
  const { data } = await api.post(`${base(ws, campaignId)}/${runId}/cancel`, { cancel_instagram: cancelInstagram });
  return pilotRunSchema.parse(data);
}

/** Atualiza sozinho enquanto o servidor trabalha (plano montando ou execução andando); parado/bloqueado/pronto não fica perguntando. */
export function usePilot(ws: string | null | undefined, campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["pilot", ws, campaignId],
    enabled: !!ws && enabled,
    queryFn: () => getPilot(ws!, campaignId),
    refetchInterval: (q) => {
      const r = q.state.data as PilotRun | null | undefined;
      if (!r) return false;
      const planning = r.status === "planning" && r.steps.strategy?.status !== "done" && r.steps.strategy?.status !== "failed";
      return planning || r.status === "running" ? 15_000 : false;
    },
  });
}
