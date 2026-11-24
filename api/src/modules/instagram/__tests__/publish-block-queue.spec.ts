import { MetaError } from '../meta-graph';
import { PUBLISH_BLOCKED_MSG, TOKEN_EXPIRED_POST_MSG } from '../ig-types';
import { PublishingService } from '../publishing.service';
import { useVirtualClock } from '../../../common/__tests__/virtual-clock';
import { WS_B } from '../../media/__tests__/mem';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';

const WS = igWorld().WS_A;
const H = 3600e3;
const MIN = 60e3;
const IG_A = 'ig-a';
const IG_B = 'ig-b';
const PERM = () => new MetaError('(#10) Requires instagram_content_publish permission', 10);

/** Mundo com A e B conectadas; `denyA` = a Meta recusa a criação de container de A por permissão. */
function setup(o: { denyA?: boolean } = {}) {
  const w: IgWorld = igWorld();
  w.t['instagram_accounts']!.rows.push(
    { id: uuid(), workspace_id: WS, ig_user_id: IG_A, status: 'connected', username: 'a', publish_block_reason: null, publish_block_failures: 0 },
    { id: uuid(), workspace_id: WS_B, ig_user_id: IG_B, status: 'connected', username: 'b', publish_block_reason: null, publish_block_failures: 0 },
  );
  const deny = { a: !!o.denyA };
  let n = 0;
  w.respond((path, opts) => {
    if (path.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: 1 }] };
    if (path === `/${IG_A}/media` && opts.method === 'POST' && deny.a) return PERM();
    if (path.endsWith('/media') && opts.method === 'POST') return { id: `c${++n}` };
    if (path.endsWith('/media_publish')) return { id: 'm1' };
    if (path === '/m1') return { permalink: 'https://instagram.com/p/x' };
    if (/^\/c\d+$/.test(path)) return { status_code: 'FINISHED' };
    return undefined;
  });
  const svc = new PublishingService(w.store, w.graph, (async () => new Response(null, { status: 200 })) as any);
  useVirtualClock(svc);
  const acc = (ws: string) => w.t['instagram_accounts']!.rows.find((r) => r.workspace_id === ws)!;
  const containers = (ig: string) => w.calls.filter((c) => c.path === `/${ig}/media` && c.opts.method === 'POST').length;
  const job = (p: any, over: Record<string, unknown> = {}) => {
    const j = { id: uuid(), workspace_id: p.workspace_id, channel: 'instagram_organic', status: 'pending', ig_post_id: p.id, run_at: new Date(Date.now() - MIN), attempts: 0, log: null, locked_at: null, ...over };
    w.t['publishing_jobs']!.rows.push(j);
    return j;
  };
  return { w, svc, deny, acc, containers, job };
}

