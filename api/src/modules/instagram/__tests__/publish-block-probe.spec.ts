import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceAccessGuard } from '../../access/workspace-access.guard';
import { FilesService } from '../../files/files.service';
import { MARKETING, OWNER, STRANGER, VIEWER, WS_B } from '../../media/__tests__/mem';
import { InstagramResourcesController } from '../instagram-resources.controller';
import { MetaError } from '../meta-graph';
import { PROBE_IMAGE_KEY, PUBLISH_CHECK_MSG } from '../publish-block.service';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';

const WS = igWorld().WS_A;
const H = 3600e3;
const t0 = new Date('2026-11-24T12:00:00Z');
const at = (h: number) => new Date(t0.getTime() + h * H);
/** Resposta da Meta à criação do container de story da sonda. */
type Meta = 'created' | 'permission' | 'network' | 'media' | 'token';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(o: { meta?: Meta } = {}) {
  const w: IgWorld = igWorld();
  for (const ws of [WS, WS_B]) w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: ws, ig_user_id: `ig-${ws}`, status: 'connected', username: 'loja', publish_block_reason: null, publish_block_failures: 0, publish_checked_at: null });
  const state = { meta: o.meta ?? 'permission' };
  let n = 0;
  w.respond((p, opts) => {
    if (!/^\/ig-[^/]+\/media$/.test(p) || opts.method !== 'POST') return undefined;
    if (state.meta === 'permission') return new MetaError('(#10) Application does not have permission for this action', 10);
    if (state.meta === 'network') return new MetaError('Não foi possível falar com a Meta agora. Tente de novo em instantes.');
    if (state.meta === 'media') return new MetaError('Media download has failed.', 9004, 2207052);
    if (state.meta === 'token') return new MetaError('token', 190);
    return { id: `probe-c${++n}` };
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-probe-'));
  dirs.push(dir);
  const files = new FilesService({ UPLOADS_DIR: dir, JWT_SECRET: 'segredo-de-teste-16+', PUBLIC_URL: 'http://api.test', FILES_SIGNING_SECRET: undefined } as any);
  const s = igServices(w, { files });
  const acc = (ws = WS) => w.t['instagram_accounts']!.rows.find((r) => r.workspace_id === ws)!;
  const containers = () => w.calls.filter((c) => /^\/ig-[^/]+\/media$/.test(c.path) && c.opts.method === 'POST');
  const published = () => w.calls.filter((c) => c.path.endsWith('/media_publish'));
  return { w, s, state, acc, containers, published, files, svc: s.publishBlock };
}
const block = (x: ReturnType<typeof setup>, ws = WS, now = t0) => x.w.store.openPublishBlock(ws, 'permission', '(#10) sem permissão', { now });
const err = async (p: Promise<unknown>) => p.then(() => null, (e) => e);
const events = (x: ReturnType<typeof setup>) => x.w.t['ig_autopilot_events']!.rows.map((e) => e.message);

describe('sonda do bloqueio (R8): cria um container de story e NUNCA publica', () => {
  it('só confere quem venceu a conferência; container criado fecha o bloqueio (conferência) e mantém as falhas', async () => {
    const x = setup({ meta: 'created' });
    await block(x);
    expect(await x.svc.checkDue(at(0.5))).toEqual({ checked: 0, unblocked: 0 });
    expect(x.containers()).toHaveLength(0);
    expect(await x.svc.checkDue(at(1))).toEqual({ checked: 1, unblocked: 1 });
    expect(x.containers()).toHaveLength(1);
    expect(x.published()).toHaveLength(0);
    expect(x.containers()[0]!).toMatchObject({ ws: WS, path: `/ig-${WS}/media` });
    expect(x.containers()[0]!.opts.params).toEqual({ media_type: 'STORIES', image_url: expect.stringMatching(/^http:\/\/api\.test\/v1\/files\/creative-assets\/system\/publish-probe\.jpg\?exp=\d+&sig=[0-9a-f]{64}$/) });
    expect(x.acc()).toMatchObject({ publish_block_reason: null, publish_block_failures: 1, publish_checked_at: at(1) });
    expect(events(x)).toContain('A Meta voltou a aceitar publicações (a conferência automática conseguiu preparar um story de teste).');
  });

  it('a imagem é um JPEG 1080 × 1920 (o único formato de imagem que a Meta aceita em story), servido pela URL assinada de 1 h', async () => {
    const x = setup({ meta: 'created' });
    await block(x);
    const before = Date.now();
    await x.svc.checkDue(at(1));
    const url = new URL(x.containers()[0]!.opts.params.image_url);
    const exp = Number(url.searchParams.get('exp'));
    expect(exp * 1000 - before).toBeGreaterThan(59 * 60e3);
    expect(exp * 1000 - before).toBeLessThanOrEqual(61 * 60e3);
    expect(() => x.files.verify('creative-assets', PROBE_IMAGE_KEY, url.searchParams.get('exp')!, url.searchParams.get('sig')!)).not.toThrow();
    const bytes = await x.files.read('creative-assets', PROBE_IMAGE_KEY);
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const img = require('jpeg-js').decode(bytes);
    expect([img.width, img.height]).toEqual([1080, 1920]);
    // gravada uma vez: a 2ª conferência reaproveita o arquivo
    const put = jest.spyOn(x.files, 'put');
    await block(x, WS, at(2));
    await x.svc.checkDue(at(10));
    expect(x.containers()).toHaveLength(2);
    expect(put).not.toHaveBeenCalled();
  });

  it('recusa por permissão (#10/#200–299): soma falha e respeita a escada (1 h → 3 h → 6 h)', async () => {
    const x = setup({ meta: 'permission' });
    await block(x);
    await x.svc.checkDue(at(1));
    expect(x.acc()).toMatchObject({ publish_block_reason: 'permission', publish_block_failures: 2, publish_next_check_at: at(4) });
    await x.svc.checkDue(at(3.9));
    expect(x.containers()).toHaveLength(1);
    await x.svc.checkDue(at(4));
    expect(x.acc()).toMatchObject({ publish_block_failures: 3, publish_next_check_at: at(10) });
    expect(x.published()).toHaveLength(0);
  });

  it('erro passageiro (rede ou mídia que a Meta não baixou): não muda o bloqueio nem as falhas; tenta de novo em 1 h', async () => {
    for (const meta of ['network', 'media'] as Meta[]) {
      const x = setup({ meta });
      await block(x);
      expect(await x.svc.checkDue(at(1))).toEqual({ checked: 1, unblocked: 0 });
      expect(x.acc()).toMatchObject({ publish_block_reason: 'permission', publish_block_failures: 1, publish_next_check_at: at(2) });
    }
  });

  it('190 na sonda: vira bloqueio de token (só a reconexão resolve), como na fila', async () => {
    const x = setup({ meta: 'token' });
    await block(x);
    await x.svc.checkDue(at(1));
    expect(x.acc()).toMatchObject({ status: 'error', publish_block_reason: 'token', publish_next_check_at: null });
  });

  it('R11: a sonda de A não mexe no estado de B', async () => {
    const x = setup({ meta: 'created' });
    await block(x, WS);
    await block(x, WS_B, at(0.5));
    await x.svc.checkDue(at(1));
    expect(x.acc(WS).publish_block_reason).toBeNull();
    expect(x.acc(WS_B)).toMatchObject({ publish_block_reason: 'permission', publish_next_check_at: at(1.5), publish_checked_at: null });
    expect(x.containers().map((c) => c.ws)).toEqual([WS]);
  });

  it('as outras saídas continuam: "Publicar agora" que dá certo e a reconexão fecham (e zeram as falhas)', async () => {
    const x = setup({ meta: 'created' });
    await block(x);
    let n = 0;
    x.w.respond((p, opts) => {
      if (p === `/ig-${WS}/media` && opts.method === 'POST') return { id: `c${++n}` };
      if (/^\/c\d+$/.test(p)) return { status_code: 'FINISHED' };
      if (p === `/ig-${WS}/media_publish`) return { id: 'm1' };
      return undefined;
    });
    const waiting = seedPost(x.w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - 60e3) });
    const job = { id: uuid(), workspace_id: WS, channel: 'instagram_organic', status: 'pending', ig_post_id: waiting.id, run_at: new Date(Date.now() + 30 * 60e3), attempts: 1 };
    x.w.t['publishing_jobs']!.rows.push(job);
    expect(await x.s.actions.publishInstagramPost(OWNER, WS, seedPost(x.w, { workspace_id: WS }).id)).toMatchObject({ ok: true });
    expect(x.acc()).toMatchObject({ publish_block_reason: null, publish_block_failures: 0 });
    expect(job.run_at.getTime()).toBeLessThanOrEqual(Date.now());

    await block(x);
    x.w.respond((p) => (p === '/page1' ? { instagram_business_account: { id: `ig-${WS}` } } : p === `/ig-${WS}` ? { username: 'loja' } : undefined));
    expect(await x.s.account.connectInstagramAccount(WS)).toMatchObject({ ok: true });
    expect(x.acc()).toMatchObject({ publish_block_reason: null, publish_block_message: null, publish_next_check_at: null, publish_block_failures: 0 });
    expect(x.acc().publish_unblocked_at).toBeInstanceOf(Date);
  });
});

