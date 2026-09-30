/**
 * Piloto automático do Instagram (somente servidor).
 * - weekly (domingo 18h BRT): gera a semana seguinte para planos ativos com auto_publish.
 * - tick (a cada 5 min, junto da fila): gera mídias pendentes aos poucos, agenda, e
 *   reagenda posts sem aprovação a menos de 2h do horário.
 * - optimize (segunda): ajusta horários e pesos dos pilares com base nos últimos 14 dias.
 */
import { generateContentCalendar, generatePostAssets, schedulePost } from "./instagram.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "erro desconhecido");

export async function logEvent(ev: {
  workspace_id: string;
  plan_id?: string | null;
  post_id?: string | null;
  kind:
    | "generation"
    | "media"
    | "schedule"
    | "publish"
    | "failure"
    | "approval"
    | "reschedule"
    | "optimize"
    | "guardrail";
  level?: "info" | "warn" | "error";
  message: string;
}) {
  try {
    const s = await db();
    await s.from("ig_autopilot_events").insert({ level: "info", ...ev });
  } catch (e) {
    console.error("[autopilot] log falhou:", errMsg(e));
  }
}

async function activePlans() {
  const s = await db();
  const { data } = await s
    .from("ig_content_plans")
    .select("*")
    .eq("auto_publish", true)
    .eq("status", "active");
  return (data ?? []) as any[];
}

/** Domingo 18h: gera a semana seguinte. */
export async function runWeeklyAutopilot() {
  const out: any[] = [];
  for (const plan of await activePlans()) {
    try {
      const r = await generateContentCalendar(plan.workspace_id, plan.id, 1, "auto");
      const s = await db();
      await s
        .from("ig_content_plans")
        .update({ last_autopilot_at: new Date().toISOString() })
        .eq("id", plan.id);
      await logEvent({
        workspace_id: plan.workspace_id,
        plan_id: plan.id,
        kind: "generation",
        message: `Calendário da próxima semana gerado: ${r.created} posts (IA: ${r.provider}).`,
      });
      if (plan.requires_approval) {
        await logEvent({
          workspace_id: plan.workspace_id,
          plan_id: plan.id,
          kind: "approval",
          message: "Os criativos serão gerados e aguardarão sua aprovação na aba Aprovações.",
        });
      }
      out.push({ plan: plan.id, created: r.created });
    } catch (e) {
      await logEvent({
        workspace_id: plan.workspace_id,
        plan_id: plan.id,
        kind: "failure",
        level: "error",
        message: `Falha ao gerar o calendário: ${errMsg(e)}`,
      });
      out.push({ plan: plan.id, error: errMsg(e) });
    }
  }
  return out;
}