describe('fila com o bloqueio de publicação (R3, R4, R11)', () => {
  it('#10 abre o bloqueio; o job volta pending SEM gastar tentativa e o post volta agendado no MESMO horário, com o aviso', async () => {
    const { w, svc, acc, job } = setup({ denyA: true });
    const at = new Date(Date.now() - 2 * MIN);
    const p = seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: at, retry_count: 0 });
    const j = job(p, { attempts: 1 });
    const r = await svc.runPublishingQueue();
    expect(r).toEqual([expect.objectContaining({ job: j.id, status: 'blocked' })]);
    expect(acc(WS)).toMatchObject({ publish_block_reason: 'permission', publish_block_failures: 1 });
    expect(j).toMatchObject({ status: 'pending', attempts: 1, locked_at: null });
    // run_at = próxima conferência (1 h), no máximo 60 min
    expect(Math.abs(j.run_at.getTime() - (Date.now() + H))).toBeLessThan(5_000);
    expect(p).toMatchObject({ status: 'scheduled', scheduled_at: at, last_error: PUBLISH_BLOCKED_MSG, retry_count: 0 });
    expect(p.failure_kind ?? null).toBeNull();
    expect(w.t['ig_autopilot_events']!.rows.map((e) => e.message)).toContain('Publicação parada: a Meta recusou por falta de permissão.');
  });

  it('empresa bloqueada: o job vencido é adiado sem chamar a Meta, sem tentativa; mais de 12 h depois do horário → failed com o motivo', async () => {
    const { w, svc, acc, containers, job } = setup();
    await w.store.openPublishBlock(WS, 'permission', '(#10)', { now: new Date('2026-11-20T11:30:00Z') });
    const recent = seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - 10 * MIN) });
    const old = seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - 13 * H) });
    const j1 = job(recent, { attempts: 2 });
    const j2 = job(old, { attempts: 0 });
    await svc.runPublishingQueue();
    expect(containers(IG_A)).toBe(0);
    expect(j1).toMatchObject({ status: 'pending', attempts: 2 });
    expect(j1.run_at.getTime()).toBeGreaterThan(Date.now());
    expect(recent).toMatchObject({ status: 'scheduled', last_error: PUBLISH_BLOCKED_MSG });
    expect(j2.status).toBe('failed');
    expect(old).toMatchObject({ status: 'failed', failure_kind: 'publish' });
    expect(old.last_error).toMatch(/^Não foi publicado: a Meta recusou as publicações desta empresa entre 20\/11 às 8h30 e \d{2}\/\d{2} às \d{1,2}h(\d{2})?\.$/);
    expect(acc(WS).publish_block_reason).toBe('permission');
  });

  it('empresa bloqueada: job sem post (ou post sem horário) expira 12 h depois da CRIAÇÃO do job (o run_at muda a cada adiamento)', async () => {
    const { w, svc, containers, job } = setup();
    await w.store.openPublishBlock(WS, 'permission', '(#10)', { now: new Date('2026-11-20T11:30:00Z') });
    const orphanOld = job({ id: null, workspace_id: WS }, { ig_post_id: null, created_at: new Date(Date.now() - 13 * H) });
    const orphanNew = job({ id: null, workspace_id: WS }, { ig_post_id: null, created_at: new Date(Date.now() - 1 * H) });
    const noTime = seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: null });
    const jNoTime = job(noTime, { created_at: new Date(Date.now() - 13 * H) });
    await svc.runPublishingQueue();
    expect(containers(IG_A)).toBe(0);
    expect(orphanOld.status).toBe('failed');
    expect(orphanOld.log).toMatch(/Não foi publicado: a Meta recusou as publicações desta empresa entre 20\/11 às 8h30 e /);
    expect(orphanNew).toMatchObject({ status: 'pending', attempts: 0 });
    expect(orphanNew.run_at.getTime()).toBeGreaterThan(Date.now());
    expect(jNoTime.status).toBe('failed');
    expect(noTime).toMatchObject({ status: 'failed', failure_kind: 'publish' });
  });

  it('R11: A bloqueada com 6 jobs vencidos não ocupa a vez de B (que publica na mesma rodada)', async () => {
    const { w, svc, containers, job } = setup();
    await w.store.openPublishBlock(WS, 'permission', '(#10)');
    for (let i = 0; i < 6; i++) job(seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - (i + 1) * MIN) }), { run_at: new Date(Date.now() - (i + 10) * MIN) });
    const pb = seedPost(w, { workspace_id: WS_B, status: 'scheduled', scheduled_at: new Date(Date.now() - MIN) });
    const jb = job(pb, { run_at: new Date(Date.now() - MIN) });
    await svc.runPublishingQueue();
    expect(containers(IG_A)).toBe(0);
    expect(jb.status).toBe('done');
    expect(pb.status).toBe('published');
  });

  it('o 1º job de A recusado na rodada: os outros de A na mesma rodada são adiados sem chamar a Meta; B publica', async () => {
    const { w, svc, containers, job, acc } = setup({ denyA: true });
    const a1 = job(seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - 3 * MIN) }), { run_at: new Date(Date.now() - 3 * MIN) });
    const a2 = job(seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - 2 * MIN) }), { run_at: new Date(Date.now() - 2 * MIN) });
    const jb = job(seedPost(w, { workspace_id: WS_B, status: 'scheduled', scheduled_at: new Date(Date.now() - MIN) }), { run_at: new Date(Date.now() - MIN) });
    await svc.runPublishingQueue();
    expect(containers(IG_A)).toBe(1);
    expect([a1.status, a2.status]).toEqual(['pending', 'pending']);
    expect(a2.attempts).toBe(0);
    expect(jb.status).toBe('done');
    expect(acc(WS).publish_block_failures).toBe(1);
    expect(acc(WS_B).publish_block_reason).toBeNull();
  });

  it('publicação que dá certo fecha o bloqueio, zera as falhas e antecipa os adiados da empresa', async () => {
    const { w, svc, acc, job } = setup();
    await w.store.openPublishBlock(WS, 'permission', '(#10)');
    await w.store.openPublishBlock(WS, 'permission', '(#10)');
    const waiting = seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - 5 * MIN), last_error: PUBLISH_BLOCKED_MSG });
    const jw = job(waiting, { run_at: new Date(Date.now() + 40 * MIN) });
    const now = seedPost(w, { workspace_id: WS }); // "Publicar agora" de um post normal
    expect(await svc.publishInstagramPost(now.id, WS)).toMatchObject({ ok: true });
    expect(acc(WS)).toMatchObject({ publish_block_reason: null, publish_block_failures: 0 });
    expect(acc(WS).publish_unblocked_at).toBeInstanceOf(Date);
    expect(jw.run_at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(w.t['ig_autopilot_events']!.rows.map((e) => e.message)).toContain('A Meta voltou a aceitar publicações (uma publicação deu certo).');
  });

  it('ao fechar, os adiados voltam em escalonamento (4 por rodada de 5 min, na ordem do horário do post)', async () => {
    const { w, job } = setup();
    await w.store.openPublishBlock(WS, 'permission', '(#10)');
    const jobs = Array.from({ length: 10 }, (_, i) =>
      job(seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - (60 - i) * MIN), last_error: PUBLISH_BLOCKED_MSG }), { run_at: new Date(Date.now() + 40 * MIN) }),
    );
    const now = new Date();
    await w.store.closePublishBlock(WS, 'reconnect', now);
    // Os 10 posts estão em ordem de horário (o 1º é o mais antigo).
    expect(jobs.map((j) => (j.run_at.getTime() - now.getTime()) / MIN)).toEqual([0, 0, 0, 0, 5, 5, 5, 5, 10, 10]);
  });

  it('limite de publicações (RateLimited) não é falha do post: evento de reagendamento, sem tentativa', async () => {
    const { w, svc, job } = setup();
    w.respond((path) => (path.endsWith('/content_publishing_limit') ? { data: [{ quota_usage: 25 }] } : undefined));
    const p = seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - MIN), retry_count: 0 });
    const j = job(p, { attempts: 1 });
    expect(await svc.runPublishingQueue()).toEqual([expect.objectContaining({ job: j.id, status: 'retry' })]);
    expect(j).toMatchObject({ status: 'pending', attempts: 1 });
    expect(p).toMatchObject({ status: 'scheduled', retry_count: 0 });
    const ev = w.t['ig_autopilot_events']!.rows;
    expect(ev).toEqual([expect.objectContaining({ kind: 'reschedule', level: 'info' })]);
    expect(ev[0].message).toMatch(/^Limite de 25 publicações em 24h atingido\. Vai ao ar às \d{2}h\d{2}\.$/);
  });

  it('corrida: a Meta recusa uma tentativa que começou antes de o bloqueio fechar → não reabre; o job volta em 5 min, sem tentativa e sem o aviso', async () => {
    const { w, svc, acc, job } = setup();
    // A reconexão acontece no meio da tentativa: entre o início dela e a recusa da Meta.
    w.respond((path, opts) => {
      if (path === `/${IG_A}/media` && opts.method === 'POST') {
        acc(WS).publish_unblocked_at = new Date(Date.now() + 1);
        return PERM();
      }
      return undefined;
    });
    const at = new Date(Date.now() - 2 * MIN);
    const p = seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: at, retry_count: 0 });
    const j = job(p, { attempts: 1 });
    const r = await svc.runPublishingQueue();
    expect(r).toEqual([expect.objectContaining({ job: j.id, status: 'retry' })]);
    expect(acc(WS)).toMatchObject({ publish_block_reason: null, publish_block_failures: 0 });
    expect(j).toMatchObject({ status: 'pending', attempts: 1, locked_at: null });
    expect(Math.abs(j.run_at.getTime() - (Date.now() + 5 * MIN))).toBeLessThan(5_000);
    expect(p).toMatchObject({ status: 'scheduled', scheduled_at: at, retry_count: 0 });
    expect(p.last_error ?? null).toBeNull();
    expect(w.t['ig_autopilot_events']!.rows).toHaveLength(0);
  });

  it('token vencido (190) na fila grava o motivo `token` (sem próxima conferência), como hoje pausa e suspende', async () => {
    const { w, svc, acc, job } = setup();
    w.respond((path, opts) => (path === `/${IG_A}/media` && opts.method === 'POST' ? new MetaError('token', 190) : undefined));
    const p = seedPost(w, { workspace_id: WS, status: 'scheduled', scheduled_at: new Date(Date.now() - MIN), run_id: uuid() });
    job(p);
    await svc.runPublishingQueue();
    expect(acc(WS)).toMatchObject({ status: 'error', publish_block_reason: 'token', publish_next_check_at: null });
    expect(p).toMatchObject({ status: 'ready', last_error: TOKEN_EXPIRED_POST_MSG });
  });
});

