import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ENV } from '../../common/config/env.module';
import type { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { ActivityService } from '../activity/activity.service';
import { CAMPAIGN_FINISHED } from '../campaigns/campaign-labels';
import { pilotSummary } from '../campaigns/pilot-summary';
import { AutoCalendarService } from '../instagram/auto-calendar.service';
import { computeSlots, todaySP } from '../instagram/slots';
import { StrategistService } from '../strategist/strategist.service';
import { PilotGate } from './pilot-gate';
import { estimatePilot, suggestedOptions } from './pilot-estimate';
import { PilotRunnerService } from './pilot-runner.service';
import { optionsOf, PilotOptions, PilotRunRow, RUN_STEPS, StepName, Steps, stepsOf } from './pilot.types';
import { spentCredits } from './steps/creatives.step';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
const conflict = (message = 'Não dá para fazer isso agora.') => new ConflictException({ code: 'CONFLICT', message });
const ACTIVE = ['planning', 'running', 'blocked'];
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export type Blocker = { code: string; message: string; action: string };

/** API do piloto (contrato §29): criar, ver, estimar, aprovar, retomar e parar. O trabalho em si é do `PilotRunnerService`. */
@Injectable()
export class PilotService {
  private readonly maxCreatives: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly gate: PilotGate,
    private readonly strategist: StrategistService,
    private readonly runner: PilotRunnerService,
    private readonly autoCalendar: AutoCalendarService,
    private readonly activity: ActivityService,
    @Inject(ENV) env: Pick<Env, 'CAMPAIGN_PILOT_MAX_CREATIVES'>,
  ) {
    this.maxCreatives = env.CAMPAIGN_PILOT_MAX_CREATIVES;
  }

  /** Portão antes do acesso (fora da lista = a função não existe para a empresa), depois o papel, depois a campanha da empresa. */
  private async enter(userId: string, ws: string, campaignId: string, level: 'read' | 'write') {
    if (!this.gate.enabled(ws)) throw notFound();
    await this.access.require(userId, ws, level);
    const campaign = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: ws } });
    if (!campaign) throw notFound();
    return campaign;
  }

  private async runOf(ws: string, campaignId: string, runId: string): Promise<PilotRunRow> {
    const run = await this.prisma.campaign_pilot_runs.findFirst({ where: { id: runId, workspace_id: ws, campaign_id: campaignId } });
    if (!run) throw notFound();
    return run;
  }

  async create(userId: string, ws: string, campaignId: string, key: string) {
    const c = await this.enter(userId, ws, campaignId, 'write');
    const same = await this.prisma.campaign_pilot_runs.findFirst({ where: { workspace_id: ws, idempotency_key: key } });
    if (same) {
      if (same.campaign_id !== c.id) throw conflict('Esta chave já foi usada em outra campanha.');
      return this.view(same);
    }
    if (c.status === CAMPAIGN_FINISHED) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Campanha encerrada.' });
    const active = await this.prisma.campaign_pilot_runs.findFirst({ where: { campaign_id: c.id, workspace_id: ws, status: { in: ACTIVE } }, select: { id: true } });
    if (active) throw conflict('O estrategista já está trabalhando nesta campanha.');
    let run: PilotRunRow;
    try {
      run = await this.prisma.campaign_pilot_runs.create({
        data: {
          workspace_id: ws, campaign_id: c.id, created_by: userId, idempotency_key: key, status: 'planning', current_step: 'strategy',
          steps: { strategy: { status: 'pending', attempts: 0 } }, next_run_at: new Date(),
        },
      });
    } catch (e) {
      // Corrida entre dois cliques: o índice "1 ativo por campanha" / a chave única decide.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.campaign_pilot_runs.findFirst({ where: { workspace_id: ws, idempotency_key: key } });
        if (again?.campaign_id === c.id) return this.view(again);
        throw conflict('O estrategista já está trabalhando nesta campanha.');
      }
      throw e;
    }
    this.runner.kick(run.id);
    return this.view(run);
  }

  async get(userId: string, ws: string, campaignId: string) {
    const c = await this.enter(userId, ws, campaignId, 'read');
    const run = await this.prisma.campaign_pilot_runs.findFirst({ where: { campaign_id: c.id, workspace_id: ws }, orderBy: { created_at: 'desc' } });
    return { run: run ? await this.view(run) : null };
  }

  async estimate(userId: string, ws: string, campaignId: string, options: PilotOptions) {
    const c = await this.enter(userId, ws, campaignId, 'write');
    return this.estimateFor(c, options);
  }

  private async estimateFor(c: Prisma.campaignsGetPayload<object>, options: PilotOptions) {
    const blockers: Blocker[] = [];
    if (!c.brand_id) blockers.push({ code: 'NO_BRAND', message: 'Escolha a marca da campanha antes de começar.', action: 'edit_campaign' });
    if (c.status === CAMPAIGN_FINISHED) blockers.push({ code: 'CAMPAIGN_ENDED', message: 'Campanha encerrada.', action: 'none' });
    const end = day(c.end_date);
    let igSlots: { format: PilotOptions['instagram']['formats'][number] }[] | null = null;
    if (options.instagram.enabled && end) {
      const today = todaySP();
      const start = day(c.start_date);
      const ig = options.instagram;
      igSlots = computeSlots({ startDate: start && start > today ? start : today, endDate: end, weekdays: ig.weekdays, times: ig.times, storyTimes: ig.story_times, formats: ig.formats }).slots;
    }
    return { estimate: estimatePilot(options, igSlots ? { slots: igSlots } : null), blockers, can_approve: blockers.length === 0 };
  }

  async approve(userId: string, ws: string, campaignId: string, runId: string, body: { strategy_version: number; options: PilotOptions }, now = new Date()) {
    const c = await this.enter(userId, ws, campaignId, 'write');
    const run = await this.runOf(ws, c.id, runId);
    if (run.status !== 'planning' || stepsOf(run).strategy?.status !== 'done') throw conflict('O plano ainda está sendo montado.');
    const latest = await this.strategist.latestVersion(ws, c.id);
    if (body.strategy_version !== latest) throw new ConflictException({ code: 'STRATEGY_CHANGED', message: 'A estratégia mudou. Confira o plano de novo.' });
    const o = body.options;
    if (o.max_angles * o.images_per_angle + o.videos > this.maxCreatives) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: `No máximo ${this.maxCreatives} peças por campanha.` });
    }
    const { estimate, blockers } = await this.estimateFor(c, o);
    if (blockers.length) throw new BadRequestException({ code: blockers[0]!.code, message: blockers[0]!.message });
    await this.strategist.approveVersion(ws, c.id, body.strategy_version, userId);
    const steps: Steps = { ...stepsOf(run) };
    for (const s of RUN_STEPS) steps[s] = { status: 'pending', attempts: 0 };
    const upd = await this.prisma.campaign_pilot_runs.updateMany({
      where: { id: run.id, workspace_id: ws, status: 'planning' },
      data: {
        status: 'running', current_step: RUN_STEPS[0], options: o as unknown as Prisma.InputJsonObject, steps: steps as unknown as Prisma.InputJsonObject,
        strategy_version: body.strategy_version, max_credits: o.max_credits, estimated_credits: estimate.total, approved_by: userId, approved_at: now, next_run_at: now,
      },
    });
    if (!upd.count) throw conflict('O plano ainda está sendo montado.');
    await this.activity.log(ws, userId, 'campaign.pilot_started', 'campaign', { campaign_id: c.id, via: 'pilot', run_id: run.id });
    this.runner.kick(run.id);
    return this.view((await this.runOf(ws, c.id, run.id)));
  }

  async resume(userId: string, ws: string, campaignId: string, runId: string, body: { action: 'retry' | 'proceed_partial' | 'raise_cap'; max_credits?: number }, now = new Date()) {
    const c = await this.enter(userId, ws, campaignId, 'write');
    const run = await this.runOf(ws, c.id, runId);
    if (run.status !== 'blocked' && run.status !== 'failed') throw conflict();
    const name = (run.current_step ?? 'strategy') as StepName;
    const steps: Steps = structuredClone(stepsOf(run));
    const st = steps[name];
    if (!st) throw conflict();
    const data: Prisma.campaign_pilot_runsUpdateManyMutationInput = { status: name === 'strategy' ? 'planning' : 'running', next_run_at: now, lease_until: null };

    if (body.action === 'retry') {
      Object.assign(st, { status: 'pending', attempts: 0, error: null, error_code: null });
      st.slots?.forEach((s) => { if (s.status === 'failed') Object.assign(s, { status: 'pending', error: null }); });
    } else if (body.action === 'proceed_partial') {
      const done = st.slots?.filter((s) => s.status === 'done').length ?? 0;
      if (name !== 'creatives' || st.error_code !== 'COST_CAP' || !done) throw conflict();
      st.slots!.forEach((s) => { if (s.status === 'pending') s.status = 'skipped'; });
      Object.assign(st, { status: 'running', error: null, error_code: null });
    } else {
      const current = Number(run.max_credits ?? optionsOf(run).max_credits);
      if (st.error_code !== 'COST_CAP' || !body.max_credits || body.max_credits <= current) throw conflict();
      data.max_credits = body.max_credits;
      Object.assign(st, { status: 'pending', error: null, error_code: null });
    }
    data.steps = steps as unknown as Prisma.InputJsonObject;
    const upd = await this.prisma.campaign_pilot_runs.updateMany({ where: { id: run.id, workspace_id: ws, status: run.status }, data });
    if (!upd.count) throw conflict();
    await this.activity.log(ws, userId, 'campaign.pilot_resumed', 'campaign', { campaign_id: c.id, via: 'pilot', run_id: run.id, action: body.action });
    this.runner.kick(run.id);
    return this.view(await this.runOf(ws, c.id, run.id));
  }

  async cancel(userId: string, ws: string, campaignId: string, runId: string, body: { cancel_instagram: boolean }) {
    const c = await this.enter(userId, ws, campaignId, 'write');
    const run = await this.runOf(ws, c.id, runId);
    if (!ACTIVE.includes(run.status)) throw conflict();
    const upd = await this.prisma.campaign_pilot_runs.updateMany({
      where: { id: run.id, workspace_id: ws, status: { in: ACTIVE } }, data: { status: 'cancelled', lease_until: null, next_run_at: null },
    });
    if (!upd.count) throw conflict();
    const igRun = stepsOf(run).instagram?.ref;
    if (body.cancel_instagram && igRun) await this.autoCalendar.cancelAutoRun(ws, igRun);
    await this.activity.log(ws, userId, 'campaign.pilot_cancelled', 'campaign', { campaign_id: c.id, via: 'pilot', run_id: run.id, cancel_instagram: body.cancel_instagram });
    return this.view(await this.runOf(ws, c.id, run.id));
  }

  /** `PilotRunView` (§29): a linha + gasto derivado, resumo e, com o plano pronto, o pacote sugerido. */
  private async view(run: PilotRunRow) {
    const steps = stepsOf(run);
    const slots = steps.creatives?.slots ?? [];
    const jobIds = slots.map((s) => s.job_id).filter(Boolean) as string[];
    const jobs = jobIds.length
      ? await this.prisma.creative_generation_jobs.findMany({ where: { id: { in: jobIds }, workspace_id: run.workspace_id }, select: { id: true, actual_cost: true, estimated_cost: true } })
      : [];
    const planReady = run.status === 'planning' && steps.strategy?.status === 'done';
    return {
      id: run.id, status: run.status, current_step: run.current_step, steps, options: run.options, strategy_version: run.strategy_version,
      approved_at: run.approved_at, approved_by: run.approved_by, created_at: run.created_at,
      estimated_credits: run.estimated_credits == null ? null : Number(run.estimated_credits), max_credits: run.max_credits == null ? null : Number(run.max_credits),
      spent_credits: spentCredits(slots, jobs), summary: pilotSummary(run),
      suggested_options: planReady ? suggestedOptions(await this.strategist.currentStrategy(run.workspace_id, run.campaign_id), this.maxCreatives) : null,
    };
  }
}
