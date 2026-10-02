import { serverFnPost } from "@/lib/server-fn";

/** `POST /v1/crm-cadences/enroll-leads` (Task 8) — até 500 leads por chamada. */
export const enrollLeads = serverFnPost<{ workspaceId: string; cadenceId: string; leadIds: string[] }, { enrolled: number }>(
  "/v1/crm-cadences/enroll-leads",
);
