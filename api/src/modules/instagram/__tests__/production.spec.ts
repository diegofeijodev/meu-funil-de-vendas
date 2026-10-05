import { WS_A, WS_B } from '../../media/__tests__/mem';
import { ProductionService, rankProductionCandidates } from '../production.service';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';

function setup() {
  const w: IgWorld = igWorld();
  const s = igServices(w);
  return { w, s, prod: s.production };
}
const connected = (w: IgWorld, ws: string = WS_A) => w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: ws, ig_user_id: `ig-${ws}`, status: 'connected' });
const inH = (h: number) => new Date(Date.now() + h * 3600e3);
const runFor = (w: IgWorld, ws: string = WS_A, over: Record<string, unknown> = {}): any => {
  const plan = { id: uuid(), workspace_id: ws, brand_id: null, status: 'active', requires_approval: false, auto_publish: false };
  w.t['ig_content_plans']!.rows.push(plan);
  const r = { id: uuid(), workspace_id: ws, plan_id: plan.id, mode: 'publish', status: 'active', strategy: null, strategy_status: 'approved', ...over };
  w.t['ig_auto_runs']!.rows.push(r);
  return r;
};
const idea = (w: IgWorld, r: any, at: Date, over: Record<string, unknown> = {}) =>
  seedPost(w, { workspace_id: r.workspace_id, plan_id: r.plan_id, run_id: r.id, automation: r.mode, status: 'idea', media: [], approved_at: null, scheduled_at: at, creative_brief: { prompt: 'copo de chope' }, objective_link: 'serve', pillar: 'A', persona: 'Ana', ...over });

describe('rankProductionCandidates (rodízio por empresa + prioridade da meta)', () => {
  const now = new Date('2099-01-01T12:00:00Z');
  const at = (h: number) => new Date(now.getTime() + h * 3600e3);
  it('1 post por empresa (o mais próximo dela); quem está a menos de 24 h passa à frente; até perTick', () => {
    const rows = [
      { id: 'a1', workspace_id: 'A', scheduled_at: at(30) },
      { id: 'a2', workspace_id: 'A', scheduled_at: at(40) },
      { id: 'b1', workspace_id: 'B', scheduled_at: at(20) },
      { id: 'b2', workspace_id: 'B', scheduled_at: at(2) },
      { id: 'c1', workspace_id: 'C', scheduled_at: at(47) },
    ];
    expect(rankProductionCandidates(rows, { now, perTick: 4, targetHours: 24 }).map((r) => [r.id, r.late])).toEqual([['b2', true], ['a1', false], ['c1', false]]);
    expect(rankProductionCandidates(rows, { now, perTick: 1, targetHours: 24 }).map((r) => r.id)).toEqual(['b2']);
  });
});

describe('ProductionService.candidates (consulta real)', () => {
  it('o rodízio é feito NA SQL (ROW_NUMBER por empresa), com janela, lease livre, prioridade da meta e limite por rodada', async () => {
    const queryRaw = jest.fn(async () => []);
    const svc = new ProductionService({ prisma: { $queryRaw: queryRaw } } as any, {} as any, {} as any, { IG_PRODUCTION_PER_TICK: 3, IG_PRODUCTION_WINDOW_HOURS: 48, IG_PRODUCTION_TARGET_HOURS: 24 } as any);
    await svc.candidates(new Date('2099-01-01T12:00:00Z'));
    const [strings, ...values] = queryRaw.mock.calls[0] as unknown as [string[], ...unknown[]];
    const sql = strings.join('$');
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY p\.workspace_id ORDER BY p\.scheduled_at ASC, p\.id ASC\) AS rn/);
    expect(sql).toMatch(/WHERE x\.rn = 1/);
    expect(sql).toMatch(/p\.run_id IS NOT NULL/);
    expect(sql).toMatch(/p\.status = 'idea'/);
    expect(sql).toMatch(/p\.lease_until IS NULL OR p\.lease_until < \$::timestamptz/);
    expect(sql).toMatch(/ORDER BY late DESC, x\.scheduled_at ASC/);
    expect(values).toEqual(['2099-01-02T12:00:00.000Z', '2099-01-01T00:00:00.000Z', '2099-01-03T12:00:00.000Z', '2099-01-01T12:00:00.000Z', 3]);
  });
});

