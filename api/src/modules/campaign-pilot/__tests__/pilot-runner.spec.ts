import { AiError } from '../../ai/ai-error';
import { PilotRunnerService, PilotStep, StepResult } from '../pilot-runner.service';
import { StrategyStep } from '../steps/strategy.step';
import { min, OWNER, pilotDb, rowOf, seedRun, T0, WS_A, WS_B } from './world';

type Fn = (run: any, now: Date) => Promise<StepResult>;
const step = (fn: Fn): PilotStep & { calls: number } => {
  const s = { calls: 0, run: async (run: any, now: Date) => { s.calls++; return fn(run, now); } };
  return s;
};
const done: Fn = async () => ({ kind: 'done' });

function setup(over: Partial<Record<string, PilotStep>> = {}, perTick = 2, allowed: string[] = [WS_A, WS_B]) {
  const db = pilotDb();
  const strategist = { generateAsSystem: jest.fn(async () => ({ version: 3, content: {} })) };
  const steps: any = {
    strategy: new StrategyStep(db.prisma, strategist as any),
    copies: step(done), instagram: step(done), creatives: step(done), meta: step(async () => ({ kind: 'skipped', note: 'x' })),
    ...over,
  };
  const gate = { enabled: (ws: string) => allowed.includes(ws) };
  const runner = new PilotRunnerService(db.prisma, db.activity, steps, gate as any, { CAMPAIGN_PILOT_PER_TICK: perTick } as any);
  return { db, runner, steps, strategist };
}
const running = (extra: Record<string, unknown> = {}) => ({
  status: 'running', current_step: 'copies', approved_at: min(-1), approved_by: OWNER,
  steps: { strategy: { status: 'done', attempts: 0 }, copies: { status: 'pending', attempts: 0 }, instagram: { status: 'pending', attempts: 0 }, creatives: { status: 'pending', attempts: 0 }, meta: { status: 'pending', attempts: 0 } },
  ...extra,
});

