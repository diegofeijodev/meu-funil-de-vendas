import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AutoCalendarService } from './auto-calendar.service';
import { ContentService } from './content.service';
import { fmtDate, PostRow } from './ig-types';
import { IgStore, errText } from './ig-store.service';
import { MediaGenerationService } from './media-generation.service';
import { PublishingService } from './publishing.service';

const PILLAR_STOP = new Set(['de', 'da', 'do', 'e', 'a', 'o', 'para', 'com', 'em', 'dos', 'das']);
const pillarName = (p: any) => (typeof p === 'string' ? p : String(p?.name ?? p?.title ?? p?.label ?? ''));

/**
 * Piloto automático do Instagram:
 * - weekly (domingo 18h BRT): gera a semana seguinte para planos ativos com auto_publish.
 * - tick (a cada 5 min): gera mídias pendentes aos poucos, agenda e reagenda posts sem aprovação a menos de 2h do horário.
 * - optimize (segunda): ajusta horários e pesos dos pilares com base nos últimos 14 dias.
 */
@Injectable()
export class AutopilotService {
  constructor(
    private readonly store: IgStore,
    private readonly content: ContentService,
    private readonly mediaGen: MediaGenerationService,
    private readonly publishing: PublishingService,
    private readonly autoCalendar: AutoCalendarService,
  ) {}

  private get prisma() {
    return this.store.prisma;
  }

  private activePlans() {
    return this.prisma.ig_content_plans.findMany({ where: { auto_publish: true, status: 'active' } });
  }

