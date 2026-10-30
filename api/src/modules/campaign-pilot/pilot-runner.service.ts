import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ENV } from '../../common/config/env.module';
import type { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AiError } from '../ai/ai-error';
import { CAMPAIGN_FINISHED } from '../campaigns/campaign-labels';
import { PilotRunRow, RUN_STEPS, StepName, StepState, Steps, stepsOf } from './pilot.types';

/**
 * Resultado de UMA ação de uma etapa. `again` = ainda há trabalho nesta etapa (próxima rodada); `wait` = nada a fazer por `minutes`;
 * `blocked` com `stopRun=false` marca a etapa e segue para a próxima (ex.: sem temas do Instagram, o anúncio segue). `state` = estado
 * próprio da etapa (ex.: as vagas das artes), gravado pelo runner junto com o resto, sob o mesmo lease.
 */
export type StepResult = (
  | { kind: 'done'; ref?: string | null; note?: string | null }
  | { kind: 'again' }
  | { kind: 'wait'; minutes: number }
  | { kind: 'skipped'; note: string }
  | { kind: 'blocked'; code: string; message: string; stopRun: boolean }
) & { state?: Partial<StepState> };

export interface PilotStep {
  run(run: PilotRunRow, now: Date): Promise<StepResult>;
}

export const PILOT_STEPS = Symbol('PILOT_STEPS');

const LEASE_MS = 10 * 60_000;
/** Espera depois de cada falha comum (5xx, 429, tempo): 5, 15 e 60 min; na 3ª a etapa para com o motivo. */
const BACKOFF_MIN = [5, 15, 60];
const CLAIMABLE = ['planning', 'running'];

/**
 * Executor do piloto: pega a execução com lease condicional (10 min), faz UMA ação da etapa corrente e grava o resultado só se o
 * lease ainda é nosso. Nada aqui chama a Meta para ligar verba — o módulo nem conhece esse caminho (§2.0 #1).
 */
