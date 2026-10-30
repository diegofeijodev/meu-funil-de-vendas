import { CreativesStep, spentCredits } from '../steps/creatives.step';
import type { PilotOptions, Slot } from '../pilot.types';
import { min, OWNER, pilotDb, seedRun, T0, WS_A } from './world';

const OPTIONS: PilotOptions = {
  max_angles: 3, images_per_angle: 2, variations: 3, videos: 1,
  instagram: { enabled: false, mode: 'approval', weekdays: [1], times: ['11:00'], story_times: [], formats: ['feed_image'] },
  meta: { enabled: true, review_creatives: false }, max_credits: 48,
};

async function world(opt: Partial<PilotOptions> = {}) {
  const db = pilotDb();
  const { run, campaign } = await seedRun(db, { status: 'running', current_step: 'creatives', approved_at: min(-1), approved_by: OWNER, options: { ...OPTIONS, ...opt }, max_credits: opt.max_credits ?? 48 });
  Object.assign(db.t.campaigns.rows[0]!, { brand_id: 'brand-1' });
  const strategist = { currentStrategy: jest.fn(async () => ({ angulos_detalhados: [{ nome: 'Falta de gente' }, { nome: 'Rapidez' }, { nome: 'Sem custo' }, { nome: 'Extra' }] })) };
  let n = 0;
  const outcome: { next: (dto: any) => any } = {
    next: (dto) => (dto.type === 'reels' ? { status: 'generating', creativeId: null } : { status: 'ready', creativeId: null, score: 41 }),
  };
  const creative = {
    generateAsSystem: jest.fn(async (dto: any, _actor: string, _via: any) => {
      n++;
      const o = outcome.next(dto);
      const job = await db.t.creative_generation_jobs.create({ data: { workspace_id: WS_A, status: o.status === 'generating' ? 'generating' : o.status, estimated_cost: dto.type === 'reels' ? 6 : 4.5, actual_cost: o.status === 'ready' ? 4.5 : null, creative_id: null } });
      let creativeId: string | null = null;
      if (o.status === 'ready') {
        const cr = await db.t.creatives.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, extras: {} } });
        creativeId = cr.id;
        job.creative_id = cr.id;
      }
      return { jobId: job.id, creativeId, status: o.status, error: o.status === 'failed' ? 'provedor caiu' : null, variations: o.score ? [{ winner: false, score: { total: 20 } }, { winner: true, score: { total: o.score } }] : [] };
    }),
  };
  const step = new CreativesStep(db.prisma, strategist as any, creative as any);
  const current = () => db.t.campaign_pilot_runs.rows[0]! as any;
  /** Simula o runner: grava o `state` devolvido nas vagas da etapa. */
  const tick = async (now = T0) => {
    const r = await step.run(current(), now);
    if (r.state?.slots) current().steps = { ...current().steps, creatives: { ...(current().steps.creatives ?? {}), status: 'running', attempts: 0, slots: r.state.slots } };
    return r;
  };
  return { db, run, campaign, step, creative, outcome, tick, current, calls: () => n };
}
const slotsOf = (w: any): Slot[] => w.current().steps.creatives.slots;

