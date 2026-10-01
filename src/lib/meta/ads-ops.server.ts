/**
 * Gestor de tráfego (somente servidor):
 * - 2.1 sincroniza o desempenho real da Meta (por anúncio e por dia) em performance_daily;
 * - 2.3 regras automáticas com limites (pausar anúncio caro, escalar conjunto barato);
 * - 1.4/2.2 recomendações da IA com dados reais e execução de verdade na Meta.
 */
import { readRules } from "./ads-config";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => day(new Date(Date.now() - n * 86400e3));
const money = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

type CampaignRow = {
  id: string;
  workspace_id: string;
  name: string;
  objective: string;
  status: string;
  max_cac: number | null;
  goal_leads: number | null;
  budget_daily: number | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_adset_ids: string[] | null;
  meta_ad_ids: string[] | null;
  meta_ad_map: Record<string, { creativeId: string | null; adsetId: string; angle: string | null }> | null;
  automation_rules: unknown;
};

/* ---------------- 2.1 Sincronização ---------------- */

export async function syncWorkspaceInsights(workspaceId: string, days = 7) {
  const s = await db();
  const { data } = await s
    .from("campaigns")
    .select("id, workspace_id, meta_campaign_id, meta_ad_map")
    .eq("workspace_id", workspaceId)
    .not("meta_campaign_id", "is", null);
  const camps = (data ?? []) as unknown as Pick<CampaignRow, "id" | "workspace_id" | "meta_campaign_id" | "meta_ad_map">[];
  if (!camps.length) return { campaigns: 0, rows: 0 };
  const byMeta = new Map(camps.map((c) => [c.meta_campaign_id!, c]));
  const { runWithMetaWorkspace } = await import("./graph.server");
  const { fetchDailyAdInsights } = await import("./meta-ads.server");
  const rows = await runWithMetaWorkspace(workspaceId, () =>
    fetchDailyAdInsights([...byMeta.keys()], daysAgo(days), day(new Date())),
  );
  const now = new Date().toISOString();
  const upserts = rows
    .map((r) => {
      const c = byMeta.get(r.campaignId);
      if (!c) return null;
      const mapped = c.meta_ad_map?.[r.adId];
      return {
        workspace_id: workspaceId,
        campaign_id: c.id,
        creative_id: mapped?.creativeId ?? null,
        adset_name: r.adsetName,
        ad_name: r.adName,
        date: r.date,
        spend: r.spend,
        impressions: r.impressions,
        reach: r.reach,
        clicks: r.clicks,
        leads: r.leads,
        conversions: r.conversions,
        revenue: r.revenue,
        source: "meta",
        meta_ad_id: r.adId,
        meta_adset_id: r.adsetId,
        synced_at: now,
      };
    })
    .filter(Boolean);
  for (let i = 0; i < upserts.length; i += 500) {
    const { error } = await s
      .from("performance_daily")
      .upsert(upserts.slice(i, i + 500) as never, { onConflict: "campaign_id,meta_ad_id,date" });
    if (error) throw new Error(error.message);
  }
  await s
    .from("campaigns")
    .update({ last_insights_sync_at: now } as never)
    .in("id", camps.map((c) => c.id));
  return { campaigns: camps.length, rows: upserts.length };
}

export async function syncAllInsights() {
  const s = await db();
  const { data } = await s.from("campaigns").select("workspace_id").not("meta_campaign_id", "is", null);
  const workspaces = [...new Set(((data ?? []) as { workspace_id: string }[]).map((r) => r.workspace_id))];
  const out: { workspace: string; rows?: number; error?: string }[] = [];
  for (const w of workspaces) {
    try {
      const r = await syncWorkspaceInsights(w, 3);
      out.push({ workspace: w, rows: r.rows });
    } catch (e) {
      out.push({ workspace: w, error: e instanceof Error ? e.message : "falhou" });
    }
  }
  return out;
}

/* ---------------- Estatísticas por anúncio / conjunto ---------------- */

type Agg = { spend: number; impressions: number; clicks: number; leads: number; conversions: number; revenue: number; name: string };

