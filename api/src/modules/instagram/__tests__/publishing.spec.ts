import { ContainerPending, Guardrail, IgStore, PublishClaimLost, RateLimited } from '../ig-store.service';
import { MetaError } from '../meta-graph';
import { fullCaption, PublishingService } from '../publishing.service';
import { igWorld, IgWorld, seedPost, uuid } from './harness';
import { WS_B } from '../../media/__tests__/mem';

const WS = igWorld().WS_A;
const IG = 'ig-user-1';
const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return e; } };
const msgOf = (e: any) => (e?.getResponse ? e.getResponse().message : e?.message);

function setup(over: { head?: (url: string, init?: RequestInit) => Promise<Response> } = {}) {
  const w: IgWorld = igWorld();
  w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS, ig_user_id: IG, status: 'connected', username: 'loja' });
  const head = jest.fn(over.head ?? (async () => new Response(null, { status: 200 })));
  const svc = new PublishingService(w.store, w.graph, head as any);
  svc.sleep = async () => undefined;
  let n = 0;
  w.respond((path, opts) => {
    if (path === `/${IG}/content_publishing_limit`) return { data: [{ quota_usage: 1 }] };
    if (path === `/${IG}/media` && opts.method === 'POST') return { id: `c${++n}` };
    if (path === `/${IG}/media_publish`) return { id: 'm1' };
    if (path === '/m1') return { permalink: 'https://instagram.com/p/x' };
    if (/^\/c\d+$/.test(path)) return { status_code: 'FINISHED' };
    return undefined;
  });
  return { w, svc, head, created: () => w.calls.filter((c) => c.path === `/${IG}/media` && c.opts.method === 'POST').map((c) => c.opts.params) };
}

describe('PublishingService.schedulePost', () => {
  it('valida mídia, status e aprovação com as mensagens do protótipo', async () => {
    const { w, svc } = setup();
    const noMedia = seedPost(w, { media: [] });
    expect(msgOf(await err(svc.schedulePost(WS, noMedia.id, new Date())))).toBe('Gere a mídia antes de agendar.');
    const idea = seedPost(w, { status: 'idea' });
    expect(msgOf(await err(svc.schedulePost(WS, idea.id, new Date())))).toBe('O post precisa estar aprovado para ser agendado.');
    const plan = { id: uuid(), workspace_id: WS, requires_approval: true };
    w.t['ig_content_plans']!.rows.push(plan);
    const ready = seedPost(w, { status: 'ready', plan_id: plan.id, approved_at: null });
    expect(msgOf(await err(svc.schedulePost(WS, ready.id, new Date())))).toBe('Este post exige aprovação antes de agendar.');
  });

  it('post de outra empresa = 404 "Post não encontrado."', async () => {
    const { w, svc } = setup();
    const p = seedPost(w);
    const e = await err(svc.schedulePost(WS_B, p.id, new Date()));
    expect(e.getStatus()).toBe(404);
    expect(msgOf(e)).toBe('Post não encontrado.');
  });

  it('cancela o job pendente anterior, cria o novo (live com conta, mock sem) e marca o post agendado', async () => {
    const { w, svc } = setup();
    const p = seedPost(w);
    const at = new Date(Date.now() + 3600e3);
    expect(await svc.schedulePost(WS, p.id, at)).toEqual({ ok: true, sandbox: false });
    const at2 = new Date(Date.now() + 7200e3);
    await svc.schedulePost(WS, p.id, at2);
    const jobs = w.t['publishing_jobs']!.rows;
    expect(jobs.map((j) => j.status)).toEqual(['cancelled', 'pending']);
    expect(jobs[1]).toMatchObject({ channel: 'instagram_organic', target: 'instagram', mode: 'live', ig_post_id: p.id, workspace_id: WS });
    expect(jobs[1].run_at).toEqual(at2);
    expect(p).toMatchObject({ status: 'scheduled', scheduled_at: at2 });
    w.t['instagram_accounts']!.rows.length = 0;
    expect((await svc.schedulePost(WS, p.id, at2)).sandbox).toBe(true);
    expect(w.t['publishing_jobs']!.rows[2]!.mode).toBe('mock');
  });
});

