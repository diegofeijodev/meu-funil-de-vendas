import { UserError } from '../../media/user-error';
import { CopiesStep } from '../steps/copies.step';
import { InstagramStep } from '../steps/instagram.step';
import { MetaStep } from '../steps/meta.step';
import type { PilotOptions } from '../pilot.types';
import { min, OWNER, pilotDb, seedRun, T0, WS_A } from './world';

const OPTIONS: PilotOptions = {
  max_angles: 3, images_per_angle: 2, variations: 3, videos: 1,
  instagram: { enabled: true, mode: 'approval', weekdays: [1, 3, 5], times: ['11:00', '18:00'], story_times: ['12:00'], formats: ['feed_image', 'reel', 'story_image'] },
  meta: { enabled: true, review_creatives: false }, max_credits: 48,
};

async function world(opt: Partial<PilotOptions> = {}) {
  const db = pilotDb();
  const brand = await db.t.brands.create({ data: { workspace_id: WS_A, name: 'Freela', tone_of_voice: 'direto' } });
  const { run, campaign } = await seedRun(db, { status: 'running', current_step: 'copies', approved_at: min(-1), approved_by: OWNER, options: { ...OPTIONS, ...opt } });
  Object.assign(db.t.campaigns.rows[0]!, {
    brand_id: brand.id, objective: 'leads', offer_product: 'Freela', offer_promise: '1ª contratação grátis',
    start_date: new Date('2026-10-28T00:00:00Z'), end_date: new Date('2026-11-27T00:00:00Z'), audience: {},
  });
  const copyAi = { generateAsSystem: jest.fn(async () => ({ content: { headline: 'H' }, engine: 'IA do app' })) };
  const campaigns = { createCopy: jest.fn(async (_a: any, ws: string, cid: string, dto: any) => db.t.copies.create({ data: { workspace_id: ws, campaign_id: cid, content: dto.content, created_at: T0 } })) };
  const strategist = { createIgPlanAsSystem: jest.fn(async () => ({ planId: 'plan-1' }) as any) };
  const autoCalendar = {
    createAutoRun: jest.fn(async (ws: string, _u: string, input: any) => {
      const r = await db.t.ig_auto_runs.create({ data: { workspace_id: ws, campaign_id: input.campaignId, created_at: T0 } });
      return { runId: r.id, planId: input.planId, total: 12, skipped: 0 };
    }),
  };
  return {
    db, run: db.t.campaign_pilot_runs.rows[0]! as any, campaign, brand, copyAi, campaigns, strategist, autoCalendar,
    copies: new CopiesStep(db.prisma, copyAi as any, campaigns as any),
    instagram: new InstagramStep(db.prisma, strategist as any, autoCalendar as any),
  };
}

describe('etapa copies', () => {
  it('gera uma vez com marca e briefing do servidor; segunda rodada não duplica', async () => {
    const w = await world();
    const r = await w.copies.run(w.run);
    expect(r).toMatchObject({ kind: 'done', ref: w.db.t.copies.rows[0]!.id });
    const input = (w.copyAi.generateAsSystem.mock.calls[0] as any[])[0];
    expect(input).toMatchObject({ workspaceId: WS_A, campaignId: w.campaign.id, brand: { name: 'Freela', tone_of_voice: 'direto' }, brief: { name: 'Jundiaí', offer_promise: '1ª contratação grátis' } });
    expect(w.campaigns.createCopy).toHaveBeenCalledWith(null, WS_A, w.campaign.id, { content: { headline: 'H' } });
    expect(await w.copies.run(w.run)).toMatchObject({ kind: 'done', note: 'Já havia textos depois da aprovação.' });
    expect(w.copyAi.generateAsSystem).toHaveBeenCalledTimes(1);
  });

  it('copy feita à mão depois de aprovar conta como feita; a de antes, não', async () => {
    const w = await world();
    await w.db.t.copies.create({ data: { workspace_id: WS_A, campaign_id: w.campaign.id, created_at: min(-30) } });
    expect((await w.copies.run(w.run)).kind).toBe('done');
    expect(w.copyAi.generateAsSystem).toHaveBeenCalledTimes(1);
    const w2 = await world();
    await w2.db.t.copies.create({ data: { workspace_id: WS_A, campaign_id: w2.campaign.id, created_at: T0 } });
    await w2.copies.run(w2.run);
    expect(w2.copyAi.generateAsSystem).not.toHaveBeenCalled();
  });
});

