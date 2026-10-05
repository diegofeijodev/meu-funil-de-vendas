import { ADMIN, MARKETING, OWNER, STRANGER, VIEWER, WS_A, WS_B, status } from '../../media/__tests__/mem';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';
import { plusDays, todaySP } from '../slots';

function setup() {
  const w: IgWorld = igWorld();
  const s = igServices(w);
  return { w, s, a: s.actions, auto: s.auto };
}
const brandOf = (w: IgWorld, workspaceId: string = WS_A, over: Record<string, unknown> = {}): any => {
  const b = { id: uuid(), workspace_id: workspaceId, name: 'Bar do Zé', segment: 'bar', tone_of_voice: 'descontraído', banned_words: ['barato'], region: 'Valinhos', ...over };
  w.t['brands']!.rows.push(b);
  return b;
};
/** Plano com marca própria (a programação exige marca); `brand_id: null` simula plano sem marca. */
const plan = (w: IgWorld, over: Record<string, unknown> = {}): any => {
  const ws = (over['workspace_id'] as string) ?? WS_A;
  const brand_id = 'brand_id' in over ? over['brand_id'] : brandOf(w, ws).id;
  const p = { id: uuid(), workspace_id: ws, name: 'Plano', status: 'active', requires_approval: false, auto_publish: false, content_pillars: ['A'], hashtag_strategy: {}, ai_notes: [], pillar_weights: {}, cta_default: 'Peça já', objective: 'x', tone_of_voice: 't', posting_days: [0, 1, 2, 3, 4, 5, 6], ...over, brand_id };
  w.t['ig_content_plans']!.rows.push(p);
  return p;
};
const OBJECTIVE = 'Levar o público de Valinhos para almoçar o prato executivo durante a semana';
const STRATEGY = {
  objetivo_resumido: 'Almoço executivo', kpi_principal: 'Reservas', publico_foco: 'Adultos', mensagem_central: 'Almoço rápido e gostoso',
  pilares: [{ nome: 'A', peso_percentual: 100, por_que_serve_ao_objetivo: 'serve' }], distribuicao_por_dia: [], ctas: ['CTA', 'Peça já'], proibicoes: ['barato'],
};
/** Post da programação já ligado ao objetivo/pilar/persona (a checagem final de agendamento exige). */
const ALIGNED = { objective_link: 'Serve ao objetivo', pillar: 'A', persona: 'Ana' };
const DATE = (s: string) => new Date(`${s}T12:00:00Z`);
const slotAt = (minutes: number, i: number, format = 'feed_image') => ({ index: i, at: new Date(Date.now() + minutes * 60e3).toISOString(), format, kind: 'main' });
/** Programação com estratégia JÁ aprovada (o passo da estratégia tem os testes próprios abaixo); `strategy_status: 'pending'` para testá-lo. */
const run = (w: IgWorld, p: any, over: Record<string, unknown> = {}): any => {
  const r = { id: uuid(), workspace_id: WS_A, plan_id: p.id, created_by: OWNER, start_date: DATE('2099-01-01'), end_date: DATE('2099-01-07'), weekdays: [0, 1, 2, 3, 4, 5, 6], times: ['09:00'], story_times: [], formats: ['feed_image'], status: 'planning', filled: 0, slots: [], mode: 'publish', recurring: false, parent_id: null, campaign_id: null, locked_until: null, focus: OBJECTIVE, strategy: STRATEGY, strategy_status: 'approved', paused_reason: null, last_error: null, ...over };
  w.t['ig_auto_runs']!.rows.push(r);
  return r;
};
const input = (over: Record<string, unknown> = {}): any => ({ workspaceId: WS_A, startDate: '2099-01-01', endDate: '2099-01-03', weekdays: [0, 1, 2, 3, 4, 5, 6], times: ['09:00', '18:00'], storyTimes: [], formats: ['feed_image'], mode: 'approval', focus: OBJECTIVE, ...over });

describe('createAutoCalendar', () => {
  it('cria a programação com os horários exatos, normaliza horários e registra o evento', async () => {
    const { w, a } = setup();
    const p = plan(w);
    const r = await a.createAutoCalendar(OWNER, input({ planId: p.id, times: ['9:00', '09:00', '18:00'], focus: `  ${OBJECTIVE}  ` }));
    expect(r).toMatchObject({ planId: p.id, total: 6, skipped: 0 });
    const row = w.t['ig_auto_runs']!.rows[0];
    expect(row).toMatchObject({ id: r.runId, workspace_id: WS_A, plan_id: p.id, created_by: OWNER, mode: 'approval', recurring: false, focus: OBJECTIVE, times: ['09:00', '18:00'], story_times: [] });
    expect(row.slots).toHaveLength(6);
    expect(row.slots[0]).toMatchObject({ index: 0, at: '2099-01-01T12:00:00.000Z', format: 'feed_image', kind: 'main' });
    expect(w.t['ig_autopilot_events']!.rows[0]).toMatchObject({ kind: 'generation', plan_id: p.id });
    expect(w.t['ig_autopilot_events']!.rows[0].message).toMatch(/Programação criada: 6 posts .* \(com aprovação\)/);
  });

  it('sem plano cria um a partir da marca (pilares sugeridos pela IA); exige plano ou marca; ids de outra empresa = 404', async () => {
    const { w, s, a } = setup();
    expect(await status(a.createAutoCalendar(OWNER, input()))).toBe('400:Cadastre a marca em Brands antes.');
    const brand = { id: uuid(), workspace_id: WS_A, name: 'Chopp do Zé', tone_of_voice: 'descontraído', target_audience: 'adultos' };
    const alien = { id: uuid(), workspace_id: WS_B, name: 'Alheia' };
    w.t['brands']!.rows.push(brand, alien);
    s.aiJson['ig_pillars'] = () => ({ pillars: ['Bastidores', 'Promoções'] });
    const r = await a.createAutoCalendar(OWNER, input({ brandId: brand.id, mode: 'publish' }));
    expect(w.t['ig_content_plans']!.rows[0]).toMatchObject({ id: r.planId, workspace_id: WS_A, brand_id: brand.id, name: 'Instagram · Chopp do Zé', content_pillars: ['Bastidores', 'Promoções'], requires_approval: false, auto_publish: false, status: 'active', tone_of_voice: 'descontraído' });
    expect(await status(a.createAutoCalendar(OWNER, input({ brandId: alien.id })))).toBe('404:Marca não encontrada.');
    const otherPlan = plan(w, { workspace_id: WS_B });
    expect(await status(a.createAutoCalendar(OWNER, input({ planId: otherPlan.id })))).toBe('404:Plano de conteúdo não encontrado.');
    expect(await status(a.createAutoCalendar(OWNER, input({ planId: plan(w).id, campaignId: uuid() })))).toBe('404:Campanha não encontrada.');
    expect(w.t['ig_auto_runs']!.rows).toHaveLength(1);
  });

  it('todos os horários no passado: mensagem do protótipo', async () => {
    const { w, a } = setup();
    const p = plan(w);
    const today = todaySP();
    const e = await status(a.createAutoCalendar(OWNER, input({ planId: p.id, startDate: today, endDate: today, times: ['00:00'] })));
    expect(e).toMatch(/^400:(Todos os horários escolhidos já passaram|Nenhum horário no período)/);
  });
});

