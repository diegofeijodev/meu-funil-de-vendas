import { MetaError, PublishPermissionError } from '../meta-graph';
import { classifyPublishError, nextCheckDelay, toPublishError } from '../publish-block';
import { PublishingService } from '../publishing.service';
import { useVirtualClock } from '../../../common/__tests__/virtual-clock';
import { igWorld, seedPost, uuid } from './harness';

const H = 3600e3;
const meta = (code?: number) => new MetaError(`erro ${code ?? 'rede'}`, code);

describe('classifyPublishError (R1: pelo código, nunca pela mensagem)', () => {
  it('10 e 200–299 = permissão; 190 = token; o resto não classifica', () => {
    expect(classifyPublishError(meta(10))).toBe('permission');
    expect(classifyPublishError(meta(200))).toBe('permission');
    expect(classifyPublishError(meta(299))).toBe('permission');
    expect(classifyPublishError(meta(190))).toBe('token');
    for (const c of [100, 9004, 4, 300, 2]) expect(classifyPublishError(meta(c))).toBeNull();
    expect(classifyPublishError(meta())).toBeNull(); // rede (sem código)
    expect(classifyPublishError(new Error('Permissão insuficiente na Meta (#10)'))).toBeNull(); // texto não conta
    expect(classifyPublishError(null)).toBeNull();
  });

  it('toPublishError: só a permissão vira a subclasse (mesma mensagem e códigos); o resto passa igual', () => {
    const p = toPublishError(new MetaError('sem permissão', 10, 2207));
    expect(p).toBeInstanceOf(PublishPermissionError);
    expect(p).toBeInstanceOf(MetaError);
    expect(p).toMatchObject({ message: 'sem permissão', code: 10, subcode: 2207 });
    const token = meta(190);
    expect(toPublishError(token)).toBe(token);
    const net = new Error('queda');
    expect(toPublishError(net)).toBe(net);
    expect(classifyPublishError(p)).toBe('permission');
  });

  it('nextCheckDelay: 1 h, 3 h, 6 h, 12 h e teto de 24 h', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => nextCheckDelay(n) / H)).toEqual([1, 1, 3, 6, 12, 24, 24]);
  });
});

describe('caminho de publicação: só a criação do container e o media_publish classificam', () => {
  const WS = igWorld().WS_A;
  const IG = 'ig-1';
  function setup() {
    const w = igWorld();
    w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS, ig_user_id: IG, status: 'connected' });
    const svc = new PublishingService(w.store, w.graph, (async () => new Response(null, { status: 200 })) as any);
    useVirtualClock(svc);
    return { w, svc };
  }
  const err = async (p: Promise<unknown>) => p.then(() => null, (e) => e);

  it('#10 no content_publishing_limit é engolido (publica igual)', async () => {
    const { w, svc } = setup();
    w.respond((path, opts) => {
      if (path === `/${IG}/content_publishing_limit`) return new MetaError('(#10) Requires instagram_content_publish permission', 10);
      if (path === `/${IG}/media` && opts.method === 'POST') return { id: 'c1' };
      if (path === '/c1') return { status_code: 'FINISHED' };
      if (path === `/${IG}/media_publish`) return { id: 'm1' };
      if (path === '/m1') return new MetaError('(#10) sem permissão no permalink', 10);
      return undefined;
    });
    const p = seedPost(w, { workspace_id: WS });
    expect(await svc.publishInstagramPost(p.id)).toMatchObject({ ok: true });
  });

  it('#10 ao criar o container e no media_publish = PublishPermissionError', async () => {
    const a = setup();
    a.w.respond((path, opts) => (path === `/${IG}/media` && opts.method === 'POST' ? new MetaError('(#10) Requires instagram_content_publish permission', 10) : undefined));
    expect(await err(a.svc.publishInstagramPost(seedPost(a.w, { workspace_id: WS }).id))).toBeInstanceOf(PublishPermissionError);

    const b = setup();
    b.w.respond((path, opts) => {
      if (path === `/${IG}/media` && opts.method === 'POST') return { id: 'c1' };
      if (path === '/c1') return { status_code: 'FINISHED' };
      if (path === `/${IG}/media_publish`) return new MetaError('(#200) Permissions error', 200);
      return undefined;
    });
    expect(await err(b.svc.publishInstagramPost(seedPost(b.w, { workspace_id: WS }).id))).toBeInstanceOf(PublishPermissionError);
  });

  it('190 ao criar o container continua MetaError comum (caminho do token, como hoje)', async () => {
    const { w, svc } = setup();
    w.respond((path, opts) => (path === `/${IG}/media` && opts.method === 'POST' ? new MetaError('token', 190) : undefined));
    const e = await err(svc.publishInstagramPost(seedPost(w, { workspace_id: WS }).id));
    expect(e).toBeInstanceOf(MetaError);
    expect(e).not.toBeInstanceOf(PublishPermissionError);
  });
});

