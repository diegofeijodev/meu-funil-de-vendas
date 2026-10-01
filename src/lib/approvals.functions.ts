import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Decisão de aprovação feita no servidor:
 * - só owner/admin aprovam ou rejeitam;
 * - quem pediu não aprova o próprio pedido, a menos que seja owner/admin.
 * O banco também impede (trigger) que outros perfis mudem uma campanha para aprovada/ativa.
 */
export const decideApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ approvalId: z.string().uuid(), decision: z.enum(["approved", "rejected"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: req, error } = await db.from("approval_requests").select("*").eq("id", data.approvalId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!req) throw new Error("Pedido de aprovação não encontrado.");
    if (req.status !== "pending") throw new Error("Este pedido já foi decidido.");

    const { data: member } = await db
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", req.workspace_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!member) throw new Error("Você não tem acesso a esta empresa.");
    const isManager = member.role === "owner" || member.role === "admin";
    if (!isManager) throw new Error("Só o dono ou um administrador da empresa pode aprovar ou rejeitar.");

    const now = new Date().toISOString();
    const { error: upErr } = await db
      .from("approval_requests")
      .update({ status: data.decision, decided_at: now, decided_by: context.userId })
      .eq("id", req.id)
      .eq("status", "pending");
    if (upErr) throw new Error(upErr.message);

    if (req.entity_id) {
      if (req.entity_type === "campaign") {
        const status = data.decision === "approved" ? "approved" : "draft";
        const { error: e } = await db.from("campaigns").update({ status }).eq("id", req.entity_id);
        if (e) throw new Error(e.message);
      }
      if (req.entity_type === "creative") {
        await db.from("creatives").update({ status: data.decision }).eq("id", req.entity_id);
      }
    }
    await db.from("activity_logs").insert({
      workspace_id: req.workspace_id,
      actor_id: context.userId,
      action: `approval.${data.decision}`,
      entity_type: req.entity_type,
      metadata: { request_id: req.id, entity_id: req.entity_id } as never,
    });
    return { ok: true };
  });