  /** Domingo 18h: gera a semana seguinte. */
  async runWeeklyAutopilot() {
    const out: any[] = [];
    out.push({ recurring: await this.autoCalendar.renewRecurring().catch((e) => ({ error: errText(e) })) });
    // Semana que começa na próxima segunda (BRT): a reserva em ig_autopilot_weeks impede gerar duas vezes.
    const now = new Date(Date.now() - 3 * 3600e3);
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + ((8 - now.getUTCDay()) % 7 || 7));
    const weekStart = monday.toISOString().slice(0, 10);
    const week = new Date(`${weekStart}T12:00:00Z`);
    for (const plan of await this.activePlans()) {
      try {
        try {
          await this.prisma.ig_autopilot_weeks.create({ data: { plan_id: plan.id, week_start: week } });
        } catch (e) {
          if ((e as { code?: string }).code === 'P2002') {
            out.push({ plan: plan.id, skipped: `semana ${weekStart} já gerada` });
            continue;
          }
          throw e;
        }
        const r = await this.content.generateContentCalendar(plan.workspace_id, plan.id, 1, 'auto').catch(async (e) => {
          // Falhou: libera a semana para a próxima tentativa.
          await this.prisma.ig_autopilot_weeks.deleteMany({ where: { plan_id: plan.id, week_start: week } });
          throw e;
        });
        await this.prisma.ig_content_plans.update({ where: { id: plan.id }, data: { last_autopilot_at: new Date() } });
        await this.store.logEvent({ workspace_id: plan.workspace_id, plan_id: plan.id, kind: 'generation', message: `Calendário da próxima semana gerado: ${r.created} posts (IA: ${r.provider}).` });
        if (plan.requires_approval) {
          await this.store.logEvent({ workspace_id: plan.workspace_id, plan_id: plan.id, kind: 'approval', message: 'Os criativos serão gerados e aguardarão sua aprovação na aba Aprovações.' });
        }
        out.push({ plan: plan.id, created: r.created });
      } catch (e) {
        await this.store.logEvent({ workspace_id: plan.workspace_id, plan_id: plan.id, kind: 'failure', level: 'error', message: `Falha ao gerar o calendário: ${errText(e)}` });
        out.push({ plan: plan.id, error: errText(e) });
      }
    }
    return out;
  }

  /** A cada 5 minutos: gera mídias (até 2 por execução), agenda e aplica a regra das 2h. */
  async autopilotTick() {
    const plans = await this.activePlans();
    const byId = new Map(plans.map((p) => [p.id, p]));
    const ids = plans.map((p) => p.id);
    let media = 0;
    let rescheduled = 0;

    // 1) Mídia dos posts "idea" futuros dos planos no piloto, os mais próximos primeiro (limite baixo para não estourar a execução).
    //    Os posts das programações com IA (`automation`) são da produção antecipada (`ProductionService`), não daqui.
    const ideas = ids.length
      ? await this.prisma.ig_posts.findMany({
          where: { automation: null, plan_id: { in: ids }, status: 'idea', scheduled_at: { gt: new Date() } },
          orderBy: { scheduled_at: 'asc' },
          take: 2,
          select: { id: true, workspace_id: true, plan_id: true, scheduled_at: true },
        })
      : [];
    for (const p of ideas) {
      const plan = p.plan_id ? byId.get(p.plan_id) : undefined;
      const r = await this.mediaGen.generatePostAssets(p.workspace_id, p.id, 'auto');
      media++;
      if (!r.ok) {
        await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'failure', level: 'error', message: `Falha ao gerar a mídia: ${r.error}` });
        continue;
      }
      if ('pending' in r && r.pending) {
        await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'media', message: `Mídia em geração (${r.provider}); será concluída automaticamente.` });
        continue;
      }
      await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'media', message: `Mídia gerada (${r.provider}).` });
      if (!plan?.requires_approval) {
        try {
          await this.publishing.schedulePost(p.workspace_id, p.id, p.scheduled_at!);
          await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'schedule', message: `Agendado para ${fmtDate(p.scheduled_at!)}.` });
        } catch (e) {
          await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'failure', level: 'error', message: `Falha ao agendar: ${errText(e)}` });
        }
      }
    }


    // 2) Regra das 2h: posts sem aprovação perto do horário vão para o dia seguinte.
    const approvalPlanIds = plans.filter((p) => p.requires_approval).map((p) => p.id);
    if (approvalPlanIds.length) {
      const limit = new Date(Date.now() + 2 * 3600e3);
      const late = await this.prisma.ig_posts.findMany({
        where: { plan_id: { in: approvalPlanIds }, automation: null, status: { in: ['idea', 'generating', 'needs_review', 'pending_approval', 'ready'] }, approved_at: null, scheduled_at: { lt: limit } },
        take: 50,
        select: { id: true, workspace_id: true, plan_id: true, scheduled_at: true },
      });
      for (const p of late) {
        const base = Math.max(p.scheduled_at!.getTime(), Date.now());
        let next = p.scheduled_at!.getTime() + 86400e3;
        while (next < base + 2 * 3600e3) next += 86400e3;
        const when = new Date(next);
        await this.prisma.ig_posts.update({ where: { id: p.id }, data: { scheduled_at: when } });
        rescheduled++;
        await this.store.logEvent({
          workspace_id: p.workspace_id,
          plan_id: p.plan_id,
          post_id: p.id,
          kind: 'reschedule',
          level: 'warn',
          message: `Sem aprovação até 2h antes — reagendado para ${fmtDate(when)}.`,
        });
      }
    }
    return { media, rescheduled };
  }

  /** Chamado quando um post é aprovado: agenda sozinho se o plano está no piloto automático. */
  async afterApproval(workspaceId: string, postId: string) {
    const post = await this.prisma.ig_posts.findFirst({ where: { id: postId, workspace_id: workspaceId }, select: { plan_id: true, scheduled_at: true, automation: true } });
    if (post?.automation) {
      await this.store.logEvent({ workspace_id: workspaceId, plan_id: post.plan_id, post_id: postId, kind: 'approval', message: 'Post aprovado.' });
      await this.publishing.scheduleAutomated(postId);
      return;
    }
    if (!post?.plan_id) return;
    const plan = await this.prisma.ig_content_plans.findUnique({ where: { id: post.plan_id }, select: { auto_publish: true, status: true } });
    await this.store.logEvent({ workspace_id: workspaceId, plan_id: post.plan_id, post_id: postId, kind: 'approval', message: 'Post aprovado.' });
    if (!plan?.auto_publish || plan.status !== 'active' || !post.scheduled_at) return;
    if (post.scheduled_at.getTime() < Date.now()) return;
    await this.publishing.schedulePost(workspaceId, postId, post.scheduled_at);
    await this.store.logEvent({ workspace_id: workspaceId, plan_id: post.plan_id, post_id: postId, kind: 'schedule', message: `Agendado automaticamente para ${fmtDate(post.scheduled_at)}.` });
  }

  /** Agente de otimização: melhores horários e pesos dos pilares pelo desempenho dos últimos 14 dias. */
  async runOptimizer() {
    const since = new Date(Date.now() - 14 * 86400e3);
    const plans = await this.prisma.ig_content_plans.findMany({ where: { status: { in: ['active', 'paused'] } } });
    const out: any[] = [];
    for (const plan of plans) {
      const list = (await this.prisma.ig_posts.findMany({
        where: { plan_id: plan.id, workspace_id: plan.workspace_id, status: 'published', published_at: { gte: since } },
        select: { id: true, theme: true, caption: true, published_at: true },
      })) as PostRow[];
      if (list.length < 3) {
        out.push({ plan: plan.id, skipped: 'poucos dados' });
        continue;
      }
      const metrics = await this.prisma.ig_post_metrics.findMany({ where: { post_id: { in: list.map((p) => p.id) } }, orderBy: { collected_at: 'desc' }, select: { post_id: true, reach: true } });
      const reach = new Map<string, number>();
      for (const m of metrics) if (!reach.has(m.post_id)) reach.set(m.post_id, m.reach ?? 0);

      // Horários (fuso de São Paulo).
      const byHour = new Map<number, number[]>();
      for (const p of list) {
        const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date(p.published_at))) % 24;
        byHour.set(h, [...(byHour.get(h) ?? []), reach.get(p.id) ?? 0]);
      }
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
      const hours = [...byHour.entries()].map(([h, v]) => ({ h, avg: avg(v), n: v.length })).sort((a, b) => b.avg - a.avg);
      const topHours = hours.slice(0, 3).map((x) => `${String(x.h).padStart(2, '0')}:00`);

      // Pilares por palavra-chave.
      const pillars = (Array.isArray(plan.content_pillars) ? plan.content_pillars : []).map(pillarName).filter(Boolean);
      const scores: Record<string, number[]> = {};
      for (const name of pillars) {
        const words = name.toLowerCase().split(/\W+/).filter((w: string) => w.length > 3 && !PILLAR_STOP.has(w));
        for (const p of list) {
          const text = `${p.theme ?? ''} ${p.caption ?? ''}`.toLowerCase();
          if (words.some((w: string) => text.includes(w))) (scores[name] ??= []).push(reach.get(p.id) ?? 0);
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
                .map((x) => `${String(x.h).padStart(2, '0')}h (${Math.round(x.avg)} de alcance, ${x.n} posts)`)
                .join(', ')}.`
            : null,
          best ? `Pilar com melhor desempenho: "${best[0]}" (peso ${Math.round(best[1] * 100)}%).` : null,
          `Baseado em ${list.length} posts publicados nos últimos 14 dias.`,
        ]
          .filter(Boolean)
          .join(' '),
      };
      const notes = [...(Array.isArray(plan.ai_notes) ? plan.ai_notes : []), note].slice(-20);
      await this.prisma.ig_content_plans.update({
        where: { id: plan.id },
        data: { preferred_times: newTimes as Prisma.InputJsonValue, pillar_weights: weights, ai_notes: notes as Prisma.InputJsonValue },
      });
      await this.store.logEvent({ workspace_id: plan.workspace_id, plan_id: plan.id, kind: 'optimize', message: `Otimização semanal: ${note.summary}` });
      out.push({ plan: plan.id, ok: true });
    }
    return out;
  }
}