describe('etapa creatives', () => {
  it('monta 3 jeitos × 2 imagens + 1 vídeo e gera uma peça por rodada', async () => {
    const w = await world();
    expect((await w.tick()).kind).toBe('again');
    expect(slotsOf(w).map((s) => [s.slot, s.kind, s.angle, s.status])).toEqual([
      [1, 'image', 'Falta de gente', 'pending'], [2, 'image', 'Falta de gente', 'pending'], [3, 'image', 'Rapidez', 'pending'],
      [4, 'image', 'Rapidez', 'pending'], [5, 'image', 'Sem custo', 'pending'], [6, 'image', 'Sem custo', 'pending'], [7, 'video', 'Falta de gente', 'pending'],
    ]);
    expect(w.calls()).toBe(0);
    expect((await w.tick()).kind).toBe('again');
    expect(w.calls()).toBe(1);
    const [dto, actor, via] = w.creative.generateAsSystem.mock.calls[0] as any[];
    expect(dto).toMatchObject({ workspaceId: WS_A, campaignId: w.campaign.id, brandId: 'brand-1', type: 'static_image', aspectRatio: '4:5', angle: 'Falta de gente', variations: 3, provider: 'auto', title: 'Jundiaí · Falta de gente' });
    expect([actor, via]).toEqual([OWNER, { runId: w.run.id }]);
    expect(slotsOf(w)[0]).toMatchObject({ status: 'done', score: 41 });
  });

  it('teto: para em COST_CAP antes de gastar a peça que estoura', async () => {
    const w = await world({ max_credits: 10 } as any);
    w.current().max_credits = 10;
    await w.tick(); // monta
    await w.tick(); // 1ª imagem: 0 + 6 ≤ 10 (custo real 4,5)
    const r = await w.tick(); // 4,5 + 6 > 10
    expect(r).toMatchObject({ kind: 'blocked', code: 'COST_CAP', stopRun: true, message: 'Chegamos ao teto de 10 créditos com 1 de 7 artes prontas.' });
    expect(w.calls()).toBe(1);
  });

  it('vídeo: waiting até o job ficar pronto; a proveniência preserva legendas e capa', async () => {
    const w = await world({ max_angles: 1, images_per_angle: 1, videos: 1 });
    await w.tick();
    await w.tick(); // imagem
    expect((await w.tick()).kind).toBe('wait'); // vídeo gerando
    expect(slotsOf(w)[1]).toMatchObject({ kind: 'video', status: 'waiting' });
    expect((await w.tick()).kind).toBe('wait'); // ainda gerando
    const job = w.db.t.creative_generation_jobs.rows.find((j: any) => j.status === 'generating')!;
    const cr = await w.db.t.creatives.create({ data: { workspace_id: WS_A, campaign_id: w.campaign.id, extras: { captions_srt: 's.srt', cover_url: 'c.jpg' } } });
    Object.assign(job, { status: 'ready', creative_id: cr.id, actual_cost: 6 });
    expect(await w.tick()).toMatchObject({ kind: 'done', note: '2 de 2 prontas' });
    expect(w.db.t.creatives.rows.find((c: any) => c.id === cr.id)!.extras).toEqual({ captions_srt: 's.srt', cover_url: 'c.jpg', pilot: { run_id: w.run.id, slot: 2, score: null } });
  });

  it('peça que falha não para as outras; todas falharam = NO_CREATIVE_MADE', async () => {
    const w = await world({ max_angles: 1, images_per_angle: 2, videos: 0 });
    let first = true;
    w.outcome.next = () => (first ? ((first = false), { status: 'failed' }) : { status: 'ready', score: 30 });
    await w.tick();
    await w.tick();
    expect(slotsOf(w)[0]).toMatchObject({ status: 'failed', error: 'provedor caiu' });
    expect(await w.tick()).toMatchObject({ kind: 'done', note: '1 de 2 prontas' });
    const z = await world({ max_angles: 1, images_per_angle: 1, videos: 0 });
    z.outcome.next = () => ({ status: 'failed' });
    await z.tick();
    expect(await z.tick()).toMatchObject({ kind: 'blocked', code: 'NO_CREATIVE_MADE', stopRun: true, message: 'Nenhuma arte ficou pronta.' });
  });

  it('só criativos do piloto ganham extras.pilot (o manual da mesma campanha fica intacto)', async () => {
    const w = await world({ max_angles: 1, images_per_angle: 1, videos: 0 });
    const manual = await w.db.t.creatives.create({ data: { workspace_id: WS_A, campaign_id: w.campaign.id, extras: { nota: 'feito à mão' } } });
    await w.tick();
    await w.tick();
    const pilotCr = w.db.t.creatives.rows.find((c: any) => c.id !== manual.id)!;
    expect(pilotCr.extras).toEqual({ pilot: { run_id: w.run.id, slot: 1, score: 41 } });
    expect(w.db.t.creatives.rows.find((c: any) => c.id === manual.id)!.extras).toEqual({ nota: 'feito à mão' });
  });
});

describe('spentCredits', () => {
  it('soma o custo real (ou o estimado, enquanto o vídeo gera) só dos jobs das vagas', () => {
    const slots: Slot[] = [{ slot: 1, kind: 'image', angle: 'A', status: 'done', job_id: 'j1' }, { slot: 2, kind: 'video', angle: 'A', status: 'waiting', job_id: 'j2' }, { slot: 3, kind: 'image', angle: 'A', status: 'pending' }];
    const jobs = [{ id: 'j1', actual_cost: 4.5, estimated_cost: 4.5 }, { id: 'j2', actual_cost: null, estimated_cost: 6 }, { id: 'jX', actual_cost: 99, estimated_cost: 99 }];
    expect(spentCredits(slots, jobs as any)).toBe(10.5);
  });
});