describe('PublishingService.publishInstagramPost (Graph)', () => {
  it('feed_image: container com image_url + legenda completa, espera FINISHED, publica e salva o permalink', async () => {
    const { w, svc, created } = setup();
    const p = seedPost(w);
    const r = await svc.publishInstagramPost(p.id);
    expect(r).toEqual({ ok: true, sandbox: false, permalink: 'https://instagram.com/p/x' });
    expect(created()).toEqual([{ image_url: 'https://cdn.test/a.jpg', caption: 'Legenda\n\nPeça já\n\n#a #b' }]);
    expect(p).toMatchObject({ status: 'published', ig_media_id: 'm1', ig_permalink: 'https://instagram.com/p/x', ig_creation_id: null, last_error: null });
    expect(p.published_at).toBeInstanceOf(Date);
  });

  it('legenda: texto + CTA + hashtags, no máximo 2200 caracteres', () => {
    expect(fullCaption({ caption: 'x'.repeat(3000), cta: null, hashtags: [] })).toHaveLength(2200);
    expect(fullCaption({ caption: 'a', cta: 'b', hashtags: ['#c', 'c', 'd'] })).toBe('a\n\nb\n\n#c #d');
  });

  it('carrossel: um item por mídia (vídeo espera processar) + container CAROUSEL com children', async () => {
    const { w, svc, created } = setup();
    const a1 = uuid();
    const a2 = uuid();
    for (const id of [a1, a2]) w.t['media_assets']!.rows.push({ id, workspace_id: WS, ig_ready: true, quality_report: {}, provider: 'gemini', source: 'gemini', url: 'https://cdn.test/x' });
    const p = seedPost(w, { format: 'feed_carousel', media: [{ url: 'https://cdn.test/1.jpg', type: 'image', order: 1, asset_id: a1 }, { url: 'https://cdn.test/2.mp4', type: 'video', order: 0, asset_id: a2 }] });
    await svc.publishInstagramPost(p.id);
    const [c1, c2, car] = created();
    expect(c1).toMatchObject({ is_carousel_item: 'true', media_type: 'VIDEO', video_url: 'https://cdn.test/2.mp4' }); // order 0 primeiro
    expect(c2).toMatchObject({ is_carousel_item: 'true', image_url: 'https://cdn.test/1.jpg' });
    expect(car).toMatchObject({ media_type: 'CAROUSEL', children: 'c1,c2' });
  });

  it('reel: REELS com video_url, share_to_feed e capa; story: STORIES sem legenda', async () => {
    const { w, svc, created } = setup();
    const reel = seedPost(w, { format: 'reel', media: [{ url: 'https://cdn.test/r.mp4', type: 'video', order: 0, cover_url: 'https://cdn.test/cover.jpg' }] });
    await svc.publishInstagramPost(reel.id);
    expect(created()[0]).toMatchObject({ media_type: 'REELS', video_url: 'https://cdn.test/r.mp4', share_to_feed: 'true', cover_url: 'https://cdn.test/cover.jpg' });
    const story = seedPost(w, { format: 'story_image' });
    await svc.publishInstagramPost(story.id);
    expect(created()[1]).toEqual({ media_type: 'STORIES', image_url: 'https://cdn.test/a.jpg' });
  });

  it('guardrails (não repetidos pela fila): sem mídia, sem aprovação, mídia simulada, fora do padrão, URL não pública, sem conta', async () => {
    const { w, svc } = setup({ head: async () => new Response(null, { status: 404 }) });
    expect(await err(svc.publishInstagramPost(seedPost(w, { media: [], media_: 1 }).id))).toBeInstanceOf(Guardrail);
    const plan = { id: uuid(), workspace_id: WS, requires_approval: true };
    w.t['ig_content_plans']!.rows.push(plan);
    const unapproved = seedPost(w, { plan_id: plan.id, approved_at: null });
    expect(msgOf(await err(svc.publishInstagramPost(unapproved.id)))).toBe('Post não aprovado — publicação bloqueada.');

    const mock = seedPost(w, { media: [{ url: 'https://picsum.photos/1', type: 'image', order: 0 }] });
    expect(msgOf(await err(svc.publishInstagramPost(mock.id)))).toMatch(/Mídia simulada/);

    const bad = seedPost(w);
    w.t['media_assets']!.rows.find((a) => a.id === bad.media[0].asset_id)!.ig_ready = false;
    w.t['media_assets']!.rows.find((a) => a.id === bad.media[0].asset_id)!.quality_report = { issues: ['Largura menor que 320 px.'] };
    expect(msgOf(await err(svc.publishInstagramPost(bad.id)))).toBe('Mídia fora do padrão do Instagram: Largura menor que 320 px.');

    const nothttps = seedPost(w, { media: [{ url: 'http://cdn.test/a.jpg', type: 'image', order: 0 }] });
    expect(msgOf(await err(svc.publishInstagramPost(nothttps.id)))).toBe('Mídia sem URL pública válida (HTTPS).');

    const unreachable = seedPost(w);
    expect(msgOf(await err(svc.publishInstagramPost(unreachable.id)))).toBe('A mídia não está acessível publicamente (HTTP 404).');

    const s2 = setup();
    s2.w.t['instagram_accounts']!.rows.length = 0;
    expect(msgOf(await err(s2.svc.publishInstagramPost(seedPost(s2.w).id)))).toMatch(/Nenhuma conta do Instagram conectada/);
  });

  it('HEAD recusado (405) tenta GET com Range; limite de 25 publicações em 24h = RateLimited', async () => {
    const calls: string[] = [];
    const { w, svc } = setup({ head: async (_u, init) => { calls.push(String(init?.method)); return new Response(null, { status: init?.method === 'HEAD' ? 405 : 206 }); } });
    const p = seedPost(w);
    await svc.publishInstagramPost(p.id);
    expect(calls).toEqual(['HEAD', 'GET']);
    for (let i = 0; i < 25; i++) seedPost(w, { status: 'published', published_at: new Date(Date.now() - 3600e3) });
    const e = await err(svc.publishInstagramPost(seedPost(w).id));
    expect(e).toBeInstanceOf(RateLimited);
    expect(e.message).toBe('Limite de 25 publicações em 24h atingido.');
  });

  it('retoma o container já criado (status publishing + ig_creation_id) sem criar outro', async () => {
    const { w, svc, created } = setup();
    const p = seedPost(w, { status: 'publishing', ig_creation_id: 'c99', updated_at: new Date(Date.now() - 5 * 60e3) });
    await svc.publishInstagramPost(p.id, undefined, { fromQueue: true });
    expect(created()).toHaveLength(0);
    expect(p.status).toBe('published');
  });
});

