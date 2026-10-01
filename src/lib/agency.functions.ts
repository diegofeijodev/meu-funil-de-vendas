import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Ctx = { supabase: any; userId: string };

async function managedWorkspaces(ctx: Ctx) {
  const { data } = await ctx.supabase.from("workspace_members").select("workspace_id, role").eq("user_id", ctx.userId);
  return new Set(((data ?? []) as { workspace_id: string; role: string }[]).filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.workspace_id));
}

/** 7.1 Esta empresa passa a usar as conexões de IA de outra (a da agência). null = só as próprias. */
export const setAiInheritance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid(), sourceId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const managed = await managedWorkspaces(context as Ctx);
    if (!managed.has(data.workspaceId)) throw new Error("Só o dono ou um administrador altera esta empresa.");
    if (data.sourceId && !managed.has(data.sourceId)) throw new Error("Você precisa ser dono ou administrador da empresa de origem.");
    if (data.sourceId === data.workspaceId) throw new Error("Escolha outra empresa como origem.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.sourceId) {
      // Evita corrente: a origem não pode herdar de ninguém.
      await supabaseAdmin.from("workspaces").update({ ai_inherit_from: null }).eq("id", data.sourceId);
    }
    const { error } = await supabaseAdmin.from("workspaces").update({ ai_inherit_from: data.sourceId }).eq("id", data.workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** 7.1 Aplica a origem a todas as empresas que você administra (menos a própria origem). */
export const applyAiInheritanceToAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sourceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const managed = await managedWorkspaces(context as Ctx);
    if (!managed.has(data.sourceId)) throw new Error("Você precisa ser dono ou administrador da empresa de origem.");
    const targets = [...managed].filter((id) => id !== data.sourceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("workspaces").update({ ai_inherit_from: null }).eq("id", data.sourceId);
    if (targets.length) {
      const { error } = await supabaseAdmin.from("workspaces").update({ ai_inherit_from: data.sourceId }).in("id", targets);
      if (error) throw new Error(error.message);
    }
    return { updated: targets.length };
  });

/** 7.4 Painel da agência: números de todas as empresas do usuário. */
export const agencyOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = (context as Ctx).supabase;
    const { data: members } = await db
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, ai_inherit_from)")
      .eq("user_id", (context as Ctx).userId);
    const list = ((members ?? []) as any[]).map((m) => ({
      id: m.workspace_id as string,
      name: (m.workspaces?.name as string) ?? "Empresa",
      role: m.role as string,
      inheritFrom: (m.workspaces?.ai_inherit_from as string | null) ?? null,
    }));
    const ids = list.map((w) => w.id);
    if (!ids.length) return { workspaces: [] };
    const since30 = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const since7 = new Date(Date.now() - 7 * 86400e3).toISOString();
    const weekEnd = new Date(Date.now() + 7 * 86400e3).toISOString();
    const [perf, leads, posts, approvals, igPending, active] = await Promise.all([
      db.from("performance_daily").select("workspace_id, spend, leads, revenue").in("workspace_id", ids).neq("source", "demo").gte("date", since30).limit(20000),
      db.from("crm_leads").select("workspace_id").in("workspace_id", ids).gte("created_at", since7).limit(20000),
      db.from("ig_posts").select("workspace_id, status").in("workspace_id", ids).or(`and(scheduled_at.gte.${since7},scheduled_at.lte.${weekEnd}),published_at.gte.${since7}`).limit(5000),
      db.from("approval_requests").select("workspace_id").in("workspace_id", ids).eq("status", "pending"),
      db.from("ig_posts").select("workspace_id").in("workspace_id", ids).eq("status", "pending_approval"),
      db.from("campaigns").select("workspace_id").in("workspace_id", ids).eq("meta_delivery_status", "ACTIVE"),
    ]);
    const count = (rows: any[] | null, ws: string) => (rows ?? []).filter((r) => r.workspace_id === ws).length;
    return {
      workspaces: list.map((w) => {
        const p = ((perf.data ?? []) as any[]).filter((r) => r.workspace_id === w.id);
        const spend = p.reduce((a, r) => a + Number(r.spend), 0);
        const lead = p.reduce((a, r) => a + Number(r.leads), 0);
        const revenue = p.reduce((a, r) => a + Number(r.revenue), 0);
        return {
          ...w,
          spend,
          adLeads: lead,
          cpl: lead ? spend / lead : null,
          roas: spend ? revenue / spend : null,
          crmLeads7d: count(leads.data, w.id),
          postsWeek: count(posts.data, w.id),
          pending: count(approvals.data, w.id) + count(igPending.data, w.id),
          activeCampaigns: count(active.data, w.id),
        };
      }),
    };
  });
