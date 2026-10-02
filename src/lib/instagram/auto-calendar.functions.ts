import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { EDITORS, MANAGERS, requireRole } from "@/lib/membership";

const lib = () => import("./auto-calendar.server");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{1,2}:\d{2}$/);
const FORMATS = ["feed_image", "feed_carousel", "reel", "story_image", "story_video"] as const;

async function runOf(ctx: { supabase: any }, runId: string) {
  const { data } = await ctx.supabase.from("ig_auto_runs").select("id, workspace_id").eq("id", runId).maybeSingle();
  if (!data) throw new Error("Programação não encontrada.");
  return data as { id: string; workspace_id: string };
}

/** Cria a programação: período, dias, horários, formatos e modo. Publicar sem aprovação é só para dono/admin. */
export const createAutoCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        planId: z.string().uuid().nullable().optional(),
        brandId: z.string().uuid().nullable().optional(),
        campaignId: z.string().uuid().nullable().optional(),
        startDate: date,
        endDate: date,
        weekdays: z.array(z.number().int().min(0).max(6)).min(1),
        times: z.array(time).max(8),
        storyTimes: z.array(time).max(10),
        formats: z.array(z.enum(FORMATS)).min(1),
        focus: z.string().trim().min(30, "Descreva o objetivo deste período (mínimo de 30 caracteres).").max(1000),
        mode: z.enum(["publish", "approval"]),
        recurring: z.boolean().optional(),
        asap: z.boolean().optional(),
      })
      .refine((v) => v.times.length + v.storyTimes.length > 0 || v.asap, "Informe ao menos um horário.")
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, data.mode === "publish" ? MANAGERS : EDITORS);
    return (await lib()).createAutoRun(data.workspaceId, context.userId, data);
  });

/** Próximo lote de conteúdos da estrategista (a tela chama até terminar; o agendador continua se a página fechar). */
export const fillAutoCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const run = await runOf(context, data.runId);
    await requireRole(context, run.workspace_id, EDITORS);
    return (await lib()).fillAutoRun(run.id);
  });

/** Gera agora o criativo do próximo post da programação que acontece nas próximas horas. */
export const generateNextAutoMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid(), withinHours: z.number().min(1).max(72).default(6) }).parse(d))
  .handler(async ({ data, context }) => {
    const run = await runOf(context, data.runId);
    await requireRole(context, run.workspace_id, EDITORS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const s = supabaseAdmin as any;
    const until = new Date(Date.now() + data.withinHours * 3600e3).toISOString();
    const { data: next } = await s
      .from("ig_posts")
      .select("id")
      .eq("run_id", run.id)
      .eq("status", "idea")
      .gt("scheduled_at", new Date().toISOString())
      .lt("scheduled_at", until)
      .order("scheduled_at")
      .limit(2);
    const list = (next ?? []) as { id: string }[];
    if (!list.length) return { done: true, ok: true, remaining: 0 };
    const ig = await import("./instagram.server");
    const r = await ig.generatePostAssets(run.workspace_id, list[0]!.id, "auto");
    if (r.ok && !("pending" in r && r.pending)) await (await lib()).scheduleAutomated(list[0]!.id).catch(() => null);
    return { done: list.length < 2, ok: r.ok, error: r.ok ? null : r.error, remaining: list.length - 1 };
  });

export const cancelAutoCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const run = await runOf(context, data.runId);
    await requireRole(context, run.workspace_id, EDITORS);
    return (await lib()).cancelAutoRun(run.workspace_id, run.id);
  });

/** Prévia dos horários antes de criar (sem gastar IA). */
export const previewAutoCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        startDate: date,
        endDate: date,
        weekdays: z.array(z.number().int().min(0).max(6)),
        times: z.array(time).max(8),
        storyTimes: z.array(time).max(10),
        formats: z.array(z.enum(FORMATS)).min(1),
        asap: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const { slots, skipped } = (await lib()).computeSlots(data);
      return { ok: true as const, total: slots.length, skipped, first: slots[0]?.at ?? null, last: slots[slots.length - 1]?.at ?? null, slots: slots.slice(0, 200) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Configuração inválida." };
    }
  });

/** Aprova (e opcionalmente ajusta em texto) a estratégia do período: libera a geração dos posts. */
export const approveAutoStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid(), editedText: z.string().max(4000).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const run = await runOf(context, data.runId);
    await requireRole(context, run.workspace_id, EDITORS);
    return (await lib()).approveRunStrategy(run.id, data.editedText ?? null);
  });

/** Descarta a estratégia atual e pede outra à IA. */
export const redoAutoStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const run = await runOf(context, data.runId);
    await requireRole(context, run.workspace_id, EDITORS);
    return (await lib()).redoRunStrategy(run.id);
  });
