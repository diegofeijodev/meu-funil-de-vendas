import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

const member = z.object({ id: z.string(), user_id: z.string(), role: z.string(), created_at: z.string() }).passthrough();
const profile = z
  .object({ id: z.string(), email: z.string().nullish(), full_name: z.string().nullish(), avatar_url: z.string().nullish() })
  .passthrough();
const workspace = z.object({ id: z.string(), name: z.string(), plan: z.string() }).passthrough();
const membersResponse = z.object({ members: z.array(member), profiles: z.array(profile) });

export type SettingsData = {
  members: z.infer<typeof member>[];
  profiles: z.infer<typeof profile>[];
  profile: z.infer<typeof profile> | null;
  workspace: z.infer<typeof workspace> | null;
};

/** As três leituras de Configurações (membros + perfis dos membros, meu perfil, workspace). */
export async function fetchSettings(workspaceId: string): Promise<SettingsData> {
  const [m, p, w] = await Promise.all([
    api.get(`/v1/workspaces/${workspaceId}/members`),
    api.get("/v1/profiles/me"),
    api.get(`/v1/workspaces/${workspaceId}`),
  ]);
  const members = membersResponse.parse(m.data);
  return { ...members, profile: profile.parse(p.data), workspace: workspace.parse(w.data) };
}

/** `PATCH /v1/workspaces/:ws` — dono/admin; a API grava `workspace.updated`. */
export async function updateWorkspaceName(workspaceId: string, name: string) {
  await api.patch(`/v1/workspaces/${workspaceId}`, { name });
}

export async function updateMyName(fullName: string) {
  await api.patch("/v1/profiles/me", { full_name: fullName });
}