describe('fillAutoRun (estrategista em lotes, lock de 240 s)', () => {
  const posts = (n: number) => ({ posts: Array.from({ length: n }, (_, i) => ({ index: i, theme: `T${i}`, pillar: 'A', persona: 'Ana', product_name: '', funnel_stage: 'atracao', objective_link: 'Serve ao objetivo', hook: 'H', headline: 'Manchete', caption: 'Legenda', hashtags: ['a', 'b'], cta: 'CTA', image_prompt: 'cena', slides: ['s1'] })) });
  const aiPosts = (s: ReturnType<typeof setup>['s']) => s.ai.jsonWithEngine.mock.calls.filter((c: any[]) => c[1].name === 'ig_auto_calendar');

  it('preenche 8 horários por chamada, avança "filled" e conclui em "active"', async () => {
    const { w, s, a } = setup();
    const p = plan(w);
    const slots = Array.from({ length: 10 }, (_, i) => slotAt(600 + i * 60, i, i === 3 ? 'feed_carousel' : 'feed_image'));
    const r = run(w, p, { slots, mode: 'approval' });
    s.aiJson['ig_auto_calendar'] = () => posts(10);
    expect(await a.fillAutoCalendar(OWNER, r.id)).toEqual({ filled: 8, total: 10, done: false, busy: false, strategyReview: false });
    expect(r).toMatchObject({ filled: 8, status: 'planning', locked_until: null });
    const created = w.t['ig_posts']!.rows;
    expect(created).toHaveLength(8);
    expect(created[0]).toMatchObject({ workspace_id: WS_A, plan_id: p.id, run_id: r.id, automation: 'approval', status: 'idea', theme: 'T0', hook: 'H', caption: 'Legenda', cta: 'CTA', hashtags: ['a', 'b'], ai_provider: 'lovable_ai', objective_link: 'Serve ao objetivo', pillar: 'A', persona: 'Ana', product_id: null, funnel_stage: 'atracao', review_reason: null, review_score: null });
    expect(created[0].scheduled_at).toEqual(new Date(slots[0]!.at));
    expect(created[0].creative_brief).toMatchObject({ prompt: 'cena', slides: [], aspect_ratio: '1:1', headline: 'Manchete', pillar: 'A', funnel_stage: 'atracao', variations: 3 });
    expect(created[3].creative_brief).toMatchObject({ slides: ['s1'], aspect_ratio: '4:5' });
    expect(await a.fillAutoCalendar(OWNER, r.id)).toEqual({ filled: 10, total: 10, done: true, busy: false, strategyReview: false });
    expect(r.status).toBe('active');
    expect(created).toHaveLength(10);
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'generation' });
    // programação concluída: chamada extra não gera nada
    expect(await a.fillAutoCalendar(OWNER, r.id)).toEqual({ filled: 10, total: 10, done: true, busy: false, strategyReview: false });
    expect(w.t['ig_posts']!.rows).toHaveLength(10);
  });

  it('chamadas simultâneas: quem não pegou o lock recebe busy:true e não gasta IA; lock vencido é reassumido', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0)] });
    s.aiJson['ig_auto_calendar'] = () => posts(1);
    const [x, y] = await Promise.all([auto.fillAutoRun(r.id), auto.fillAutoRun(r.id)]);
    expect([x, y].filter((o) => o.busy)).toHaveLength(1);
    expect(aiPosts(s)).toHaveLength(1);
    const r2 = run(w, plan(w), { slots: [slotAt(600, 0)], locked_until: new Date(Date.now() + 100e3) });
    expect(await auto.fillAutoRun(r2.id)).toMatchObject({ busy: true, filled: 0 });
    r2.locked_until = new Date(Date.now() - 1000);
    expect(await auto.fillAutoRun(r2.id)).toMatchObject({ busy: false, filled: 1, done: true });
  });

  it('o lock (240 s) é maior que o timeout da IA (180 s); se outro lote avançou a programação no meio, o resultado atrasado não sobrescreve', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0), slotAt(660, 1)] });
    let lease = 0;
    s.aiJson['ig_auto_calendar'] = () => {
      lease = r.locked_until.getTime() - Date.now();
      r.filled = 2; // outro worker (lock vencido) já concluiu e avançou
      r.status = 'active';
      return posts(2);
    };
    const out = await auto.fillAutoRun(r.id);
    expect(lease).toBeGreaterThanOrEqual(240_000 - 2_000);
    expect(lease).toBeGreaterThan(180_000);
    expect(out).toMatchObject({ busy: true, filled: 2, done: true });
    expect(r).toMatchObject({ filled: 2, status: 'active' });
    // lock ainda válido aos 200 s: continua ocupado
    const r2 = run(w, plan(w), { slots: [slotAt(600, 0)], locked_until: new Date(Date.now() + 200e3) });
    expect(await auto.fillAutoRun(r2.id)).toMatchObject({ busy: true });
  });

  it('IA falha: solta o lock, guarda last_error, registra o evento e relança; item malformado/ausente vira post simples', async () => {
    const { w, s, auto } = setup();
    const p = plan(w);
    const r = run(w, p, { slots: [slotAt(600, 0), slotAt(660, 1)] });
    s.aiJson['ig_auto_calendar'] = () => { throw new Error('IA fora do ar'); };
    await expect(auto.fillAutoRun(r.id)).rejects.toThrow('IA fora do ar');
    expect(r).toMatchObject({ locked_until: null, last_error: 'IA fora do ar', filled: 0 });
    expect(w.t['ig_autopilot_events']!.rows[0]).toMatchObject({ kind: 'failure', level: 'error' });
    expect(w.t['ig_autopilot_events']!.rows[0].message).toMatch(/tenta de novo em 5 min\): IA fora do ar/);
    // só o índice 0 volta; o 1 (ausente nas 3 tentativas) ganha um post simples em revisão, com aviso no log
    s.aiJson['ig_auto_calendar'] = () => ({ posts: [{ index: 0, theme: 'Só este', hashtags: 'x y' }] });
    await auto.fillAutoRun(r.id);
    const rows = w.t['ig_posts']!.rows;
    expect(rows[0]).toMatchObject({ theme: 'Só este', hashtags: ['x', 'y'], cta: 'Peça já', status: 'idea' });
    expect(rows[0].ai_generation_log[0].warnings).toEqual(['hashtags vieram como texto e foram normalizadas']);
    expect(rows[1].ai_generation_log[0].warnings).toEqual(['a IA não devolveu conteúdo para este horário']);
    expect(rows[1]).toMatchObject({ status: 'needs_review', review_reason: 'A IA não devolveu conteúdo para este horário.' });
    expect(rows[1].theme).toMatch(/^Post de /);
  });

  it('descarta horários que passaram esperando e usa 1 variação quando falta menos de 90 min', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(5, 0), slotAt(60, 1), slotAt(300, 2)] });
    s.aiJson['ig_auto_calendar'] = () => posts(3);
    await auto.fillAutoRun(r.id);
    const rows = w.t['ig_posts']!.rows;
    expect(rows).toHaveLength(2); // o de 5 min (<10 min) foi descartado, mas conta como preenchido
    expect(r.filled).toBe(3);
    expect(rows.map((x) => x.creative_brief.variations)).toEqual([1, 3]);
    expect(s.ai.jsonWithEngine.mock.calls[0][1].prompt).not.toMatch(/index 0:/);
  });

  it('usa a estratégia da campanha e o objetivo do período (prioridade 1) no prompt', async () => {
    const { w, s, auto } = setup();
    s.strategist.currentStrategy.mockResolvedValue({ big_idea: 'Chopp gelado de verdade', mensagem_principal: 'm', angulos_detalhados: [], objecoes: [], briefing_criativo: {} });
    const p = plan(w);
    const camp = uuid();
    const r = run(w, p, { slots: [slotAt(600, 0)], campaign_id: camp, focus: 'Black Friday com chopp em dobro para quem chegar cedo' });
    s.aiJson['ig_auto_calendar'] = () => posts(1);
    await auto.fillAutoRun(r.id);
    const prompt = s.ai.jsonWithEngine.mock.calls[0][1].prompt as string;
    expect(prompt).toMatch(/1\. OBJETIVO DO PERÍODO \(fonte principal, cada post precisa servir a ele\): Black Friday com chopp em dobro/);
    expect(prompt).toMatch(/CAMPANHA LIGADA: .*Chopp gelado de verdade/);
    expect(s.strategist.currentStrategy).toHaveBeenCalledWith(WS_A, camp);
  });

  it('programação de outra empresa = 404; viewer não preenche; marketing sim', async () => {
    const { w, s, a } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0)] });
    s.aiJson['ig_auto_calendar'] = () => posts(1);
    expect(await status(a.fillAutoCalendar(STRANGER, r.id))).toBe('404:Programação não encontrada.');
    expect(await status(a.fillAutoCalendar(uuid(), uuid()))).toBe('404:Programação não encontrada.');
    expect(await status(a.fillAutoCalendar(VIEWER, r.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(w.t['ig_posts']!.rows).toHaveLength(0);
    expect(await status(a.fillAutoCalendar(MARKETING, r.id))).toBe('ok');
  });
});

describe('generateNextAutoMedia (laço do navegador)', () => {
  it('gera o criativo do próximo post na janela e agenda; devolve restantes', async () => {
    const { w, s, a } = setup();
    connected(w);
    const p = plan(w);
    const r = run(w, p, { status: 'active', mode: 'publish' });
    const soon1 = seedPost(w, { status: 'idea', media: [], run_id: r.id, plan_id: p.id, ...ALIGNED, automation: 'publish', scheduled_at: new Date(Date.now() + 2 * 3600e3) });
    const soon2 = seedPost(w, { status: 'idea', media: [], run_id: r.id, plan_id: p.id, ...ALIGNED, automation: 'publish', scheduled_at: new Date(Date.now() + 3 * 3600e3) });
    const far = seedPost(w, { status: 'idea', media: [], run_id: r.id, plan_id: p.id, ...ALIGNED, automation: 'publish', scheduled_at: new Date(Date.now() + 30 * 3600e3) });
    const other = seedPost(w, { status: 'idea', media: [], run_id: uuid(), automation: 'publish', scheduled_at: new Date(Date.now() + 3600e3) });
    const res = await a.generateNextAutoMedia(OWNER, { runId: r.id, withinHours: 6 });
    expect(res).toEqual({ done: false, ok: true, error: null, remaining: 1 });
    expect(soon1.status).toBe('scheduled'); // mídia pronta + publish => agendado
    expect(soon1.media).toHaveLength(1);
    expect(soon2.status).toBe('idea');
    expect(far.status).toBe('idea');
    expect(other.status).toBe('idea');
    expect(s.pipeline.run).toHaveBeenCalledTimes(1);
    expect(await a.generateNextAutoMedia(OWNER, { runId: r.id })).toEqual({ done: true, ok: true, error: null, remaining: 0 }); // soon2 (janela padrão de 6 h)
    expect(soon2.status).toBe('scheduled');
    expect(await a.generateNextAutoMedia(OWNER, { runId: r.id })).toEqual({ done: true, ok: true, remaining: 0 });
  });

  it('falha da mídia volta { ok:false, error } e o post fica failed', async () => {
    const { w, s, a } = setup();
    const p = plan(w);
    const r = run(w, p, { status: 'active' });
    const post = seedPost(w, { status: 'idea', media: [], run_id: r.id, plan_id: p.id, ...ALIGNED, automation: 'publish', scheduled_at: new Date(Date.now() + 3600e3) });
    s.pipeline.run.mockRejectedValueOnce(new Error('Sem créditos de IA'));
    const res = await a.generateNextAutoMedia(OWNER, { runId: r.id, withinHours: 6 });
    expect(res).toEqual({ done: true, ok: false, error: 'Sem créditos de IA', remaining: 0 });
    expect(post).toMatchObject({ status: 'failed', last_error: 'Sem créditos de IA' });
  });
});
const connected = (w: IgWorld) => w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, ig_user_id: 'ig1', status: 'connected' });