async function statsFor(campaignId: string, sinceDays: number) {
  const s = await db();
  const { data } = await s
    .from("performance_daily")
    .select("meta_ad_id, meta_adset_id, ad_name, adset_name, spend, impressions, clicks, leads, conversions, revenue, date")
    .eq("campaign_id", campaignId)
    .eq("source", "meta")
    .gte("date", daysAgo(sinceDays));
  const byAd = new Map<string, Agg & { adsetId: string }>();
  const byAdset = new Map<string, Agg>();
  for (const r of (data ?? []) as any[]) {
    const add = (m: Map<string, any>, key: string, name: string, extra: Record<string, unknown> = {}) => {
      const a = m.get(key) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0, revenue: 0, name, ...extra };
      a.spend += Number(r.spend ?? 0);
      a.impressions += Number(r.impressions ?? 0);
      a.clicks += Number(r.clicks ?? 0);
      a.leads += Number(r.leads ?? 0);
      a.conversions += Number(r.conversions ?? 0);
      a.revenue += Number(r.revenue ?? 0);
      m.set(key, a);
    };
    if (r.meta_ad_id) add(byAd, r.meta_ad_id, r.ad_name ?? r.meta_ad_id, { adsetId: r.meta_adset_id });
    if (r.meta_adset_id) add(byAdset, r.meta_adset_id, r.adset_name ?? r.meta_adset_id);
  }
  return { byAd, byAdset };
}

const cplOf = (a: { spend: number; leads: number }) => (a.leads ? a.spend / a.leads : null);

async function recentRuleAction(campaignId: string, key: string, hours: number) {
  const s = await db();
  const { data } = await s
    .from("ai_recommendations")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("source", "rule")
    .eq("payload->>target" as never, key)
    .gte("created_at", new Date(Date.now() - hours * 3600e3).toISOString())
    .limit(1);
  return !!data?.length;
}

/* ---------------- 2.3 Regras automáticas ---------------- */

export async function runRulesForCampaign(c: CampaignRow) {
  const rules = readRules(c.automation_rules);
  if (!rules.enabled || !c.meta_campaign_id) return [];
  const s = await db();
  const { runWithMetaWorkspace, graph } = await import("./graph.server");
  const ops = await import("./meta-ads.server");
  const actions: string[] = [];
  const log = async (action: string, title: string, reason: string, payload: Record<string, unknown>, result: string) => {
    await s.from("ai_recommendations").insert({
      workspace_id: c.workspace_id,
      campaign_id: c.id,
      action,
      title,
      reason,
      severity: "high",
      requires_approval: false,
      status: "applied",
      source: "rule",
      payload,
      applied_at: new Date().toISOString(),
      result,
    } as never);
    actions.push(title);
  };

  await runWithMetaWorkspace(c.workspace_id, async () => {
    const week = await statsFor(c.id, 7);
    // Pausa anúncio caro (ou sem lead depois do gasto mínimo).
    for (const [adId, a] of week.byAd) {
      if (a.spend < rules.minSpendToJudge) continue;
      const cpl = cplOf(a);
      const tooExpensive = rules.maxCpl != null && cpl != null && cpl > rules.maxCpl;
      const noLeads = a.leads === 0;
      if (!tooExpensive && !noLeads) continue;
      if (await recentRuleAction(c.id, adId, 24 * 7)) continue;
      const st = await graph<{ effective_status?: string }>(`/${adId}`, { params: { fields: "effective_status" } }).catch(() => null);
      if (st?.effective_status !== "ACTIVE") continue;
      // Nunca pausa o último anúncio ativo do conjunto.
      const siblings = [...week.byAd.entries()].filter(([id, x]) => x.adsetId === a.adsetId && id !== adId);
      if (!siblings.length) continue;
      await ops.setAdStatus(adId, "PAUSED");
      await log(
        "pause_ad",
        `Regra: anúncio "${a.name}" pausado`,
        noLeads
          ? `Gastou ${money(a.spend)} em 7 dias sem nenhum lead (limite: ${money(rules.minSpendToJudge)}).`
          : `CPL de ${money(cpl!)} acima do teto de ${money(rules.maxCpl!)} nos últimos 7 dias.`,
        { target: adId, adId },
        "Pausado na Meta",
      );
    }
    // Escala conjunto barato (com teto e no máximo 1 aumento a cada 24 h).
    if (rules.scaleBelowCpl != null) {
      const recent = await statsFor(c.id, 3);
      for (const [adsetId, a] of recent.byAdset) {
        const cpl = cplOf(a);
        if (cpl == null || a.leads < 3 || cpl >= rules.scaleBelowCpl) continue;
        if (await recentRuleAction(c.id, adsetId, 24)) continue;
        const cur = await ops.getAdsetBudget(adsetId);
        if (cur.status !== "ACTIVE" || !cur.dailyBudget) continue;
        let next = Math.round(cur.dailyBudget * (1 + rules.scaleStepPct / 100) * 100) / 100;
        if (rules.maxDailyBudget != null) next = Math.min(next, rules.maxDailyBudget);
        if (next <= cur.dailyBudget) continue;
        await ops.setAdsetBudget(adsetId, next);
        await log(
          "increase_budget",
          `Regra: verba de "${cur.name}" de ${money(cur.dailyBudget)} para ${money(next)}/dia`,
          `CPL de ${money(cpl)} nos últimos 3 dias, abaixo da meta de ${money(rules.scaleBelowCpl)}.`,
          { target: adsetId, adsetId, from: cur.dailyBudget, to: next },
          "Verba alterada na Meta",
        );
      }
    }
  });
  return actions;
}

