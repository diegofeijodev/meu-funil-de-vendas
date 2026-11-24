import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceAccessGuard } from '../../access/workspace-access.guard';
import { MARKETING, OWNER, STRANGER, VIEWER, WS_B } from '../../media/__tests__/mem';
import { InstagramResourcesController } from '../instagram-resources.controller';
import { MetaError } from '../meta-graph';
import { PUBLISH_CHECK_MSG } from '../publish-block.service';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';

const WS = igWorld().WS_A;
const H = 3600e3;
const t0 = new Date('2026-11-24T12:00:00Z');
const at = (h: number) => new Date(t0.getTime() + h * H);
type Perm = 'granted' | 'declined' | 'absent' | 'network' | 'token';

function setup(o: { closes?: boolean; perm?: Perm } = {}) {
  const w: IgWorld = igWorld();
  for (const ws of [WS, WS_B]) w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: ws, ig_user_id: `ig-${ws}`, status: 'connected', username: 'loja', publish_block_reason: null, publish_block_failures: 0, publish_checked_at: null });
  const state = { perm: o.perm ?? 'declined' };
  w.respond((path) => {
    if (path === '/me/permissions') {
      if (state.perm === 'network') return new MetaError('Não foi possível falar com a Meta agora. Tente de novo em instantes.');
      if (state.perm === 'token') return new MetaError('token', 190);
      const list = [{ permission: 'pages_show_list', status: 'granted' }];
      if (state.perm !== 'absent') list.push({ permission: 'instagram_content_publish', status: state.perm });
      return { data: list };
    }
    if (path.endsWith('/content_publishing_limit')) return { data: [{ config: { quota_total: 50, quota_duration: 86400 }, quota_usage: 3 }] };
    return undefined;
  });
  const s = igServices(w, { probeCloses: o.closes });
  const acc = (ws = WS) => w.t['instagram_accounts']!.rows.find((r) => r.workspace_id === ws)!;
  const probes = () => w.calls.filter((c) => c.path === '/me/permissions');
  return { w, s, state, acc, probes, svc: s.publishBlock };
}
const block = (x: ReturnType<typeof setup>, ws = WS, now = t0) => x.w.store.openPublishBlock(ws, 'permission', '(#10) sem permissão', { now });
const err = async (p: Promise<unknown>) => p.then(() => null, (e) => e);

describe('sonda do bloqueio (R8) — modo ativo (IG_PUBLISH_PROBE_CLOSES=true)', () => {
  it('só confere quem venceu a conferência; granted fecha (pela sonda) e mantém as falhas', async () => {
    const x = setup({ closes: true, perm: 'granted' });
    await block(x);
    expect(await x.svc.checkDue(at(0.5))).toEqual({ checked: 0, unblocked: 0 });
    expect(x.probes()).toHaveLength(0);
    expect(await x.svc.checkDue(at(1))).toEqual({ checked: 1, unblocked: 1 });
    expect(x.acc()).toMatchObject({ publish_block_reason: null, publish_block_failures: 1, publish_checked_at: at(1) });
    expect(x.w.t['ig_autopilot_events']!.rows.map((e) => e.message)).toContain('A Meta voltou a aceitar publicações (a conferência automática viu a permissão de publicar).');
  });

  it('permissão ausente ou recusada: soma falha e respeita a escada (1 h → 3 h → 6 h)', async () => {
    for (const perm of ['absent', 'declined'] as Perm[]) {
      const x = setup({ closes: true, perm });
      await block(x);
      await x.svc.checkDue(at(1));
      expect(x.acc()).toMatchObject({ publish_block_reason: 'permission', publish_block_failures: 2, publish_next_check_at: at(4) });
      await x.svc.checkDue(at(3.9));
      expect(x.probes()).toHaveLength(1);
      await x.svc.checkDue(at(4));
      expect(x.acc()).toMatchObject({ publish_block_failures: 3, publish_next_check_at: at(10) });
    }
  });

  it('erro de rede: +1 h sem contar falha', async () => {
    const x = setup({ closes: true, perm: 'network' });
    await block(x);
    await x.svc.checkDue(at(1));
    expect(x.acc()).toMatchObject({ publish_block_reason: 'permission', publish_block_failures: 1, publish_next_check_at: at(2) });
  });

  it('190 na sonda: vira bloqueio de token (só a reconexão resolve), como na fila', async () => {
    const x = setup({ closes: true, perm: 'token' });
    await block(x);
    await x.svc.checkDue(at(1));
    expect(x.acc()).toMatchObject({ status: 'error', publish_block_reason: 'token', publish_next_check_at: null });
  });

  it('R11: a sonda de A não mexe no estado de B', async () => {
    const x = setup({ closes: true, perm: 'granted' });
    await block(x, WS);
    await block(x, WS_B, at(0.5));
    await x.svc.checkDue(at(1));
    expect(x.acc(WS).publish_block_reason).toBeNull();
    expect(x.acc(WS_B)).toMatchObject({ publish_block_reason: 'permission', publish_next_check_at: at(1.5), publish_checked_at: null });
  });
});