describe('cancelAutoCalendar', () => {
  it('cancela a programação e as semanas dela, os posts não publicados e os jobs pendentes', async () => {
    const { w, a } = setup();
    const p = plan(w);
    const root = run(w, p, { status: 'active', recurring: true });
    const kid = run(w, p, { status: 'active', parent_id: root.id });
    const mk = (runId: string, st: string) => seedPost(w, { run_id: runId, status: st, plan_id: p.id });
    const pubd = mk(root.id, 'published');
    const publishing = mk(root.id, 'publishing');
    const sched = mk(root.id, 'scheduled');
    const idea = mk(kid.id, 'idea');
    const foreign = seedPost(w, { run_id: uuid(), status: 'scheduled' });
    w.t['publishing_jobs']!.rows.push({ id: uuid(), ig_post_id: sched.id, status: 'pending' }, { id: uuid(), ig_post_id: foreign.id, status: 'pending' });
    expect(await a.cancelAutoCalendar(OWNER, root.id)).toEqual({ cancelled: 2 });
    expect([root.status, kid.status, root.recurring]).toEqual(['cancelled', 'cancelled', false]);
    expect([pubd.status, publishing.status, sched.status, idea.status, foreign.status]).toEqual(['published', 'publishing', 'cancelled', 'cancelled', 'scheduled']);
    expect(w.t['publishing_jobs']!.rows.map((j) => j.status)).toEqual(['cancelled', 'pending']);
    expect(await status(a.cancelAutoCalendar(STRANGER, root.id))).toBe('404:Programação não encontrada.');
    expect(await status(a.cancelAutoCalendar(VIEWER, root.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
  });
});

describe('autoCalendarTick (a cada 5 min)', () => {
  it('2: agenda posts automáticos prontos (e aprovados no modo approval); 2b: uma nova tentativa para falhas; 5: conclui programações', async () => {
    const { w, s, auto } = setup();
    connected(w);
    const p = plan(w);
    const r = run(w, p, { status: 'active' });
    const ready = seedPost(w, { automation: 'publish', status: 'ready', plan_id: p.id, run_id: r.id, ...ALIGNED, scheduled_at: new Date(Date.now() + 3600e3) });
    const waitApproval = seedPost(w, { automation: 'approval', status: 'ready', approved_at: null, plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3 * 3600e3) });
    const failed = seedPost(w, { automation: 'publish', status: 'failed', failure_kind: 'media', plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3600e3), creative_brief: { prompt: 'x', variations: 3 } });
    const failedTwice = seedPost(w, { automation: 'publish', status: 'failed', failure_kind: 'media', plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3600e3), creative_brief: { auto_retried: true } });
    const publishFail = seedPost(w, { automation: 'publish', status: 'failed', failure_kind: 'publish', plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3600e3), creative_brief: { prompt: 'y' } });
    const out = await auto.autoCalendarTick();
    expect(out).toMatchObject({ filled: 0, scheduled: 1, rescheduled: 0 });
    expect(ready.status).toBe('scheduled');
    expect(waitApproval.status).toBe('ready');
    expect(failed).toMatchObject({ status: 'idea', creative_brief: { prompt: 'x', auto_retried: true, variations: 1 } });
    expect(failedTwice.status).toBe('failed');
    expect(publishFail.status).toBe('failed'); // falha de publicação: a mídia não é refeita
    expect(r.status).toBe('active'); // ainda há posts em aberto
    void s;
  });

  it('3: modo com aprovação sem aprovar 10 min antes vai para o mesmo horário do dia seguinte', async () => {
    const { w, auto } = setup();
    const p = plan(w);
    const t0 = Date.now() + 5 * 60e3;
    const late = seedPost(w, { automation: 'approval', status: 'pending_approval', approved_at: null, plan_id: p.id, scheduled_at: new Date(t0) });
    const fine = seedPost(w, { automation: 'approval', status: 'pending_approval', approved_at: null, plan_id: p.id, scheduled_at: new Date(Date.now() + 3 * 3600e3) });
    const approved = seedPost(w, { automation: 'approval', status: 'approved', plan_id: p.id, scheduled_at: new Date(Date.now() + 5 * 60e3) });
    const out = await auto.autoCalendarTick();
    expect(out['rescheduled']).toBe(1);
    expect(late.scheduled_at.getTime()).toBe(t0 + 86400e3);
    expect(fine.scheduled_at.getTime()).toBeLessThan(t0 + 4 * 3600e3);
    void approved;
    expect(w.t['ig_autopilot_events']!.rows.find((e) => e.kind === 'reschedule')).toMatchObject({ level: 'warn' });
  });

  it('5: todos os posts finalizados → programação "done"; planning vira active pelo próprio tick', async () => {
    const { w, s, auto } = setup();
    const p = plan(w);
    const active = run(w, p, { status: 'active' });
    seedPost(w, { run_id: active.id, status: 'published', plan_id: p.id });
    seedPost(w, { run_id: active.id, status: 'failed', plan_id: p.id });
    const planning = run(w, p, { slots: [slotAt(600, 0)] });
    s.aiJson['ig_auto_calendar'] = () => ({ posts: [{ index: 0, theme: 'T' }] });
    const out = await auto.autoCalendarTick();
    expect(out['filled']).toBe(1);
    expect(active.status).toBe('done');
    expect(planning.status).toBe('active');
  });
});

describe('renewRecurring', () => {
  it('quando faltam < 7 dias cria a semana seguinte uma vez; filha não renova; cancelada não renova', async () => {
    const { w, auto } = setup();
    const p = plan(w);
    const t = todaySP();
    const root = run(w, p, { recurring: true, status: 'active', start_date: DATE(plusDays(t, -3)), end_date: DATE(plusDays(t, 3)), times: ['09:00'] });
    expect(await auto.renewRecurring()).toEqual({ created: 1 });
    const kid = w.t['ig_auto_runs']!.rows[1];
    expect(kid).toMatchObject({ parent_id: root.id, recurring: false, mode: 'publish', plan_id: p.id, workspace_id: WS_A });
    expect(kid.start_date.toISOString().slice(0, 10)).toBe(plusDays(t, 4));
    expect(kid.end_date.toISOString().slice(0, 10)).toBe(plusDays(t, 10));
    expect(kid.slots.length).toBeGreaterThan(0);
    expect(w.t['ig_autopilot_events']!.rows[0].message).toMatch(/Programação recorrente: semana de/);
    expect(await auto.renewRecurring()).toEqual({ created: 0 }); // lastEnd (t+10) >= t+7
    root.status = 'cancelled';
    root.recurring = false;
    expect(await auto.renewRecurring()).toEqual({ created: 0 });
  });
});

