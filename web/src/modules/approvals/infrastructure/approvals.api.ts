import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

const approvalRequest = z
  .object({
    id: z.string(),
    workspace_id: z.string(),
    entity_type: z.string(),
    entity_id: z.string().nullish(),
    campaign_id: z.string().nullish(),
    title: z.string(),
    summary: z.string().nullish(),
    status: z.string(),
    decided_at: z.string().nullish(),
    created_at: z.string(),
    // `campaigns(name)` do PostgREST: objeto (ou null) com o nome da campanha.
    campaigns: z.object({ name: z.string() }).passthrough().nullish(),
  })
  .passthrough();
export type ApprovalRequest = z.infer<typeof approvalRequest>;

const activityLog = z
  .object({ id: z.string(), action: z.string(), metadata: z.unknown(), created_at: z.string() })
  .passthrough();
export type ActivityLog = z.infer<typeof activityLog>;

/** `approval_requests select *, campaigns(name)` eq workspace_id order created_at desc. */
export async function listApprovals(ws: string): Promise<ApprovalRequest[]> {
  const { data } = await api.get(`/v1/workspaces/${ws}/approvals`);
  return z.array(approvalRequest).parse(data);
}

/** `activity_logs select *` eq workspace_id order created_at desc limit 30. */
export async function listActivityLogs(ws: string, limit = 30): Promise<ActivityLog[]> {
  const { data } = await api.get(`/v1/workspaces/${ws}/activity-logs`, { params: { limit } });
  return z.array(activityLog).parse(data);
}
