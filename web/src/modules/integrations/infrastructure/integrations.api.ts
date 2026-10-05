import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

const job = z
  .object({
    id: z.string(),
    target: z.string(),
    status: z.string(),
    mode: z.string(),
    log: z.string().nullish(),
    created_at: z.string(),
  })
  .passthrough();

export type PublishingJob = z.infer<typeof job>;

/** `publishing_jobs` do workspace, mais novos primeiro (a tela mostra os 15 últimos). */
export async function fetchPublishingJobs(workspaceId: string, limit = 15): Promise<PublishingJob[]> {
  const { data } = await api.get(`/v1/workspaces/${workspaceId}/publishing-jobs`, { params: { limit } });
  return z.array(job).parse(data);
}

const workspace = z.object({ ai_inherit_from: z.string().nullish() }).passthrough();

/** `workspaces.ai_inherit_from` (empresa de onde esta herda as conexões de IA), ou `null`. */
export async function fetchAiInheritFrom(workspaceId: string): Promise<string | null> {
  const { data } = await api.get(`/v1/workspaces/${workspaceId}`);
  return workspace.parse(data).ai_inherit_from ?? null;
}