describe('PublishingService.runPublishingQueue (publishing_jobs, lock, retentativas)', () => {
  const job = (w: IgWorld, postId: string, over: Record<string, unknown> = {}) => {
    const j: any = { id: uuid(), workspace_id: WS, channel: 'instagram_organic', ig_post_id: postId, target: 'instagram', status: 'pending', mode: 'live', run_at: new Date(Date.now() - 1000), attempts: 0, locked_at: null, log: null, ...over };
    w.t['publishing_jobs']!.rows.push(j);
    return j;
  };

  it('publica só os jobs vencidos do canal instagram_organic (no máx. 4) e registra o evento', async () => {
    const { w, svc } = setup();
    const due = Array.from({ length: 5 }, () => job(w, seedPost(w).id));
    const future = job(w, seedPost(w).id, { run_at: new Date(Date.now() + 3600e3) });
    const ads = job(w, seedPost(w).id, { channel: 'meta_ads' });
    const res = await svc.runPublishingQueue();
    expect(res).toHaveLength(4);
    expect(res.every((r) => r.status === 'done')).toBe(true);
    expect(due.filter((j) => j.status === 'done')).toHaveLength(4);
    expect(due.find((j) => j.status === 'pending')).toBeTruthy();
    expect(future.status).toBe('pending');
    expect(ads.status).toBe('pending');
    expect(due[0]!.log).toMatch(/publicado https:\/\/instagram.com\/p\/x/);
    expect(due[0]!.attempts).toBe(1);
    expect(w.t['ig_autopilot_events']!.rows.filter((e) => e.kind === 'publish')).toHaveLength(4);
  });

  it('lock otimista: duas execuções simultâneas não publicam o mesmo job duas vezes', async () => {
    const { w, svc, created } = setup();
    job(w, seedPost(w).id);
    await Promise.all([svc.runPublishingQueue(), svc.runPublishingQueue()]);
    expect(created()).toHaveLength(1);
    expect(w.t['publishing_jobs']!.rows[0]!.status).toBe('done');
  });

  it('lock vencido (running há mais de 15 min) volta para pending; lock recente não', async () => {
    const { w, svc } = setup();
    const stale = job(w, seedPost(w).id, { status: 'running', locked_at: new Date(Date.now() - 16 * 60e3) });
    const fresh = job(w, seedPost(w).id, { status: 'running', locked_at: new Date(Date.now() - 5 * 60e3) });
    await svc.runPublishingQueue();
    expect(stale.status).toBe('done');
    expect(fresh.status).toBe('running');
  });

  it('container ainda processando: volta para pending em 2 min SEM consumir a tentativa', async () => {
    const { w, svc } = setup();
    w.respond((path) => (/^\/c\d+$/.test(path) ? { status_code: 'IN_PROGRESS' } : undefined));
    const p = seedPost(w);
    const j = job(w, p.id);
    let t = Date.now();
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => (t += 15_000));
    try {
      const res = await svc.runPublishingQueue();
      expect(res).toEqual([{ job: j.id, status: 'processing' }]);
    } finally {
      spy.mockRestore();
    }
    expect(j).toMatchObject({ status: 'pending', attempts: 0, locked_at: null });
    expect(j.run_at.getTime()).toBeGreaterThan(Date.now() + 60e3);
    expect(j.log).toMatch(/ainda está processando/);
    expect(p.status).toBe('publishing'); // retomado depois com o mesmo container
    expect(p.ig_creation_id).toBe('c1');
  });

  it('falha comum: tenta de novo com backoff (5 min, 10 min) e na 3ª falha desiste (post failed, retry_count)', async () => {
    const { w, svc } = setup();
    w.respond((path, opts) => (path === `/${IG}/media` && opts.method === 'POST' ? new Error('A Meta recusou') : undefined));
    const p = seedPost(w);
    const j = job(w, p.id);
    let res = await svc.runPublishingQueue();
    expect(res[0]).toMatchObject({ status: 'retry', error: 'A Meta recusou' });
    expect(j).toMatchObject({ status: 'pending', attempts: 1, locked_at: null });
    expect(j.run_at.getTime() - Date.now()).toBeGreaterThan(4 * 60e3);
    expect(j.run_at.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60e3 + 1000);
    expect(p).toMatchObject({ status: 'scheduled', last_error: 'A Meta recusou', retry_count: 1 });

    j.run_at = new Date(Date.now() - 1000);
    res = await svc.runPublishingQueue();
    expect(res[0]!.status).toBe('retry');
    expect(j.attempts).toBe(2);
    expect(j.run_at.getTime() - Date.now()).toBeGreaterThan(9 * 60e3);

    j.run_at = new Date(Date.now() - 1000);
    res = await svc.runPublishingQueue();
    expect(res[0]!.status).toBe('failed');
    expect(j).toMatchObject({ status: 'failed', attempts: 3 });
    expect(p).toMatchObject({ status: 'failed', retry_count: 3 });
    expect(j.log!.split('\n')).toHaveLength(3);
    expect(w.t['ig_autopilot_events']!.rows.filter((e) => e.kind === 'failure').map((e) => e.level)).toEqual(['warn', 'warn', 'error']);
  });

  it('Guardrail não repete: job failed na hora, evento "guardrail"', async () => {
    const { w, svc } = setup();
    const p = seedPost(w, { media: [{ url: 'https://picsum.photos/x', type: 'image', order: 0 }] });
    const j = job(w, p.id);
    const res = await svc.runPublishingQueue();
    expect(res[0]!.status).toBe('failed');
    expect(j.status).toBe('failed');
    expect(p.status).toBe('failed');
    expect(w.t['ig_autopilot_events']!.rows[0]).toMatchObject({ kind: 'guardrail', level: 'error' });
  });

  it('limite diário: tenta de novo em 1 h sem contar tentativa nem retry_count', async () => {
    const { w, svc } = setup();
    w.respond((path) => (path === `/${IG}/content_publishing_limit` ? { data: [{ quota_usage: 25 }] } : undefined));
    const p = seedPost(w);
    const j = job(w, p.id, { attempts: 1 });
    const res = await svc.runPublishingQueue();
    expect(res[0]!.status).toBe('retry');
    expect(j).toMatchObject({ status: 'pending', attempts: 1 });
    expect(j.run_at.getTime() - Date.now()).toBeGreaterThan(59 * 60e3);
    expect(p.retry_count).toBe(0);
  });

  it('token expirado (190): sem retry, conta em erro, planos pausados e fila suspensa', async () => {
    const { w, svc } = setup();
    w.respond((path, opts) => (path === `/${IG}/media` && opts.method === 'POST' ? new MetaError('O token da Meta é inválido ou expirou.', 190) : undefined));
    const plan = { id: uuid(), workspace_id: WS, status: 'active' };
    w.t['ig_content_plans']!.rows.push(plan);
    const p = seedPost(w);
    const j = job(w, p.id);
    const other = job(w, seedPost(w).id, { run_at: new Date(Date.now() + 3600e3 * 5) });
    const res = await svc.runPublishingQueue();
    expect(res[0]!.status).toBe('failed');
    expect(j.status).toBe('failed');
    expect(w.t['instagram_accounts']!.rows[0]).toMatchObject({ status: 'error' });
    expect(plan.status).toBe('paused');
    expect(other.status).toBe('cancelled');
    expect(w.t['ig_autopilot_events']!.rows.some((e) => e.kind === 'guardrail' && /Token da Meta expirado/.test(e.message))).toBe(true);
  });
});

