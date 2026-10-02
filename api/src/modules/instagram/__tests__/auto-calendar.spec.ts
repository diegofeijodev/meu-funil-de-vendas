import { ADMIN, MARKETING, OWNER, STRANGER, VIEWER, WS_A, WS_B, status } from '../../media/__tests__/mem';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';
import { plusDays, todaySP } from '../slots';

function setup() {
  const w: IgWorld = igWorld();
  const s = igServices(w);
  return { w, s, a: s.actions, auto: s.auto };
}
const plan = (w: IgWorld, over: Record<string, unknown> = {}): any => {
  const p = { id: uuid(), workspace_id: WS_A, name: 'Plano', status: 'active', requires_approval: false, auto_publish: false, content_pillars: ['A'], hashtag_strategy: {}, ai_notes: [], pillar_weights: {}, cta_default: 'Peça já', objective: 'x', tone_of_voice: 't', posting_days: [0, 1, 2, 3, 4, 5, 6], ...over };
  w.t['ig_content_plans']!.rows.push(p);
  return p;
};
const DATE = (s: string) => new Date(`${s}T12:00:00Z`);
const slotAt = (minutes: number, i: number, format = 'feed_image') => ({ index: i, at: new Date(Date.now() + minutes * 60e3).toISOString(), format, kind: 'main' });
const run = (w: IgWorld, p: any, over: Record<string, unknown> = {}): any => {
  const r = { id: uuid(), workspace_id: WS_A, plan_id: p.id, created_by: OWNER, start_date: DATE('2099-01-01'), end_date: DATE('2099-01-07'), weekdays: [0, 1, 2, 3, 4, 5, 6], times: ['09:00'], story_times: [], formats: ['feed_image'], status: 'planning', filled: 0, slots: [], mode: 'publish', recurring: false, parent_id: null, campaign_id: null, locked_until: null, ...over };
  w.t['ig_auto_runs']!.rows.push(r);
  return r;
};
const input = (over: Record<string, unknown> = {}): any => ({ workspaceId: WS_A, startDate: '2099-01-01', endDate: '2099-01-03', weekdays: [0, 1, 2, 3, 4, 5, 6], times: ['09:00', '18:00'], storyTimes: [], formats: ['feed_image'], mode: 'approval', ...over });

