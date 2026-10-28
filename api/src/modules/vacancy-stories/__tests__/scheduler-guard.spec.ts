jest.setTimeout(60_000);

import { ORIGIN_UNAVAILABLE_MSG } from '../../instagram/instagram-actions.service';
import { OriginUnavailable } from '../../instagram/ig-store.service';
import { NO_ACCOUNT_MSG, TOKEN_EXPIRED_POST_MSG } from '../../instagram/ig-types';
import { igServices, seedPost, uuid } from '../../instagram/__tests__/harness';
import { OWNER, WS_A } from '../../media/__tests__/mem';
import type { VacancyGeneratorService } from '../vacancy-generator.service';
import { VacancySchedulerService } from '../vacancy-scheduler.service';
import { fingerprint } from '../vacancy-text';
import type { FreelaVacancy, SettingsRow } from '../vacancy-types';
import { vacancyWorld, type VacancyWorld } from './world';

const NOW = new Date('2026-10-29T13:00:00Z'); // quinta, 10h em Brasília
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const TOMORROW_8H = new Date('2026-10-30T11:00:00Z');
const CLOSED = 'A vaga não está mais aberta no Freela (preenchida ou cancelada).';
const CHANGED = 'A vaga mudou no Freela (valor ou horário). Vamos criar o story de novo.';
const TOO_MANY = 'A vaga mudou muitas vezes no Freela. Crie o story de novo quando ela estiver definida.';
const STARTED = 'A vaga começou antes de ir ao ar.';

/** Sábado 31/10, 18h às 23h em Brasília, Coco Bambu em Campinas, R$ 150. */
const vac = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: uuid(), title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-10-31',
  startTime: '2026-10-31T21:00:00Z', endTime: '2026-11-01T02:00:00Z', amountInCents: 15000,
  contractorName: 'COCO BAMBU', publishedAt: '2026-10-29T10:00:00Z', ...o,
});

let w: VacancyWorld;
afterEach(() => w?.cleanup());

async function setup(o: { settings?: Record<string, unknown>; ig?: boolean } = {}) {
  w = vacancyWorld();
  const s = igServices(w, { guards: w.guard });
  // Só os ganchos do gerador (a geração em si é do generator.spec).
  const generator = { hooks: {} } as VacancyGeneratorService;
  const sched = new VacancySchedulerService(w.prisma, w.store, s.publishing, w.guard, generator, w.gate);
  const clock = { t: NOW.getTime() };
  sched.now = () => clock.t;
  sched.onModuleInit();
  await w.prisma.vacancy_story_settings.create({
    data: { workspace_id: WS_A, enabled: true, enabled_at: new Date('2026-10-29T09:00:00Z'), template_asset_id: uuid(), auto_publish: true, ...o.settings },
  });
  if (o.ig !== false) w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, status: 'connected', ig_user_id: '17841', username: 'freela' });
  const settings = () => w.t['vacancy_story_settings']!.rows.find((r) => r.workspace_id === WS_A) as SettingsRow;
  const rowOf = (postId: string) => w.t['vacancy_stories']!.rows.find((r) => r.ig_post_id === postId)!;
  const jobsOf = (postId: string) => w.t['publishing_jobs']!.rows.filter((j) => j.ig_post_id === postId);
  const pending = (postId: string) => jobsOf(postId).filter((j) => j.status === 'pending');
  /** Story de vaga entregue como o gerador deixa: post de vaga + linha `handed_off` ligada a ele. */
  const delivered = async (v: FreelaVacancy, over: Record<string, unknown> = {}, opt: { requiresApproval?: boolean; row?: Record<string, unknown> } = {}) => {
    w.feed.state.byId.set(v.id, v);
    const post = seedPost(w, {
      source: 'vacancy', format: 'story_image', status: 'ready', automation: null, plan_id: null, run_id: null, approved_at: null,
      caption: null, hashtags: [], cta: null, created_at: NOW, theme: 'Vaga · Garçom · Coco Bambu · Sáb 31/10',
      creative_brief: { compose: false, vacancy: { external_id: v.id, fingerprint: fingerprint(v), requires_approval: opt.requiresApproval ?? false, starts_at: v.startTime } },
      ...over,
    });
    await w.prisma.vacancy_stories.create({
      data: {
        workspace_id: WS_A, external_id: v.id, snapshot: v, fingerprint: fingerprint(v), starts_at: new Date(v.startTime), status: 'handed_off',
        ig_post_id: post.id, ...opt.row,
      },
    });
    return post;
  };
  /** Job pendente de um post já agendado. */
  const job = (postId: string, runAt: Date, status = 'pending') => {
    const j = { id: uuid(), workspace_id: WS_A, channel: 'instagram_organic', ig_post_id: postId, target: 'instagram', status, mode: 'live', run_at: runAt, attempts: 0, locked_at: null, log: null };
    w.t['publishing_jobs']!.rows.push(j);
    return j;
  };
  return { s, sched, generator, clock, settings, rowOf, jobsOf, pending, delivered, job };
}