describe('URL da mídia (SSRF)', () => {
  it('URL privada/loopback/interna é recusada ANTES de qualquer requisição; redirecionamento para rede interna também', async () => {
    const { w, svc, head } = setup();
    for (const url of ['https://10.0.0.5/a.jpg', 'https://127.0.0.1/a.jpg', 'https://169.254.169.254/latest', 'https://db.internal/a.jpg', 'https://localhost/a.jpg']) {
      const p = seedPost(w, { media: [{ url, type: 'image', order: 0 }] });
      expect(msgOf(await err(svc.publishInstagramPost(p.id)))).toBe('Mídia sem URL pública válida (HTTPS).');
    }
    expect(head).not.toHaveBeenCalled();
    const calls: string[] = [];
    const s2 = setup({ head: async (u) => { calls.push(u); return u.includes('cdn.test') ? new Response(null, { status: 302, headers: { location: 'https://192.168.1.10/x' } }) : new Response(null, { status: 200 }); } });
    const p2 = seedPost(s2.w);
    expect(msgOf(await err(s2.svc.publishInstagramPost(p2.id)))).toBe('Mídia sem URL pública válida (HTTPS).');
    expect(calls).toEqual(['https://cdn.test/a.jpg']);
  });
});

describe('publicar agora × fila (claim atômico)', () => {
  it('só um dos dois publica; o perdedor não conta falha e a fila encerra/adia o job', async () => {
    const { w, svc, created } = setup();
    const p = seedPost(w, { status: 'scheduled' });
    const j: any = { id: uuid(), workspace_id: WS, channel: 'instagram_organic', ig_post_id: p.id, target: 'instagram', status: 'pending', mode: 'live', run_at: new Date(Date.now() - 1000), attempts: 0, locked_at: null, log: null };
    w.t['publishing_jobs']!.rows.push(j);
    const [a, b] = await Promise.allSettled([svc.publishInstagramPost(p.id), svc.runPublishingQueue()]);
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    expect(created()).toHaveLength(1);
    expect(p.status).toBe('published');
    // perdeu o claim (outro estava no meio): volta em 2 min sem gastar tentativa; ou foi cancelado pelo "publicar agora"
    expect(['cancelled', 'pending', 'done']).toContain(j.status);
    expect(j.attempts).toBeLessThanOrEqual(1);
  });
  it('segundo "publicar agora" no mesmo post = PublishClaimLost; job de post já publicado é cancelado sem tentativa', async () => {
    const { w, svc } = setup();
    const p = seedPost(w);
    await svc.publishInstagramPost(p.id);
    await expect(svc.publishInstagramPost(p.id)).rejects.toBeInstanceOf(PublishClaimLost);
    const j: any = { id: uuid(), workspace_id: WS, channel: 'instagram_organic', ig_post_id: p.id, status: 'pending', mode: 'live', run_at: new Date(Date.now() - 1000), attempts: 0, locked_at: null, log: null };
    w.t['publishing_jobs']!.rows.push(j);
    const res = await svc.runPublishingQueue();
    expect(res[0]!.status).toBe('skipped');
    expect(j).toMatchObject({ status: 'cancelled', attempts: 0 });
  });
  it('publicar agora tira os jobs pendentes do post da fila; post publicando por outro volta em 2 min', async () => {
    const { w, svc } = setup();
    const p = seedPost(w, { status: 'scheduled' });
    const j: any = { id: uuid(), workspace_id: WS, channel: 'instagram_organic', ig_post_id: p.id, status: 'pending', mode: 'live', run_at: new Date(Date.now() + 3600e3), attempts: 0, locked_at: null, log: null };
    w.t['publishing_jobs']!.rows.push(j);
    await svc.publishInstagramPost(p.id);
    expect(j.status).toBe('cancelled');
    const q = seedPost(w, { status: 'publishing', ig_creation_id: 'cX' }); // outro processo no meio
    const j2: any = { ...j, id: uuid(), ig_post_id: q.id, status: 'pending', run_at: new Date(Date.now() - 1000) };
    w.t['publishing_jobs']!.rows.push(j2);
    const res = await svc.runPublishingQueue();
    expect(res.find((r) => r.job === j2.id)!.status).toBe('processing');
    expect(j2).toMatchObject({ status: 'pending', attempts: 0 });
  });
});