describe('summary (tela "Programar com IA")', () => {
  it('raízes com semanas e contagem de posts por situação; só da empresa', async () => {
    const { w, auto } = setup();
    const p = plan(w);
    const root = run(w, p, { status: 'active' });
    const kid = run(w, p, { parent_id: root.id });
    for (const [rid, st] of [[root.id, 'pending_approval'], [root.id, 'scheduled'], [kid.id, 'published'], [kid.id, 'failed'], [kid.id, 'idea']] as const) seedPost(w, { run_id: rid, status: st });
    run(w, plan(w, { workspace_id: WS_B }), { workspace_id: WS_B });
    const out = await auto.summary(WS_A);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: root.id, weeks: 2, counts: { total: 5, media: 3, waiting: 1, scheduled: 1, published: 1, failed: 1 } });
    expect(await auto.summary(uuid())).toEqual([]);
    void ADMIN;
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Atualização do protótipo (05/10/2026): estratégia do período, validador de posts e needs_review.
// ---------------------------------------------------------------------------------------------------------------------

describe('createAutoCalendar — objetivo obrigatório e marca obrigatória', () => {
  it('objetivo com menos de 30 caracteres (depois do trim) ou ausente: mensagem do protótipo; nada é criado', async () => {
    const { w, a } = setup();
    const p = plan(w);
    const MSG = '400:Descreva o objetivo deste período (mínimo de 30 caracteres).';
    expect(await status(a.createAutoCalendar(OWNER, input({ planId: p.id, focus: 'Black Friday' })))).toBe(MSG);
    expect(await status(a.createAutoCalendar(OWNER, input({ planId: p.id, focus: `   ${'x'.repeat(29)}   ` })))).toBe(MSG);
    expect(await status(a.createAutoCalendar(OWNER, input({ planId: p.id, focus: undefined })))).toBe(MSG);
    expect(await status(a.createAutoCalendar(OWNER, input({ planId: p.id, focus: 'x'.repeat(30) })))).toBe('ok');
    expect(w.t['ig_auto_runs']!.rows).toHaveLength(1);
    expect(w.t['ig_auto_runs']!.rows[0]).toMatchObject({ strategy: null, strategy_status: 'pending', paused_reason: null });
  });

  it('plano sem marca vinculada: "Cadastre a marca em Brands antes (e vincule-a ao plano de conteúdo)."', async () => {
    const { w, a } = setup();
    const p = plan(w, { brand_id: null });
    expect(await status(a.createAutoCalendar(OWNER, input({ planId: p.id })))).toBe('400:Cadastre a marca em Brands antes (e vincule-a ao plano de conteúdo).');
    expect(w.t['ig_auto_runs']!.rows).toHaveLength(0);
  });
});

describe('estratégia do período (passo 1 do fillAutoRun)', () => {
  const STRAT_JSON = {
    objetivo_resumido: 'Almoço executivo', kpi_principal: 'Reservas', publico_foco: 'Adultos de Valinhos', mensagem_central: 'Almoço rápido',
    pilares: [{ nome: 'Almoço', peso_percentual: 70, por_que_serve_ao_objetivo: 'serve' }, { nome: 'Bastidores', peso_percentual: 30, por_que_serve_ao_objetivo: 'conexão' }],
    distribuicao_por_dia: [], ctas: ['Reserve pelo WhatsApp'], proibicoes: ['barato'],
  };
  const pendingRun = (w: IgWorld, over: Record<string, unknown> = {}) => run(w, plan(w), { mode: 'approval', slots: [slotAt(600, 0), slotAt(660, 1)], strategy: null, strategy_status: 'pending', ...over });
  const setPosts = (s: ReturnType<typeof setup>['s'], n = 2) => {
    s.aiJson['ig_auto_calendar'] = () => ({ posts: Array.from({ length: n }, (_, i) => ({ index: i, theme: `T${i}`, pillar: 'Almoço', persona: 'Ana', product_name: '', funnel_stage: 'atracao', objective_link: 'serve', hook: 'H', headline: 'M', caption: 'L', hashtags: ['a'], cta: 'Reserve pelo WhatsApp', image_prompt: 'x', slides: [] })) });
  };

  it('pending → gera a estratégia do objetivo digitado, grava em "review", solta o lease, NÃO gera posts e avisa strategyReview', async () => {
    const { w, s, a } = setup();
    const r = pendingRun(w);
    s.aiJson['ig_run_strategy'] = () => STRAT_JSON;
    expect(await a.fillAutoCalendar(OWNER, r.id)).toEqual({ filled: 0, total: 2, done: false, busy: false, strategyReview: true });
    expect(r).toMatchObject({ strategy_status: 'review', locked_until: null, last_error: null, paused_reason: null, status: 'planning', filled: 0 });
    expect(r.strategy).toMatchObject({ kpi_principal: 'Reservas', ctas: ['Reserve pelo WhatsApp'] });
    expect(r.strategy.pilares).toHaveLength(2);
    expect(w.t['ig_posts']!.rows).toHaveLength(0);
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'generation', message: 'Estratégia do período pronta: revise e aprove para gerar os posts.' });
    const call = s.ai.jsonWithEngine.mock.calls.find((c: any[]) => c[1].name === 'ig_run_strategy')!;
    expect(call[1].prompt).toContain(`1. OBJETIVO DIGITADO PELO CLIENTE (fonte principal, nunca ignore): ${OBJECTIVE}`);
    expect(call[1].prompt).toMatch(/2\. DNA DA MARCA: .*"nome":"Bar do Zé"/);
  });

  it('aguardando aprovação ("review"): fill não gasta IA, não gera posts e continua devolvendo strategyReview; o tick pula a programação', async () => {
    const { w, s, a, auto } = setup();
    const r = pendingRun(w, { strategy: STRAT_JSON, strategy_status: 'review' });
    expect(await a.fillAutoCalendar(OWNER, r.id)).toEqual({ filled: 0, total: 2, done: false, busy: false, strategyReview: true });
    expect(s.ai.jsonWithEngine).not.toHaveBeenCalled();
    expect(r.locked_until).toBeNull();
    expect((await auto.autoCalendarTick())['filled']).toBe(0);
    expect(s.ai.jsonWithEngine).not.toHaveBeenCalled();
    // lease vivo + review: quem não pegou o lease também vê strategyReview e busy:false
    r.locked_until = new Date(Date.now() + 100e3);
    expect(await auto.fillAutoRun(r.id)).toMatchObject({ busy: false, strategyReview: true });
  });

  it('aprovar libera os posts: o texto dos ajustes do cliente vai ao prompt; só programação em andamento; sem estratégia = erro', async () => {
    const { w, s, a, auto } = setup();
    const r = pendingRun(w);
    expect(await status(a.approveAutoStrategy(OWNER, { runId: r.id }))).toBe('400:A estratégia ainda não foi gerada.');
    s.aiJson['ig_run_strategy'] = () => STRAT_JSON;
    await a.fillAutoCalendar(OWNER, r.id);
    expect(await a.approveAutoStrategy(OWNER, { runId: r.id, editedText: '  foque no prato executivo; nada de promoção  ' })).toEqual({ ok: true });
    expect(r).toMatchObject({ strategy_status: 'approved', locked_until: null });
    expect(r.strategy.texto_editado).toBe('foque no prato executivo; nada de promoção');
    setPosts(s);
    expect(await a.fillAutoCalendar(OWNER, r.id)).toEqual({ filled: 2, total: 2, done: true, busy: false, strategyReview: false });
    expect(w.t['ig_posts']!.rows).toHaveLength(2);
    const prompt = s.ai.jsonWithEngine.mock.calls.find((c: any[]) => c[1].name === 'ig_auto_calendar')![1].prompt as string;
    expect(prompt).toContain('"ajustes_do_cliente":"foque no prato executivo; nada de promoção"');
    expect(prompt).toMatch(/2\. ESTRATÉGIA APROVADA: .*"mensagem_central":"Almoço rápido"/);
    // reaprovar sem texto mantém o ajuste anterior
    await auto.approveRunStrategy(WS_A, r.id, null);
    expect(r.strategy.texto_editado).toBe('foque no prato executivo; nada de promoção');
    // programação cancelada/concluída não volta a ser "approved"
    const done = pendingRun(w, { strategy: STRAT_JSON, strategy_status: 'review', status: 'cancelled' });
    await auto.approveRunStrategy(WS_A, done.id, 'x');
    expect(done.strategy_status).toBe('review');
  });

  it('aprovar velho depois de "Refazer": não desfaz o refazer (strategy_status segue pending) e avisa em pt-BR', async () => {
    const { w, a } = setup();
    // o usuário abriu a revisão (review), mas o refazer chegou antes; a estratégia ainda existe no banco só para a aprovação ler
    const r = pendingRun(w, { strategy: STRAT_JSON, strategy_status: 'pending' });
    expect(await status(a.approveAutoStrategy(OWNER, { runId: r.id, editedText: 'x' }))).toMatch(/^400:A estratégia foi refeita/);
    expect(r.strategy_status).toBe('pending');
  });

  it('refazer descarta a estratégia e volta a "pending"; o próximo fill gera outra; recusado com lote da IA rodando', async () => {
    const { w, s, a } = setup();
    const r = pendingRun(w, { strategy: STRAT_JSON, strategy_status: 'review', paused_reason: 'x' });
    expect(await a.redoAutoStrategy(OWNER, r.id)).toEqual({ ok: true });
    expect(r).toMatchObject({ strategy: null, strategy_status: 'pending', paused_reason: null });
    s.aiJson['ig_run_strategy'] = () => ({ ...STRAT_JSON, mensagem_central: 'Nova mensagem' });
    await a.fillAutoCalendar(OWNER, r.id);
    expect(r.strategy.mensagem_central).toBe('Nova mensagem');
    // lease vivo (alguém está gerando): não descarta
    const busy = pendingRun(w, { strategy: STRAT_JSON, strategy_status: 'approved', locked_until: new Date(Date.now() + 100e3) });
    expect(await status(a.redoAutoStrategy(OWNER, busy.id))).toMatch(/^400:A estratégia está sendo gerada ou os posts estão em criação agora/);
    expect(busy).toMatchObject({ strategy_status: 'approved' });
    // programação concluída: no-op (não é "planning")
    const finished = pendingRun(w, { strategy: STRAT_JSON, strategy_status: 'approved', status: 'active' });
    expect(await status(a.redoAutoStrategy(OWNER, finished.id))).toMatch(/^400:Esta programação não está mais em andamento/);
    expect(finished.strategy_status).toBe('approved');
  });

  it('autorização: viewer 403, estranho/inexistente 404, marketing ok (aprovar e refazer)', async () => {
    const { w, s, a } = setup();
    const r = pendingRun(w, { strategy: STRAT_JSON, strategy_status: 'review' });
    s.aiJson['ig_run_strategy'] = () => STRAT_JSON;
    for (const fn of [(u: string) => a.approveAutoStrategy(u, { runId: r.id }), (u: string) => a.redoAutoStrategy(u, r.id)]) {
      expect(await status(fn(VIEWER))).toBe('403:Seu perfil não tem permissão para esta ação.');
      expect(await status(fn(STRANGER))).toBe('404:Programação não encontrada.');
    }
    expect(await status(a.approveAutoStrategy(OWNER, { runId: uuid() }))).toBe('404:Programação não encontrada.');
    expect(r.strategy_status).toBe('review');
    expect(await status(a.approveAutoStrategy(MARKETING, { runId: r.id }))).toBe('ok');
    expect(await status(a.redoAutoStrategy(MARKETING, r.id))).toBe('ok');
  });

  it('chamadas simultâneas na estratégia: só uma gasta IA; a outra recebe busy:true', async () => {
    const { w, s, auto } = setup();
    const r = pendingRun(w);
    s.aiJson['ig_run_strategy'] = () => STRAT_JSON;
    const [x, y] = await Promise.all([auto.fillAutoRun(r.id), auto.fillAutoRun(r.id)]);
    expect([x, y].filter((o) => o.busy)).toHaveLength(1);
    expect(s.ai.jsonWithEngine.mock.calls.filter((c: any[]) => c[1].name === 'ig_run_strategy')).toHaveLength(1);
    expect(r.strategy_status).toBe('review');
  });

  it('estratégia incompleta (sem pilares): erro, last_error guardado, lease solto, nada vai para "review"', async () => {
    const { w, s, auto } = setup();
    const r = pendingRun(w);
    s.aiJson['ig_run_strategy'] = () => ({ ...STRAT_JSON, pilares: [] });
    await expect(auto.fillAutoRun(r.id)).rejects.toThrow('A IA não devolveu a estratégia completa');
    expect(r).toMatchObject({ strategy: null, strategy_status: 'pending', locked_until: null, paused_reason: null });
    expect(r.last_error).toMatch(/estratégia completa/);
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'failure', level: 'error' });
  });

  it('sem marca/objetivo/plano o fill falha com a mensagem certa e solta o lease', async () => {
    const { w, auto } = setup();
    const noBrand = run(w, plan(w, { brand_id: null }), { slots: [slotAt(600, 0)] });
    await expect(auto.fillAutoRun(noBrand.id)).rejects.toThrow('Cadastre a marca em Brands antes.');
    expect(noBrand).toMatchObject({ locked_until: null, last_error: 'Cadastre a marca em Brands antes.' });
    const noGoal = run(w, plan(w, { objective: null }), { slots: [slotAt(600, 0)], focus: null });
    await expect(auto.fillAutoRun(noGoal.id)).rejects.toThrow('Informe o objetivo deste período na programação.');
    const orphan = run(w, { id: uuid() }, { slots: [slotAt(600, 0)] });
    await expect(auto.fillAutoRun(orphan.id)).rejects.toThrow('Plano de conteúdo não encontrado.');
  });

  it('crédito de IA esgotado: paused_reason + evento específico; sucesso depois limpa o aviso', async () => {
    const { w, s, auto } = setup();
    const r = pendingRun(w);
    s.aiJson['ig_run_strategy'] = () => { throw new Error('Créditos de IA esgotados. Adicione créditos para continuar.'); };
    await expect(auto.fillAutoRun(r.id)).rejects.toThrow('Créditos de IA esgotados');
    expect(r).toMatchObject({ paused_reason: 'Créditos de IA esgotados — programação pausada', locked_until: null });
    expect(r.last_error).toMatch(/Créditos de IA esgotados/);
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'failure', message: 'Créditos de IA esgotados — programação pausada. Retoma sozinha quando houver crédito.' });
    // um erro comum NÃO marca pausa
    s.aiJson['ig_run_strategy'] = () => { throw new Error('IA fora do ar'); };
    await expect(auto.fillAutoRun(r.id)).rejects.toThrow('IA fora do ar');
    expect(r.paused_reason).toBeNull();
    // crédito de novo → pausada; ao voltar, a estratégia sai e o aviso some
    s.aiJson['ig_run_strategy'] = () => { throw new Error('402 insufficient'); };
    await expect(auto.fillAutoRun(r.id)).rejects.toThrow();
    expect(r.paused_reason).toMatch(/Créditos de IA esgotados/);
    s.aiJson['ig_run_strategy'] = () => STRAT_JSON;
    await auto.fillAutoRun(r.id);
    expect(r).toMatchObject({ paused_reason: null, last_error: null, strategy_status: 'review' });
  });

  it('o aviso de pausa também some quando um lote de posts conclui', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0)], paused_reason: 'Créditos de IA esgotados — programação pausada', last_error: 'x' });
    setPosts(s, 1);
    await auto.fillAutoRun(r.id);
    expect(r).toMatchObject({ paused_reason: null, last_error: null, status: 'active' });
  });

  it('lease perdido no meio do lote (outro worker assumiu): descarta o resultado, NÃO grava posts nem mexe na programação dele', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0), slotAt(660, 1)] });
    s.aiJson['ig_auto_calendar'] = () => {
      r.locked_until = new Date(Date.now() + 200e3); // outro worker pegou o lease depois que o nosso venceu
      return { posts: [{ index: 0, theme: 'T', caption: 'L' }, { index: 1, theme: 'T', caption: 'L' }] };
    };
    const out = await auto.fillAutoRun(r.id);
    expect(out).toMatchObject({ busy: true, filled: 0, done: false });
    expect(w.t['ig_posts']!.rows).toHaveLength(0);
    expect(r.locked_until!.getTime()).toBeGreaterThan(Date.now() + 100e3); // o lease do outro continua intacto
    expect(r.last_error).toBeNull();
  });

  it('lease perdido entre a conferência final e o avanço: posts e avanço são atômicos (nenhum post inserido)', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0)] });
    s.aiJson['ig_auto_calendar'] = () => ({ posts: [{ index: 0, theme: 'T', caption: 'L' }] });
    const tbl = w.t['ig_auto_runs']! as any;
    const orig = tbl.updateMany.bind(tbl);
    tbl.updateMany = async (args: any) => {
      if (args.where.filled !== undefined) r.locked_until = new Date(Date.now() + 200e3); // outro worker assume bem antes do avanço
      return orig(args);
    };
    const out = await auto.fillAutoRun(r.id);
    expect(out).toMatchObject({ busy: true, filled: 0 });
    expect(w.t['ig_posts']!.rows).toHaveLength(0);
  });

  it('programação cancelada no meio do lote: o fill não a ressuscita nem grava posts', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0)] });
    s.aiJson['ig_auto_calendar'] = () => { r.status = 'cancelled'; r.locked_until = null; return { posts: [{ index: 0, theme: 'T', caption: 'L' }] }; };
    const out = await auto.fillAutoRun(r.id);
    expect(out).toMatchObject({ busy: true, done: true });
    expect(r.status).toBe('cancelled');
    expect(w.t['ig_posts']!.rows).toHaveLength(0);
  });
});