describe('botão "Já corrigi — testar agora" (POST …/instagram-account/publish-check)', () => {
  it('sem bloqueio: "funcionando" sem chamar a Meta', async () => {
    const x = setup({ meta: 'created' });
    expect(await x.svc.checkNow(WS, t0)).toEqual({ ok: true, unblocked: true, message: PUBLISH_CHECK_MSG.working, next_check_at: null });
    expect(x.containers()).toHaveLength(0);
  });

  it('recusado responde o texto e a próxima conferência; menos de 60 s → 409; container criado fecha (pelo botão); token → 422', async () => {
    const x = setup({ meta: 'permission' });
    await block(x);
    expect(await x.svc.checkNow(WS, at(0.1))).toEqual({ ok: true, unblocked: false, message: PUBLISH_CHECK_MSG.denied, next_check_at: new Date(at(0.1).getTime() + 3 * H) });
    const e409 = await err(x.svc.checkNow(WS, new Date(at(0.1).getTime() + 59e3)));
    expect(e409.getStatus()).toBe(409);
    expect(e409.getResponse()).toEqual({ code: 'PUBLISH_CHECK_TOO_SOON', message: 'Espere um minuto para testar de novo.' });
    expect(x.containers()).toHaveLength(1);
    x.state.meta = 'created';
    expect(await x.svc.checkNow(WS, new Date(at(0.1).getTime() + 61e3))).toEqual({ ok: true, unblocked: true, message: PUBLISH_CHECK_MSG.unblocked, next_check_at: null });
    expect(events(x)).toContain('A Meta voltou a aceitar publicações (o teste pelo botão conseguiu preparar um story de teste).');
    expect(x.published()).toHaveLength(0);

    await x.w.store.openPublishBlock(WS, 'token', 'token', { silent: true });
    const e422 = await err(x.svc.checkNow(WS, at(2)));
    expect(e422.getStatus()).toBe(422);
    expect(e422.getResponse()).toEqual({ code: 'PUBLISH_NEEDS_RECONNECT', message: 'Reconecte o Instagram em Instagram → Visão geral.' });
  });

  it('erro passageiro: o bloqueio fica, a resposta diz e traz a próxima conferência (+1 h)', async () => {
    const x = setup({ meta: 'network' });
    await block(x);
    expect(await x.svc.checkNow(WS, at(0.2))).toEqual({ ok: true, unblocked: false, message: PUBLISH_CHECK_MSG.error, next_check_at: at(1.2) });
    expect(x.acc().publish_block_reason).toBe('permission');
  });

  it('empresa A × B: o botão de A não confere nem fecha B', async () => {
    const x = setup({ meta: 'created' });
    await block(x, WS_B);
    expect(await x.svc.checkNow(WS, t0)).toMatchObject({ unblocked: true, message: PUBLISH_CHECK_MSG.working });
    expect(x.acc(WS_B).publish_block_reason).toBe('permission');
    expect(x.containers()).toHaveLength(0);
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
