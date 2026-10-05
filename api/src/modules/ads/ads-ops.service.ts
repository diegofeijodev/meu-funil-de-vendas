/**
 * Gestor de tráfego (porte de `meta/ads-ops.server.ts` + `ads-ops.functions.ts`):
 * - sincroniza o desempenho real da Meta (por anúncio e por dia) e dos canais Google/TikTok em `performance_daily`;
 * - regras automáticas com limites (pausar anúncio caro, escalar conjunto barato);
 * - recomendações da IA com dados reais e execução de verdade na Meta.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { addDays, todaySp } from '../../common/time/dates';
import { WorkspaceAccessService } from '../access/access.service';
import { AiService } from '../ai/ai.service';
import { CampaignGuardsService } from '../campaigns/campaign-guards.service';
import { CrmDefaultsService } from '../crm-defaults/crm-defaults.service';
import { notFound, UserError } from '../media/user-error';
import { StrategistService } from '../strategist/strategist.service';
import { VaultService } from '../vault/vault.service';
import { readRules, sanitizeAdsConfig, sanitizeRules } from './ads-config';
import { errMsg, guarded } from './ads-errors';
import { isDigits } from './ads-ids';
import { GoogleAdsClient } from './google-ads.client';
import { MetaOpsService } from './meta-ops.service';
import { PerfRow, PerfStore } from './perf-store';
import { TikTokAdsClient } from './tiktok-ads.client';

const money = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;
/** Reserva vencida: quem aplicava a recomendação morreu; ela volta a "pending". */
const APPLY_LEASE_MS = 10 * 60 * 1000;
/** Intervalo mínimo entre duas sincronizações manuais de 30 dias da mesma empresa. */
const SYNC_COOLDOWN_MS = 60 * 1000;
const EXECUTABLE = new Set(['pause_ad', 'activate_ad', 'increase_budget', 'decrease_budget']);
const daysAgo = (n: number) => addDays(todaySp(), -n);
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

type Agg = { spend: number; impressions: number; clicks: number; leads: number; conversions: number; revenue: number; name: string };
type CampaignRow = {
  id: string; workspace_id: string; name: string; objective: string; status: string; max_cac: unknown; goal_leads: unknown; budget_daily: unknown;
  meta_campaign_id: string | null; meta_adset_id: string | null; meta_adset_ids: string[]; meta_ad_ids: string[]; meta_ad_map: unknown; automation_rules: unknown;
};

const RECO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recomendacoes'],
  properties: {
    recomendacoes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'title', 'reason', 'estimated_impact', 'severity', 'target_ad_id', 'target_adset_id', 'new_daily_budget'],
        properties: {
          action: { type: 'string', enum: ['pause_ad', 'activate_ad', 'increase_budget', 'decrease_budget', 'create_variation', 'test_headline', 'new_audience', 'create_remarketing'] },
          title: { type: 'string' },
          reason: { type: 'string' },
          estimated_impact: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          target_ad_id: { type: 'string' },
          target_adset_id: { type: 'string' },
          new_daily_budget: { type: 'number' },
        },
      },
    },
  },
};

const cplOf = (a: { spend: number; leads: number }) => (a.leads ? a.spend / a.leads : null);