describe('validador de posts no lote (reprovação → regera → needs_review)', () => {
  const full = (i: number, over: Record<string, unknown> = {}) => ({ index: i, theme: `T${i}`, pillar: 'A', persona: 'Ana', product_name: '', funnel_stage: 'atracao', objective_link: 'serve', hook: 'H', headline: 'M', caption: 'Legenda', hashtags: ['a'], cta: 'CTA', image_prompt: 'x', slides: [], ...over });

  it('reprovado pela IA é refeito com o motivo no prompt (até 2 novas tentativas); aprovado na 2ª entra como "idea" com attempts=2 e nota', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0), slotAt(660, 1)] });
    const askPrompts: string[] = [];
    s.aiJson['ig_auto_calendar'] = (req: any) => { askPrompts.push(req.prompt); return { posts: [full(0), full(1)] }; };
    let reviews = 0;
    s.aiJson['ig_post_review'] = () => {
      reviews++;
      return { results: reviews === 1 ? [{ index: 0, aprovado: true, nota_0_10: 9, motivo: 'ok' }, { index: 1, aprovado: false, nota_0_10: 3, motivo: 'fala de outro negócio' }] : [{ index: 1, aprovado: true, nota_0_10: 7, motivo: 'agora sim' }] };
    };
    await auto.fillAutoRun(r.id);
    expect(askPrompts).toHaveLength(2);
    expect(askPrompts[0]).not.toContain('REFAÇA');
    expect(askPrompts[1]).toContain('REFAÇA, reprovado antes por: fala de outro negócio');
    expect(askPrompts[1]).not.toMatch(/index 0:/); // só o reprovado volta
    const rows = w.t['ig_posts']!.rows;
    expect(rows.map((x) => x.status)).toEqual(['idea', 'idea']);
    expect(rows[0]).toMatchObject({ review_score: 9, review_reason: null });
    expect(rows[1]).toMatchObject({ review_score: 7, review_reason: null });
    expect(rows[0].ai_generation_log[0]).toMatchObject({ attempts: 1, review: { aprovado: true, nota: 9 } });
    expect(rows[1].ai_generation_log[0]).toMatchObject({ attempts: 2, review: { aprovado: true, nota: 7, motivo: 'agora sim' } });
    expect(rows[1].ai_generation_log[0].status).toBeUndefined();
  });

  it('reprovado nas 3 tentativas vira "needs_review" com motivo, nota e log; os aprovados seguem normais', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0), slotAt(660, 1)] });
    s.aiJson['ig_auto_calendar'] = () => ({ posts: [full(0), full(1)] });
    s.aiJson['ig_post_review'] = (req: any) => ({ results: [{ index: 0, aprovado: true, nota_0_10: 8, motivo: 'ok' }, ...(/index 1 ·/.test(req.prompt) ? [{ index: 1, aprovado: false, nota_0_10: 2, motivo: 'preço inventado' }] : [])] });
    await auto.fillAutoRun(r.id);
    expect(s.ai.jsonWithEngine.mock.calls.filter((c: any[]) => c[1].name === 'ig_auto_calendar')).toHaveLength(3); // 1 + 2 novas tentativas
    const rows = w.t['ig_posts']!.rows;
    expect(rows[0].status).toBe('idea');
    expect(rows[1]).toMatchObject({ status: 'needs_review', review_reason: 'preço inventado', review_score: 2 });
    expect(rows[1].ai_generation_log[0]).toMatchObject({ attempts: 3, status: 'needs_review', review: { aprovado: false, nota: 2, motivo: 'preço inventado' } });
    expect(r).toMatchObject({ filled: 2, status: 'active' });
  });

  it('regras de data (código): "sextou" numa segunda reprova SEM a IA revisora ver o post; refeito e ainda errado vira needs_review com o motivo da data', async () => {
    const { w, s, auto } = setup();
    // slot numa segunda-feira de 2099 (01/01/2099 é quinta; 05/01/2099 é segunda) às 10:00 SP
    const monday = { index: 0, at: new Date('2099-01-05T10:00:00-03:00').toISOString(), format: 'feed_image', kind: 'main' };
    const r = run(w, plan(w), { slots: [monday] });
    s.aiJson['ig_auto_calendar'] = () => ({ posts: [full(0, { caption: 'Sextou! Chopp em dobro' })] });
    const seen: string[] = [];
    s.aiJson['ig_post_review'] = (req: any) => { seen.push(req.prompt); return { results: [] }; };
    await auto.fillAutoRun(r.id);
    expect(seen).toHaveLength(0); // as 3 tentativas reprovaram por código; a IA nunca foi consultada
    expect(w.t['ig_posts']!.rows[0]).toMatchObject({ status: 'needs_review', review_score: 0, review_reason: 'Incoerência de data: "sextou" fora de sexta-feira.' });
    // o prompt de refação leva o motivo e o dia real
    const prompts = s.ai.jsonWithEngine.mock.calls.filter((c: any[]) => c[1].name === 'ig_auto_calendar').map((c: any[]) => c[1].prompt as string);
    expect(prompts[1]).toContain('segunda-feira, 05/01/2099, 10:00');
    expect(prompts[1]).toContain('REFAÇA, reprovado antes por: Incoerência de data: "sextou" fora de sexta-feira.');
  });

  it('IA que devolve conteúdo vazio vira needs_review com o motivo padrão; revisor fora do ar não bloqueia', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0), slotAt(660, 1)] });
    s.aiJson['ig_auto_calendar'] = () => ({ posts: [full(0), { index: 1 }] });
    s.aiJson['ig_post_review'] = () => { throw new Error('revisor caiu'); };
    await auto.fillAutoRun(r.id);
    const rows = w.t['ig_posts']!.rows;
    expect(rows[0]).toMatchObject({ status: 'idea', review_score: null });
    expect(rows[1]).toMatchObject({ status: 'needs_review', review_reason: 'A IA não devolveu conteúdo para este horário.' });
  });

  it('grava objetivo/pilar/persona/produto/etapa do funil; produto casa pelo nome (sem caixa) só dentro da MARCA do plano; etapa é normalizada', async () => {
    const { w, s, auto } = setup();
    const p = plan(w);
    const prato = { id: uuid(), workspace_id: WS_A, brand_id: p.brand_id, name: 'Prato Executivo', description: 'almoço', price: 29.9 };
    w.t['products']!.rows.push(prato, { id: uuid(), workspace_id: WS_A, brand_id: uuid(), name: 'Outra marca', description: null, price: 5 }, { id: uuid(), workspace_id: WS_B, brand_id: p.brand_id, name: 'Alheio', description: null, price: 1 });
    w.t['personas']!.rows.push({ id: uuid(), workspace_id: WS_A, brand_id: p.brand_id, name: 'Ana', pains: 'sem tempo' });
    const r = run(w, p, { slots: [slotAt(600, 0), slotAt(660, 1), slotAt(720, 2), slotAt(780, 3)] });
    s.aiJson['ig_auto_calendar'] = () => ({ posts: [
      full(0, { product_name: 'prato executivo', funnel_stage: 'Conversão' }),
      full(1, { product_name: 'Combo com Prato Executivo e suco', funnel_stage: 'consideração' }),
      full(2, { product_name: 'Produto que não existe', funnel_stage: 'conexao' }),
      full(3, { product_name: '', funnel_stage: 'qualquer coisa' }),
    ] });
    await auto.fillAutoRun(r.id);
    const rows = w.t['ig_posts']!.rows;
    expect(rows.map((x) => x.product_id)).toEqual([prato.id, prato.id, null, null]);
    expect(rows.map((x) => x.funnel_stage)).toEqual(['conversao', 'consideracao', 'consideracao', 'atracao']);
    expect(rows[0]).toMatchObject({ objective_link: 'serve', pillar: 'A', persona: 'Ana' });
    expect(rows[0].creative_brief).toMatchObject({ funnel_stage: 'conversao', product_name: 'prato executivo' });
    const prompt = s.ai.jsonWithEngine.mock.calls.find((c: any[]) => c[1].name === 'ig_auto_calendar')![1].prompt as string;
    expect(prompt).toContain('"nome":"Prato Executivo","descricao":"almoço","preco":29.9');
    expect(prompt).toContain('PERSONAS: ["Ana"]');
    expect(prompt).not.toContain('Outra marca');
    expect(prompt).not.toContain('Alheio');
  });
});