describe('scheduleAutomated', () => {
  it('modo approval só agenda depois de aprovado; atraso ≤ 12 h publica em 1 min; > 12 h vai para o dia seguinte', async () => {
    const { w, svc } = setup();
    const waiting = seedPost(w, { automation: 'approval', status: 'pending_approval', approved_at: null });
    expect(await svc.scheduleAutomated(waiting.id)).toEqual({ skipped: 'pending_approval' });
    const wait2 = seedPost(w, { automation: 'approval', status: 'ready', approved_at: null });
    expect(await svc.scheduleAutomated(wait2.id)).toEqual({ skipped: 'aguardando aprovação' });
    const future = seedPost(w, { automation: 'publish', status: 'ready', scheduled_at: new Date(Date.now() + 3 * 3600e3) });
    expect(await svc.scheduleAutomated(future.id)).toMatchObject({ scheduled: future.scheduled_at.toISOString() });
    const late = seedPost(w, { automation: 'publish', status: 'ready', scheduled_at: new Date(Date.now() - 2 * 3600e3) });
    const r = (await svc.scheduleAutomated(late.id)) as { scheduled: string };
    expect(Date.parse(r.scheduled) - Date.now()).toBeLessThan(61e3);
    const origin = Date.now() - 20 * 3600e3;
    const lost = seedPost(w, { automation: 'publish', status: 'ready', scheduled_at: new Date(origin) });
    const r2 = (await svc.scheduleAutomated(lost.id)) as { scheduled: string };
    expect(Date.parse(r2.scheduled)).toBeGreaterThan(Date.now() + 30 * 60e3);
    expect(Date.parse(r2.scheduled) - origin).toBe(86400e3);
    expect(w.t['ig_autopilot_events']!.rows.map((e) => e.message).join('|')).toMatch(/Horário perdido/);
    const noAuto = seedPost(w, { status: 'ready' });
    expect(await svc.scheduleAutomated(noAuto.id)).toEqual({ skipped: 'sem mídia' });
  });
});

describe('IgStore', () => {
  it('approvalRequired: a programação decide pelo modo; sem ela vale o plano', async () => {
    const w = igWorld();
    const s = new IgStore(w.prisma);
    expect(await s.approvalRequired({ automation: 'publish' })).toBe(false);
    expect(await s.approvalRequired({ automation: 'approval' })).toBe(true);
    expect(await s.approvalRequired({})).toBeNull();
    const plan = { id: uuid(), requires_approval: false };
    w.t['ig_content_plans']!.rows.push(plan);
    expect(await s.approvalRequired({ plan_id: plan.id })).toBe(false);
  });
  it('ContainerPending é erro próprio', () => {
    expect(new ContainerPending('x')).toBeInstanceOf(Error);
  });
});
