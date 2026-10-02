import { serverFnPost } from "@/lib/server-fn";

export type AgencyWorkspaceRow = {
  id: string;
  name: string;
  role: string;
  inheritFrom: string | null;
  spend: number;
  adLeads: number;
  cpl: number | null;
  roas: number | null;
  activeCampaigns: number;
  crmLeads7d: number;
  postsWeek: number;
  pending: number;
};

/** `POST /v1/agency/set-ai-inheritance` — exige dono/admin da empresa E da origem. */
export const setAiInheritance = serverFnPost<{ workspaceId: string; sourceId: string | null }, { ok: true }>("/v1/agency/set-ai-inheritance");

/** `POST /v1/agency/apply-ai-inheritance-to-all` */
export const applyAiInheritanceToAll = serverFnPost<{ sourceId: string }, { updated: number }>("/v1/agency/apply-ai-inheritance-to-all");

/** `POST /v1/agency/overview` (sem entrada). */
export const agencyOverview = serverFnPost<void, { workspaces: AgencyWorkspaceRow[] }>("/v1/agency/overview");
