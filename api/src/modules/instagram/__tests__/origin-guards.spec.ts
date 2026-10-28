import { ClaimRefused, Guardrail, OriginUnavailable } from '../ig-store.service';
import { NO_ACCOUNT_MSG, TOKEN_EXPIRED_POST_MSG } from '../ig-types';
import { MetaError } from '../meta-graph';
import { PublishOriginGuard } from '../origin-guards';
import { OWNER, WS_A } from '../../media/__tests__/mem';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';

const IG = 'ig-user-1';
const CLOSED = 'A vaga não está mais aberta no Freela (preenchida ou cancelada).';

/** Guarda falsa: por padrão libera tudo. */
const fakeGuard = (blockReason: PublishOriginGuard['blockReason'] = async () => null) => ({
  blockReason: jest.fn(blockReason),
  afterApproval: jest.fn(async () => undefined),
});

function setup(guard: ReturnType<typeof fakeGuard> | null = fakeGuard()) {
  const w: IgWorld = igWorld();
  w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, ig_user_id: IG, status: 'connected', username: 'loja' });
  let n = 0;
  w.respond((path, opts) => {
    if (path === `/${IG}/content_publishing_limit`) return { data: [{ quota_usage: 1 }] };
    if (path === `/${IG}/media` && opts.method === 'POST') return { id: `c${++n}` };
    if (path === `/${IG}/media_publish`) return { id: 'm1' };
    if (path === '/m1') return { permalink: 'https://instagram.com/p/x' };
    if (/^\/c\d+$/.test(path)) return { status_code: 'FINISHED' };
    return undefined;
  });
  const s = igServices(w, { guards: guard });
  const created = () => w.calls.filter((c) => c.path === `/${IG}/media` && c.opts.method === 'POST');
  return { w, s, guard, created };
}

/** Story de vaga como o módulo das vagas o entrega (sem automação, plano nem programação). */
const vacancyPost = (w: IgWorld, over: Record<string, unknown> = {}, requiresApproval = false) =>
  seedPost(w, {
    source: 'vacancy', format: 'story_image', automation: null, plan_id: null, run_id: null, status: 'scheduled',
    creative_brief: { vacancy: { requires_approval: requiresApproval, external_id: 'v1' } },
    ...over,
  });

type JobRow = { id: string; status: string; attempts: number; run_at: Date; locked_at: Date | null; log: string | null; [k: string]: unknown };
const job = (w: IgWorld, postId: string, over: Record<string, unknown> = {}) => {
  const j = { id: uuid(), workspace_id: WS_A, channel: 'instagram_organic', ig_post_id: postId, target: 'instagram', status: 'pending', mode: 'live', run_at: new Date(Date.now() - 1000), attempts: 0, locked_at: null, log: null, ...over } as JobRow;
  w.t['publishing_jobs']!.rows.push(j);
  return j;
};

describe('IgStore.approvalRequired — story de vaga', () => {
  it('decide pelo requires_approval do creative_brief.vacancy', async () => {
    const { w } = setup(null);
    expect(await w.store.approvalRequired(vacancyPost(w, {}, true))).toBe(true);
    expect(await w.store.approvalRequired(vacancyPost(w, {}, false))).toBe(false);
    // Sem o campo: não exige (a fonte da verdade é o módulo das vagas).
    expect(await w.store.approvalRequired(vacancyPost(w, { creative_brief: {} }))).toBe(false);
  });
});

describe('"Publicar agora" num post não aprovado', () => {
  it('devolve o guardrail de aprovação SEM gravar failed (post continua pending_approval)', async () => {
    const { w, s } = setup(null);
    const plan = { id: uuid(), workspace_id: WS_A, requires_approval: true };
    w.t['ig_content_plans']!.rows.push(plan);
    const regular = seedPost(w, { status: 'pending_approval', plan_id: plan.id, approved_at: null });
    const vac = vacancyPost(w, { status: 'pending_approval', approved_at: null }, true);
    for (const p of [regular, vac]) {
      const r = await s.actions.publishInstagramPost(OWNER, WS_A, p.id);
      expect(r).toEqual({ ok: false, sandbox: false, error: 'Post não aprovado — publicação bloqueada.' });
      expect(p).toMatchObject({ status: 'pending_approval', last_error: null });
      expect(p.failure_kind ?? null).toBeNull();
    }
  });

  it('ClaimRefused é um Guardrail (a fila continua tratando como guardrail: job failed, sem nova tentativa)', async () => {
    expect(new ClaimRefused('x')).toBeInstanceOf(Guardrail);
    const { w, s } = setup(null);
    const p = seedPost(w, { status: 'pending_approval', approved_at: null });
    const j = job(w, p.id);
    const res = await s.publishing.runPublishingQueue();
    expect(res[0]).toMatchObject({ status: 'failed', error: 'Post não aprovado — publicação bloqueada.' });
    expect(j.status).toBe('failed');
  });
});