describe('ProductionService.productionTick (janela 48 h → meta 24 h)', () => {
  it('produz 1 post por empresa por rodada (o mais próximo dela), agenda no horário e registra os eventos', async () => {
    const { w, prod } = setup();
    connected(w, WS_A);
    connected(w, WS_B);
    const ra = runFor(w, WS_A);
    const rb = runFor(w, WS_B);
    const a1 = idea(w, ra, inH(30));
    const a2 = idea(w, ra, inH(40));
    const b1 = idea(w, rb, inH(20));
    const far = idea(w, ra, inH(60)); // fora da janela de 48 h
    const planPost = seedPost(w, { status: 'idea', media: [], plan_id: ra.plan_id, scheduled_at: inH(5) }); // sem programação
    const out = await prod.productionTick();
    expect(out).toMatchObject({ skipped: 0, started: 2, ready: 2, pending: 0, failed: 0 });
    expect([a1.status, b1.status]).toEqual(['scheduled', 'scheduled']);
    expect([a2.status, far.status, planPost.status]).toEqual(['idea', 'idea', 'idea']);
    expect(w.t['publishing_jobs']!.rows.map((j) => j.run_at.getTime()).sort()).toEqual([a1.scheduled_at.getTime(), b1.scheduled_at.getTime()].sort());
    const msgs = w.t['ig_autopilot_events']!.rows.filter((e) => e.kind === 'media').map((e) => e.message);
    expect(msgs).toEqual(['Mídia produzida (gemini) — dentro das 24 h antes do horário.', 'Mídia produzida (gemini) com antecedência.']);
    await prod.productionTick();
    expect(a2.status).toBe('scheduled'); // rodada seguinte: o próximo da empresa A
    expect(far.status).toBe('idea');
  });

  it('prioridade: com 1 vaga por rodada, o post a menos de 24 h de outra empresa passa à frente', async () => {
    const { w, prod } = setup();
    (prod as any).perTick = 1;
    const ra = runFor(w, WS_A);
    const rb = runFor(w, WS_B);
    const a = idea(w, ra, inH(30));
    const b = idea(w, rb, inH(20));
    await prod.productionTick();
    expect(b.media).toHaveLength(1);
    expect(a.status).toBe('idea');
  });

  it('vídeo assíncrono: o tick só dispara (espera curta de 25 s), guarda o pending_job e segue; quem conclui é o poller', async () => {
    const { w, s, prod } = setup();
    s.provider.generateVideo.mockResolvedValueOnce({ status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: 'veo:p1', cost: 6 });
    const r = runFor(w);
    const reel = idea(w, r, inH(10), { format: 'reel' });
    expect(await prod.productionTick()).toMatchObject({ started: 1, pending: 1, ready: 0 });
    expect(s.provider.generateVideo.mock.calls[0][0].maxWaitMs).toBe(25_000);
    expect(reel.status).toBe('generating');
    expect(reel.creative_brief.pending_job.jobId).toBe('veo:p1');
    expect(w.t['publishing_jobs']!.rows).toHaveLength(0);
    expect(w.t['ig_autopilot_events']!.rows.at(-1)!.message).toMatch(/^Mídia em produção \(gemini\); fica pronta sozinha/);
  });

  it('falha da geração: evento "failure", post failed com failure_kind "media"; o laço segue para a próxima empresa', async () => {
    const { w, s, prod } = setup();
    s.pipeline.run.mockRejectedValueOnce(new Error('Sem créditos'));
    const ra = runFor(w, WS_A);
    const rb = runFor(w, WS_B);
    const bad = idea(w, ra, inH(3));
    const good = idea(w, rb, inH(4));
    expect(await prod.productionTick()).toMatchObject({ started: 2, failed: 1, ready: 1 });
    expect(bad).toMatchObject({ status: 'failed', failure_kind: 'media', last_error: 'Sem créditos' });
    expect(good.media).toHaveLength(1);
    expect(w.t['ig_autopilot_events']!.rows.find((e) => e.kind === 'failure')).toMatchObject({ level: 'error', message: 'Falha ao gerar a mídia: Sem créditos', post_id: bad.id });
  });

  it('atrasado até 12 h (modo publish): produz agora e publica em ~1 min', async () => {
    const { w, prod } = setup();
    connected(w);
    const r = runFor(w);
    const late = idea(w, r, inH(-2));
    await prod.productionTick();
    expect(late.status).toBe('scheduled');
    expect(w.t['publishing_jobs']!.rows[0]!.run_at.getTime() - Date.now()).toBeLessThan(61e3);
  });

  it('Review Focus #3 — mais de 12 h sem criativo (ideia ou em reescrita, modo publish): pulado uma única vez, sem IA; approval e lease vivo ficam', async () => {
    const { w, s, prod } = setup();
    const r = runFor(w);
    const ra = runFor(w, WS_A, { mode: 'approval' });
    const old = idea(w, r, inH(-13));
    const rewriting = idea(w, r, inH(-20), { status: 'needs_review', review_reason: 'x' });
    const busy = idea(w, r, inH(-14), { lease_until: new Date(Date.now() + 60e3) });
    const recent = idea(w, r, inH(-11));
    const approval = idea(w, ra, inH(-13));
    const first = await prod.productionTick();
    expect(first.skipped).toBe(2);
    for (const p of [old, rewriting]) expect(p).toMatchObject({ status: 'cancelled', last_error: 'Pulado automaticamente: o horário passou há mais de 12 h sem o criativo pronto.' });
    expect([busy.status, approval.status]).toEqual(['idea', 'idea']);
    expect(recent.status).not.toBe('cancelled');
    const skippedEvents = () => w.t['ig_autopilot_events']!.rows.filter((e) => e.kind === 'post_skipped');
    expect(skippedEvents()).toHaveLength(2);
    expect(skippedEvents()[0]).toMatchObject({ level: 'warn' });
    expect((await prod.productionTick()).skipped).toBe(0);
    expect(skippedEvents()).toHaveLength(2);
    expect(s.ai.json).toHaveBeenCalledTimes(1); // só a mídia do "recent" (até 12 h de atraso) foi gerada
  });
});
