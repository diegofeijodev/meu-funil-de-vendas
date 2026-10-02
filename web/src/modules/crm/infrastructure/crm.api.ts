import axios from "axios";
import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";
import type { Lead, Stage } from "@/lib/crm";

const base = (ws: string) => `/v1/workspaces/${ws}/crm`;
const str = z.string().nullish();

const pipelineSchema = z.object({ id: z.string(), name: z.string(), is_default: z.boolean() });
const stageSchema = z
  .object({
    id: z.string(), name: z.string(), color: z.string(), position: z.coerce.number(), sla_hours: z.coerce.number(),
    is_won: z.boolean(), is_lost: z.boolean(), pipeline_id: z.string(),
  })
  .passthrough();
const leadSchema = z
  .object({
    id: z.string(), workspace_id: z.string(), name: z.string(), source: z.string(), score: z.coerce.number(),
    estimated_value: z.coerce.number(), tags: z.array(z.string()).default([]), created_at: z.string(), stage_entered_at: z.string(),
    stage_id: str, owner_id: str, phone: str, email: str, ai_active: z.boolean(), unsubscribed: z.boolean(),
  })
  .passthrough();
const interactionSchema = z.object({ id: z.string(), kind: z.string(), author_type: z.string(), content: str, created_at: z.string() }).passthrough();
const taskSchema = z.object({ id: z.string(), title: z.string(), due_at: str, status: z.string(), lead_id: str }).passthrough();
const taskRowSchema = taskSchema.extend({ crm_leads: z.object({ name: z.string() }).nullish() });
const memberRaw = z.object({
  user_id: z.string(), role: z.string(),
  profiles: z.object({ id: z.string(), full_name: str, email: str }).nullish(),
});
const historySchema = z.object({ lead_id: z.string(), from_stage_id: str, to_stage_id: str, created_at: z.string() });
const interactionLiteSchema = z.object({ lead_id: z.string(), kind: z.string(), author_type: z.string(), created_at: z.string() });
const settingsSchema = z.object({ distribution: z.string(), default_owner_id: str }).passthrough().nullable();
const named = z.object({ id: z.string(), name: z.string() });
const tagSchema = named.extend({ color: z.string() });

export type Pipeline = z.infer<typeof pipelineSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
export type CrmTask = z.infer<typeof taskSchema>;
export type CrmTaskRow = z.infer<typeof taskRowSchema>;
export type CrmMember = { user_id: string; role: string; label: string };

// ---- funis, etapas, usuários
export async function listPipelines(ws: string): Promise<Pipeline[]> {
  const { data } = await api.get(`${base(ws)}/pipelines`);
  return z.array(pipelineSchema).parse(data);
}
export async function listStages(ws: string, pipelineId: string): Promise<Stage[]> {
  const { data } = await api.get(`${base(ws)}/stages`, { params: { pipeline_id: pipelineId } });
  return z.array(stageSchema).parse(data) as unknown as Stage[];
}
export async function createStage(ws: string, body: { pipeline_id: string; name: string; position: number }) {
  await api.post(`${base(ws)}/stages`, body);
}
export async function updateStage(ws: string, id: string, body: { name?: string; color?: string; sla_hours?: number; position?: number }) {
  await api.patch(`${base(ws)}/stages/${id}`, body);
}
export async function deleteStage(ws: string, id: string) {
  await api.delete(`${base(ws)}/stages/${id}`);
}
/** `[]` em erro, como o `useMembers` do protótipo. */
export async function listMembers(ws: string): Promise<CrmMember[]> {
  try {
    const { data } = await api.get(`${base(ws)}/members`);
    return z.array(memberRaw).parse(data).map((m) => ({
      user_id: m.user_id, role: m.role, label: m.profiles?.full_name || m.profiles?.email || "Usuário",
    }));
  } catch {
    return [];
  }
}