describe('guarda de origem na fila', () => {
  it('guarda devolve motivo → post e job cancelados, nenhum container criado', async () => {
    const { w, s, guard, created } = setup(fakeGuard(async () => CLOSED));
    const p = vacancyPost(w);
    const j = job(w, p.id);
    const res = await s.publishing.runPublishingQueue();
    expect(res.map((r) => r.status)).toEqual(['skipped']);
    expect(created()).toHaveLength(0);
    expect([p.status, j.status]).toEqual(['cancelled', 'cancelled']);
    expect(guard!.blockReason).toHaveBeenCalledWith(expect.objectContaining({ id: p.id, source: 'vacancy' }), expect.any(Date));
    expect(w.t['ig_autopilot_events']!.rows.find((e) => e.kind === 'guardrail')!.message).toBe(`Post cancelado: ${CLOSED}`);
  });

  it('Review Focus #5 — fonte fora do ar (OriginUnavailable): job pending em 10 min sem gastar tentativa, post scheduled, nenhum container', async () => {
    const { w, s, created } = setup(fakeGuard(async () => { throw new OriginUnavailable('Vitrine do Freela fora do ar (HTTP 503).'); }));
    const p = vacancyPost(w);
    const j = job(w, p.id, { attempts: 1 });
    const t0 = Date.now();
    await s.publishing.runPublishingQueue();
    expect(created()).toHaveLength(0);
    expect(j).toMatchObject({ status: 'pending', attempts: 1, locked_at: null });
    expect(j.run_at.getTime()).toBeGreaterThanOrEqual(t0 + 10 * 60e3 - 1000);
    expect(j.run_at.getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60e3 + 1000);
    expect(j.log).toMatch(/Vitrine do Freela fora do ar/);
    expect(p).toMatchObject({ status: 'scheduled', ig_creation_id: null, retry_count: 0 });
    expect(p.scheduled_at.getTime()).toBe(j.run_at.getTime());
    expect(p.lease_until ?? null).toBeNull();
  });

  it('RateLimited: a guarda é consultada no horário da próxima tentativa (+1 h) e cancela em vez de remarcar', async () => {
    const start = Date.now() + 30 * 60e3;
    const { w, s, guard, created } = setup(fakeGuard(async (_post, at) => (at.getTime() >= start ? 'Ninguém aprovou a tempo.' : null)));
    w.respond((path) => (path === `/${IG}/content_publishing_limit` ? { data: [{ quota_usage: 25 }] } : undefined));
    const p = vacancyPost(w);
    const j = job(w, p.id);
    const res = await s.publishing.runPublishingQueue();
    expect(res[0]!.status).toBe('cancelled');
    expect(created()).toHaveLength(0);
    expect([p.status, j.status]).toEqual(['cancelled', 'cancelled']);
    const ats = guard!.blockReason.mock.calls.map((c) => (c[1] as Date).getTime());
    expect(ats).toHaveLength(2);
    expect(ats[1]! - ats[0]!).toBeGreaterThanOrEqual(59 * 60e3);
  });

  it('RateLimited com a vaga ainda longe: remarca para 1 h como hoje', async () => {
    const { w, s } = setup(fakeGuard(async () => null));
    w.respond((path) => (path === `/${IG}/content_publishing_limit` ? { data: [{ quota_usage: 25 }] } : undefined));
    const p = vacancyPost(w);
    const j = job(w, p.id);
    expect((await s.publishing.runPublishingQueue())[0]!.status).toBe('retry');
    expect(j.status).toBe('pending');
    expect(j.run_at.getTime() - Date.now()).toBeGreaterThan(59 * 60e3);
    expect(p.status).toBe('scheduled');
  });

  it('a guarda que falha no catch da fila não derruba o tratamento do erro', async () => {
    let calls = 0;
    const { w, s } = setup(fakeGuard(async () => {
      if (calls++ === 0) return null;
      throw new Error('vitrine caiu');
    }));
    w.respond((path, opts) => (path === `/${IG}/media` && opts.method === 'POST' ? new Error('A Meta recusou') : undefined));
    const warn = jest.spyOn(s.publishing['logger'], 'warn').mockImplementation(() => undefined);
    const p = vacancyPost(w);
    const j = job(w, p.id);
    expect((await s.publishing.runPublishingQueue())[0]).toMatchObject({ status: 'retry', error: 'A Meta recusou' });
    expect(j).toMatchObject({ status: 'pending', attempts: 1 });
    expect(p.status).toBe('scheduled');
    // R15: a falha da guarda não some sem rastro.
    expect(warn).toHaveBeenCalledWith(`[instagram] post ${p.id}: cancelledOrigin falhou no catch da fila: vitrine caiu`);
  });

  it('R18 — story que exige aprovação, sem aprovação, agendado com job: a fila nunca cria container nem publica', async () => {
    const { w, s, created } = setup();
    const p = vacancyPost(w, { status: 'scheduled', approved_at: null }, true);
    const j = job(w, p.id);
    await s.publishing.runPublishingQueue();
    expect(created()).toHaveLength(0);
    expect(w.calls.some((c) => c.path === `/${IG}/media_publish`)).toBe(false);
    expect(p.status).not.toBe('published');
    expect(j.status).toBe('failed');
  });

  it('post que não é de vaga nunca chega à guarda; publica como hoje', async () => {
    const { w, s, guard } = setup(fakeGuard(async () => CLOSED));
    const p = seedPost(w, { status: 'scheduled' });
    const j = job(w, p.id);
    expect((await s.publishing.runPublishingQueue())[0]!.status).toBe('done');
    expect(j.status).toBe('done');
    expect(p.status).toBe('published');
    expect(guard!.blockReason).not.toHaveBeenCalled();
  });

  it('sem guarda injetada: post de vaga publica normalmente (nada consulta a origem)', async () => {
    const { w, s } = setup(null);
    const p = vacancyPost(w);
    job(w, p.id);
    expect((await s.publishing.runPublishingQueue())[0]!.status).toBe('done');
    expect(p.status).toBe('published');
  });
});