describe('VacancySchedulerService — horário livre, limite do dia e agenda', () => {
  it('modo sozinho: entregue às 10h → job em agora+1 min; o 2º story vai 15 min depois do 1º', async () => {
    const t = await setup();
    expect(t.generator.hooks.afterHandOff).toBeInstanceOf(Function);
    expect(t.generator.hooks.capacityWait).toBeInstanceOf(Function);

    const p1 = await t.delivered(vac());
    expect(await t.generator.hooks.afterHandOff!(WS_A, p1.id)).toBe('scheduled');
    expect(p1).toMatchObject({ status: 'scheduled', scheduled_at: at(MIN), last_error: null });
    expect(t.pending(p1.id)).toEqual([expect.objectContaining({ run_at: at(MIN), channel: 'instagram_organic', mode: 'live' })]);

    const p2 = await t.delivered(vac());
    expect(await t.sched.afterHandOff(WS_A, p2.id)).toBe('scheduled');
    expect(p2.scheduled_at).toEqual(at(16 * MIN));
    expect(t.pending(p2.id)).toEqual([expect.objectContaining({ run_at: at(16 * MIN) })]);
  });

  it('entrega que espera aprovação (inclusive reserva reprovada, R22) não é agendada', async () => {
    const t = await setup();
    const p = await t.delivered(vac(), { status: 'pending_approval' }, { requiresApproval: true });
    expect(await t.sched.afterHandOff(WS_A, p.id)).toBeNull();
    expect(p.status).toBe('pending_approval');
    expect(t.jobsOf(p.id)).toHaveLength(0);
  });

  it('limite 2 com 2 já agendados hoje: o 3º vai às 8h de amanhã; vaga que começa antes de 8h + antecedência é cancelada', async () => {
    const t = await setup({ settings: { daily_cap: 2 } });
    await t.delivered(vac(), { status: 'scheduled', scheduled_at: at(HOUR) });
    // O 2º (pronto, criado hoje) já conta no dia, mas não contra ele mesmo: vai hoje, 15 min depois do 1º.
    const p2 = await t.delivered(vac());
    expect(await t.sched.capacityFor(WS_A, t.settings(), '2026-10-29')).toEqual({ used: 2, cap: 2 });
    expect(await t.sched.capacityFor(WS_A, t.settings(), '2026-10-29', p2.id)).toEqual({ used: 1, cap: 2 });
    expect(await t.sched.afterHandOff(WS_A, p2.id)).toBe('scheduled');
    expect(p2.scheduled_at).toEqual(at(75 * MIN));
    expect(await t.sched.capacityFor(WS_A, t.settings(), '2026-10-29')).toEqual({ used: 2, cap: 2 });

    // 3º story de uma vaga que começa amanhã às 9h30: amanhã 8h + 2 h já passa do início.
    const early = vac({ startTime: '2026-10-30T12:30:00Z', endTime: '2026-10-30T18:00:00Z' });
    const p3early = await t.delivered(early);
    expect(await t.sched.afterHandOff(WS_A, p3early.id)).toBe('cancelled');
    expect(p3early.status).toBe('cancelled');
    expect(t.rowOf(p3early.id).skip_reason).toBe('Ficou esperando a vez (máximo de 2 por dia) e a vaga começou antes.');
    expect(t.jobsOf(p3early.id)).toHaveLength(0);

    const p3 = await t.delivered(vac());
    // O próprio post (pronto, criado hoje) não conta contra ele mesmo.
    expect(await t.sched.planSlot(WS_A, t.settings(), new Date('2026-10-31T21:00:00Z'), NOW, { postId: p3.id })).toEqual({ at: TOMORROW_8H, waitingFor: 'cap' });
    expect(await t.sched.afterHandOff(WS_A, p3.id)).toBe('scheduled');
    expect(p3).toMatchObject({ status: 'scheduled', scheduled_at: TOMORROW_8H });
    expect(t.pending(p3.id)).toEqual([expect.objectContaining({ run_at: TOMORROW_8H })]);
  });

  it('capacityWait do gerador: limite cheio → início da janela de amanhã; com vaga ou "Postar agora" → null', async () => {
    const t = await setup({ settings: { daily_cap: 2 } });
    await t.delivered(vac(), { status: 'scheduled', scheduled_at: at(HOUR) });
    await t.delivered(vac(), { status: 'published', published_at: at(-HOUR), scheduled_at: at(-HOUR) });
    const row = await w.prisma.vacancy_stories.create({
      data: { workspace_id: WS_A, external_id: 'nova', snapshot: {}, fingerprint: 'f', starts_at: new Date('2026-10-31T21:00:00Z') },
    });
    const wait = t.generator.hooks.capacityWait!;
    expect(await wait(row, t.settings(), NOW)).toEqual(TOMORROW_8H);
    expect(await wait({ ...row, post_now: true }, t.settings(), NOW)).toBeNull();
    expect(await wait(row, { ...t.settings(), daily_cap: 3 }, NOW)).toBeNull();
  });

  it('20 publicados nas últimas 24 h (posts normais) → planSlot espera até a mais antiga fazer 24 h', async () => {
    const t = await setup();
    for (let i = 1; i <= 20; i++) seedPost(w, { status: 'published', published_at: at(-i * HOUR) });
    // Fora das contas: publicado há 25 h e post normal agendado para daqui a 30 h.
    seedPost(w, { status: 'published', published_at: at(-25 * HOUR) });
    seedPost(w, { status: 'scheduled', scheduled_at: at(30 * HOUR) });
    const freesAt = at(4 * HOUR); // a de 20 h atrás sai da janela de 24 h às 14h
    expect(await t.sched.igRoom(WS_A, NOW)).toEqual({ room: 0, freesAt });
    expect(await t.sched.planSlot(WS_A, t.settings(), new Date('2026-10-31T21:00:00Z'), NOW)).toEqual({ at: freesAt, waitingFor: 'ig_limit' });
    // Um post normal agendado nas próximas 24 h também ocupa espaço.
    w.t['ig_posts']!.rows.splice(w.t['ig_posts']!.rows.findIndex((p) => p.published_at?.getTime() === at(-20 * HOUR).getTime()), 1);
    expect((await t.sched.igRoom(WS_A, NOW)).room).toBe(1);
    seedPost(w, { status: 'scheduled', scheduled_at: at(2 * HOUR) });
    expect((await t.sched.igRoom(WS_A, NOW)).room).toBe(0);
  });

  it('fora da janela espera o início dela; vaga que já não daria tempo é cancelada com o motivo da antecedência', async () => {
    const t = await setup();
    const late = new Date('2026-10-30T01:10:00Z'); // 22h10
    expect(await t.sched.planSlot(WS_A, t.settings(), new Date('2026-10-31T21:00:00Z'), late)).toEqual({ at: TOMORROW_8H, waitingFor: 'window' });
    t.clock.t = late.getTime();
    const v = vac({ startTime: '2026-10-30T12:00:00Z', endTime: '2026-10-30T18:00:00Z' }); // amanhã 9h
    const p = await t.delivered(v);
    expect(await t.sched.afterHandOff(WS_A, p.id)).toBe('cancelled');
    expect(t.rowOf(p.id).skip_reason).toBe('Começa às 9h, em menos de 2 h. Não dá tempo de divulgar.');
  });

  it('"Postar agora" (force) às 22h10 com o limite cheio → job em agora+1 min; linha com post_now também', async () => {
    const t = await setup({ settings: { daily_cap: 2 } });
    const late = new Date('2026-10-30T01:10:00Z'); // 22h10 de quinta
    t.clock.t = late.getTime();
    // Quinta e sexta cheias.
    await t.delivered(vac(), { status: 'scheduled', scheduled_at: new Date('2026-10-29T20:00:00Z') });
    await t.delivered(vac(), { status: 'scheduled', scheduled_at: new Date('2026-10-29T20:15:00Z') });
    await t.delivered(vac(), { status: 'scheduled', scheduled_at: new Date('2026-10-30T11:00:00Z') });
    await t.delivered(vac(), { status: 'scheduled', scheduled_at: new Date('2026-10-30T11:15:00Z') });
    const p = await t.delivered(vac());
    expect(await t.sched.planSlot(WS_A, t.settings(), new Date('2026-11-01T21:00:00Z'), late, { postId: p.id })).toEqual({ at: new Date('2026-10-31T11:00:00Z'), waitingFor: 'cap' });
    expect(await t.sched.planSlot(WS_A, t.settings(), new Date('2026-11-01T21:00:00Z'), late, { force: true, postId: p.id })).toEqual({ at: new Date(late.getTime() + MIN), waitingFor: 'none' });

    expect(await t.sched.scheduleVacancyPost(WS_A, p.id, { force: true })).toBe('scheduled');
    expect(p).toMatchObject({ status: 'scheduled', scheduled_at: new Date(late.getTime() + MIN) });
    expect(t.pending(p.id)).toEqual([expect.objectContaining({ run_at: new Date(late.getTime() + MIN) })]);

    // "Postar agora" numa linha que esperava a vez: a entrega agenda já com force.
    const q = await t.delivered(vac(), {}, { row: { post_now: true } });
    expect(await t.sched.afterHandOff(WS_A, q.id)).toBe('scheduled');
    expect(q.scheduled_at).toEqual(new Date(late.getTime() + MIN));
  });

  it('sem conta conectada → no_account, post fica com o aviso (sem job)', async () => {
    const t = await setup({ ig: false });
    const p = await t.delivered(vac());
    expect(await t.sched.scheduleVacancyPost(WS_A, p.id)).toBe('no_account');
    expect(p).toMatchObject({ status: 'ready', last_error: NO_ACCOUNT_MSG });
    expect(t.jobsOf(p.id)).toHaveLength(0);
    // Token vencido continua com o aviso mais preciso.
    const q = await t.delivered(vac(), { last_error: TOKEN_EXPIRED_POST_MSG });
    expect(await t.sched.scheduleVacancyPost(WS_A, q.id)).toBe('no_account');
    expect(q.last_error).toBe(TOKEN_EXPIRED_POST_MSG);
  });

  it('aprovar um post de vaga (approvePost) → agendado na hora pelo callback da guarda', async () => {
    const t = await setup({ settings: { auto_publish: false } });
    const p = await t.delivered(vac(), { status: 'pending_approval' }, { requiresApproval: true });
    await t.s.actions.approvePost(OWNER, WS_A, p.id);
    expect(p).toMatchObject({ status: 'scheduled', scheduled_at: at(MIN) });
    expect(p.approved_at).toBeInstanceOf(Date);
    expect(t.pending(p.id)).toHaveLength(1);
  });

  it('tick: agenda aprovado sem job e reconcilia scheduled/ready sem job; nunca o que ainda precisa de aprovação', async () => {
    const t = await setup();
    const busy = await t.delivered(vac(), { status: 'scheduled', scheduled_at: at(30 * MIN) });
    const busyJob = t.job(busy.id, at(30 * MIN));
    const approved = await t.delivered(vac(), { status: 'approved', approved_at: NOW }, { requiresApproval: true });
    // Job cancelado quando o token venceu e o post ficou agendado (ou "Publicar agora" com a vitrine fora).
    const orphan = await t.delivered(vac(), { status: 'scheduled', scheduled_at: at(-30 * MIN) });
    t.job(orphan.id, at(-30 * MIN), 'cancelled');
    // Token vencido (R16): voltou para pronto; reconectou.
    const readyAuto = await t.delivered(vac(), { status: 'ready', last_error: TOKEN_EXPIRED_POST_MSG });
    const readyNeeds = await t.delivered(vac(), { status: 'ready' }, { requiresApproval: true });
    const pendingApproval = await t.delivered(vac(), { status: 'pending_approval' }, { requiresApproval: true });

    expect(await t.sched.tick(NOW)).toEqual({ approved: 1, reconciled: 2 });
    expect(approved).toMatchObject({ status: 'scheduled', scheduled_at: at(45 * MIN) });
    expect(orphan).toMatchObject({ status: 'scheduled', scheduled_at: at(60 * MIN) });
    expect(readyAuto).toMatchObject({ status: 'scheduled', scheduled_at: at(75 * MIN), last_error: null });
    for (const p of [approved, orphan, readyAuto]) expect(t.pending(p.id)).toHaveLength(1);
    expect(t.jobsOf(busy.id)).toEqual([busyJob]);
    expect(busyJob).toMatchObject({ status: 'pending', run_at: at(30 * MIN) });
    expect(readyNeeds.status).toBe('ready');
    expect(pendingApproval.status).toBe('pending_approval');
    expect(t.jobsOf(readyNeeds.id)).toHaveLength(0);
    expect(t.jobsOf(pendingApproval.id)).toHaveLength(0);

    // Segunda rodada: nada a fazer.
    expect(await t.sched.tick(NOW)).toEqual({ approved: 0, reconciled: 0 });
  });

  it('"Publicar agora" com a vitrine fora deixa o post agendado sem job; o tick reagenda', async () => {
    const t = await setup();
    const p = await t.delivered(vac(), { status: 'scheduled', scheduled_at: at(2 * HOUR) });
    const j = t.job(p.id, at(2 * HOUR));
    w.feed.state.down = true;
    expect(await t.s.actions.publishInstagramPost(OWNER, WS_A, p.id)).toEqual({ ok: false, sandbox: false, error: ORIGIN_UNAVAILABLE_MSG });
    expect(p.status).toBe('scheduled');
    expect(j.status).toBe('cancelled');
    expect(t.pending(p.id)).toHaveLength(0);

    w.feed.state.down = false;
    expect(await t.sched.tick(NOW)).toEqual({ approved: 0, reconciled: 1 });
    expect(p).toMatchObject({ status: 'scheduled', scheduled_at: at(MIN) });
    expect(t.pending(p.id)).toEqual([expect.objectContaining({ run_at: at(MIN) })]);
  });

  it('empresa desligada ou fora da lista: o tick não mexe nos posts dela', async () => {
    const t = await setup({ settings: { enabled: false } });
    const p = await t.delivered(vac(), { status: 'approved', approved_at: NOW });
    expect(await t.sched.tick(NOW)).toEqual({ approved: 0, reconciled: 0 });
    expect(p.status).toBe('approved');
  });
});

