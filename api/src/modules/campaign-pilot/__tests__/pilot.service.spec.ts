import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApprovePilotDto } from '../pilot.dto';
import { PilotService } from '../pilot.service';
import type { PilotOptions } from '../pilot.types';
import { min, OWNER, pilotDb, rowOf, T0, WS_A, WS_B } from './world';

const VIEWER = '33333333-3333-4333-8333-333333333333';
const MARKETING = '44444444-4444-4444-8444-444444444444';
const OPTIONS: PilotOptions = {
  max_angles: 3, images_per_angle: 2, variations: 3, videos: 1,
  instagram: { enabled: true, mode: 'approval', weekdays: [1, 3, 5], times: ['11:00', '18:00'], story_times: ['12:00'], formats: ['feed_image', 'reel', 'story_image'] },
  meta: { enabled: true, review_creatives: false }, max_credits: 48,
};
const status = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) { const r = e.getResponse?.(); return `${e.getStatus?.() ?? 500}:${r?.code ? `${r.code}:` : ''}${r?.message ?? e.message}`; }
};

async function setup(opts: { gate?: boolean } = {}) {
  const db = pilotDb();
  const access = {
    require: jest.fn(async (user: string, ws: string, level: string) => {
      if (ws !== WS_A) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem acesso a esta empresa.' });
      if (user === VIEWER && level !== 'read') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Seu perfil não tem permissão para esta ação.' });
      if (user === MARKETING && level === 'manage') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Seu perfil não tem permissão para esta ação.' });
      return user === VIEWER ? 'viewer' : user === MARKETING ? 'marketing' : 'owner';
    }),
  };
  const gate = { enabled: (_ws: string) => opts.gate !== false };
  const strategist = {
    latestVersion: jest.fn(async () => 2), approveVersion: jest.fn(async () => undefined),
    currentStrategy: jest.fn(async () => ({ angulos_detalhados: [{ nome: 'A' }, { nome: 'B' }, { nome: 'C' }] })),
  };
  const runner = { kick: jest.fn() };
  const autoCalendar = { cancelAutoRun: jest.fn(async () => ({ ok: true })) };
  const campaigns = {
    requestApproval: jest.fn(async (_u: string, _ws: string, cid: string, summary?: string) => {
      db.t.campaigns.rows.find((c: any) => c.id === cid)!.status = 'pending_approval';
      return { id: 'req-1', summary };
    }),
  };
  const approvals = {
    decide: jest.fn(async () => { db.t.campaigns.rows[0]!.status = 'approved'; return { ok: true }; }),
  };
  const svc = new PilotService(db.prisma, access as any, gate as any, strategist as any, runner as any, autoCalendar as any, db.activity, campaigns as any, approvals as any, { CAMPAIGN_PILOT_MAX_CREATIVES: 10 } as any);
  const brand = await db.t.brands.create({ data: { workspace_id: WS_A, name: 'Freela' } });
  const campaign = await db.t.campaigns.create({ data: { workspace_id: WS_A, brand_id: brand.id, name: 'Jundiaí', status: 'draft', budget_daily: 30, start_date: new Date('2026-10-30T00:00:00Z'), end_date: new Date('2026-11-28T00:00:00Z') } });
  const now = () => T0;
  return { db, svc, access, strategist, runner, autoCalendar, campaigns, approvals, campaign, brand, now };
}
const KEY = 'chave-12345';
async function planned(w: Awaited<ReturnType<typeof setup>>) {
  const r = await w.svc.create(OWNER, WS_A, w.campaign.id, KEY);
  Object.assign(rowOf(w.db, r.id), { strategy_version: 2, next_run_at: null, steps: { strategy: { status: 'done', attempts: 0, ref: '2' } } });
  return r;
}