describe('needs_review no restante do fluxo', () => {
  const needsReview = (w: IgWorld, over: Record<string, unknown> = {}) => seedPost(w, { status: 'needs_review', approved_at: null, review_reason: 'preço inventado', review_score: 2, ...over });

  it('summary: conta "review" à parte (não entra em media/waiting)', async () => {
    const { w, auto } = setup();
    const p = plan(w);
    const root = run(w, p, { status: 'active' });
    for (const st of ['needs_review', 'needs_review', 'pending_approval', 'idea']) seedPost(w, { run_id: root.id, status: st });
    const out = await auto.summary(WS_A);
    expect(out[0]).toMatchObject({ id: root.id, strategy_status: 'approved', counts: { total: 4, media: 1, waiting: 1, review: 2, failed: 0 } });
    expect(out[0].strategy).toEqual(STRATEGY); // a tela mostra o resumo da estratégia
  });

  it('contagem do selo (pending-count) soma pending_approval + needs_review, só da empresa; agência também', async () => {
    const { w, s } = setup();
    seedPost(w, { status: 'pending_approval' });
    needsReview(w);
    needsReview(w, { workspace_id: WS_B });
    seedPost(w, { status: 'idea' });
    expect(await s.resources.pendingCount(WS_A)).toEqual({ count: 2 });
    expect(await s.resources.pendingCount(WS_B)).toEqual({ count: 1 });
  });

  it('tick 3: needs_review (modo aprovação) que passa do horário é reagendado como os demais; modo publish não', async () => {
    const { w, auto } = setup();
    const p = plan(w);
    const t0 = Date.now() + 5 * 60e3;
    const late = needsReview(w, { automation: 'approval', plan_id: p.id, scheduled_at: new Date(t0) });
    const pub = needsReview(w, { automation: 'publish', plan_id: p.id, scheduled_at: new Date(t0) });
    const out = await auto.autoCalendarTick();
    expect(out['rescheduled']).toBe(1);
    expect(late.scheduled_at.getTime()).toBe(t0 + 86400e3);
    expect(pub.scheduled_at.getTime()).toBe(t0);
  });

  it('a programação só conclui ("done") quando não resta post em revisão', async () => {
    const { w, auto } = setup();
    const p = plan(w);
    const r = run(w, p, { status: 'active' });
    seedPost(w, { run_id: r.id, status: 'published', plan_id: p.id });
    const rev = needsReview(w, { run_id: r.id, plan_id: p.id });
    await auto.autoCalendarTick();
    expect(r.status).toBe('active');
    rev.status = 'cancelled';
    await auto.autoCalendarTick();
    expect(r.status).toBe('done');
  });

  it('cancelar a programação cancela os posts em revisão', async () => {
    const { w, a } = setup();
    const p = plan(w);
    const r = run(w, p, { status: 'active' });
    const rev = needsReview(w, { run_id: r.id, plan_id: p.id });
    expect(await a.cancelAutoCalendar(OWNER, r.id)).toEqual({ cancelled: 1 });
    expect(rev.status).toBe('cancelled');
  });

  it('aprovar post em revisão com mídia: segue o fluxo normal (approved); sem mídia: "Gere a mídia antes de aprovar."; reprovar cancela', async () => {
    const { w, a } = setup();
    const withMedia = needsReview(w);
    expect(await a.approvePost(OWNER, WS_A, withMedia.id)).toEqual({ ok: true });
    expect(withMedia.status).toBe('approved');
    const none = needsReview(w, { media: [] });
    expect(await status(a.approvePost(OWNER, WS_A, none.id))).toBe('400:Gere a mídia antes de aprovar.');
    expect(await a.rejectPost(OWNER, WS_A, none.id, 'não serve')).toEqual({ ok: true });
    expect(none).toMatchObject({ status: 'cancelled', rejection_reason: 'não serve' });
  });

  it('post em revisão nunca é publicado nem agendado direto', async () => {
    const { w, s, a } = setup();
    const post = needsReview(w);
    expect(await status(a.schedulePost(OWNER, WS_A, post.id, new Date(Date.now() + 3600e3).toISOString()))).toBe('400:O post precisa estar aprovado para ser agendado.');
    const r = await a.publishInstagramPost(OWNER, WS_A, post.id);
    expect(r).toMatchObject({ ok: false, error: 'Post não aprovado — publicação bloqueada.' });
    void s;
  });
});

describe('checagem final no agendamento (posts da programação com IA)', () => {
  const aligned = { objective_link: 'serve ao objetivo', pillar: 'A', persona: 'Ana' };
  const when = () => new Date(Date.now() + 5 * 3600e3).toISOString();
  const setupRun = (strategy: Record<string, unknown> | null = STRATEGY) => {
    const ctx = setup();
    connected(ctx.w);
    const p = plan(ctx.w);
    const r = run(ctx.w, p, { status: 'active', strategy, strategy_status: strategy ? 'approved' : 'pending' });
    const post = (over: Record<string, unknown> = {}) => seedPost(ctx.w, { plan_id: p.id, run_id: r.id, status: 'approved', ...aligned, cta: 'CTA', caption: 'Legenda boa', ...over });
    return { ...ctx, p, r, post };
  };

  it('post alinhado agenda normalmente (status scheduled, job criado)', async () => {
    const { w, a, post } = setupRun();
    const x = post();
    expect(await a.schedulePost(OWNER, WS_A, x.id, when())).toMatchObject({ ok: true });
    expect(x.status).toBe('scheduled');
    expect(w.t['publishing_jobs']!.rows.filter((j) => j.ig_post_id === x.id && j.status === 'pending')).toHaveLength(1);
  });

  it.each([
    ['sem ligação com objetivo/pilar/persona', { persona: null }, /faltam ligação com o objetivo, pilar ou persona/],
    ['"sextou" fora de sexta (horário real do agendamento)', { caption: 'Sextou com chopp!' }, /"sextou" fora de sexta-feira|ok-friday/],
    ['CTA fora da lista da estratégia', { cta: 'Clique no link da bio' }, /CTA fora dos CTAs da estratégia/],
  ])('%s → needs_review com o motivo, NÃO agenda, e o erro volta ao chamador', async (_n, over, msg) => {
    const { w, a, post } = setupRun();
    const x = post(over);
    // 'sextou' só reprova fora de sexta: escolhe um horário de segunda
    const at = (over as any).caption ? new Date('2099-01-05T10:00:00-03:00').toISOString() : when();
    const res = await status(a.schedulePost(OWNER, WS_A, x.id, at));
    if (!msg.test(res) && (over as any).caption) throw new Error(res);
    expect(res).toMatch(/^400:Post enviado para revisão: /);
    expect(x.status).toBe('needs_review');
    expect(x.review_reason).toMatch(/^Checagem final: /);
    expect(x.review_reason).toMatch(msg);
    expect(w.t['publishing_jobs']!.rows.filter((j) => j.ig_post_id === x.id)).toHaveLength(0);
  });

  it('preço fora do cadastro de produtos da marca reprova; preço cadastrado (R$ 29,90) passa; sem preço na legenda passa', async () => {
    const { w, a, p, post } = setupRun();
    w.t['products']!.rows.push({ id: uuid(), workspace_id: WS_A, brand_id: p.brand_id, name: 'Prato', price: 29.9 }, { id: uuid(), workspace_id: WS_B, brand_id: p.brand_id, name: 'x', price: 99 });
    const ok = post({ caption: 'Prato executivo por R$ 29,90 hoje' });
    expect(await a.schedulePost(OWNER, WS_A, ok.id, when())).toMatchObject({ ok: true });
    const bad = post({ caption: 'Prato por R$ 19,90', creative_brief: {} });
    expect(await status(a.schedulePost(OWNER, WS_A, bad.id, when()))).toMatch(/^400:Post enviado para revisão: preço fora do cadastro de produtos\.$/);
    expect(bad.review_reason).toBe('Checagem final: preço fora do cadastro de produtos.');
    // preço só na headline também conta
    const head = post({ caption: 'Sem preço aqui', creative_brief: { headline: 'Só R$ 99' } });
    expect(await status(a.schedulePost(OWNER, WS_A, head.id, when()))).toMatch(/preço fora do cadastro/);
    // o preço do produto de OUTRA empresa (R$ 99, WS_B) não vale
  });

  it('programação ANTIGA (sem estratégia): campos novos ausentes não reprovam; as regras de data continuam valendo', async () => {
    const { a, post } = setupRun(null);
    const legacy = post({ objective_link: null, pillar: null, persona: null });
    expect(await a.schedulePost(OWNER, WS_A, legacy.id, when())).toMatchObject({ ok: true });
    const bad = post({ objective_link: null, pillar: null, persona: null, hook: 'Bom dia!' });
    const noon = new Date('2099-01-05T15:00:00-03:00').toISOString();
    expect(await status(a.schedulePost(OWNER, WS_A, bad.id, noon))).toMatch(/"bom dia" depois das 12h/);
  });

  it('post SEM run (calendário do plano / manual) não passa pela checagem final', async () => {
    const { w, a } = setup();
    connected(w);
    const p = plan(w);
    const x = seedPost(w, { plan_id: p.id, run_id: null, status: 'approved', caption: 'Sextou!', persona: null });
    expect(await a.schedulePost(OWNER, WS_A, x.id, new Date('2099-01-05T10:00:00-03:00').toISOString())).toMatchObject({ ok: true });
  });

  it('reprovar um post que já estava agendado cancela o job pendente anterior (a fila não o tenta)', async () => {
    const { w, a, post } = setupRun();
    const x = post();
    await a.schedulePost(OWNER, WS_A, x.id, when());
    expect(w.t['publishing_jobs']!.rows.filter((j) => j.ig_post_id === x.id && j.status === 'pending')).toHaveLength(1);
    x.persona = null;
    await expect(a.schedulePost(OWNER, WS_A, x.id, when())).rejects.toThrow(/Post enviado para revisão/);
    expect(x.status).toBe('needs_review');
    expect(w.t['publishing_jobs']!.rows.filter((j) => j.ig_post_id === x.id && j.status === 'pending')).toHaveLength(0);
  });

  it('o status só vira needs_review se o post ainda estava em estado agendável (publishing no meio do caminho não é sobrescrito)', async () => {
    const { w, s, post } = setupRun();
    const x = post({ persona: null });
    const orig = w.store.getPost.bind(w.store);
    // o post "vira publishing" logo depois que o agendamento leu o status
    jest.spyOn(w.store, 'getPost').mockImplementationOnce(async (...args: any[]) => { const r = await (orig as any)(...args); x.status = 'publishing'; return r; });
    await expect(s.publishing.schedulePost(WS_A, x.id, when())).rejects.toThrow(/Post enviado para revisão/);
    expect(x.status).toBe('publishing');
    expect(x.review_reason ?? null).toBeNull();
  });

  it('tick: post automático que reprova na checagem final sai da fila de agendamento (status needs_review) e guarda o erro', async () => {
    const { w, auto, post } = setupRun();
    const x = post({ automation: 'publish', status: 'ready', persona: null, scheduled_at: new Date(Date.now() + 3600e3) });
    const out = await auto.autoCalendarTick();
    expect(out['scheduled']).toBe(0);
    expect(x.status).toBe('needs_review');
    expect(x.last_error).toMatch(/Post enviado para revisão/);
    expect(w.t['publishing_jobs']!.rows).toHaveLength(0);
  });
});