export async function runAllRules() {
  const s = await db();
  const { data } = await s
    .from("campaigns")
    .select("*")
    .not("meta_campaign_id", "is", null)
    .eq("automation_rules->>enabled" as never, "true");
  const out: { campaign: string; actions?: string[]; error?: string }[] = [];
  for (const c of (data ?? []) as unknown as CampaignRow[]) {
    try {
      out.push({ campaign: c.id, actions: await runRulesForCampaign(c) });
    } catch (e) {
      out.push({ campaign: c.id, error: e instanceof Error ? e.message : "falhou" });
    }
  }
  return out;
}

/* ---------------- 1.4 Recomendações com IA ---------------- */

const EXECUTABLE = new Set(["pause_ad", "activate_ad", "increase_budget", "decrease_budget"]);

const RECO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recomendacoes"],
  properties: {
    recomendacoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "title", "reason", "estimated_impact", "severity", "target_ad_id", "target_adset_id", "new_daily_budget"],
        properties: {
          action: {
            type: "string",
            enum: ["pause_ad", "activate_ad", "increase_budget", "decrease_budget", "create_variation", "test_headline", "new_audience", "create_remarketing"],
          },
          title: { type: "string" },
          reason: { type: "string" },
          estimated_impact: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          target_ad_id: { type: "string" },
          target_adset_id: { type: "string" },
          new_daily_budget: { type: "number" },
        },
      },
    },
  },
};

