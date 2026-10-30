import { BadRequestException } from '@nestjs/common';
import { MetaStep } from '../steps/meta.step';
import type { PilotOptions } from '../pilot.types';
import { min, OWNER, pilotDb, seedRun, WS_A } from './world';

const OPTIONS: PilotOptions = {
  max_angles: 1, images_per_angle: 2, variations: 3, videos: 1,
  instagram: { enabled: false, mode: 'approval', weekdays: [1], times: ['11:00'], story_times: [], formats: ['feed_image'] },
  meta: { enabled: true, review_creatives: false }, max_credits: 48,
};

async function world(opts: { meta?: Partial<PilotOptions['meta']>; campaign?: Record<string, unknown>; missing?: string[] } = {}) {
  const db = pilotDb();
  (db.t as any).approval_requests = new (db.t.copies.constructor as any)();
  db.prisma.approval_requests = (db.t as any).approval_requests;
  const { run, campaign } = await seedRun(db, {
    status: 'running', current_step: 'meta', approved_at: min(-1), approved_by: OWNER, approval_request_id: null,
    options: { ...OPTIONS, meta: { ...OPTIONS.meta, ...opts.meta } },
  });
  Object.assign(db.t.campaigns.rows[0]!, { status: 'approved', landing_url: 'https://x.test/cadastro', budget_daily: 30, ads_config: {}, meta_campaign_id: null, ...opts.campaign });
  const publisher = {
    publishPaused: jest.fn(async () => ({ campaignId: 'm-1' })),
    missingCredentials: jest.fn(async () => opts.missing ?? []),
  };
  const step = new MetaStep(db.prisma, publisher as any);
  const mine = (slot: number, extra: Record<string, unknown> = {}) =>
    db.t.creatives.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, status: 'ready', type: 'static_image', extras: { pilot: { run_id: run.id, slot, score: 40 } }, ...extra } });
  return { db, run: db.t.campaign_pilot_runs.rows[0] as any, campaign, publisher, step, mine };
}

describe('etapa meta (G1: o piloto escolhe as artes que passaram; tudo PAUSADO)', () => {
  it('aprova só as artes do piloto com nota ≥ 28 (vídeo pronto entra), grava o padrão do anúncio e monta pausado', async () => {
    const w = await world();
    const ok = await w.mine(1);
    const low = await w.mine(2, { extras: { pilot: { run_id: w.run.id, slot: 2, score: 20 } } });
    const video = await w.mine(3, { type: 'reels', extras: { pilot: { run_id: w.run.id, slot: 3, score: null } } });
    const manual = await w.db.t.creatives.create({ data: { workspace_id: WS_A, campaign_id: w.campaign.id, status: 'ready', type: 'static_image', extras: {} } });
    expect(await w.step.run(w.run)).toEqual({ kind: 'done', ref: 'm-1', note: 'Montado na Meta e desligado.' });
    const st = (id: string) => w.db.t.creatives.rows.find((c: any) => c.id === id)!.status;
    expect([st(ok.id), st(low.id), st(video.id), st(manual.id)]).toEqual(['approved', 'ready', 'approved', 'ready']);
    expect(w.db.t.campaigns.rows[0]!.ads_config).toMatchObject({ structure: 'per_angle', useStrategyAudiences: true });
    expect(w.publisher.publishPaused).toHaveBeenCalledWith(WS_A, w.campaign.id, { runId: w.run.id });
  });

  it('nenhuma arte passou e nenhuma aprovada à mão = NO_CREATIVE_PASSED; aprovada à mão conta', async () => {
    const w = await world();
    await w.mine(1, { extras: { pilot: { run_id: w.run.id, slot: 1, score: 10 } } });
    expect(await w.step.run(w.run)).toMatchObject({ kind: 'blocked', code: 'NO_CREATIVE_PASSED', stopRun: true, message: 'Nenhuma arte passou na revisão automática (nota mínima 28 de 50).' });
    expect(w.publisher.publishPaused).not.toHaveBeenCalled();
    await w.db.t.creatives.create({ data: { workspace_id: WS_A, campaign_id: w.campaign.id, status: 'approved', type: 'static_image', extras: {} } });
    expect((await w.step.run(w.run)).kind).toBe('done');
  });

  it('já publicada à mão = skipped; desligado = skipped; ads_config da pessoa é respeitado', async () => {
    const pub = await world({ campaign: { meta_campaign_id: '777' } });
    expect(await pub.step.run(pub.run)).toEqual({ kind: 'skipped', note: 'Já enviada à Meta.' });
    const off = await world({ meta: { enabled: false } });
    expect(await off.step.run(off.run)).toEqual({ kind: 'skipped', note: 'Anúncio na Meta desligado no plano.' });
    const own = await world({ campaign: { ads_config: { structure: 'single', cta: 'SIGN_UP' } } });
    await own.mine(1);
    await own.step.run(own.run);
    expect(own.db.t.campaigns.rows[0]!.ads_config).toEqual({ structure: 'single', cta: 'SIGN_UP' });
  });

  it('esperando aprovação / Meta desconectada: espera sem parar o resto; recusado em Approvals = skipped', async () => {
    const wait = await world({ campaign: { status: 'pending_approval' } });
    expect(await wait.step.run(wait.run)).toMatchObject({ kind: 'wait', minutes: 5, code: 'WAITING_APPROVAL' });
    const nc = await world({ missing: ['META_SYSTEM_USER_TOKEN'] });
    expect(await nc.step.run(nc.run)).toMatchObject({ kind: 'wait', minutes: 30, code: 'META_NOT_CONNECTED' });
    const rej = await world({ campaign: { status: 'draft' } });
    const req = await rej.db.prisma.approval_requests.create({ data: { workspace_id: WS_A, status: 'rejected' } });
    rej.run.approval_request_id = req.id;
    expect(await rej.step.run(rej.run)).toEqual({ kind: 'skipped', note: 'Recusado em Approvals.' });
  });

  it('sem destino, sem verba, cidade não achada: para com a frase (nunca inventa)', async () => {
    const nl = await world({ campaign: { landing_url: null } });
    expect(await nl.step.run(nl.run)).toMatchObject({ kind: 'blocked', code: 'LANDING_MISSING', stopRun: true });
    const nb = await world({ campaign: { budget_daily: 0 } });
    expect(await nb.step.run(nb.run)).toMatchObject({ kind: 'blocked', code: 'BUDGET_MISSING', stopRun: true });
    const geo = await world();
    await geo.mine(1);
    geo.publisher.publishPaused.mockRejectedValueOnce(new BadRequestException({ code: 'GEO_UNRESOLVED', message: 'A Meta não achou a cidade "Jundiai". Escolha de novo na região da campanha.' }));
    expect(await geo.step.run(geo.run)).toEqual({ kind: 'blocked', code: 'GEO_UNRESOLVED', stopRun: true, message: 'A Meta não achou a cidade "Jundiai". Escolha de novo na região da campanha.' });
  });

  it('G2: sem arte aprovada à mão, espera a pessoa escolher', async () => {
    const w = await world({ meta: { review_creatives: true } });
    await w.mine(1);
    expect(await w.step.run(w.run)).toMatchObject({ kind: 'wait', minutes: 5, code: 'WAITING_CREATIVE_REVIEW' });
    expect(w.db.t.creatives.rows[0]!.status).toBe('ready');
  });
});