describe('R16 — conta/token em story de vaga', () => {
  it('token vencido (190): o post da fila e os outros stories de vaga agendados voltam para "pronto" com o motivo; os do plano ficam como estavam', async () => {
    const { w, s } = setup();
    w.respond((path, opts) => (path === `/${IG}/media` && opts.method === 'POST' ? new MetaError('O token da Meta é inválido ou expirou.', 190) : undefined));
    const p = vacancyPost(w);
    const j = job(w, p.id);
    const other = vacancyPost(w, { scheduled_at: new Date(Date.now() + 3600e3) });
    const otherJob = job(w, other.id, { run_at: new Date(Date.now() + 3600e3) });
    const plan = { id: uuid(), workspace_id: WS_A, requires_approval: false, status: 'active' };
    w.t['ig_content_plans']!.rows.push(plan);
    const fromPlan = seedPost(w, { plan_id: plan.id, status: 'scheduled' });
    expect((await s.publishing.runPublishingQueue())[0]!.status).toBe('waiting_account');
    expect(p).toMatchObject({ status: 'ready', last_error: TOKEN_EXPIRED_POST_MSG, ig_creation_id: null });
    expect(j.status).toBe('failed');
    expect(other).toMatchObject({ status: 'ready', last_error: TOKEN_EXPIRED_POST_MSG });
    expect(otherJob.status).toBe('cancelled');
    expect(fromPlan.status).toBe('scheduled');
  });

  it('sem conta conectada: o story de vaga da fila volta para "pronto" com o aviso (nunca failed)', async () => {
    const { w, s } = setup();
    w.t['instagram_accounts']!.rows = [];
    const p = vacancyPost(w);
    job(w, p.id);
    expect((await s.publishing.runPublishingQueue())[0]!.status).toBe('waiting_account');
    expect(p).toMatchObject({ status: 'ready', last_error: NO_ACCOUNT_MSG, ig_creation_id: null });
  });
});

