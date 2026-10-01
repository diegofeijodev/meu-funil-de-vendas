/** Checagem de acesso usada pelas server functions (com o cliente do usuário logado). */
type Ctx = { supabase: any; userId: string };

export type WorkspaceRole = "owner" | "admin" | "marketing" | "viewer";

export async function requireRole(ctx: Ctx, workspaceId: string, roles?: WorkspaceRole[]): Promise<WorkspaceRole> {
  const { data } = await ctx.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!data) throw new Error("Você não tem acesso a esta empresa.");
  const role = data.role as WorkspaceRole;
  if (roles && !roles.includes(role)) throw new Error("Seu perfil não tem permissão para esta ação.");
  return role;
}

export const EDITORS: WorkspaceRole[] = ["owner", "admin", "marketing"];
export const MANAGERS: WorkspaceRole[] = ["owner", "admin"];