@Injectable()
export class PilotRunnerService {
  private readonly logger = new Logger(PilotRunnerService.name);
  private readonly perTick: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    @Inject(PILOT_STEPS) private readonly steps: Record<StepName, PilotStep>,
    @Inject(ENV) env: Pick<Env, 'CAMPAIGN_PILOT_PER_TICK'>,
  ) {
    this.perTick = env.CAMPAIGN_PILOT_PER_TICK;
  }

  private due(now: Date): Prisma.campaign_pilot_runsWhereInput {
    return { status: { in: CLAIMABLE }, next_run_at: { lte: now }, OR: [{ lease_until: null }, { lease_until: { lt: now } }] };
  }

  /** Rodada do job: até `CAMPAIGN_PILOT_PER_TICK` execuções, uma por empresa, a mais atrasada primeiro. */
  async tick(now = new Date()): Promise<number> {
    const candidates = await this.prisma.campaign_pilot_runs.findMany({
      where: this.due(now), orderBy: { next_run_at: 'asc' }, take: 50, select: { id: true, workspace_id: true },
    });
    const busy = new Set<string>();
    let ran = 0;
    for (const c of candidates) {
      if (ran >= this.perTick) break;
      if (busy.has(c.workspace_id)) continue;
      if (await this.runOnce(c.id, now).catch((e) => (this.logger.error(`[piloto] ${c.id}: ${(e as Error).message}`), false))) {
        ran++;
        busy.add(c.workspace_id);
      }
    }
    return ran;
  }

  /** "Chute" depois de criar/aprovar: roda já, sem esperar o job (erros só no log). */
  kick(runId: string): void {
    setImmediate(() => {
      this.runOnce(runId).catch((e) => this.logger.error(`[piloto] chute ${runId}: ${(e as Error).message}`));
    });
  }

  /** Uma ação. `false` = não era a vez (sem lease, nada devido). */
  async runOnce(runId: string, now = new Date()): Promise<boolean> {
    const lease = new Date(now.getTime() + LEASE_MS);
    const claimed = await this.prisma.campaign_pilot_runs.updateMany({ where: { id: runId, ...this.due(now) }, data: { lease_until: lease } });
    if (claimed.count !== 1) return false;
    const run = await this.prisma.campaign_pilot_runs.findUnique({ where: { id: runId } });
    if (!run) return false;
    const steps: Steps = structuredClone(stepsOf(run));
    const save = async (data: Prisma.campaign_pilot_runsUpdateManyMutationInput) => {
      const r = await this.prisma.campaign_pilot_runs.updateMany({
        where: { id: runId, lease_until: lease },
        data: { ...data, steps: steps as unknown as Prisma.InputJsonObject, lease_until: null },
      });
      if (!r.count) this.logger.warn(`[piloto] ${runId}: lease perdido; resultado descartado`);
      return r.count === 1;
    };

    const name: StepName = run.status === 'planning' ? 'strategy' : ((run.current_step as StepName | null) ?? RUN_STEPS[0]!);
    const st: StepState = steps[name] ?? { status: 'pending', attempts: 0 };
    steps[name] = st;

    const camp = await this.prisma.campaigns.findFirst({ where: { id: run.campaign_id, workspace_id: run.workspace_id }, select: { status: true } });
    if (!camp || camp.status === CAMPAIGN_FINISHED) {
      st.note = 'Campanha encerrada: o estrategista parou.';
      await save({ status: 'cancelled', next_run_at: null });
      return true;
    }

    st.started_at ??= now.toISOString();
    let res: StepResult;
    try {
      res = await this.steps[name].run(run, now);
    } catch (e) {
      return this.onError(e, st, now, save);
    }
    if (res.state) Object.assign(st, res.state);
    st.error = res.kind === 'blocked' ? res.message : null;
    st.error_code = res.kind === 'blocked' ? res.code : null;

    if (res.kind === 'again') {
      st.status = 'running';
      return save({ next_run_at: now });
    }
    if (res.kind === 'wait') {
      st.status = 'waiting';
      return save({ next_run_at: new Date(now.getTime() + res.minutes * 60_000) });
    }
    if (res.kind === 'blocked' && res.stopRun) {
      st.status = 'blocked';
      return save({ status: 'blocked', next_run_at: null });
    }
    // done | skipped | blocked que não para: a etapa termina e a próxima entra na rodada seguinte.
    st.status = res.kind === 'done' ? 'done' : res.kind === 'skipped' ? 'skipped' : 'blocked';
    st.finished_at = now.toISOString();
    st.attempts = 0;
    if (res.kind === 'done') st.ref = res.ref ?? st.ref ?? null;
    if (res.kind === 'done' || res.kind === 'skipped') st.note = res.note ?? null;

    if (name === 'strategy') return save({ strategy_version: Number(st.ref), next_run_at: null });
    const next = RUN_STEPS[RUN_STEPS.indexOf(name) + 1];
    if (next) {
      steps[next] ??= { status: 'pending', attempts: 0 };
      return save({ current_step: next, next_run_at: now });
    }
    const ok = await save({ status: 'done', next_run_at: null });
    if (ok) await this.activity.log(run.workspace_id, null, 'campaign.pilot_done', 'campaign', { campaign_id: run.campaign_id, via: 'pilot', run_id: run.id });
    return ok;
  }

  private async onError(e: unknown, st: StepState, now: Date, save: (d: Prisma.campaign_pilot_runsUpdateManyMutationInput) => Promise<boolean>) {
    const message = (e instanceof AiError ? (e.getResponse() as { message?: string }).message : (e as Error)?.message) || 'Erro inesperado.';
    const code = e instanceof AiError ? (e.getResponse() as { code?: string }).code : undefined;
    if (code === 'AI_NOT_CONFIGURED' || message.startsWith('Créditos de IA esgotados')) {
      Object.assign(st, { status: 'blocked', error_code: code === 'AI_NOT_CONFIGURED' ? 'AI_NOT_CONFIGURED' : 'AI_NO_CREDITS', error: message });
      return save({ status: 'blocked', next_run_at: null });
    }
    st.attempts = (st.attempts ?? 0) + 1;
    st.error = message;
    st.error_code = 'STEP_FAILED';
    if (st.attempts >= BACKOFF_MIN.length) {
      st.status = 'failed';
      st.finished_at = now.toISOString();
      return save({ status: 'failed', next_run_at: null });
    }
    st.status = 'pending';
    return save({ next_run_at: new Date(now.getTime() + BACKOFF_MIN[st.attempts - 1]! * 60_000) });
  }
}