describe('Calendário de conteúdo do plano (generateContentCalendar) — marca, objetivo e datas', () => {
  const calPost = (over: Record<string, unknown>) => ({ format: 'feed_image', scheduled_at: '2099-01-05T10:00:00-03:00', theme: 'T', hook: 'H', caption: 'C', hashtags: ['a'], cta: 'CTA', image_prompt: 'x', slides: [], ...over });

  it('sem marca no plano: "Cadastre a marca em Brands antes (e vincule-a ao plano de conteúdo)."', async () => {
    const { w, a } = setup();
    const p = plan(w, { brand_id: null });
    expect(await status(a.generateContentCalendar(OWNER, WS_A, p.id, 1))).toBe('400:Cadastre a marca em Brands antes (e vincule-a ao plano de conteúdo).');
  });

  it('o prompt leva objetivo + DNA da marca + regras de data; post com incoerência de data entra como needs_review com o motivo', async () => {
    const { w, s, a } = setup();
    const p = plan(w, { objective: 'Lotar o happy hour' });
    s.aiJson['ig_calendar'] = () => ({ posts: [
      calPost({ caption: 'Sextou!' }), // 05/01/2099 é segunda
      calPost({ caption: 'Bom dia, Valinhos!' }), // segunda às 10h: ok
      calPost({ scheduled_at: '2099-01-05T15:00:00-03:00', hook: 'Bom dia!' }),
      calPost({ scheduled_at: 'lixo', caption: 'Sextou' }), // sem data válida: não há como checar
    ] });
    await a.generateContentCalendar(OWNER, WS_A, p.id, 1);
    const rows = w.t['ig_posts']!.rows;
    expect(rows.map((x) => x.status)).toEqual(['needs_review', 'idea', 'needs_review', 'idea']);
    expect(rows[0].review_reason).toBe('Incoerência de data: "sextou" fora de sexta-feira.');
    expect(rows[2].review_reason).toBe('Incoerência de data: "bom dia" depois das 12h.');
    expect(rows[1].review_reason).toBeNull();
    const prompt = s.ai.jsonWithEngine.mock.calls[0][1].prompt as string;
    expect(prompt).toContain('OBJETIVO (fonte principal): Lotar o happy hour. MARCA: {"nome":"Bar do Zé"');
    expect(prompt).toContain('Nunca fale de outro negócio nem invente preço ou promoção.');
    expect(prompt).toContain('Coerência com a data:');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Produção automática (05/10/2026) — A1: estratégia no modo totalmente automático e semanas repetidas.
// ---------------------------------------------------------------------------------------------------------------------

describe('A1 — estratégia no modo "publish" e semanas repetidas', () => {
  const STRAT = { ...STRATEGY, distribuicao_por_dia: [] };
  const onePost = () => ({ posts: [{ index: 0, theme: 'T0', pillar: 'A', persona: 'Ana', product_name: '', funnel_stage: 'atracao', objective_link: 'serve', hook: 'H', headline: 'M', caption: 'Legenda', hashtags: ['a'], cta: 'CTA', image_prompt: 'x', slides: [] }] });

  it('modo "publish": estratégia aprovada sozinha (sem passar por review), evento strategy_auto_approved; o próximo fill já gera os posts', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { mode: 'publish', slots: [slotAt(600, 0)], strategy: null, strategy_status: 'pending' });
    s.aiJson['ig_run_strategy'] = () => STRAT;
    expect(await auto.fillAutoRun(r.id)).toEqual({ filled: 0, total: 1, done: false, busy: false, strategyReview: false });
    expect(r).toMatchObject({ strategy_status: 'approved', locked_until: null, status: 'planning' });
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'strategy_auto_approved', level: 'info', message: 'Estratégia do período aprovada automaticamente (modo totalmente automático).' });
    expect(w.t['ig_posts']!.rows).toHaveLength(0);
    s.aiJson['ig_auto_calendar'] = onePost;
    expect(await auto.fillAutoRun(r.id)).toMatchObject({ filled: 1, done: true, strategyReview: false });
    expect(w.t['ig_posts']!.rows).toHaveLength(1);
  });

  it('zero cliques pelo tick: o 1º tick aprova a estratégia, o 2º gera os posts', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { mode: 'publish', slots: [slotAt(600, 0)], strategy: null, strategy_status: 'pending' });
    s.aiJson['ig_run_strategy'] = () => STRAT;
    s.aiJson['ig_auto_calendar'] = onePost;
    await auto.autoCalendarTick();
    expect(r.strategy_status).toBe('approved');
    expect(w.t['ig_posts']!.rows).toHaveLength(0);
    await auto.autoCalendarTick();
    expect(r.status).toBe('active');
    expect(w.t['ig_posts']!.rows).toHaveLength(1);
  });

  it('modo "approval" continua esperando a revisão (sem aprovação automática)', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { mode: 'approval', slots: [slotAt(600, 0)], strategy: null, strategy_status: 'pending' });
    s.aiJson['ig_run_strategy'] = () => STRAT;
    expect(await auto.fillAutoRun(r.id)).toMatchObject({ strategyReview: true });
    expect(r.strategy_status).toBe('review');
    expect(w.t['ig_autopilot_events']!.rows.some((e) => e.kind === 'strategy_auto_approved')).toBe(false);
  });

  it('semana repetida nasce SEM estratégia (pending) e herda modo, objetivo e o áudio dos vídeos da raiz', async () => {
    const { w, auto } = setup();
    const t = todaySP();
    const root = run(w, plan(w), {
      recurring: true, status: 'active', mode: 'publish', start_date: DATE(plusDays(t, -3)), end_date: DATE(plusDays(t, 3)), times: ['09:00'],
      strategy: { ...STRATEGY, texto_editado: 'nada de promoção' }, video_audio: { modo: 'narracao', instrucoes: 'voz calma' },
    });
    expect(await auto.renewRecurring()).toEqual({ created: 1 });
    const kid = w.t['ig_auto_runs']!.rows.at(-1);
    expect(kid).toMatchObject({ parent_id: root.id, strategy_status: 'pending', mode: 'publish', focus: OBJECTIVE, video_audio: { modo: 'narracao', instrucoes: 'voz calma' } });
    expect(kid!.strategy ?? null).toBeNull();
  });

  it('a filha gera a estratégia das SUAS datas, com os ajustes da raiz como orientação (e como texto_editado); publish aprova, approval vai para review', async () => {
    const { w, s, auto } = setup();
    const p = plan(w);
    const root = run(w, p, { recurring: true, status: 'active', mode: 'publish', strategy: { ...STRATEGY, texto_editado: 'foque no prato executivo; nada de promoção' } });
    const kidSlots = [{ index: 0, at: '2099-02-02T12:00:00.000Z', format: 'feed_image', kind: 'main' }]; // segunda-feira
    const kid = run(w, p, { parent_id: root.id, mode: 'publish', slots: kidSlots, strategy: null, strategy_status: 'pending' });
    const prompts: string[] = [];
    s.aiJson['ig_run_strategy'] = (req: any) => {
      prompts.push(req.prompt);
      return STRAT;
    };
    await auto.fillAutoRun(kid.id);
    expect(prompts[0]).toContain('- segunda-feira, 02/02/2099');
    expect(prompts[0]).toContain('ORIENTAÇÃO DO CLIENTE (ajustes feitos nas semanas anteriores desta programação — siga, salvo se contrariar a marca): «foque no prato executivo; nada de promoção»');
    expect(kid.strategy_status).toBe('approved');
    expect(kid.strategy.texto_editado).toBe('foque no prato executivo; nada de promoção');
    const kid2 = run(w, p, { parent_id: root.id, mode: 'approval', slots: kidSlots, strategy: null, strategy_status: 'pending' });
    await auto.fillAutoRun(kid2.id);
    expect(kid2.strategy_status).toBe('review');
  });

  it('a orientação é delimitada e limitada: « » do cliente saem e o texto vai até 2000 caracteres', async () => {
    const { w, s, auto } = setup();
    const p = plan(w);
    const root = run(w, p, { recurring: true, status: 'active', strategy: { ...STRATEGY, texto_editado: `a«b»c ${'x'.repeat(3000)}` } });
    const kid = run(w, p, { parent_id: root.id, mode: 'publish', slots: [slotAt(600, 0)], strategy: null, strategy_status: 'pending' });
    let prompt = '';
    s.aiJson['ig_run_strategy'] = (req: any) => {
      prompt = req.prompt;
      return STRAT;
    };
    await auto.fillAutoRun(kid.id);
    const guidance = /«([^«»]*)»/.exec(prompt)![1]!;
    expect(guidance.startsWith('abc ')).toBe(true);
    expect(guidance.length).toBeLessThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Produção automática (05/10/2026) — A2: reescrita do post reprovado no modo totalmente automático.
// ---------------------------------------------------------------------------------------------------------------------

describe('A2 — reescrita do post reprovado (modo "publish")', () => {
  const flagged = (w: IgWorld, r: any, over: Record<string, unknown> = {}) =>
    seedPost(w, {
      run_id: r.id, plan_id: r.plan_id, automation: 'publish', status: 'needs_review', media: [], approved_at: null,
      review_reason: 'fala de outro negócio', review_score: 3, review_attempts: 0, scheduled_at: new Date(Date.now() + 30 * 3600e3),
      theme: 'Velho', hook: 'Gancho velho', caption: 'Legenda velha', cta: 'CTA', objective_link: 'serve', pillar: 'A', persona: 'Ana',
      creative_brief: { prompt: 'cena velha', headline: 'Manchete velha', variations: 3 }, ...over,
    });
  const item = (over: Record<string, unknown> = {}) => ({
    posts: [{ index: 0, theme: 'Novo', pillar: 'A', persona: 'Ana', product_name: '', funnel_stage: 'atracao', objective_link: 'serve ao objetivo', hook: 'Gancho novo', headline: 'Manchete nova', caption: 'Legenda nova', hashtags: ['a'], cta: 'CTA', image_prompt: 'cena nova', slides: [], ...over }],
  });
  const approve = (s: ReturnType<typeof setup>['s'], nota = 8) => (s.aiJson['ig_post_review'] = () => ({ results: [{ index: 0, aprovado: true, nota_0_10: nota, motivo: 'ok' }] }));
  const reject = (s: ReturnType<typeof setup>['s'], motivo = 'ainda fora do segmento') => (s.aiJson['ig_post_review'] = () => ({ results: [{ index: 0, aprovado: false, nota_0_10: 2, motivo }] }));

  it('aprovado na 1ª reescrita: volta para "idea" com o texto novo, sem motivo, conta a tentativa e registra post_rewritten', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const post = flagged(w, r);
    s.aiJson['ig_auto_calendar'] = () => item();
    approve(s, 9);
    expect(await auto.rewritePost(post.id)).toBe('rewritten');
    expect(post).toMatchObject({ status: 'idea', theme: 'Novo', hook: 'Gancho novo', caption: 'Legenda nova', objective_link: 'serve ao objetivo', review_reason: null, review_score: 9, review_attempts: 1, last_error: null, lease_until: null });
    expect(post.creative_brief).toMatchObject({ prompt: 'cena nova', headline: 'Manchete nova', variations: 3 });
    expect(post.ai_generation_log.at(-1)).toMatchObject({ step: 'rewrite', attempt: 1, reason: 'fala de outro negócio', status: 'idea' });
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'post_rewritten', level: 'info', post_id: post.id });
  });

  it('o prompt da reescrita leva o motivo, a versão reprovada, a estratégia aprovada e as regras de data', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const post = flagged(w, r);
    let prompt = '';
    s.aiJson['ig_auto_calendar'] = (req: any) => {
      prompt = req.prompt;
      return item();
    };
    approve(s);
    await auto.rewritePost(post.id);
    expect(prompt).toContain('REFAÇA, reprovado antes por: fala de outro negócio');
    expect(prompt).toContain('VERSÃO REPROVADA (reescreva corrigindo o motivo; mantenha o que não foi criticado): {"tema":"Velho","gancho":"Gancho velho","headline":"Manchete velha","legenda":"Legenda velha","cta":"CTA"}');
    expect(prompt).toMatch(/2\. ESTRATÉGIA APROVADA: .*"mensagem_central":"Almoço rápido e gostoso"/);
    expect(prompt).toContain('Coerência com a data');
  });

  it('com mídia e o mesmo gancho/headline: volta "ready" mantendo a mídia; headline mudou: mídia descartada e volta "idea"', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const keep = flagged(w, r, { media: [{ url: 'https://cdn.test/a.jpg', type: 'image', order: 0 }], hook: 'Gancho novo', creative_brief: { prompt: 'x', headline: 'Manchete nova' } });
    s.aiJson['ig_auto_calendar'] = () => item();
    approve(s);
    await auto.rewritePost(keep.id);
    expect(keep).toMatchObject({ status: 'ready', caption: 'Legenda nova' });
    expect(keep.media).toHaveLength(1);
    const drop = flagged(w, r, { media: [{ url: 'https://cdn.test/b.jpg', type: 'image', order: 0 }] });
    await auto.rewritePost(drop.id);
    expect(drop).toMatchObject({ status: 'idea', media: [] });
  });

  it('reprovado: a 1ª reescrita vira tentativa 1 (continua em revisão com o novo motivo); a 2ª pula o horário (cancelado + post_skipped)', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const post = flagged(w, r);
    s.aiJson['ig_auto_calendar'] = () => item();
    reject(s, 'ainda fora do segmento');
    expect(await auto.rewritePost(post.id)).toBe('retried');
    expect(post).toMatchObject({ status: 'needs_review', review_reason: 'ainda fora do segmento', review_attempts: 1, theme: 'Velho' });
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'post_rewritten', level: 'warn' });
    reject(s, 'continua genérico');
    w.t['publishing_jobs']!.rows.push({ id: uuid(), ig_post_id: post.id, status: 'pending' });
    expect(await auto.rewritePost(post.id)).toBe('skipped');
    expect(post).toMatchObject({ status: 'cancelled', last_error: 'Pulado automaticamente: continua genérico', review_attempts: 2 });
    expect(w.t['publishing_jobs']!.rows[0]!.status).toBe('cancelled');
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'post_skipped', level: 'warn', post_id: post.id });
    expect(w.t['ig_autopilot_events']!.rows.at(-1)!.message).toMatch(/continuou reprovado depois de 2 reescrita\(s\) — continua genérico/);
  });

  it('reprovação por código também conta: data incoerente e checagem final (CTA fora da estratégia)', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const monday = new Date('2099-01-05T10:00:00-03:00');
    const a = flagged(w, r, { scheduled_at: monday });
    s.aiJson['ig_auto_calendar'] = () => item({ caption: 'Sextou com chope!' });
    approve(s);
    expect(await auto.rewritePost(a.id)).toBe('retried');
    expect(a.review_reason).toBe('Incoerência de data: "sextou" fora de sexta-feira.');
    const b = flagged(w, r);
    s.aiJson['ig_auto_calendar'] = () => item({ cta: 'Clique no link da bio' });
    expect(await auto.rewritePost(b.id)).toBe('retried');
    expect(b.review_reason).toBe('Checagem final: CTA fora dos CTAs da estratégia.');
  });

  it('IA fora do ar: não gasta tentativa, guarda last_error e tenta de novo no próximo tick', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const post = flagged(w, r);
    s.aiJson['ig_auto_calendar'] = () => {
      throw new Error('IA fora do ar');
    };
    expect(await auto.rewritePost(post.id)).toBeNull();
    expect(post).toMatchObject({ status: 'needs_review', review_attempts: 0, last_error: 'IA fora do ar', lease_until: null });
  });

  it('tentativas esgotadas (review_attempts = 2): pula sem chamar a IA; modo "approval" nunca é reescrito; lease vivo é respeitado', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const spent = flagged(w, r, { review_attempts: 2 });
    expect(await auto.rewritePost(spent.id)).toBe('skipped');
    expect(spent.last_error).toBe('Pulado automaticamente: fala de outro negócio');
    const human = flagged(w, r, { automation: 'approval' });
    const busy = flagged(w, r, { lease_until: new Date(Date.now() + 60e3) });
    expect(await auto.rewritePost(human.id)).toBeNull();
    expect(await auto.rewritePost(busy.id)).toBeNull();
    expect(s.ai.jsonWithEngine).not.toHaveBeenCalled();
    expect([human.status, busy.status]).toEqual(['needs_review', 'needs_review']);
  });

  it('tick: a reescrita roda ANTES de agendar; o post reprovado na checagem final só é reescrito no tick seguinte', async () => {
    const { w, s, auto } = setup();
    connected(w);
    const p = plan(w);
    const r = run(w, p, { status: 'active' });
    // gancho e headline iguais aos que a IA devolve: a reescrita mantém a mídia (volta "ready") e o passo 2 já agenda
    const post = seedPost(w, { run_id: r.id, plan_id: p.id, automation: 'publish', status: 'ready', persona: null, objective_link: 'serve', pillar: 'A', cta: 'CTA', hook: 'Gancho novo', creative_brief: { headline: 'Manchete nova' }, scheduled_at: new Date(Date.now() + 30 * 3600e3) });
    s.aiJson['ig_auto_calendar'] = () => item();
    approve(s);
    let out = await auto.autoCalendarTick();
    expect(post.status).toBe('needs_review'); // reprovado na checagem final do agendamento (passo 2)
    expect(out['rewritten']).toEqual({ rewritten: 0, retried: 0, skipped: 0 });
    out = await auto.autoCalendarTick();
    expect(out['rewritten']).toEqual({ rewritten: 1, retried: 0, skipped: 0 });
    expect(post.status).toBe('scheduled'); // reescrito (mesmo gancho/headline → mantém a mídia) e agendado no mesmo tick
  });

  it('o selo de aprovações (pending-count) não conta o post que a IA está reescrevendo', async () => {
    const { w, s } = setup();
    const r = run(w, plan(w), { status: 'active' });
    flagged(w, r);
    seedPost(w, { status: 'needs_review', automation: 'approval', review_reason: 'x' });
    seedPost(w, { status: 'needs_review', review_reason: 'x' }); // calendário do plano (automation null)
    seedPost(w, { status: 'pending_approval' });
    expect(await s.resources.pendingCount(WS_A)).toEqual({ count: 3 });
  });
});