describe('VacancyGuardService — guarda antes de publicar', () => {
  it('post que não é de vaga: null sem chamar a vitrine', async () => {
    await setup();
    const p = seedPost(w, { status: 'scheduled' });
    expect(await w.guard.blockReason(p, NOW)).toBeNull();
    expect(w.feed.state.urls).toEqual([]);
  });

  it('vaga aberta, mesma assinatura, com tempo: libera', async () => {
    const t = await setup();
    const p = await t.delivered(vac(), { status: 'scheduled' });
    expect(await w.guard.blockReason(p, NOW)).toBeNull();
    expect(t.rowOf(p.id)).toMatchObject({ status: 'handed_off', skip_reason: null });
  });

  it('vaga fechada (404) → motivo de fechada, gravado na linha', async () => {
    const t = await setup();
    const v = vac();
    const p = await t.delivered(v, { status: 'scheduled' });
    w.feed.state.closed.add(v.id);
    expect(await w.guard.blockReason(p, NOW)).toBe(CLOSED);
    expect(t.rowOf(p.id)).toMatchObject({ status: 'handed_off', skip_reason: CLOSED });
  });

  it('vitrine fora do ar → OriginUnavailable (a fila tenta de novo), linha intacta', async () => {
    const t = await setup();
    const p = await t.delivered(vac(), { status: 'scheduled' });
    w.feed.state.down = true;
    await expect(w.guard.blockReason(p, NOW)).rejects.toBeInstanceOf(OriginUnavailable);
    expect(t.rowOf(p.id)).toMatchObject({ status: 'handed_off', skip_reason: null });
  });

  it('assinatura mudou → linha volta a new com os dados novos e redo_count 1', async () => {
    const t = await setup();
    const v = vac();
    const p = await t.delivered(v, { status: 'scheduled' }, { row: { mismatch_attempts: 2, wait_reason: 'x', not_before: at(HOUR) } });
    const row = t.rowOf(p.id);
    const changed = { ...v, amountInCents: 18000, startTime: '2026-10-31T22:00:00Z' };
    w.feed.state.byId.set(v.id, changed);
    expect(await w.guard.blockReason(p, NOW)).toBe(CHANGED);
    expect(row).toMatchObject({
      status: 'new', ig_post_id: null, fingerprint: fingerprint(changed), snapshot: changed, starts_at: new Date('2026-10-31T22:00:00Z'),
      redo_count: 1, mismatch_attempts: 0, wait_reason: null, not_before: null, skip_reason: null,
    });
  });

  it('Review Focus #3: a vaga muda 4 vezes → 3 refações e a 4ª deixa a linha failed com o texto D11, sem nova geração', async () => {
    const t = await setup();
    let v = vac();
    let p = await t.delivered(v, { status: 'scheduled' });
    const row = t.rowOf(p.id);
    for (let n = 1; n <= 3; n++) {
      v = { ...v, amountInCents: 15000 + n * 1000 };
      w.feed.state.byId.set(v.id, v);
      expect(await w.guard.blockReason(p, NOW)).toBe(CHANGED);
      expect(row).toMatchObject({ status: 'new', redo_count: n, ig_post_id: null });
      // O gerador entrega de novo (novo post com a assinatura nova).
      p = seedPost(w, {
        source: 'vacancy', format: 'story_image', status: 'scheduled', automation: null, plan_id: null, run_id: null,
        creative_brief: { vacancy: { external_id: v.id, fingerprint: fingerprint(v), requires_approval: false, starts_at: v.startTime } },
      });
      Object.assign(row, { status: 'handed_off', ig_post_id: p.id });
    }
    v = { ...v, amountInCents: 99000 };
    w.feed.state.byId.set(v.id, v);
    expect(await w.guard.blockReason(p, NOW)).toBe(TOO_MANY);
    expect(row).toMatchObject({ status: 'failed', skip_reason: TOO_MANY, redo_count: 3 });
    expect(w.t['vacancy_stories']!.rows.filter((r) => ['new', 'waiting', 'generating'].includes(r.status))).toHaveLength(0);
  });

  it('na hora da publicação a vaga já começou / falta menos que a antecedência', async () => {
    const t = await setup();
    const v = vac();
    const p = await t.delivered(v, { status: 'scheduled' });
    expect(await w.guard.blockReason(p, new Date(new Date(v.startTime).getTime() + MIN))).toBe(STARTED);
    expect(t.rowOf(p.id).skip_reason).toBe(STARTED);
    const q = await t.delivered(vac(), { status: 'scheduled' });
    expect(await w.guard.blockReason(q, new Date(new Date(v.startTime).getTime() - 90 * MIN))).toBe('Começa às 18h, em menos de 2 h. Não dá tempo de divulgar.');
    expect(t.rowOf(q.id).skip_reason).toBe('Começa às 18h, em menos de 2 h. Não dá tempo de divulgar.');
  });

  it('pela fila de publicação: vaga fechada → post e job cancelados, nenhum container, motivo na linha', async () => {
    const t = await setup();
    // Datas relativas ao relógio real: a fila usa `new Date()`.
    const start = Date.now() + 3 * 24 * HOUR;
    const v = vac({ startTime: new Date(start).toISOString(), endTime: new Date(start + 5 * HOUR).toISOString() });
    const p = await t.delivered(v, { status: 'scheduled', scheduled_at: new Date(Date.now() - MIN) });
    const j = t.job(p.id, new Date(Date.now() - MIN));
    w.feed.state.closed.add(v.id);
    const res = await t.s.publishing.runPublishingQueue();
    expect(res[0]).toMatchObject({ job: j.id, status: 'skipped' });
    expect(p.status).toBe('cancelled');
    expect(j.status).toBe('cancelled');
    expect(w.calls.filter((c) => c.path.endsWith('/media'))).toHaveLength(0);
    expect(t.rowOf(p.id).skip_reason).toBe(CLOSED);
  });
});