describe('"Publicar agora" num story de vaga', () => {
  it('R18 — a partir de "scheduled" com a vitrine fora: post volta a scheduled e o job pendente fica cancelado (a T10 reconcilia)', async () => {
    const { w, s, created } = setup(fakeGuard(async () => { throw new OriginUnavailable('HTTP 503'); }));
    const at = new Date(Date.now() + 3600e3);
    const p = vacancyPost(w, { status: 'scheduled', scheduled_at: at });
    const j = job(w, p.id, { run_at: at });
    const r = await s.actions.publishInstagramPost(OWNER, WS_A, p.id);
    expect(r).toEqual({ ok: false, sandbox: false, error: 'Não conseguimos consultar a vaga no Freela agora. Tente de novo em alguns minutos.' });
    expect(p).toMatchObject({ status: 'scheduled', scheduled_at: at });
    expect(j.status).toBe('cancelled');
    expect(created()).toHaveLength(0);
  });

  it('fonte fora do ar: devolve a mensagem própria e o post volta ao status de antes (sem failed)', async () => {
    const { w, s, created } = setup(fakeGuard(async () => { throw new OriginUnavailable('HTTP 503'); }));
    const p = vacancyPost(w, { status: 'approved' });
    const r = await s.actions.publishInstagramPost(OWNER, WS_A, p.id);
    expect(r).toEqual({ ok: false, sandbox: false, error: 'Não conseguimos consultar a vaga no Freela agora. Tente de novo em alguns minutos.' });
    expect(p).toMatchObject({ status: 'approved', last_error: null });
    expect(p.failure_kind ?? null).toBeNull();
    expect(created()).toHaveLength(0);
  });

  it('vaga fechada: post cancelado e { ok:false } com o motivo', async () => {
    const { w, s } = setup(fakeGuard(async () => CLOSED));
    const p = vacancyPost(w, { status: 'approved' });
    const r = await s.actions.publishInstagramPost(OWNER, WS_A, p.id);
    expect(r).toEqual({ ok: false, sandbox: false, error: `Post cancelado: ${CLOSED}` });
    expect(p.status).toBe('cancelled');
  });
});

describe('mídia de story de vaga não passa pelo gerador comum', () => {
  it('generatePostAssets (e o caminho de regenerate-media) recusa antes do lease; post intocado', async () => {
    const { w, s } = setup();
    const p = vacancyPost(w, { status: 'pending_approval' });
    const snap = JSON.stringify(p);
    const msg = 'Story de vaga: use Refazer a arte na aba Vagas.';
    expect(await s.mediaGen.generatePostAssets(WS_A, p.id, 'auto')).toEqual({ ok: false, error: msg });
    // `regenerate-media` e `generate-post-assets` chegam por aqui.
    expect(await s.actions.generatePostAssets(OWNER, WS_A, p.id, 'auto', 'mais escuro')).toEqual({ ok: false, error: msg });
    expect(JSON.stringify(p)).toBe(snap);
    expect(s.pipeline.run).not.toHaveBeenCalled();
    expect(s.providers.resolve).not.toHaveBeenCalled();
  });
});

describe('aprovação de story de vaga', () => {
  it('approvePost → post approved, evento "Post aprovado." e guard.afterApproval(ws, postId)', async () => {
    const { w, s, guard } = setup();
    const p = vacancyPost(w, { status: 'pending_approval', approved_at: null }, true);
    expect(await s.actions.approvePost(OWNER, WS_A, p.id)).toEqual({ ok: true });
    expect(p.status).toBe('approved');
    expect(guard!.afterApproval).toHaveBeenCalledWith(WS_A, p.id);
    expect(w.t['ig_autopilot_events']!.rows.map((e) => e.message)).toEqual(['Post aprovado.']);
    expect(w.t['publishing_jobs']!.rows).toHaveLength(0);
  });

  it('sem guarda: aprovar continua funcionando (nada é agendado aqui)', async () => {
    const { w, s } = setup(null);
    const p = vacancyPost(w, { status: 'pending_approval', approved_at: null }, true);
    expect(await s.actions.approvePost(OWNER, WS_A, p.id)).toEqual({ ok: true });
    expect(p.status).toBe('approved');
  });
});