export async function generateRecommendationsAI(campaignId: string) {
  const s = await db();
  const { data: cRow } = await s.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
  const c = cRow as unknown as CampaignRow | null;
  if (!c) throw new Error("Campanha não encontrada.");
  if (!c.meta_campaign_id) throw new Error("Esta campanha ainda não foi publicada na Meta.");
  const { byAd, byAdset } = await statsFor(c.id, 14);
  if (!byAd.size) throw new Error("Ainda não há resultados da Meta para esta campanha. Sincronize depois que ela veicular.");
  const { runWithMetaWorkspace } = await import("./graph.server");
  const { getAdsetBudget } = await import("./meta-ads.server");
  const budgets = await runWithMetaWorkspace(c.workspace_id, async () => {
    const out: Record<string, number> = {};
    for (const id of byAdset.keys()) out[id] = (await getAdsetBudget(id).catch(() => ({ dailyBudget: 0 }))).dailyBudget;
    return out;
  });
  const { currentStrategy } = await import("@/lib/ai/strategist.server");
  const strategy = await currentStrategy(s as never, c.id);
  const fmt = (a: Agg) => ({
    gasto: Number(a.spend.toFixed(2)),
    impressoes: a.impressions,
    cliques: a.clicks,
    ctr: a.impressions ? Number(((a.clicks / a.impressions) * 100).toFixed(2)) : 0,
    leads: a.leads,
    cpl: cplOf(a) != null ? Number(cplOf(a)!.toFixed(2)) : null,
    vendas: a.conversions,
    roas: a.spend ? Number((a.revenue / a.spend).toFixed(2)) : 0,
  });
  const prompt = [
    "Você é gestor de tráfego sênior. Analise os resultados REAIS dos últimos 14 dias desta campanha da Meta e proponha de 2 a 6 ações.",
    "Regras: só use IDs que aparecem nos dados (target_ad_id / target_adset_id; \"\" quando não se aplica).",
    "new_daily_budget em reais só para increase_budget/decrease_budget (0 nos outros). Aumentos de no máximo 30% por vez.",
    "Não pause o único anúncio ativo de um conjunto. Justifique com os números. Português do Brasil.",
    `CAMPANHA: ${JSON.stringify({ nome: c.name, objetivo: c.objective, meta_leads: c.goal_leads, cac_maximo: c.max_cac, verba_diaria: c.budget_daily })}`,
    `METAS DA ESTRATÉGIA: ${JSON.stringify(strategy?.kpis ?? {})}`,
    `CONJUNTOS: ${JSON.stringify([...byAdset.entries()].map(([id, a]) => ({ id, nome: a.name, verba_diaria: budgets[id] ?? null, ...fmt(a) })))}`,
    `ANÚNCIOS: ${JSON.stringify([...byAd.entries()].map(([id, a]) => ({ id, nome: a.name, conjunto: a.adsetId, ...fmt(a) })))}`,
  ].join("\n");
  const { jsonLLM } = await import("@/lib/creative/llm.server");
  const raw = (await jsonLLM(c.workspace_id, prompt, RECO_SCHEMA, "optimizer")) as { recomendacoes?: any[] };
  const list = Array.isArray(raw.recomendacoes) ? raw.recomendacoes : [];
  let created = 0;
  for (const r of list) {
    const adOk = !r.target_ad_id || byAd.has(r.target_ad_id);
    const setOk = !r.target_adset_id || byAdset.has(r.target_adset_id);
    if (!adOk || !setOk) continue;
    if ((r.action === "pause_ad" || r.action === "activate_ad") && !r.target_ad_id) continue;
    if ((r.action === "increase_budget" || r.action === "decrease_budget") && (!r.target_adset_id || !(r.new_daily_budget > 0))) continue;
    await s.from("ai_recommendations").insert({
      workspace_id: c.workspace_id,
      campaign_id: c.id,
      action: r.action,
      title: String(r.title).slice(0, 200),
      reason: String(r.reason),
      estimated_impact: String(r.estimated_impact ?? ""),
      severity: ["low", "medium", "high"].includes(r.severity) ? r.severity : "medium",
      requires_approval: true,
      status: "pending",
      source: "ai",
      payload: {
        executable: EXECUTABLE.has(r.action),
        adId: r.target_ad_id || null,
        adsetId: r.target_adset_id || null,
        newDailyBudget: r.new_daily_budget || null,
        currentDailyBudget: r.target_adset_id ? (budgets[r.target_adset_id] ?? null) : null,
      },
    } as never);
    created++;
  }
  return { created };
}

/** 2.2 Executa na Meta a recomendação aprovada. */
export async function applyRecommendation(id: string, userId: string) {
  const s = await db();
  const { data: rec } = await s.from("ai_recommendations").select("*").eq("id", id).maybeSingle();
  const r = rec as any;
  if (!r) throw new Error("Recomendação não encontrada.");
  if (r.status !== "pending") throw new Error("Esta recomendação já foi decidida.");
  const p = (r.payload ?? {}) as { adId?: string; adsetId?: string; newDailyBudget?: number; executable?: boolean };
  let result = "Registrada. Esta ação é feita fora do Meta Ads (ex.: gerar variação no Estúdio).";
  if (EXECUTABLE.has(r.action)) {
    const { runWithMetaWorkspace } = await import("./graph.server");
    const ops = await import("./meta-ads.server");
    result = await runWithMetaWorkspace(r.workspace_id, async () => {
      if (r.action === "pause_ad" && p.adId) {
        await ops.setAdStatus(p.adId, "PAUSED");
        return "Anúncio pausado na Meta.";
      }
      if (r.action === "activate_ad" && p.adId) {
        await ops.setAdStatus(p.adId, "ACTIVE");
        return "Anúncio ativado na Meta.";
      }
      if ((r.action === "increase_budget" || r.action === "decrease_budget") && p.adsetId && p.newDailyBudget) {
        const cur = await ops.getAdsetBudget(p.adsetId);
        const cap = cur.dailyBudget ? cur.dailyBudget * 1.3 : p.newDailyBudget;
        const next = r.action === "increase_budget" ? Math.min(p.newDailyBudget, cap) : p.newDailyBudget;
        await ops.setAdsetBudget(p.adsetId, next);
        return `Verba do conjunto alterada de ${money(cur.dailyBudget)} para ${money(next)}/dia na Meta.`;
      }
      throw new Error("Recomendação sem alvo válido.");
    });
  }
  await s
    .from("ai_recommendations")
    .update({ status: "applied", applied_at: new Date().toISOString(), applied_by: userId, result } as never)
    .eq("id", id);
  return { result };
}
