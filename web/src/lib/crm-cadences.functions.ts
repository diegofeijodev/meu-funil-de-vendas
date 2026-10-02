import { serverFnPost } from "@/lib/server-fn";

/** `POST /v1/crm-cadences/enroll-leads` (Task 8) — até 500 leads por chamada. */
export const enrollLeads = serverFnPost<{ workspaceId: string; cadenceId: string; leadIds: string[] }, { enrolled: number }>(
  "/v1/crm-cadences/enroll-leads",
);

import type { CadenceStep, ExitRules } from "@/lib/crm/cadence-types";

/** `POST /v1/crm-cadences/save-cadence` — owner|admin. */
export const saveCadence = serverFnPost<
  {
    workspaceId: string; id?: string | null; name: string; description?: string; triggerType: "source" | "campaign" | "stage" | "tag" | "manual";
    triggerValue?: string | null; isActive: boolean; steps: CadenceStep[]; exitRules: ExitRules; templateKey?: string | null;
  },
  { id: string }
>("/v1/crm-cadences/save-cadence");

export const deleteCadence = serverFnPost<{ workspaceId: string; id: string }, { ok: true }>("/v1/crm-cadences/delete-cadence");

export const installCadenceTemplates = serverFnPost<{ workspaceId: string }, { created: number }>("/v1/crm-cadences/install-cadence-templates");

export const stopLeadCadences = serverFnPost<{ workspaceId: string; leadId: string }, { stopped: number }>("/v1/crm-cadences/stop-lead-cadences");

/** Executa os passos vencidos DESTA empresa (o protótipo executava os de todas). */
export const runCadencesNow = serverFnPost<{ workspaceId: string }, { executed: number; skipped: number; slaTasks: number }>("/v1/crm-cadences/run-cadences-now");