describe('IgStore — estado do bloqueio (R2, R9, R11)', () => {
  const { WS_A } = igWorld();
  const WS_B = '22222222-2222-4222-8222-222222222222';
  function world() {
    const w = igWorld();
    for (const ws of [WS_A, WS_B]) w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: ws, ig_user_id: `ig-${ws}`, status: 'connected', username: 'loja', publish_block_reason: null, publish_block_failures: 0 });
    return w;
  }
  const acc = (w: ReturnType<typeof igWorld>, ws: string) => w.t['instagram_accounts']!.rows.find((r) => r.workspace_id === ws)!;
  const events = (w: ReturnType<typeof igWorld>, ws: string) => w.t['ig_autopilot_events']!.rows.filter((e) => e.workspace_id === ws).map((e) => e.message);
  const t0 = new Date('2026-11-20T11:30:00Z');
  const later = (h: number) => new Date(t0.getTime() + h * H);

  it('abrir: grava motivo, mantém o início, soma falhas e marca a próxima conferência; um evento por abertura', async () => {
    const w = world();
    expect(await w.store.openPublishBlock(WS_A, 'permission', '(#10) sem permissão', { now: t0 })).toEqual({ opened: true });
    expect(acc(w, WS_A)).toMatchObject({ publish_block_reason: 'permission', publish_block_message: '(#10) sem permissão', publish_blocked_at: t0, publish_block_last_at: t0, publish_block_failures: 1, publish_next_check_at: later(1) });
    expect(await w.store.openPublishBlock(WS_A, 'permission', '(#10) de novo', { now: later(2) })).toEqual({ opened: false });
    expect(acc(w, WS_A)).toMatchObject({ publish_blocked_at: t0, publish_block_last_at: later(2), publish_block_failures: 2, publish_next_check_at: later(5), publish_block_message: '(#10) de novo' });
    expect(events(w, WS_A)).toEqual(['Publicação parada: a Meta recusou por falta de permissão.']);
    expect(await w.store.publishAccount(WS_A)).toBeNull();
    expect((await w.store.publishBlock(WS_A))?.publish_block_reason).toBe('permission');
    // R11: a empresa B segue publicando.
    expect(acc(w, WS_B).publish_block_reason).toBeNull();
    expect(await w.store.publishAccount(WS_B)).not.toBeNull();
    expect(await w.store.publishBlock(WS_B)).toBeNull();
    expect(events(w, WS_B)).toEqual([]);
  });

  it('token prevalece e não tem próxima conferência; permissão não rebaixa um bloqueio de token', async () => {
    const w = world();
    await w.store.openPublishBlock(WS_A, 'token', 'token vencido', { now: t0, silent: true });
    expect(acc(w, WS_A)).toMatchObject({ publish_block_reason: 'token', publish_next_check_at: null });
    expect(events(w, WS_A)).toEqual([]); // silent: quem chama registra o próprio evento
    await w.store.openPublishBlock(WS_A, 'permission', '(#10)', { now: later(1) });
    expect(acc(w, WS_A)).toMatchObject({ publish_block_reason: 'token', publish_next_check_at: null, publish_block_failures: 2 });
  });

  it('fechar pela sonda: zera motivo e conferência, grava unblocked_at, MANTÉM falhas e o início; evento uma vez', async () => {
    const w = world();
    await w.store.openPublishBlock(WS_A, 'permission', '(#10)', { now: t0 });
    await w.store.openPublishBlock(WS_A, 'permission', '(#10)', { now: later(1) });
    expect(await w.store.closePublishBlock(WS_A, 'probe', later(2))).toBe(true);
    expect(acc(w, WS_A)).toMatchObject({ publish_block_reason: null, publish_block_message: null, publish_next_check_at: null, publish_unblocked_at: later(2), publish_block_failures: 2, publish_blocked_at: t0 });
    expect(await w.store.closePublishBlock(WS_A, 'probe', later(3))).toBe(false); // já fechado: nada muda
    expect(events(w, WS_A)).toEqual(['Publicação parada: a Meta recusou por falta de permissão.', 'A Meta voltou a aceitar publicações (a conferência automática viu a permissão de publicar).']);
    // Reabrir continua a escada (3ª falha → 6 h) e recomeça o início.
    await w.store.openPublishBlock(WS_A, 'permission', '(#10)', { now: later(4) });
    expect(acc(w, WS_A)).toMatchObject({ publish_block_failures: 3, publish_blocked_at: later(4), publish_next_check_at: later(10) });
  });

  it('fechar por publicação ou reconexão zera as falhas (prova real), mesmo depois de um fechamento pela sonda', async () => {
    const w = world();
    await w.store.openPublishBlock(WS_A, 'permission', '(#10)', { now: t0 });
    await w.store.closePublishBlock(WS_A, 'probe', later(1));
    expect(acc(w, WS_A).publish_block_failures).toBe(1);
    expect(await w.store.closePublishBlock(WS_A, 'publish', later(2))).toBe(false);
    expect(acc(w, WS_A).publish_block_failures).toBe(0);
    await w.store.openPublishBlock(WS_A, 'permission', '(#10)', { now: later(3) });
    expect(await w.store.closePublishBlock(WS_A, 'reconnect', later(4))).toBe(true);
    expect(acc(w, WS_A)).toMatchObject({ publish_block_reason: null, publish_block_failures: 0 });
  });

  it('fechar antecipa só os jobs adiados da empresa cujo post já passou do horário', async () => {
    const w = world();
    await w.store.openPublishBlock(WS_A, 'permission', '(#10)', { now: t0 });
    const due = seedPost(w, { workspace_id: WS_A, status: 'scheduled', scheduled_at: t0 });
    const future = seedPost(w, { workspace_id: WS_A, status: 'scheduled', scheduled_at: later(5) });
    const other = seedPost(w, { workspace_id: WS_B, status: 'scheduled', scheduled_at: t0 });
    const job = (p: any, run: Date) => ({ id: uuid(), workspace_id: p.workspace_id, channel: 'instagram_organic', status: 'pending', ig_post_id: p.id, run_at: run, attempts: 1 });
    const jobs = [job(due, later(1)), job(future, later(5)), job(other, later(1))];
    w.t['publishing_jobs']!.rows.push(...jobs);
    await w.store.closePublishBlock(WS_A, 'reconnect', later(0.5));
    expect(jobs.map((j) => j.run_at)).toEqual([later(0.5), later(5), later(1)]);
  });
});