describe('A3 — painel do período (summary)', () => {
  it('conta produzidos / produzindo / na fila / agendados / publicados / pulados, separa "em reescrita" de "em revisão" e lista os pulados com o motivo', async () => {
    const { w, auto } = setup();
    const p = plan(w);
    const r = run(w, p, { status: 'active', mode: 'publish' });
    const mk = (status: string, over: Record<string, unknown> = {}) => seedPost(w, { run_id: r.id, plan_id: p.id, automation: 'publish', status, ...over });
    mk('ready');
    mk('pending_approval', { automation: 'approval' });
    mk('generating');
    mk('idea');
    mk('idea');
    mk('scheduled');
    mk('published');
    mk('needs_review');
    mk('needs_review', { automation: 'approval' });
    mk('cancelled', { last_error: 'Pulado automaticamente: o horário passou há mais de 12 h sem o criativo pronto.', theme: 'Vencido', scheduled_at: new Date('2099-01-02T12:00:00Z') });
    mk('cancelled', { rejection_reason: 'não gostei' });
    const [row] = (await auto.summary(WS_A)) as any[];
    expect(row.counts).toMatchObject({ total: 11, produced: 2, producing: 1, queued: 2, scheduled: 1, published: 1, rewriting: 1, review: 1, skipped: 1 });
    expect(row.skipped_posts).toEqual([{ id: expect.any(String), theme: 'Vencido', scheduled_at: new Date('2099-01-02T12:00:00Z'), reason: 'o horário passou há mais de 12 h sem o criativo pronto.' }]);
  });
});