describe('etapa instagram', () => {
  it('cria plano + programação no modo approval; início nunca antes de hoje; foco ≥ 30 letras', async () => {
    const w = await world();
    const r = await w.instagram.run(w.run, T0);
    expect(r).toMatchObject({ kind: 'done', note: '12 posts até 27/11' });
    const [ws, actor, input] = w.autoCalendar.createAutoRun.mock.calls[0] as any[];
    expect([ws, actor]).toEqual([WS_A, OWNER]);
    expect(input).toMatchObject({
      planId: 'plan-1', campaignId: w.campaign.id, brandId: w.brand.id, mode: 'approval', startDate: '2026-10-30', endDate: '2026-11-27',
      weekdays: [1, 3, 5], times: ['11:00', '18:00'], storyTimes: ['12:00'], formats: ['feed_image', 'reel', 'story_image'],
    });
    expect(input.focus.length).toBeGreaterThanOrEqual(30);
    expect(input.focus).toContain('1ª contratação grátis');
  });

  it('sem temas = NO_IG_PLAN e a execução segue (stopRun=false)', async () => {
    const w = await world();
    w.strategist.createIgPlanAsSystem.mockResolvedValueOnce({ error: 'NO_IG_PLAN' });
    expect(await w.instagram.run(w.run, T0)).toEqual({
      kind: 'blocked', code: 'NO_IG_PLAN', stopRun: false,
      message: 'O plano veio sem os temas do Instagram, então os posts não foram programados. O anúncio segue normal.',
    });
    expect(w.autoCalendar.createAutoRun).not.toHaveBeenCalled();
  });

  it('recusa da programação vira IG_NOT_SCHEDULED com a frase dela, sem parar', async () => {
    const w = await world();
    w.autoCalendar.createAutoRun.mockRejectedValueOnce(new UserError('Nenhum horário no período: confira os dias da semana e os horários.'));
    expect(await w.instagram.run(w.run, T0)).toEqual({ kind: 'blocked', code: 'IG_NOT_SCHEDULED', stopRun: false, message: 'Nenhum horário no período: confira os dias da semana e os horários.' });
  });

  it('desligado no pacote = skipped; programação já existente não é recriada', async () => {
    const off = await world({ instagram: { ...OPTIONS.instagram, enabled: false } });
    expect(await off.instagram.run(off.run, T0)).toEqual({ kind: 'skipped', note: 'Instagram desligado no pacote.' });
    const w = await world();
    const existing = await w.db.t.ig_auto_runs.create({ data: { workspace_id: WS_A, campaign_id: w.campaign.id, created_at: T0 } });
    expect(await w.instagram.run(w.run, T0)).toMatchObject({ kind: 'done', ref: existing.id });
    expect(w.autoCalendar.createAutoRun).not.toHaveBeenCalled();
  });
});

describe('etapa meta (F3: ainda não monta o anúncio)', () => {
  it('sempre skipped, com a frase certa', async () => {
    const step = new MetaStep();
    expect(await step.run({ options: OPTIONS } as any)).toEqual({ kind: 'skipped', note: 'A montagem do anúncio na Meta entra na próxima etapa do piloto.' });
    expect(await step.run({ options: { ...OPTIONS, meta: { enabled: false, review_creatives: false } } } as any)).toEqual({ kind: 'skipped', note: 'Anúncio na Meta desligado no pacote.' });
  });
});