describe('"Publicar agora" com #10 (R3: nunca agendado sem job)', () => {
  function actions(source: string, over: Record<string, unknown> = {}) {
    const s = setup({ denyA: true });
    const svcs = igServices(s.w, { guards: { blockReason: async () => null } as any });
    // os serviços do harness usam a mesma Graph falsa: a recusa vale para eles também
    const p = seedPost(s.w, { workspace_id: WS, source, ...over });
    return { ...s, svcs, p };
  }

  it('post manual: falhou com o aviso, o erro da Meta vai para a resposta e o bloqueio abre', async () => {
    const { svcs, p, acc, w } = actions('app');
    const r = await svcs.actions.publishInstagramPost(w.OWNER, WS, p.id);
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/permiss/i);
    expect(p).toMatchObject({ status: 'failed', last_error: PUBLISH_BLOCKED_MSG, failure_kind: 'publish' });
    expect(acc(WS).publish_block_reason).toBe('permission');
    expect(w.t['publishing_jobs']!.rows.filter((j) => j.ig_post_id === p.id && j.status === 'pending')).toHaveLength(0);
  });

  it('story de vaga e post da programação: voltam para "pronto" com o aviso (a agenda retoma quando fechar)', async () => {
    const v = actions('vacancy', { format: 'story_image', creative_brief: { vacancy: { requires_approval: false } } });
    expect(await v.svcs.actions.publishInstagramPost(v.w.OWNER, WS, v.p.id)).toMatchObject({ ok: false });
    expect(v.p).toMatchObject({ status: 'ready', last_error: PUBLISH_BLOCKED_MSG });

    const run = actions('app', { run_id: uuid() });
    expect(await run.svcs.actions.publishInstagramPost(run.w.OWNER, WS, run.p.id)).toMatchObject({ ok: false });
    expect(run.p).toMatchObject({ status: 'ready', last_error: PUBLISH_BLOCKED_MSG });
  });
});