describe('createAutoCalendar', () => {
  it('cria a programação com os horários exatos, normaliza horários e registra o evento', async () => {
    const { w, a } = setup();
    const p = plan(w);
    const r = await a.createAutoCalendar(OWNER, input({ planId: p.id, times: ['9:00', '09:00', '18:00'], focus: '  Dia dos Pais  ' }));
    expect(r).toMatchObject({ planId: p.id, total: 6, skipped: 0 });
    const row = w.t['ig_auto_runs']!.rows[0];
    expect(row).toMatchObject({ id: r.runId, workspace_id: WS_A, plan_id: p.id, created_by: OWNER, mode: 'approval', recurring: false, focus: 'Dia dos Pais', times: ['09:00', '18:00'], story_times: [] });
    expect(row.slots).toHaveLength(6);
    expect(row.slots[0]).toMatchObject({ index: 0, at: '2099-01-01T12:00:00.000Z', format: 'feed_image', kind: 'main' });
    expect(w.t['ig_autopilot_events']!.rows[0]).toMatchObject({ kind: 'generation', plan_id: p.id });
    expect(w.t['ig_autopilot_events']!.rows[0].message).toMatch(/Programação criada: 6 posts .* \(com aprovação\)/);
  });

  it('sem plano cria um a partir da marca (pilares sugeridos pela IA); exige plano ou marca; ids de outra empresa = 404', async () => {
    const { w, s, a } = setup();
    expect(await status(a.createAutoCalendar(OWNER, input()))).toBe('400:Escolha um plano de conteúdo ou uma marca.');
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

describe('fillAutoRun (estrategista em lotes, lock de 150 s)', () => {
  const posts = (n: number) => ({ posts: Array.from({ length: n }, (_, i) => ({ index: i, theme: `T${i}`, pillar: 'A', funnel_stage: 'atracao', hook: 'H', headline: 'Manchete', caption: 'Legenda', hashtags: ['a', 'b'], cta: 'CTA', image_prompt: 'cena', slides: ['s1'] })) });

  it('preenche 8 horários por chamada, avança "filled" e conclui em "active"', async () => {
    const { w, s, a } = setup();
    const p = plan(w);
    const slots = Array.from({ length: 10 }, (_, i) => slotAt(600 + i * 60, i, i === 3 ? 'feed_carousel' : 'feed_image'));
    const r = run(w, p, { slots, mode: 'approval' });
    s.aiJson['ig_auto_calendar'] = () => posts(10);
    expect(await a.fillAutoCalendar(OWNER, r.id)).toEqual({ filled: 8, total: 10, done: false, busy: false });
    expect(r).toMatchObject({ filled: 8, status: 'planning', locked_until: null });
    const created = w.t['ig_posts']!.rows;
    expect(created).toHaveLength(8);
    expect(created[0]).toMatchObject({ workspace_id: WS_A, plan_id: p.id, run_id: r.id, automation: 'approval', status: 'idea', theme: 'T0', hook: 'H', caption: 'Legenda', cta: 'CTA', hashtags: ['a', 'b'], ai_provider: 'lovable_ai' });
    expect(created[0].scheduled_at).toEqual(new Date(slots[0]!.at));
    expect(created[0].creative_brief).toMatchObject({ prompt: 'cena', slides: [], aspect_ratio: '1:1', headline: 'Manchete', pillar: 'A', funnel_stage: 'atracao', variations: 3 });
    expect(created[3].creative_brief).toMatchObject({ slides: ['s1'], aspect_ratio: '4:5' });
    expect(await a.fillAutoCalendar(OWNER, r.id)).toEqual({ filled: 10, total: 10, done: true, busy: false });
    expect(r.status).toBe('active');
    expect(created).toHaveLength(10);
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'generation' });
    // programação concluída: chamada extra não gera nada
    expect(await a.fillAutoCalendar(OWNER, r.id)).toEqual({ filled: 10, total: 10, done: true, busy: false });
    expect(w.t['ig_posts']!.rows).toHaveLength(10);
  });

  it('chamadas simultâneas: quem não pegou o lock recebe busy:true e não gasta IA; lock vencido é reassumido', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { slots: [slotAt(600, 0)] });
    s.aiJson['ig_auto_calendar'] = () => posts(1);
    const [x, y] = await Promise.all([auto.fillAutoRun(r.id), auto.fillAutoRun(r.id)]);
    expect([x, y].filter((o) => o.busy)).toHaveLength(1);
    expect(s.ai.jsonWithEngine).toHaveBeenCalledTimes(1);
    const r2 = run(w, plan(w), { slots: [slotAt(600, 0)], locked_until: new Date(Date.now() + 100e3) });
    expect(await auto.fillAutoRun(r2.id)).toMatchObject({ busy: true, filled: 0 });
    r2.locked_until = new Date(Date.now() - 1000);
    expect(await auto.fillAutoRun(r2.id)).toMatchObject({ busy: false, filled: 1, done: true });
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
    // só o índice 0 volta; o 1 ganha um post simples com aviso no log
    s.aiJson['ig_auto_calendar'] = () => ({ posts: [{ index: 0, theme: 'Só este', hashtags: 'x y' }] });
    await auto.fillAutoRun(r.id);
    const rows = w.t['ig_posts']!.rows;
    expect(rows[0]).toMatchObject({ theme: 'Só este', hashtags: ['x', 'y'], cta: 'Peça já' });
    expect(rows[0].ai_generation_log[0].warnings).toEqual(['hashtags vieram como texto e foram normalizadas']);
    expect(rows[1].ai_generation_log[0].warnings).toEqual(['a IA não devolveu conteúdo para este horário']);
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

  it('usa a estratégia da campanha e o aprendizado do plano no prompt', async () => {
    const { w, s, auto } = setup();
    s.strategist.currentStrategy.mockResolvedValue({ big_idea: 'Chopp gelado de verdade', mensagem_principal: 'm', angulos_detalhados: [], objecoes: [], briefing_criativo: {} });
    const p = plan(w, { ai_notes: [{ summary: 'Reels às 19h rendem mais' }], pillar_weights: { A: 1 } });
    const camp = uuid();
    const r = run(w, p, { slots: [slotAt(600, 0)], campaign_id: camp, focus: 'Black Friday' });
    s.aiJson['ig_auto_calendar'] = () => posts(1);
    await auto.fillAutoRun(r.id);
    const prompt = s.ai.jsonWithEngine.mock.calls[0][1].prompt as string;
    expect(prompt).toMatch(/FOCO DESTE PERÍODO \(prioridade máxima\): Black Friday/);
    expect(prompt).toMatch(/Chopp gelado de verdade/);
    expect(prompt).toMatch(/Aprendizados dos resultados: Reels às 19h rendem mais/);
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
    const soon1 = seedPost(w, { status: 'idea', media: [], run_id: r.id, plan_id: p.id, automation: 'publish', scheduled_at: new Date(Date.now() + 2 * 3600e3) });
    const soon2 = seedPost(w, { status: 'idea', media: [], run_id: r.id, plan_id: p.id, automation: 'publish', scheduled_at: new Date(Date.now() + 3 * 3600e3) });
    const far = seedPost(w, { status: 'idea', media: [], run_id: r.id, plan_id: p.id, automation: 'publish', scheduled_at: new Date(Date.now() + 30 * 3600e3) });
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
    const post = seedPost(w, { status: 'idea', media: [], run_id: r.id, plan_id: p.id, automation: 'publish', scheduled_at: new Date(Date.now() + 3600e3) });
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
    const ready = seedPost(w, { automation: 'publish', status: 'ready', plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3600e3) });
    const waitApproval = seedPost(w, { automation: 'approval', status: 'ready', approved_at: null, plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3 * 3600e3) });
    const failed = seedPost(w, { automation: 'publish', status: 'failed', plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3600e3), creative_brief: { prompt: 'x', variations: 3 } });
    const failedTwice = seedPost(w, { automation: 'publish', status: 'failed', plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3600e3), creative_brief: { auto_retried: true } });
    const out = await auto.autoCalendarTick();
    expect(out).toMatchObject({ filled: 0, scheduled: 1, rescheduled: 0 });
    expect(ready.status).toBe('scheduled');
    expect(waitApproval.status).toBe('ready');
    expect(failed).toMatchObject({ status: 'idea', creative_brief: { prompt: 'x', auto_retried: true, variations: 1 } });
    expect(failedTwice.status).toBe('failed');
    expect(r.status).toBe('active'); // ainda há posts em aberto
    void s;
  });

  it('2c: automático "publish" vencido há menos de 12 h sem criativo é gerado agora e agendado', async () => {
    const { w, s, auto } = setup();
    connected(w);
    const p = plan(w);
    const overdue = seedPost(w, { automation: 'publish', status: 'idea', media: [], plan_id: p.id, scheduled_at: new Date(Date.now() - 3600e3) });
    const tooOld = seedPost(w, { automation: 'publish', status: 'idea', media: [], plan_id: p.id, scheduled_at: new Date(Date.now() - 13 * 3600e3) });
    await auto.autoCalendarTick();
    expect(s.pipeline.run).toHaveBeenCalledTimes(1);
    expect(overdue.status).toBe('scheduled');
    expect(tooOld.status).toBe('idea');
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