/** A cada 5 minutos: gera mídias (até 2 por execução), agenda e aplica a regra das 2h. */
export async function autopilotTick() {
  const s = await db();
  const plans = await activePlans();
  if (!plans.length) return { media: 0, rescheduled: 0 };
  const byId = new Map(plans.map((p) => [p.id, p]));
  const ids = plans.map((p) => p.id);
  let media = 0;
  let rescheduled = 0;

  // 1) Mídia dos posts "idea" futuros (limite baixo para não estourar o tempo da execução).
  const { data: ideas } = await s
    .from("ig_posts")
    .select("id, workspace_id, plan_id, scheduled_at")
    .in("plan_id", ids)
    .eq("status", "idea")
    .gt("scheduled_at", new Date().toISOString())
    .order("scheduled_at")
    .limit(2);
  for (const p of (ideas ?? []) as any[]) {
    const plan = byId.get(p.plan_id);
    const r = await generatePostAssets(p.workspace_id, p.id, "auto");
    media++;
    if (!r.ok) {
      await logEvent({
        workspace_id: p.workspace_id,
        plan_id: p.plan_id,
        post_id: p.id,
        kind: "failure",
        level: "error",
        message: `Falha ao gerar a mídia: ${r.error}`,
      });
      continue;
    }
    if ("pending" in r && r.pending) {
      await logEvent({
        workspace_id: p.workspace_id,
        plan_id: p.plan_id,
        post_id: p.id,
        kind: "media",
        message: `Mídia em geração (${r.provider}); será concluída automaticamente.`,
      });
      continue;
    }
    await logEvent({
      workspace_id: p.workspace_id,
      plan_id: p.plan_id,
      post_id: p.id,
      kind: "media",
      message: `Mídia gerada (${r.provider}).`,
    });
    if (!plan.requires_approval) {
      try {
        await schedulePost(p.workspace_id, p.id, p.scheduled_at);
        await logEvent({
          workspace_id: p.workspace_id,
          plan_id: p.plan_id,
          post_id: p.id,
          kind: "schedule",
          message: `Agendado para ${fmt(p.scheduled_at)}.`,
        });
      } catch (e) {
        await logEvent({
          workspace_id: p.workspace_id,
          plan_id: p.plan_id,
          post_id: p.id,
          kind: "failure",
          level: "error",
          message: `Falha ao agendar: ${errMsg(e)}`,
        });
      }
    }
  }

  // 2) Regra das 2h: posts sem aprovação perto do horário vão para o dia seguinte.
  const approvalPlanIds = plans.filter((p) => p.requires_approval).map((p) => p.id);
  if (approvalPlanIds.length) {
    const limit = new Date(Date.now() + 2 * 3600e3).toISOString();
    const { data: late } = await s
      .from("ig_posts")
      .select("id, workspace_id, plan_id, scheduled_at")
      .in("plan_id", approvalPlanIds)
      .in("status", ["idea", "generating", "pending_approval", "ready"])
      .is("approved_at", null)
      .lt("scheduled_at", limit)
      .limit(50);
    for (const p of (late ?? []) as any[]) {
      const base = Math.max(new Date(p.scheduled_at).getTime(), Date.now());
      let next = new Date(p.scheduled_at).getTime() + 86400e3;
      while (next < base + 2 * 3600e3) next += 86400e3;
      const iso = new Date(next).toISOString();
      await s.from("ig_posts").update({ scheduled_at: iso }).eq("id", p.id);
      rescheduled++;
      await logEvent({
        workspace_id: p.workspace_id,
        plan_id: p.plan_id,
        post_id: p.id,
        kind: "reschedule",
        level: "warn",
        message: `Sem aprovação até 2h antes — reagendado para ${fmt(iso)}.`,
      });
    }
  }
  return { media, rescheduled };
}

/** Chamado quando um post é aprovado: agenda sozinho se o plano está no piloto automático. */
export async function afterApproval(workspaceId: string, postId: string) {
  const s = await db();
  const { data: post } = await s
    .from("ig_posts")
    .select("plan_id, scheduled_at")
    .eq("id", postId)
    .maybeSingle();
  if (!post?.plan_id) return;
  const { data: plan } = await s
    .from("ig_content_plans")
    .select("auto_publish, status")
    .eq("id", post.plan_id)
    .maybeSingle();
  await logEvent({
    workspace_id: workspaceId,
    plan_id: post.plan_id,
    post_id: postId,
    kind: "approval",
    message: "Post aprovado.",
  });
  if (!plan?.auto_publish || plan.status !== "active" || !post.scheduled_at) return;
  if (new Date(post.scheduled_at).getTime() < Date.now()) return;
  await schedulePost(workspaceId, postId, post.scheduled_at);
  await logEvent({
    workspace_id: workspaceId,
    plan_id: post.plan_id,
    post_id: postId,
    kind: "schedule",
    message: `Agendado automaticamente para ${fmt(post.scheduled_at)}.`,
  });
}

/** Token expirado: pausa planos, marca conta com erro e avisa. */
export async function handleTokenExpired(workspaceId: string, message: string) {
  const s = await db();
  await s
    .from("instagram_accounts")
    .update({ status: "error", last_error: message })
    .eq("workspace_id", workspaceId);
  await s
    .from("ig_content_plans")
    .update({ status: "paused" })
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  await s
    .from("publishing_jobs")
    .update({ status: "cancelled", locked_at: null })
    .eq("workspace_id", workspaceId)
    .eq("channel", "instagram_organic")
    .eq("status", "pending");
  await logEvent({
    workspace_id: workspaceId,
    kind: "guardrail",
    level: "error",
    message: `Token da Meta expirado: planos pausados e publicações suspensas. ${message}`,
  });
}

/* ---------------- Agente de otimização ---------------- */

const PILLAR_STOP = new Set(["de", "da", "do", "e", "a", "o", "para", "com", "em", "dos", "das"]);
function pillarName(p: any) {
  return typeof p === "string" ? p : String(p?.name ?? p?.title ?? p?.label ?? "");
}