@Injectable()
export class AdsOpsService {
  private readonly logger = new Logger(AdsOpsService.name);
  /** Última sincronização manual por empresa (memória do processo; basta para frear cliques repetidos). */
  private readonly lastManualSync = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly guards: CampaignGuardsService,
    private readonly ops: MetaOpsService,
    private readonly google: GoogleAdsClient,
    private readonly tiktok: TikTokAdsClient,
    private readonly perf: PerfStore,
    private readonly ai: AiService,
    private readonly strategist: StrategistService,
    private readonly vault: VaultService,
    private readonly crm: CrmDefaultsService,
  ) {}

  // ------------------------------------------------------------------ 2.1 sincronização

  async syncWorkspaceInsights(ws: string, days = 7): Promise<{ campaigns: number; rows: number }> {
    const camps = await this.prisma.campaigns.findMany({
      where: { workspace_id: ws, meta_campaign_id: { not: null } },
      select: { id: true, workspace_id: true, meta_campaign_id: true, meta_ad_map: true },
    });
    if (!camps.length) return { campaigns: 0, rows: 0 };
    const byMeta = new Map(camps.map((c) => [c.meta_campaign_id!, c]));
    const rows = await this.ops.fetchDailyAdInsights(ws, [...byMeta.keys()], daysAgo(days), todaySp());
    const now = new Date();
    const upserts: PerfRow[] = [];
    for (const r of rows) {
      const c = byMeta.get(r.campaignId);
      if (!c) continue;
      const mapped = (c.meta_ad_map as Record<string, { creativeId?: string | null }> | null)?.[r.adId];
      upserts.push({
        workspace_id: ws, campaign_id: c.id, creative_id: mapped?.creativeId ?? null, adset_name: r.adsetName, ad_name: r.adName, date: r.date,
        spend: r.spend, impressions: r.impressions, reach: r.reach, clicks: r.clicks, leads: r.leads, conversions: r.conversions, revenue: r.revenue,
        source: 'meta', meta_ad_id: r.adId, meta_adset_id: r.adsetId,
      });
    }
    // creative_id vem do mapa gravado na publicação; só vale se ainda for uma criativa DESTA empresa (FK é SET NULL).
    const creativeIds = [...new Set(upserts.map((u) => u.creative_id).filter(Boolean))] as string[];
    if (creativeIds.length) {
      const ok = new Set((await this.prisma.creatives.findMany({ where: { id: { in: creativeIds }, workspace_id: ws }, select: { id: true } })).map((x) => x.id));
      for (const u of upserts) if (u.creative_id && !ok.has(u.creative_id)) u.creative_id = null;
    }
    await this.perf.upsertMeta(upserts, now);
    await this.prisma.campaigns.updateMany({ where: { id: { in: camps.map((c) => c.id) }, workspace_id: ws }, data: { last_insights_sync_at: now } });
    return { campaigns: camps.length, rows: upserts.length };
  }

  /** 2.8/2.9 Resultados diários das campanhas ligadas no Google Ads e no TikTok Ads. */
  async syncExternalChannels(ws: string, days = 7): Promise<{ rows: number; errors?: string[] }> {
    const camps = await this.prisma.campaigns.findMany({
      where: { workspace_id: ws, OR: [{ google_campaign_id: { not: null } }, { tiktok_campaign_id: { not: null } }] },
      select: { id: true, google_campaign_id: true, tiktok_campaign_id: true },
    });
    if (!camps.length) return { rows: 0 };
    const now = new Date();
    const rows: PerfRow[] = [];
    const errors: string[] = [];
    const google = camps.filter((c) => c.google_campaign_id);
    if (google.length) {
      try {
        const byExt = new Map(google.map((c) => [String(c.google_campaign_id), c.id]));
        for (const r of await this.google.dailyResults(ws, [...byExt.keys()], days)) {
          const id = byExt.get(r.externalCampaignId);
          if (id) rows.push({ workspace_id: ws, campaign_id: id, date: r.date, spend: r.spend, impressions: r.impressions, clicks: r.clicks, leads: Math.round(r.conversions), conversions: Math.round(r.conversions), revenue: r.revenue, source: 'google', external_id: r.externalCampaignId, ad_name: r.name });
        }
      } catch (e) {
        errors.push(`Google: ${errMsg(e)}`);
      }
    }
    const tiktok = camps.filter((c) => c.tiktok_campaign_id);
    if (tiktok.length) {
      try {
        const byExt = new Map(tiktok.map((c) => [String(c.tiktok_campaign_id), c.id]));
        for (const r of await this.tiktok.dailyResults(ws, [...byExt.keys()], days)) {
          const id = byExt.get(r.externalCampaignId);
          if (id) rows.push({ workspace_id: ws, campaign_id: id, date: r.date, spend: r.spend, impressions: r.impressions, clicks: r.clicks, leads: Math.round(r.conversions), conversions: 0, revenue: 0, source: 'tiktok', external_id: r.externalCampaignId, ad_name: r.name });
        }
      } catch (e) {
        errors.push(`TikTok: ${errMsg(e)}`);
      }
    }
    try {
      await this.perf.upsertExternal(rows, now);
    } catch (e) {
      errors.push(errMsg(e));
    }
    if (errors.length && !rows.length) throw new Error(errors.join(' · '));
    return { rows: rows.length, errors };
  }

  /** Cron: 3 dias de cada empresa com campanha em algum canal. */
  async syncAllInsights() {
    const data = await this.prisma.campaigns.findMany({
      where: { OR: [{ meta_campaign_id: { not: null } }, { google_campaign_id: { not: null } }, { tiktok_campaign_id: { not: null } }] },
      select: { workspace_id: true },
    });
    const workspaces = [...new Set(data.map((r) => r.workspace_id))];
    const out: { workspace: string; rows?: number; error?: string }[] = [];
    for (const w of workspaces) {
      try {
        const meta = await this.syncWorkspaceInsights(w, 3);
        const ext = await this.syncExternalChannels(w, 3).catch((e) => ({ rows: 0, errors: [errMsg(e)] }));
        out.push({ workspace: w, rows: meta.rows + ext.rows, ...(ext.errors?.length ? { error: ext.errors.join(' · ') } : {}) });
      } catch (e) {
        out.push({ workspace: w, error: errMsg(e) });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ estatísticas por anúncio / conjunto

  private async statsFor(campaignId: string, ws: string, sinceDays: number) {
    const data = await this.prisma.performance_daily.findMany({
      where: { campaign_id: campaignId, workspace_id: ws, source: 'meta', date: { gte: asDate(daysAgo(sinceDays)) } },
      select: { meta_ad_id: true, meta_adset_id: true, ad_name: true, adset_name: true, spend: true, impressions: true, clicks: true, leads: true, conversions: true, revenue: true },
    });
    const byAd = new Map<string, Agg & { adsetId: string }>();
    const byAdset = new Map<string, Agg>();
    for (const r of data) {
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

  /**
   * Reserva a ação da regra ANTES de chamar a Meta: com um advisory lock por campanha, confere se já houve ação recente neste alvo e,
   * se não, grava a linha `source='rule'`. Duas execuções sobrepostas (cron + HTTP, ou duas HTTP) não agem duas vezes no mesmo alvo.
   * Devolve o id da reserva, ou null se já havia ação recente.
   */
  private async claimRuleAction(c: CampaignRow, key: string, hours: number, row: { action: string; title: string; reason: string; payload: Record<string, unknown> }): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ads-rule:' + c.id}))`;
      const hit = await tx.ai_recommendations.findFirst({
        where: { campaign_id: c.id, source: 'rule', payload: { path: ['target'], equals: key }, created_at: { gte: new Date(Date.now() - hours * 3600e3) } },
        select: { id: true },
      });
      if (hit) return null;
      const made = await tx.ai_recommendations.create({
        data: {
          workspace_id: c.workspace_id, campaign_id: c.id, action: row.action, title: row.title, reason: row.reason, severity: 'high', requires_approval: false,
          status: 'applied', source: 'rule', payload: row.payload as Prisma.InputJsonObject, applied_at: new Date(), result: 'Aplicando na Meta…',
        },
        select: { id: true },
      });
      return made.id;
    });
  }

  // ------------------------------------------------------------------ 2.3 regras automáticas

  async runRulesForCampaign(c: CampaignRow): Promise<string[]> {
    const rules = readRules(c.automation_rules);
    if (!rules.enabled || !c.meta_campaign_id) return [];
    const ws = c.workspace_id;
    const actions: string[] = [];
    /** Reserva (atômica), executa na Meta e confirma; se a Meta falhar, solta a reserva para a próxima rodada tentar. */
    const act = async (key: string, hours: number, row: { action: string; title: string; reason: string; payload: Record<string, unknown> }, result: string, run: () => Promise<unknown>) => {
      const id = await this.claimRuleAction(c, key, hours, row);
      if (!id) return;
      try {
        await run();
      } catch (e) {
        await this.prisma.ai_recommendations.deleteMany({ where: { id } }).catch(() => undefined);
        throw e;
      }
      await this.prisma.ai_recommendations.update({ where: { id }, data: { result } });
      actions.push(row.title);
    };

    const week = await this.statsFor(c.id, ws, 7);
    // Pausa anúncio caro (ou sem lead depois do gasto mínimo).
    for (const [adId, a] of week.byAd) {
      if (a.spend < rules.minSpendToJudge) continue;
      const cpl = cplOf(a);
      const tooExpensive = rules.maxCpl != null && cpl != null && cpl > rules.maxCpl;
      const noLeads = a.leads === 0;
      if (!tooExpensive && !noLeads) continue;
      const st = await this.ops.adEffectiveStatus(ws, adId).catch(() => null);
      if (st !== 'ACTIVE') continue;
      // Nunca pausa o último anúncio ativo do conjunto.
      const siblings = [...week.byAd.entries()].filter(([id, x]) => x.adsetId === a.adsetId && id !== adId);
      if (!siblings.length) continue;
      await act(
        adId,
        24 * 7,
        {
          action: 'pause_ad',
          title: `Regra: anúncio "${a.name}" pausado`,
          reason: noLeads ? `Gastou ${money(a.spend)} em 7 dias sem nenhum lead (limite: ${money(rules.minSpendToJudge)}).` : `CPL de ${money(cpl!)} acima do teto de ${money(rules.maxCpl!)} nos últimos 7 dias.`,
          payload: { target: adId, adId },
        },
        'Pausado na Meta',
        () => this.ops.setAdStatus(ws, adId, 'PAUSED'),
      );
    }
    // Escala conjunto barato (com teto e no máximo 1 aumento a cada 24 h).
    if (rules.scaleBelowCpl != null) {
      const recent = await this.statsFor(c.id, ws, 3);
      for (const [adsetId, a] of recent.byAdset) {
        const cpl = cplOf(a);
        if (cpl == null || a.leads < 3 || cpl >= rules.scaleBelowCpl) continue;
        const cur = await this.ops.getAdsetBudget(ws, adsetId);
        if (cur.status !== 'ACTIVE' || !cur.dailyBudget) continue;
        let next = Math.round(cur.dailyBudget * (1 + rules.scaleStepPct / 100) * 100) / 100;
        if (rules.maxDailyBudget != null) next = Math.min(next, rules.maxDailyBudget);
        if (next <= cur.dailyBudget) continue;
        await act(
          adsetId,
          24,
          {
            action: 'increase_budget',
            title: `Regra: verba de "${cur.name}" de ${money(cur.dailyBudget)} para ${money(next)}/dia`,
            reason: `CPL de ${money(cpl)} nos últimos 3 dias, abaixo da meta de ${money(rules.scaleBelowCpl)}.`,
            payload: { target: adsetId, adsetId, from: cur.dailyBudget, to: next },
          },
          'Verba alterada na Meta',
          () => this.ops.setAdsetBudget(ws, adsetId, next),
        );
      }
    }
    return actions;
  }

  async runAllRules() {
    const data = await this.prisma.campaigns.findMany({
      where: { meta_campaign_id: { not: null }, automation_rules: { path: ['enabled'], equals: true } },
    });
    const out: { campaign: string; actions?: string[]; error?: string }[] = [];
    for (const c of data) {
      try {
        out.push({ campaign: c.id, actions: await this.runRulesForCampaign(c as unknown as CampaignRow) });
      } catch (e) {
        out.push({ campaign: c.id, error: errMsg(e) });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ 1.4 recomendações com IA

  async generateRecommendationsAI(ws: string, campaignId: string): Promise<{ created: number }> {
    const cRow = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: ws } });
    const c = cRow as unknown as CampaignRow | null;
    if (!c) throw new Error('Campanha não encontrada.');
    if (!c.meta_campaign_id) throw new Error('Esta campanha ainda não foi publicada na Meta.');
    const { byAd, byAdset } = await this.statsFor(c.id, ws, 14);
    if (!byAd.size) throw new Error('Ainda não há resultados da Meta para esta campanha. Sincronize depois que ela veicular.');
    const budgets: Record<string, number> = {};
    for (const id of byAdset.keys()) budgets[id] = (await this.ops.getAdsetBudget(ws, id).catch(() => ({ dailyBudget: 0 }))).dailyBudget;
    const strategy = await this.strategist.currentStrategy(ws, c.id);
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
      'Você é gestor de tráfego sênior. Analise os resultados REAIS dos últimos 14 dias desta campanha da Meta e proponha de 2 a 6 ações.',
      'Regras: só use IDs que aparecem nos dados (target_ad_id / target_adset_id; "" quando não se aplica).',
      'new_daily_budget em reais só para increase_budget/decrease_budget (0 nos outros). Aumentos de no máximo 30% por vez.',
      'Não pause o único anúncio ativo de um conjunto. Justifique com os números. Português do Brasil.',
      `CAMPANHA: ${JSON.stringify({ nome: c.name, objetivo: c.objective, meta_leads: c.goal_leads, cac_maximo: c.max_cac, verba_diaria: c.budget_daily })}`,
      `METAS DA ESTRATÉGIA: ${JSON.stringify(strategy?.kpis ?? {})}`,
      `CONJUNTOS: ${JSON.stringify([...byAdset.entries()].map(([id, a]) => ({ id, nome: a.name, verba_diaria: budgets[id] ?? null, ...fmt(a) })))}`,
      `ANÚNCIOS: ${JSON.stringify([...byAd.entries()].map(([id, a]) => ({ id, nome: a.name, conjunto: a.adsetId, ...fmt(a) })))}`,
    ].join('\n');
    const raw = (await this.ai.json(ws, { prompt, schema: RECO_SCHEMA, name: 'optimizer' })) as { recomendacoes?: any[] };
    const list = Array.isArray(raw.recomendacoes) ? raw.recomendacoes : [];
    let created = 0;
    for (const r of list) {
      const adOk = !r.target_ad_id || byAd.has(r.target_ad_id);
      const setOk = !r.target_adset_id || byAdset.has(r.target_adset_id);
      if (!adOk || !setOk) continue;
      if ((r.action === 'pause_ad' || r.action === 'activate_ad') && !r.target_ad_id) continue;
      if ((r.action === 'increase_budget' || r.action === 'decrease_budget') && (!r.target_adset_id || !(r.new_daily_budget > 0))) continue;
      // Idempotência (duplo clique em "Gerar"): já existe pendente igual (campanha + ação + alvo)? Não duplica.
      const action = String(r.action).slice(0, 40);
      const open = await this.prisma.ai_recommendations.findMany({ where: { workspace_id: ws, campaign_id: c.id, action, status: { in: ['pending', 'applying'] } }, select: { payload: true } });
      const dup = open.some((o) => {
        const op = (o.payload ?? {}) as { adId?: string | null; adsetId?: string | null };
        return (op.adId ?? null) === (r.target_ad_id || null) && (op.adsetId ?? null) === (r.target_adset_id || null);
      });
      if (dup) continue;
      await this.prisma.ai_recommendations.create({
        data: {
          workspace_id: ws,
          campaign_id: c.id,
          action,
          title: String(r.title).slice(0, 200),
          reason: String(r.reason),
          estimated_impact: String(r.estimated_impact ?? ''),
          severity: ['low', 'medium', 'high'].includes(r.severity) ? r.severity : 'medium',
          requires_approval: true,
          status: 'pending',
          source: 'ai',
          payload: {
            executable: EXECUTABLE.has(r.action),
            adId: r.target_ad_id || null,
            adsetId: r.target_adset_id || null,
            newDailyBudget: r.new_daily_budget || null,
            currentDailyBudget: r.target_adset_id ? (budgets[r.target_adset_id] ?? null) : null,
          },
        },
      });
      created++;
    }
    return { created };
  }

  /** O alvo da recomendação (anúncio/conjunto) precisa ser desta campanha: está no mapa gravado na publicação ou nos resultados sincronizados. */
  private async targetBelongs(rec: { workspace_id: string; campaign_id: string | null }, p: { adId?: string | null; adsetId?: string | null }): Promise<boolean> {
    if (!rec.campaign_id) return false;
    const c = await this.prisma.campaigns.findFirst({ where: { id: rec.campaign_id, workspace_id: rec.workspace_id }, select: { meta_ad_ids: true, meta_adset_id: true, meta_adset_ids: true } });
    if (!c) return false;
    const seen = (where: Prisma.performance_dailyWhereInput) => this.prisma.performance_daily.findFirst({ where: { campaign_id: rec.campaign_id!, workspace_id: rec.workspace_id, ...where }, select: { id: true } });
    if (p.adId && !(c.meta_ad_ids.includes(p.adId) || (await seen({ meta_ad_id: p.adId })))) return false;
    if (p.adsetId && !(c.meta_adset_ids.includes(p.adsetId) || c.meta_adset_id === p.adsetId || (await seen({ meta_adset_id: p.adsetId })))) return false;
    return true;
  }

  /**
   * Recupera recomendações presas em "applying" (o processo caiu entre a reserva e o resultado): reserva com mais de 10 min
   * (ou sem carimbo, de antes da coluna) volta a "pending" e pode ser aplicada ou descartada de novo. Uma reserva viva
   * (carimbo recente) nunca é tocada. Roda ao listar/aplicar e no cron.
   */
  async recoverStaleApplying(ws?: string): Promise<number> {
    const stale = new Date(Date.now() - APPLY_LEASE_MS);
    const r = await this.prisma.ai_recommendations.updateMany({
      where: { status: 'applying', ...(ws ? { workspace_id: ws } : {}), OR: [{ applying_at: null }, { applying_at: { lt: stale } }] },
      data: { status: 'pending', applying_at: null },
    });
    return r.count;
  }

  /** 2.2 Executa na Meta a recomendação aprovada (reservada atomicamente: dois cliques não executam duas vezes). */
  async applyRecommendation(id: string, userId: string): Promise<{ result: string }> {
    const rec = await this.prisma.ai_recommendations.findUnique({ where: { id } });
    if (!rec) throw notFound('Recomendação não encontrada.');
    await this.recoverStaleApplying(rec.workspace_id);
    const claim = await this.prisma.ai_recommendations.updateMany({ where: { id, status: 'pending' }, data: { status: 'applying', applying_at: new Date() } });
    if (claim.count !== 1) throw new UserError('Esta recomendação já foi decidida.');
    const ws = rec.workspace_id;
    const p = (rec.payload ?? {}) as { adId?: string | null; adsetId?: string | null; newDailyBudget?: number | null };
    let result = 'Registrada. Esta ação é feita fora do Meta Ads (ex.: gerar variação no Estúdio).';
    try {
      if (EXECUTABLE.has(rec.action)) {
        if (!(await this.targetBelongs(rec, p))) throw new UserError('Recomendação sem alvo válido.');
        result = await guarded(async () => {
          if (rec.action === 'pause_ad' && p.adId) {
            await this.ops.setAdStatus(ws, p.adId, 'PAUSED');
            return 'Anúncio pausado na Meta.';
          }
          if (rec.action === 'activate_ad' && p.adId) {
            await this.ops.setAdStatus(ws, p.adId, 'ACTIVE');
            return 'Anúncio ativado na Meta.';
          }
          const nb = Number(p.newDailyBudget);
          if ((rec.action === 'increase_budget' || rec.action === 'decrease_budget') && p.adsetId && Number.isFinite(nb) && nb > 0) {
            const cur = await this.ops.getAdsetBudget(ws, p.adsetId);
            const cap = cur.dailyBudget ? cur.dailyBudget * 1.3 : nb;
            const next = rec.action === 'increase_budget' ? Math.min(nb, cap) : nb;
            await this.ops.setAdsetBudget(ws, p.adsetId, next);
            return `Verba do conjunto alterada de ${money(cur.dailyBudget)} para ${money(next)}/dia na Meta.`;
          }
          throw new UserError('Recomendação sem alvo válido.');
        });
      }
    } catch (e) {
      await this.prisma.ai_recommendations.updateMany({ where: { id, status: 'applying' }, data: { status: 'pending', applying_at: null } });
      throw e;
    }
    await this.prisma.ai_recommendations.update({ where: { id }, data: { status: 'applied', applied_at: new Date(), applied_by: userId, result, applying_at: null } });
    return { result };
  }

  // ------------------------------------------------------------------ server fns

  /** `syncAdsInsightsNow` — qualquer membro. */
  async syncNow(userId: string, ws: string) {
    await this.access.require(userId, ws, 'read');
    const last = this.lastManualSync.get(ws);
    if (last && Date.now() - last < SYNC_COOLDOWN_MS) return { campaigns: 0, rows: 0, message: 'Sincronização feita há pouco — aguarde um minuto.' };
    this.lastManualSync.set(ws, Date.now());
    try {
      return await guarded(async () => {
        const meta = await this.syncWorkspaceInsights(ws, 30);
        const ext = await this.syncExternalChannels(ws, 30).catch(() => ({ rows: 0 }));
        return { campaigns: meta.campaigns, rows: meta.rows + ext.rows } as { campaigns: number; rows: number; message?: string };
      });
    } catch (e) {
      this.lastManualSync.delete(ws); // falhou: não pune o usuário com a espera
      throw e;
    }
  }

  /** `generateAdsRecommendations` — editores. */
  async generate(userId: string, ws: string, campaignId?: string | null) {
    await this.access.require(userId, ws, 'write');
    const camps = await this.prisma.campaigns.findMany({
      where: { workspace_id: ws, meta_campaign_id: { not: null }, ...(campaignId ? { id: campaignId } : {}) },
      select: { id: true, name: true },
    });
    let created = 0;
    const errors: string[] = [];
    for (const c of camps) {
      try {
        created += (await this.generateRecommendationsAI(ws, c.id)).created;
      } catch (e) {
        errors.push(`${c.name}: ${errMsg(e)}`);
      }
    }
    if (!camps.length) errors.push('Nenhuma campanha publicada na Meta ainda.');
    return { created, errors };
  }

  /** `decideAdsRecommendation` — owner|admin. Recomendação de outra empresa = "não encontrada" (o RLS escondia). */
  async decide(userId: string, id: string, decision: 'apply' | 'dismiss') {
    const rec = await this.prisma.ai_recommendations.findUnique({ where: { id }, select: { id: true, workspace_id: true } });
    if (!rec || !(await this.access.roleOf(userId, rec.workspace_id))) throw notFound('Recomendação não encontrada.');
    await this.access.require(userId, rec.workspace_id, 'manage');
    if (decision === 'dismiss') {
      const r = await this.prisma.ai_recommendations.updateMany({ where: { id, status: 'pending' }, data: { status: 'dismissed' } });
      if (r.count !== 1) throw new UserError('Esta recomendação já foi decidida.');
      return { result: 'Descartada.' };
    }
    return this.applyRecommendation(id, userId);
  }

  /** `saveCampaignAdsSettings` — editores (campanha de outra empresa = "Campanha não encontrada."). */
  async saveSettings(userId: string, d: { campaignId: string; adsConfig: Record<string, unknown>; rules: Record<string, unknown>; privacyUrl?: string | null }) {
    const c = await this.guards.resolveCampaign(userId, d.campaignId, 'write');
    let privacy: string | null = null;
    if (d.privacyUrl) {
      try {
        const u = new URL(d.privacyUrl);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('x');
        privacy = u.toString();
      } catch {
        throw new UserError('O link da política de privacidade é inválido.');
      }
    }
    const cfg = { ...sanitizeAdsConfig(d.adsConfig), privacyUrl: privacy };
    await this.prisma.campaigns.update({
      where: { id: c.id },
      data: { ads_config: cfg as unknown as Prisma.InputJsonObject, automation_rules: sanitizeRules(d.rules) as unknown as Prisma.InputJsonObject },
    });
    return { ok: true };
  }

  /** `listMetaAudiences` — qualquer membro. */
  async listAudiences(userId: string, ws: string) {
    await this.access.require(userId, ws, 'read');
    return guarded(() => this.ops.listCustomAudiences(ws));
  }

  /** `syncCrmCustomerAudience` — owner|admin. Lê até 50.000 leads do CRM da empresa (sem descadastrados). */
  async syncCrmAudience(userId: string, ws: string, onlyWon: boolean) {
    await this.access.require(userId, ws, 'manage');
    await this.crm.ensure(ws);
    let stageIds: string[] | null = null;
    if (onlyWon) {
      const won = await this.prisma.crm_stages.findMany({ where: { workspace_id: ws, is_won: true }, select: { id: true } });
      stageIds = won.map((s) => s.id);
      if (!stageIds.length) throw new UserError('Nenhuma etapa marcada como ganho no funil do CRM.');
    }
    const leads = await this.prisma.crm_leads.findMany({
      where: { workspace_id: ws, unsubscribed: false, ...(stageIds ? { stage_id: { in: stageIds } } : {}) },
      select: { email: true, phone: true },
      take: 50000,
    });
    const contacts = leads.filter((l) => l.email || l.phone);
    if (!contacts.length) throw new UserError('Nenhum lead com e-mail ou telefone no CRM.');
    const key = onlyWon ? 'META_AUDIENCE_CRM_WON' : 'META_AUDIENCE_CRM_ALL';
    const saved = await this.vault.get(ws, key);
    const r = await guarded(() => this.ops.upsertCustomerListAudience(ws, onlyWon ? 'Clientes do CRM (ganhos)' : 'Leads do CRM', saved && isDigits(saved) ? saved : null, contacts));
    await this.vault.set(ws, { [key]: r.id });
    return r;
  }
}