describe('sonda — modo só registro (padrão, F0-5 b)', () => {
  it('granted NÃO fecha: registra e empurra a próxima conferência (nunca a cada 5 min)', async () => {
    const x = setup({ perm: 'granted' });
    expect(x.svc.mode).toBe('log_only');
    await block(x);
    expect(await x.svc.checkDue(at(1))).toEqual({ checked: 1, unblocked: 0 });
    expect(x.acc()).toMatchObject({ publish_block_reason: 'permission', publish_block_failures: 1, publish_next_check_at: at(2), publish_checked_at: at(1) });
    await x.svc.checkDue(at(1.1));
    expect(x.probes()).toHaveLength(1);
    // as duas leituras da F0-5 foram feitas
    expect(x.w.calls.some((c) => c.path === `/ig-${WS}/content_publishing_limit` && c.opts.params.fields === 'config,quota_usage')).toBe(true);
  });

  it('as saídas que sobram: "Publicar agora" que dá certo e a reconexão fecham (e zeram as falhas)', async () => {
    const x = setup({ perm: 'granted' });
    await block(x);
    let n = 0;
    x.w.respond((path, opts) => {
      if (path === `/ig-${WS}/media` && opts.method === 'POST') return { id: `c${++n}` };
      if (/^\/c\d+$/.test(path)) return { status_code: 'FINISHED' };
      if (path === `/ig-${WS}/media_publish`) return { id: 'm1' };
      return undefined;
    });
    const waiting = seedPost(x.w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - 60e3) });
    const job = { id: uuid(), workspace_id: WS, channel: 'instagram_organic', status: 'pending', ig_post_id: waiting.id, run_at: new Date(Date.now() + 30 * 60e3), attempts: 1 };
    x.w.t['publishing_jobs']!.rows.push(job);
    expect(await x.s.actions.publishInstagramPost(OWNER, WS, seedPost(x.w, { workspace_id: WS }).id)).toMatchObject({ ok: true });
    expect(x.acc()).toMatchObject({ publish_block_reason: null, publish_block_failures: 0 });
    expect(job.run_at.getTime()).toBeLessThanOrEqual(Date.now());

    await block(x);
    x.w.respond((path) => (path === '/page1' ? { instagram_business_account: { id: `ig-${WS}` } } : path === `/ig-${WS}` ? { username: 'loja' } : undefined));
    expect(await x.s.account.connectInstagramAccount(WS)).toMatchObject({ ok: true });
    expect(x.acc()).toMatchObject({ publish_block_reason: null, publish_block_message: null, publish_next_check_at: null, publish_block_failures: 0 });
    expect(x.acc().publish_unblocked_at).toBeInstanceOf(Date);
  });
});

describe('botão "Já corrigi — testar agora" (POST …/instagram-account/publish-check)', () => {
  it('sem bloqueio: "funcionando" sem chamar a Meta', async () => {
    const x = setup({ closes: true, perm: 'granted' });
    expect(await x.svc.checkNow(WS, t0)).toEqual({ ok: true, unblocked: true, probe: 'active', message: PUBLISH_CHECK_MSG.working });
    expect(x.probes()).toHaveLength(0);
  });

  it('ativo: granted fecha (pelo botão); recusado responde o texto; menos de 60 s → 409; token → 422', async () => {
    const x = setup({ closes: true, perm: 'declined' });
    await block(x);
    expect(await x.svc.checkNow(WS, at(0.1))).toEqual({ ok: true, unblocked: false, probe: 'active', message: PUBLISH_CHECK_MSG.denied });
    const e409 = await err(x.svc.checkNow(WS, new Date(at(0.1).getTime() + 59e3)));
    expect(e409.getStatus()).toBe(409);
    expect(e409.getResponse()).toEqual({ code: 'PUBLISH_CHECK_TOO_SOON', message: 'Espere um minuto para testar de novo.' });
    x.state.perm = 'granted';
    expect(await x.svc.checkNow(WS, new Date(at(0.1).getTime() + 61e3))).toMatchObject({ unblocked: true, message: PUBLISH_CHECK_MSG.unblocked });
    expect(x.w.t['ig_autopilot_events']!.rows.map((e) => e.message)).toContain('A Meta voltou a aceitar publicações (o teste pelo botão viu a permissão de publicar).');

    await x.w.store.openPublishBlock(WS, 'token', 'token', { silent: true });
    const e422 = await err(x.svc.checkNow(WS, at(2)));
    expect(e422.getStatus()).toBe(422);
    expect(e422.getResponse()).toEqual({ code: 'PUBLISH_NEEDS_RECONNECT', message: 'Reconecte o Instagram em Instagram → Visão geral.' });
  });

  it('só registro: o botão confere e registra, mas não fecha', async () => {
    const x = setup({ perm: 'granted' });
    await block(x);
    expect(await x.svc.checkNow(WS, at(0.2))).toEqual({ ok: true, unblocked: false, probe: 'log_only', message: PUBLISH_CHECK_MSG.logOnly });
    expect(x.acc().publish_block_reason).toBe('permission');
  });

  it('empresa A × B: o botão de A não confere nem fecha B', async () => {
    const x = setup({ closes: true, perm: 'granted' });
    await block(x, WS_B);
    expect(await x.svc.checkNow(WS, t0)).toMatchObject({ unblocked: true, message: PUBLISH_CHECK_MSG.working });
    expect(x.acc(WS_B).publish_block_reason).toBe('permission');
    expect(x.probes()).toHaveLength(0);
  });

  it('acesso: escrita (viewer e estranho 403; marketing pode)', async () => {
    const w = igWorld();
    const g = new WorkspaceAccessGuard(w.access, new Reflector());
    const run = (user: string) => {
      const req = { method: 'POST', user: { id: user }, params: { workspaceId: WS } };
      const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => InstagramResourcesController.prototype.publishCheck, getClass: () => InstagramResourcesController } as unknown as ExecutionContext;
      return g.canActivate(ctx);
    };
    await expect(run(VIEWER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(STRANGER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await run(MARKETING)).toBe(true);
  });
});