export async function runOptimizer() {
  const s = await db();
  const since = new Date(Date.now() - 14 * 86400e3).toISOString();
  const { data: plans } = await s
    .from("ig_content_plans")
    .select("*")
    .in("status", ["active", "paused"]);
  const out: any[] = [];
  for (const plan of (plans ?? []) as any[]) {
    const { data: posts } = await s
      .from("ig_posts")
      .select("id, theme, caption, published_at")
      .eq("plan_id", plan.id)
      .eq("status", "published")
      .gte("published_at", since);
    const list = (posts ?? []) as any[];
    if (list.length < 3) {
      out.push({ plan: plan.id, skipped: "poucos dados" });
      continue;
    }
    const { data: metrics } = await s
      .from("ig_post_metrics")
      .select("post_id, reach, collected_at")
      .in(
        "post_id",
        list.map((p) => p.id),
      )
      .order("collected_at", { ascending: false });
    const reach = new Map<string, number>();
    for (const m of (metrics ?? []) as any[])
      if (!reach.has(m.post_id)) reach.set(m.post_id, m.reach ?? 0);

    // Horários (fuso de São Paulo).
    const byHour = new Map<number, number[]>();
    for (const p of list) {
      const h =
        Number(
          new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            hour12: false,
            timeZone: "America/Sao_Paulo",
          }).format(new Date(p.published_at)),
        ) % 24;
      byHour.set(h, [...(byHour.get(h) ?? []), reach.get(p.id) ?? 0]);
    }
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    const hours = [...byHour.entries()]
      .map(([h, v]) => ({ h, avg: avg(v), n: v.length }))
      .sort((a, b) => b.avg - a.avg);
    const topHours = hours.slice(0, 3).map((x) => `${String(x.h).padStart(2, "0")}:00`);

    // Pilares por palavra-chave.
    const pillars = (Array.isArray(plan.content_pillars) ? plan.content_pillars : [])
      .map(pillarName)
      .filter(Boolean);
    const scores: Record<string, number[]> = {};
    for (const name of pillars) {
      const words = name
        .toLowerCase()
        .split(/\W+/)
        .filter((w: string) => w.length > 3 && !PILLAR_STOP.has(w));
      for (const p of list) {
        const text = `${p.theme ?? ""} ${p.caption ?? ""}`.toLowerCase();
        if (words.some((w: string) => text.includes(w)))
          (scores[name] ??= []).push(reach.get(p.id) ?? 0);
      }
    }
    const raw: Record<string, number> = {};
    for (const name of pillars) raw[name] = scores[name]?.length ? avg(scores[name]) : 0;
    const total = Object.values(raw).reduce((a, b) => a + b, 0);
    const weights: Record<string, number> = {};
    for (const name of pillars) {
      // Mistura 70% desempenho + 30% distribuição igual, para não zerar pilares sem dados.
      const perf = total ? (raw[name] ?? 0) / total : 1 / pillars.length;
      weights[name] = Math.round((0.7 * perf + 0.3 / pillars.length) * 100) / 100;
    }

    const prevTimes = plan.preferred_times;
    const newTimes = topHours.length ? topHours : prevTimes;
    const best = Object.entries(weights).sort((a, b) => b[1] - a[1])[0];
    const note = {
      at: new Date().toISOString(),
      period_days: 14,
      posts_analyzed: list.length,
      preferred_times: { before: prevTimes, after: newTimes },
      pillar_weights: weights,
      summary: [
        topHours.length
          ? `Melhores horários por alcance médio: ${hours
              .slice(0, 3)
              .map(
                (x) =>
                  `${String(x.h).padStart(2, "0")}h (${Math.round(x.avg)} de alcance, ${x.n} posts)`,
              )
              .join(", ")}.`
          : null,
        best
          ? `Pilar com melhor desempenho: "${best[0]}" (peso ${Math.round(best[1] * 100)}%).`
          : null,
        `Baseado em ${list.length} posts publicados nos últimos 14 dias.`,
      ]
        .filter(Boolean)
        .join(" "),
    };
    const notes = [...(Array.isArray(plan.ai_notes) ? plan.ai_notes : []), note].slice(-20);
    await s
      .from("ig_content_plans")
      .update({ preferred_times: newTimes, pillar_weights: weights, ai_notes: notes })
      .eq("id", plan.id);
    await logEvent({
      workspace_id: plan.workspace_id,
      plan_id: plan.id,
      kind: "optimize",
      message: `Otimização semanal: ${note.summary}`,
    });
    out.push({ plan: plan.id, ok: true });
  }
  return out;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}