describe('PilotRunnerService', () => {
  it('planning: gera a estratégia, grava strategy_version e para esperando aprovação', async () => {
    const { db, runner, strategist } = setup();
    const { run } = await seedRun(db, { steps: { strategy: { status: 'pending', attempts: 0 } } });
    expect(await runner.runOnce(run.id, T0)).toBe(true);
    const r = rowOf(db, run.id);
    expect(strategist.generateAsSystem).toHaveBeenCalledWith(WS_A, run.campaign_id);
    expect([r.status, r.strategy_version, r.next_run_at, r.lease_until]).toEqual(['planning', 3, null, null]);
    expect(r.steps.strategy).toMatchObject({ status: 'done', ref: '3', started_at: T0.toISOString(), finished_at: T0.toISOString() });
    expect(await runner.runOnce(run.id, min(5))).toBe(false); // sem next_run_at: espera o "Aprovar"
  });

  it('estratégia já gravada depois de a execução nascer conta como feita (não gera de novo)', async () => {
    const { db, runner, strategist } = setup();
    const { run, campaign } = await seedRun(db);
    await db.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: 2, created_at: T0 } });
    await runner.runOnce(run.id, T0);
    expect(strategist.generateAsSystem).not.toHaveBeenCalled();
    expect(rowOf(db, run.id).strategy_version).toBe(2);
  });

  it('duas rodadas ao mesmo tempo: só uma faz a ação', async () => {
    let release!: () => void;
    const slow = step(() => new Promise((res) => { release = () => res({ kind: 'done' }); }));
    const { db, runner } = setup({ copies: slow });
    const { run } = await seedRun(db, running());
    const a = runner.runOnce(run.id, T0);
    const b = runner.runOnce(run.id, T0);
    expect(await b).toBe(false);
    await new Promise((r) => setImmediate(r));
    release();
    expect(await a).toBe(true);
    expect(slow.calls).toBe(1);
    expect(rowOf(db, run.id).current_step).toBe('instagram');
  });

  it('lease perdido: o resultado atrasado não grava', async () => {
    let release!: () => void;
    let first = true;
    const slow = step(() => (first ? ((first = false), new Promise((res) => { release = () => res({ kind: 'done', note: 'atrasado' }); })) : Promise.resolve({ kind: 'again' } as StepResult)));
    const { db, runner } = setup({ copies: slow });
    const { run } = await seedRun(db, running());
    const late = runner.runOnce(run.id, T0);
    await new Promise((r) => setImmediate(r));
    expect(await runner.runOnce(run.id, min(11))).toBe(true); // lease de 10 min venceu: outra rodada pega
    release();
    await late;
    const r = rowOf(db, run.id);
    expect(r.current_step).toBe('copies');
    expect(r.steps.copies.note ?? null).not.toBe('atrasado');
  });

  it('campanha encerrada vira cancelled sem chamar a etapa', async () => {
    const { db, runner, steps } = setup();
    const { run, campaign } = await seedRun(db, running());
    await db.t.campaigns.update({ where: { id: campaign.id }, data: { status: 'finished' } });
    await runner.runOnce(run.id, T0);
    expect([rowOf(db, run.id).status, rowOf(db, run.id).next_run_at]).toEqual(['cancelled', null]);
    expect(steps.copies.calls).toBe(0);
  });

  it('erro comum: espera 5, 15 e 60 min e só na 4ª falha seguida vira failed', async () => {
    const boom = step(async () => { throw new Error('Meta fora do ar'); });
    const { db, runner } = setup({ copies: boom });
    const { run } = await seedRun(db, running());
    await runner.runOnce(run.id, T0);
    expect(rowOf(db, run.id).next_run_at).toEqual(min(5));
    expect(rowOf(db, run.id).steps.copies).toMatchObject({ status: 'pending', attempts: 1, error: 'Meta fora do ar' });
    await runner.runOnce(run.id, min(5));
    expect(rowOf(db, run.id).next_run_at).toEqual(min(20));
    await runner.runOnce(run.id, min(20));
    expect(rowOf(db, run.id).next_run_at).toEqual(min(80));
    await runner.runOnce(run.id, min(80));
    const r = rowOf(db, run.id);
    expect([r.status, r.next_run_at, r.steps.copies.status, r.steps.copies.attempts]).toEqual(['failed', null, 'failed', 4]);
  });

  it('falhas alternadas com sucessos não se acumulam (cada ação que deu certo zera as tentativas)', async () => {
    const seq: (StepResult | Error)[] = [new Error('429'), { kind: 'again' }, new Error('429'), { kind: 'again' }, new Error('429'), { kind: 'again' }, new Error('429'), { kind: 'done' }];
    const flaky = step(async () => { const x = seq.shift()!; if (x instanceof Error) throw x; return x; });
    const { db, runner } = setup({ copies: flaky });
    const { run } = await seedRun(db, running());
    for (let t = 0; t < 2000 && seq.length; t += 100) await runner.runOnce(run.id, min(t));
    expect([rowOf(db, run.id).status, rowOf(db, run.id).current_step]).toEqual(['running', 'instagram']);
  });

  it('empresa fora da lista do piloto não roda (nem pelo job, nem pelo chute)', async () => {
    const { db, runner, steps } = setup({}, 2, [WS_B]);
    const { run } = await seedRun(db, running());
    expect(await runner.runOnce(run.id, T0)).toBe(false);
    expect(await runner.tick(T0)).toBe(0);
    expect(steps.copies.calls).toBe(0);
    expect(rowOf(db, run.id).lease_until).toBeNull();
  });

  it('parado entre o claim e a leitura: não roda a etapa', async () => {
    const { db, runner, steps } = setup();
    const { run } = await seedRun(db, running());
    const orig = db.t.campaign_pilot_runs.findUnique.bind(db.t.campaign_pilot_runs);
    db.t.campaign_pilot_runs.findUnique = async (a: any) => { Object.assign(rowOf(db, run.id), { status: 'cancelled' }); return orig(a); };
    expect(await runner.runOnce(run.id, T0)).toBe(false);
    expect(steps.copies.calls).toBe(0);
  });

  it('AI_NOT_CONFIGURED bloqueia a execução sem nova tentativa; créditos esgotados idem', async () => {
    const { db, runner } = setup({ copies: step(async () => { throw new AiError('Configure a IA.', 'AI_NOT_CONFIGURED'); }) });
    const { run } = await seedRun(db, running());
    await runner.runOnce(run.id, T0);
    expect([rowOf(db, run.id).status, rowOf(db, run.id).steps.copies.error_code]).toEqual(['blocked', 'AI_NOT_CONFIGURED']);
    const s2 = setup({ copies: step(async () => { throw new AiError('Créditos de IA esgotados. Conecte sua chave.'); }) });
    const { run: r2 } = await seedRun(s2.db, running());
    await s2.runner.runOnce(r2.id, T0);
    expect([rowOf(s2.db, r2.id).status, rowOf(s2.db, r2.id).steps.copies.error_code]).toEqual(['blocked', 'AI_NO_CREDITS']);
  });

  it('passa pelas etapas em ordem; bloqueio que não para segue; no fim done com atividade', async () => {
    const { db, runner } = setup({ instagram: step(async () => ({ kind: 'blocked', code: 'NO_IG_PLAN', message: 'sem temas', stopRun: false })) });
    const { run } = await seedRun(db, running());
    for (const m of [0, 5, 10, 15]) await runner.runOnce(run.id, min(m));
    const r = rowOf(db, run.id);
    expect(r.status).toBe('done');
    expect(r.steps.instagram).toMatchObject({ status: 'blocked', error_code: 'NO_IG_PLAN', error: 'sem temas' });
    expect(r.steps.meta.status).toBe('skipped');
    expect(db.logs).toEqual([[WS_A, null, 'campaign.pilot_done', 'campaign', { campaign_id: run.campaign_id, via: 'pilot', run_id: run.id }]]);
  });

  it('again / wait / estado da etapa (slots) gravados pelo runner', async () => {
    const seq: StepResult[] = [{ kind: 'again', state: { slots: [{ slot: 1, kind: 'image', angle: 'A', status: 'pending' }] } }, { kind: 'wait', minutes: 5 }];
    const { db, runner } = setup({ copies: step(async () => seq.shift()!) });
    const { run } = await seedRun(db, running());
    await runner.runOnce(run.id, T0);
    expect(rowOf(db, run.id).steps.copies).toMatchObject({ status: 'running', slots: [{ slot: 1 }] });
    expect(rowOf(db, run.id).next_run_at).toEqual(T0);
    await runner.runOnce(run.id, T0);
    expect(rowOf(db, run.id).steps.copies.status).toBe('waiting');
    expect(rowOf(db, run.id).next_run_at).toEqual(min(5));
  });

  it('tick: no máximo PER_TICK execuções e uma por empresa', async () => {
    const { db, runner } = setup({}, 2);
    await seedRun(db, running());
    await seedRun(db, running());
    await seedRun(db, running(), WS_B);
    expect(await runner.tick(T0)).toBe(2);
    const moved = db.t.campaign_pilot_runs.rows.filter((r: any) => r.current_step === 'instagram').map((r: any) => r.workspace_id).sort();
    expect(moved).toEqual([WS_A, WS_B].sort());
  });
});

describe('PilotRunnerService × parar no meio', () => {
  it('execução cancelada enquanto a ação roda: o resultado não grava', async () => {
    let release!: () => void;
    const slow = step(() => new Promise((res) => { release = () => res({ kind: 'done' }); }));
    const { db, runner } = setup({ copies: slow });
    const { run } = await seedRun(db, running());
    const p = runner.runOnce(run.id, T0);
    await new Promise((r) => setImmediate(r));
    Object.assign(rowOf(db, run.id), { status: 'cancelled', next_run_at: null });
    release();
    await p;
    expect([rowOf(db, run.id).status, rowOf(db, run.id).current_step]).toEqual(['cancelled', 'copies']);
  });
});

describe('fronteira (§2.0 #1)', () => {
  it('nenhum arquivo do piloto importa o caminho que liga verba na Meta', () => {
    const { readdirSync, readFileSync, statSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p); } else if (p.endsWith('.ts')) files.push(p); } };
    walk(join(__dirname, '..'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect([f, /setStatus|setDeliveryStatus|meta-ads\.service|meta-ops\.service/.test(readFileSync(f, 'utf8'))]).toEqual([f, false]);
  });
});