// ---- leads
export async function listLeads(ws: string, pipelineId: string | null): Promise<Lead[]> {
  const { data } = await api.get(`${base(ws)}/leads`, { params: pipelineId ? { pipeline_id: pipelineId } : {} });
  return z.array(leadSchema).parse(data) as unknown as Lead[];
}
/** `null` quando o lead não existe (o protótipo usava `maybeSingle`). */
export async function getLead(ws: string, id: string): Promise<Lead | null> {
  try {
    const { data } = await api.get(`${base(ws)}/leads/${id}`);
    return leadSchema.parse(data) as unknown as Lead;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) return null;
    throw e;
  }
}
export async function listLeadInteractions(ws: string, id: string): Promise<Interaction[]> {
  const { data } = await api.get(`${base(ws)}/leads/${id}/interactions`);
  return z.array(interactionSchema).parse(data);
}
export async function listLeadTasks(ws: string, id: string): Promise<CrmTask[]> {
  const { data } = await api.get(`${base(ws)}/leads/${id}/tasks`);
  return z.array(taskSchema).parse(data);
}
export async function createLead(ws: string, body: Record<string, unknown>) {
  await api.post(`${base(ws)}/leads`, body);
}
export async function importLeads(ws: string, body: { pipeline_id: string | null; stage_id: string | null; rows: Record<string, string | null>[] }) {
  const { data } = await api.post(`${base(ws)}/leads/import`, body);
  return z.object({ imported: z.number() }).parse(data);
}
export async function bulkLeads(ws: string, body: { ids: string[]; stage_id?: string; owner_id?: string | null; add_tag?: string }) {
  await api.post(`${base(ws)}/leads/bulk`, body);
}
export async function updateLead(ws: string, id: string, patch: Record<string, string | boolean | number | string[] | null>) {
  await api.patch(`${base(ws)}/leads/${id}`, patch);
}
/** Mover lead do Kanban: lead + histórico + interação numa transação. */
export async function moveLead(ws: string, id: string, stageId: string) {
  await api.post(`${base(ws)}/leads/${id}/move`, { stage_id: stageId });
}
export async function addLeadNote(ws: string, id: string, content: string) {
  await api.post(`${base(ws)}/leads/${id}/interactions`, { content });
}
export async function setLeadAi(ws: string, id: string, active: boolean) {
  await api.post(`${base(ws)}/leads/${id}/ai`, { active });
}
export async function createLeadTask(ws: string, id: string, title: string) {
  await api.post(`${base(ws)}/leads/${id}/tasks`, { title, due_at: new Date(Date.now() + 86_400_000).toISOString() });
}

// ---- tarefas
export async function listTasks(ws: string): Promise<CrmTaskRow[]> {
  const { data } = await api.get(`${base(ws)}/tasks`);
  return z.array(taskRowSchema).parse(data);
}
export async function setTaskStatus(ws: string, id: string, status: string) {
  await api.patch(`${base(ws)}/tasks/${id}`, { status });
}

// ---- indicadores
export async function listStageHistory(ws: string) {
  const { data } = await api.get(`${base(ws)}/stage-history`);
  return z.array(historySchema).parse(data);
}
export async function listAllInteractions(ws: string) {
  const { data } = await api.get(`${base(ws)}/interactions`);
  return z.array(interactionLiteSchema).parse(data);
}
export async function listCadenceOptions(ws: string) {
  const { data } = await api.get(`${base(ws)}/cadence-options`);
  return z.array(named).parse(data);
}
export async function getCadenceMetrics(ws: string) {
  const { data } = await api.get(`${base(ws)}/cadence-metrics`);
  return z
    .object({
      cadences: z.array(z.object({ id: z.string(), name: z.string(), steps: z.unknown() })),
      events: z.array(z.object({ cadence_id: z.string(), step_index: z.number(), channel: z.string(), event: z.string(), message_id: str, lead_id: str })),
      runs: z.array(z.object({ cadence_id: z.string(), lead_id: z.string(), entered_at: z.string(), status: z.string(), stop_reason: str })),
      stages: z.array(named),
      history: z.array(z.object({ lead_id: z.string(), to_stage_id: str, created_at: z.string() })),
      messages: z.array(z.object({ id: z.string(), status: z.string() })),
    })
    .parse(data);
}

// ---- configurações
export async function getCrmExtras(ws: string) {
  const [reasons, tags, settings] = await Promise.all([
    api.get(`${base(ws)}/loss-reasons`), api.get(`${base(ws)}/tags`), api.get(`${base(ws)}/settings`),
  ]);
  return {
    reasons: z.array(named).parse(reasons.data),
    tags: z.array(tagSchema).parse(tags.data),
    settings: settingsSchema.parse(settings.data ?? null),
  };
}
export async function saveDistribution(ws: string, distribution: string, defaultOwner: string | null) {
  await api.put(`${base(ws)}/settings`, { distribution, default_owner_id: defaultOwner });
}
export async function createLossReason(ws: string, name: string) {
  await api.post(`${base(ws)}/loss-reasons`, { name });
}
export async function deleteLossReason(ws: string, id: string) {
  await api.delete(`${base(ws)}/loss-reasons/${id}`);
}
export async function createTag(ws: string, name: string) {
  await api.post(`${base(ws)}/tags`, { name });
}
export async function deleteTag(ws: string, id: string) {
  await api.delete(`${base(ws)}/tags/${id}`);
}
