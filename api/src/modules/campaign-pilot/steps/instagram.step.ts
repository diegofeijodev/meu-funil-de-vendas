import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { OBJECTIVES } from '../../campaigns/campaign-labels';
import { AutoCalendarService } from '../../instagram/auto-calendar.service';
import { todaySP } from '../../instagram/slots';
import { UserError } from '../../media/user-error';
import { StrategistService } from '../../strategist/strategist.service';
import type { PilotStep, StepResult } from '../pilot-runner.service';
import { optionsOf, type PilotRunRow } from '../pilot.types';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const NO_IG_PLAN = 'O plano veio sem os temas do Instagram, então os posts não foram programados. O anúncio segue normal.';

/**
 * Programação do Instagram do período da campanha. O piloto só CRIA a programação: produção, revisão e publicação continuam as de
 * 05/10 (post reprovado nunca sai sozinho). Sem temas ou com a programação recusada, marca a etapa e segue para as artes.
 */
@Injectable()
export class InstagramStep implements PilotStep {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategist: StrategistService,
    private readonly autoCalendar: AutoCalendarService,
  ) {}

  async run(run: PilotRunRow, now: Date): Promise<StepResult> {
    const ig = optionsOf(run).instagram;
    if (!ig?.enabled) return { kind: 'skipped', note: 'Instagram desligado no pacote.' };
    const ws = run.workspace_id;
    const existing = await this.prisma.ig_auto_runs.findFirst({
      where: { workspace_id: ws, campaign_id: run.campaign_id, ...(run.approved_at ? { created_at: { gte: run.approved_at } } : {}) },
      select: { id: true },
    });
    if (existing) return { kind: 'done', ref: existing.id, note: 'Programação já criada.' };
    const c = await this.prisma.campaigns.findFirst({ where: { id: run.campaign_id, workspace_id: ws } });
    if (!c) return { kind: 'skipped', note: 'Campanha não encontrada.' };
    const endDate = day(c.end_date);
    if (!endDate) return { kind: 'blocked', code: 'IG_NOT_SCHEDULED', message: 'A campanha não tem data de fim, então os posts não foram programados.', stopRun: false };

    const plan = await this.strategist.createIgPlanAsSystem(ws, c.id);
    if ('error' in plan) {
      if (plan.error === 'NO_IG_PLAN') return { kind: 'blocked', code: 'NO_IG_PLAN', message: NO_IG_PLAN, stopRun: false };
      return { kind: 'blocked', code: 'IG_NOT_SCHEDULED', message: 'Não deu para criar o plano do Instagram desta campanha.', stopRun: false };
    }
    const today = todaySP(now.getTime());
    const start = day(c.start_date);
    try {
      const r = await this.autoCalendar.createAutoRun(ws, run.approved_by ?? run.created_by, {
        planId: plan.planId, campaignId: c.id, brandId: c.brand_id, mode: ig.mode,
        startDate: start && start > today ? start : today, endDate,
        weekdays: ig.weekdays, times: ig.times, storyTimes: ig.story_times, formats: ig.formats, focus: focusOf(c),
      });
      return { kind: 'done', ref: r.runId, note: `${r.total} posts até ${ddmm(endDate)}` };
    } catch (e) {
      if (e instanceof UserError) return { kind: 'blocked', code: 'IG_NOT_SCHEDULED', message: (e.getResponse() as { message: string }).message, stopRun: false };
      throw e;
    }
  }
}

/** Objetivo do período (a programação exige ≥ 30 letras): objetivo + oferta da campanha, completado com o nome dela. */
function focusOf(c: { objective: string; offer_product: string | null; offer_promise: string | null; name: string }): string {
  const offer = [c.offer_product, c.offer_promise].filter(Boolean).join(' — ');
  let f = `${OBJECTIVES[c.objective] ?? c.objective}${offer ? `: ${offer}` : ''}`;
  if (f.length < 30) f += ` · Campanha ${c.name}`;
  if (f.length < 30) f += ' · Instagram da campanha';
  return f;
}