describe('PilotService', () => {
  it('criar: nasce em planning, chuta o runner; mesma chave = mesma execução; outra ativa = 409', async () => {
    const w = await setup();
    const a = await w.svc.create(OWNER, WS_A, w.campaign.id, KEY);
    expect([a.status, a.current_step, a.steps.strategy?.status]).toEqual(['planning', 'strategy', 'pending']);
    expect(w.runner.kick).toHaveBeenCalledWith(a.id);
    expect((await w.svc.create(OWNER, WS_A, w.campaign.id, KEY)).id).toBe(a.id);
    expect(await status(w.svc.create(OWNER, WS_A, w.campaign.id, 'outra-chave-1'))).toBe('409:CONFLICT:O estrategista já está trabalhando nesta campanha.');
  });

  it('portão desligado = 404 antes do acesso; viewer não inicia; empresa B não vê', async () => {
    const off = await setup({ gate: false });
    expect(await status(off.svc.create(OWNER, WS_A, off.campaign.id, KEY))).toBe('404:NOT_FOUND:Não encontrado.');
    expect(off.access.require).not.toHaveBeenCalled();
    const w = await setup();
    expect(await status(w.svc.create(VIEWER, WS_A, w.campaign.id, KEY))).toBe('403:FORBIDDEN:Seu perfil não tem permissão para esta ação.');
    // campanha da empresa A pedida pela URL da empresa B (com acesso a B): o filtro por workspace_id dá 404
    w.access.require.mockImplementationOnce(async () => 'owner');
    expect(await status(w.svc.get(OWNER, WS_B, w.campaign.id))).toBe('404:NOT_FOUND:Não encontrado.');
  });

  it('publicar no Instagram sem aprovação só para dono/admin (marketing = 403; com "eu aprovo" = ok)', async () => {
    const w = await setup();
    const r = await planned(w);
    const publish = { ...OPTIONS, instagram: { ...OPTIONS.instagram, mode: 'publish' as const } };
    expect(await status(w.svc.approve(MARKETING, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: publish }))).toBe('403:FORBIDDEN:Seu perfil não tem permissão para esta ação.');
    expect(rowOf(w.db, r.id).status).toBe('planning');
    expect((await w.svc.approve(MARKETING, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: OPTIONS })).status).toBe('running');
  });

  it('estimar: plano ainda montando = STRATEGY_NOT_READY; peças demais e Instagram sem horário também bloqueiam', async () => {
    const w = await setup();
    await w.svc.create(OWNER, WS_A, w.campaign.id, KEY);
    const e = await w.svc.estimate(OWNER, WS_A, w.campaign.id, { ...OPTIONS, max_angles: 5, images_per_angle: 3, instagram: { ...OPTIONS.instagram, times: [], story_times: [] } });
    expect(e.blockers.map((b) => b.code)).toEqual(['STRATEGY_NOT_READY', 'TOO_MANY_PIECES', 'IG_NO_TIMES']);
    expect(e.blockers.map((b) => b.message)).toEqual(['O plano ainda está sendo montado.', 'No máximo 10 peças por campanha.', 'Informe ao menos um horário para os posts do Instagram.']);
    expect(e.can_approve).toBe(false);
  });

  it('"Já conectei: conferir agora": etapa esperando sozinha numa execução que segue antecipa a conferência', async () => {
    const w = await setup();
    const r = await planned(w);
    await w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: OPTIONS, approve_now: true }, T0);
    Object.assign(rowOf(w.db, r.id), { status: 'running', current_step: 'meta', next_run_at: min(30), steps: { ...rowOf(w.db, r.id).steps, meta: { status: 'blocked', attempts: 0, error_code: 'META_NOT_CONNECTED' } } });
    const v = await w.svc.resume(OWNER, WS_A, w.campaign.id, r.id, { action: 'retry' }, min(2));
    expect([v.status, rowOf(w.db, r.id).next_run_at]).toEqual(['running', min(2)]);
  });

  it('retry com COST_CAP = 409 (só seguir com as prontas ou aumentar o teto)', async () => {
    const w = await setup();
    const r = await planned(w);
    await w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: OPTIONS }, T0);
    Object.assign(rowOf(w.db, r.id), { status: 'blocked', current_step: 'creatives', steps: { ...rowOf(w.db, r.id).steps, creatives: { status: 'blocked', attempts: 0, error_code: 'COST_CAP', slots: [{ slot: 1, kind: 'image', angle: 'A', status: 'done' }] } } });
    expect(await status(w.svc.resume(OWNER, WS_A, w.campaign.id, r.id, { action: 'retry' }))).toBe('409:CONFLICT:Não dá para fazer isso agora.');
  });

  it('parar e cancelar o Instagram acha a programação pelo domínio (mesmo sem ref) e não falha se ela já sumiu', async () => {
    const w = await setup();
    const r = await planned(w);
    await w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: OPTIONS }, T0);
    const ig = await w.db.t.ig_auto_runs.create({ data: { workspace_id: WS_A, campaign_id: w.campaign.id, status: 'planning', created_at: min(1) } });
    await w.db.t.ig_auto_runs.create({ data: { workspace_id: WS_A, campaign_id: w.campaign.id, status: 'active', created_at: min(-60) } }); // de antes da aprovação: fica
    w.autoCalendar.cancelAutoRun.mockRejectedValueOnce(new Error('sumiu'));
    const c = await w.svc.cancel(OWNER, WS_A, w.campaign.id, r.id, { cancel_instagram: true });
    expect(c.status).toBe('cancelled');
    expect(w.autoCalendar.cancelAutoRun.mock.calls).toEqual([[WS_A, ig.id]]);
  });

  it('ver: execução mais recente com resumo, gasto derivado e pacote sugerido quando o plano fica pronto', async () => {
    const w = await setup();
    expect(await w.svc.get(VIEWER, WS_A, w.campaign.id)).toEqual({ run: null });
    await planned(w);
    const { run } = await w.svc.get(VIEWER, WS_A, w.campaign.id);
    expect(run!.summary).toEqual({ status: 'planning', current_step: 'strategy', first_block_code: null, counts: { done: 0, total: 0 }, plan_ready: true });
    expect(run!.next_run_at).toBeNull();
    expect(run!.remaining_credits).toBe(0);
    expect(run!.spent_credits).toBe(0);
    expect(run!.suggested_options).toMatchObject({ max_angles: 3, images_per_angle: 2, videos: 1, max_credits: 48 });
  });

  it('estimar: conta com fórmula; sem marca = NO_BRAND e can_approve false', async () => {
    const w = await setup();
    await planned(w);
    const e = await w.svc.estimate(OWNER, WS_A, w.campaign.id, OPTIONS);
    expect(e.estimate.total).toBe(48);
    expect(e.estimate.instagram?.label).toBe('Posts do Instagram (fora do teto)');
    expect([e.blockers, e.can_approve]).toEqual([[], true]);
    w.db.t.campaigns.rows[0]!.brand_id = null;
    const e2 = await w.svc.estimate(OWNER, WS_A, w.campaign.id, OPTIONS);
    expect(e2.blockers).toEqual([{ code: 'NO_BRAND', message: 'Escolha a marca da campanha antes de começar.', action: 'edit_campaign' }]);
    expect(e2.can_approve).toBe(false);
  });

  it('aprovar: plano não pronto = 409; versão velha = 409 STRATEGY_CHANGED; peças demais = 400', async () => {
    const w = await setup();
    const r = await w.svc.create(OWNER, WS_A, w.campaign.id, KEY);
    expect(await status(w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: OPTIONS }))).toBe('409:CONFLICT:O plano ainda está sendo montado.');
    Object.assign(rowOf(w.db, r.id), { strategy_version: 2, steps: { strategy: { status: 'done', attempts: 0, ref: '2' } } });
    expect(await status(w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 1, options: OPTIONS }))).toBe('409:STRATEGY_CHANGED:A estratégia mudou. Confira o plano de novo.');
    expect(await status(w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: { ...OPTIONS, max_angles: 5, images_per_angle: 3 } }))).toBe('400:BAD_REQUEST:No máximo 10 peças por campanha.');
  });

  it('aprovar grava o pacote, o teto e começa em copies; aprova a versão da estratégia e chuta', async () => {
    const w = await setup();
    const r = await planned(w);
    const v = await w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: OPTIONS }, T0);
    expect([v.status, v.current_step, v.max_credits, v.estimated_credits, v.approved_by]).toEqual(['running', 'copies', 48, 48, OWNER]);
    expect(Object.keys(v.steps)).toEqual(['strategy', 'copies', 'instagram', 'creatives', 'meta']);
    expect(rowOf(w.db, r.id).next_run_at).toEqual(T0);
    expect(w.strategist.approveVersion).toHaveBeenCalledWith(WS_A, w.campaign.id, 2, OWNER);
    expect(w.runner.kick).toHaveBeenLastCalledWith(r.id);
    expect(w.db.logs).toContainEqual([WS_A, OWNER, 'campaign.pilot_started', 'campaign', { campaign_id: w.campaign.id, via: 'pilot', run_id: r.id }]);
    expect(await status(w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: OPTIONS }))).toBe('409:CONFLICT:O plano ainda está sendo montado.');
  });

  it('retomar: proceed_partial pula as peças restantes; raise_cap abaixo do atual = 409; retry reabre as que falharam', async () => {
    const w = await setup();
    const r = await planned(w);
    await w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: OPTIONS }, T0);
    const slots = [{ slot: 1, kind: 'image', angle: 'A', status: 'done' }, { slot: 2, kind: 'image', angle: 'A', status: 'failed', error: 'x' }, { slot: 3, kind: 'image', angle: 'B', status: 'pending' }];
    const block = () => Object.assign(rowOf(w.db, r.id), { status: 'blocked', current_step: 'creatives', steps: { ...rowOf(w.db, r.id).steps, creatives: { status: 'blocked', attempts: 0, error_code: 'COST_CAP', error: 'teto', slots: structuredClone(slots) } } });
    block();
    expect(await status(w.svc.resume(OWNER, WS_A, w.campaign.id, r.id, { action: 'raise_cap', max_credits: 40 }))).toBe('409:CONFLICT:Não dá para fazer isso agora.');
    const p = await w.svc.resume(OWNER, WS_A, w.campaign.id, r.id, { action: 'proceed_partial' }, min(1));
    expect(p.status).toBe('running');
    expect(p.steps.creatives!.slots!.map((s) => s.status)).toEqual(['done', 'failed', 'skipped']);
    block();
    const up = await w.svc.resume(OWNER, WS_A, w.campaign.id, r.id, { action: 'raise_cap', max_credits: 60 }, min(1));
    expect([up.status, up.max_credits, up.steps.creatives!.status]).toEqual(['running', 60, 'pending']);
    block();
    rowOf(w.db, r.id).steps.creatives.error_code = 'NO_CREATIVE_MADE';
    const rt = await w.svc.resume(OWNER, WS_A, w.campaign.id, r.id, { action: 'retry' }, min(1));
    expect(rt.steps.creatives!.slots!.map((s) => s.status)).toEqual(['done', 'pending', 'pending']);
    expect(rowOf(w.db, r.id).next_run_at).toEqual(min(1));
  });

  it('parar: cancelled; de outra campanha = 404; parar de novo = 409', async () => {
    const w = await setup();
    const r = await planned(w);
    rowOf(w.db, r.id).steps.instagram = { status: 'done', attempts: 0, ref: 'ig-run-1' };
    const other = await w.db.t.campaigns.create({ data: { workspace_id: WS_A, name: 'Outra' } });
    expect(await status(w.svc.cancel(OWNER, WS_A, other.id, r.id, { cancel_instagram: true }))).toBe('404:NOT_FOUND:Não encontrado.');
    const c = await w.svc.cancel(OWNER, WS_A, w.campaign.id, r.id, { cancel_instagram: true });
    expect(c.status).toBe('cancelled');
    expect(w.autoCalendar.cancelAutoRun).not.toHaveBeenCalled(); // nunca aprovado: o piloto não criou programação
    expect(await status(w.svc.cancel(OWNER, WS_A, w.campaign.id, r.id, { cancel_instagram: false }))).toBe('409:CONFLICT:Não dá para fazer isso agora.');
  });

  it('anúncio no plano: dono aprova tudo de uma vez (pedido decidido na hora); marketing deixa o pedido em Approvals', async () => {
    const w = await setup();
    const r = await planned(w);
    await w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: OPTIONS, approve_now: true }, T0);
    expect(w.campaigns.requestApproval).toHaveBeenCalledWith(OWNER, WS_A, w.campaign.id, 'Anúncio montado pelo estrategista: 6 artes + 1 vídeo, R$ 30,00 por dia de 30/10 a 28/11.');
    expect(w.approvals.decide).toHaveBeenCalledWith(OWNER, 'req-1', 'approved');
    expect([w.db.t.campaigns.rows[0]!.status, rowOf(w.db, r.id).approval_request_id]).toEqual(['approved', 'req-1']);

    const m = await setup();
    const r2 = await planned(m);
    expect(await status(m.svc.approve(MARKETING, WS_A, m.campaign.id, r2.id, { strategy_version: 2, options: OPTIONS, approve_now: true }))).toBe('403:FORBIDDEN:Seu perfil não tem permissão para esta ação.');
    expect(rowOf(m.db, r2.id).status).toBe('planning');
    await m.svc.approve(MARKETING, WS_A, m.campaign.id, r2.id, { strategy_version: 2, options: OPTIONS }, T0);
    expect(m.approvals.decide).not.toHaveBeenCalled();
    expect(m.db.t.campaigns.rows[0]!.status).toBe('pending_approval');
  });

  it('sem anúncio no plano (ou campanha já aprovada) não pede aprovação', async () => {
    const w = await setup();
    const r = await planned(w);
    await w.svc.approve(OWNER, WS_A, w.campaign.id, r.id, { strategy_version: 2, options: { ...OPTIONS, meta: { enabled: false, review_creatives: false } }, approve_now: true }, T0);
    expect(w.campaigns.requestApproval).not.toHaveBeenCalled();
    const a = await setup();
    a.db.t.campaigns.rows[0]!.status = 'approved';
    const r2 = await planned(a);
    await a.svc.approve(OWNER, WS_A, a.campaign.id, r2.id, { strategy_version: 2, options: OPTIONS, approve_now: true }, T0);
    expect(a.campaigns.requestApproval).not.toHaveBeenCalled();
  });

  it('DTO: campos do pacote são obrigatórios e com faixa', async () => {
    const errs = await validate(plainToInstance(ApprovePilotDto, { strategy_version: 2, options: { ...OPTIONS, max_angles: 9, instagram: { ...OPTIONS.instagram, times: ['25:00'] } } }));
    const flat = JSON.stringify(errs);
    expect(flat).toContain('max_angles');
    expect(flat).toContain('times');
    expect(await validate(plainToInstance(ApprovePilotDto, { strategy_version: 2, options: OPTIONS }))).toEqual([]);
    const missing = await validate(plainToInstance(ApprovePilotDto, { strategy_version: 2, options: { ...OPTIONS, meta: undefined } }));
    expect(JSON.stringify(missing)).toContain('meta');
  });
});
