import { WS_A, OWNER } from '../../media/__tests__/mem';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';

function setup() {
  const w: IgWorld = igWorld();
  const s = igServices(w);
  w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, ig_user_id: 'ig1', status: 'connected' });
  return { w, s, ap: s.autopilot };
}
const plan = (w: IgWorld, over: Record<string, unknown> = {}): any => {
  // O calendário do plano exige marca vinculada (protótipo 05/10/2026): cada plano ganha a sua, salvo `brand_id` explícito.
  const brandId = 'brand_id' in over ? over['brand_id'] : (() => { const b = { id: uuid(), workspace_id: WS_A, name: 'Marca' }; w.t['brands']!.rows.push(b); return b.id; })();
  const p = { id: uuid(), workspace_id: WS_A, name: 'P', status: 'active', auto_publish: true, requires_approval: false, content_pillars: [], posting_days: [0, 1, 2, 3, 4, 5, 6], preferred_times: [], ai_notes: [], pillar_weights: {}, hashtag_strategy: {}, posting_frequency: {}, cta_default: null, ...over, brand_id: brandId };
  w.t['ig_content_plans']!.rows.push(p);
  return p;
};
const idea = (w: IgWorld, over: Record<string, unknown> = {}) => seedPost(w, { status: 'idea', media: [], approved_at: null, creative_brief: { prompt: 'x' }, ...over });
const inH = (h: number) => new Date(Date.now() + h * 3600e3);

describe('autopilotTick', () => {
  it('gera a mídia de até 2 ideias futuras (as mais próximas) de planos com piloto e agenda quando não exige aprovação', async () => {
    const { w, s, ap } = setup();
    const p = plan(w);
    const a = idea(w, { plan_id: p.id, scheduled_at: inH(30) });
    const b = idea(w, { plan_id: p.id, scheduled_at: inH(5) });
    const c = idea(w, { plan_id: p.id, scheduled_at: inH(10) });
    const past = idea(w, { plan_id: p.id, scheduled_at: inH(-2) });
    const noPilot = idea(w, { plan_id: plan(w, { auto_publish: false }).id, scheduled_at: inH(1) });
    const out = await ap.autopilotTick();
    expect(out).toEqual({ media: 2, rescheduled: 0 });
    expect(s.pipeline.run).toHaveBeenCalledTimes(2);
    expect([b.status, c.status]).toEqual(['scheduled', 'scheduled']);
    expect([a.status, past.status, noPilot.status]).toEqual(['idea', 'idea', 'idea']);
    expect(w.t['publishing_jobs']!.rows.map((j) => j.run_at.getTime())).toEqual([b.scheduled_at.getTime(), c.scheduled_at.getTime()]);
    expect(w.t['ig_autopilot_events']!.rows.map((e) => e.kind)).toEqual(['media', 'schedule', 'media', 'schedule']);
  });

  it('plano que exige aprovação: gera e deixa aguardando (não agenda)', async () => {
    const { w, ap } = setup();
    const p = plan(w, { requires_approval: true });
    const post = idea(w, { plan_id: p.id, scheduled_at: inH(20) });
    await ap.autopilotTick();
    expect(post.status).toBe('pending_approval');
    expect(w.t['publishing_jobs']!.rows).toHaveLength(0);
  });

  it('posts de programação automática entram mesmo sem plano no piloto e são agendados pela regra própria', async () => {
    const { w, ap } = setup();
    const p = plan(w, { auto_publish: false });
    const post = idea(w, { plan_id: p.id, automation: 'publish', scheduled_at: inH(3) });
    await ap.autopilotTick();
    expect(post.status).toBe('scheduled');
  });

  it('falha ao gerar a mídia vira evento "failure"; o laço continua', async () => {
    const { w, s, ap } = setup();
    const p = plan(w);
    s.pipeline.run.mockRejectedValueOnce(new Error('Sem créditos'));
    const bad = idea(w, { plan_id: p.id, scheduled_at: inH(2) });
    const good = idea(w, { plan_id: p.id, scheduled_at: inH(3) });
    await ap.autopilotTick();
    expect(bad.status).toBe('failed');
    expect(good.status).toBe('scheduled');
    expect(w.t['ig_autopilot_events']!.rows[0]).toMatchObject({ kind: 'failure', level: 'error', message: 'Falha ao gerar a mídia: Sem créditos' });
  });

  it('regra das 2h: sem aprovação perto do horário vai para o dia seguinte; aprovado, de programação ou longe não mexe', async () => {
    const { w, ap } = setup();
    const p = plan(w, { requires_approval: true });
    const t0 = Date.now() + 3600e3;
    const late = seedPost(w, { plan_id: p.id, status: 'pending_approval', approved_at: null, scheduled_at: new Date(t0) });
    const past = seedPost(w, { plan_id: p.id, status: 'idea', approved_at: null, scheduled_at: new Date(Date.now() - 3600e3) });
    const far = seedPost(w, { plan_id: p.id, status: 'pending_approval', approved_at: null, scheduled_at: inH(10) });
    const approved = seedPost(w, { plan_id: p.id, status: 'approved', scheduled_at: new Date(t0) });
    const auto = seedPost(w, { plan_id: p.id, status: 'pending_approval', approved_at: null, automation: 'approval', scheduled_at: new Date(t0) });
    const out = await ap.autopilotTick();
    expect(out.rescheduled).toBe(2);
    expect(late.scheduled_at.getTime()).toBe(t0 + 86400e3);
    expect(past.scheduled_at.getTime()).toBeGreaterThan(Date.now() + 2 * 3600e3);
    expect(far.scheduled_at.getTime()).toBeLessThan(Date.now() + 11 * 3600e3);
    expect(approved.scheduled_at.getTime()).toBe(t0);
    expect(auto.scheduled_at.getTime()).toBe(t0);
    expect(w.t['ig_autopilot_events']!.rows.every((e) => e.kind === 'reschedule' && e.level === 'warn')).toBe(true);
  });
});

describe('runWeeklyAutopilot (domingo 18h BRT)', () => {
  it('gera a semana seguinte uma vez por plano (reserva em ig_autopilot_weeks), registra eventos e last_autopilot_at', async () => {
    const { w, s, ap } = setup();
    const p = plan(w, { requires_approval: true });
    plan(w, { auto_publish: false });
    s.aiJson['ig_calendar'] = () => ({ posts: [{ format: 'feed_image', scheduled_at: '2099-01-05T10:00:00-03:00', theme: 'T', hook: 'h', caption: 'c', hashtags: [], cta: 'x', image_prompt: 'p', slides: [] }] });
    const first = await ap.runWeeklyAutopilot();
    expect(first[0]).toEqual({ recurring: { created: 0 } });
    expect(first[1]).toEqual({ plan: p.id, created: 1 });
    expect(w.t['ig_posts']!.rows).toHaveLength(1);
    expect(p.last_autopilot_at).toBeInstanceOf(Date);
    const week = w.t['ig_autopilot_weeks']!.rows[0];
    expect(week.plan_id).toBe(p.id);
    expect(week.week_start.getUTCDay()).toBe(1); // segunda-feira
    expect(w.t['ig_autopilot_events']!.rows.map((e) => e.kind)).toEqual(['generation', 'approval']);
    // segunda execução na mesma semana: nada novo
    const second = await ap.runWeeklyAutopilot();
    expect(second[1]).toMatchObject({ plan: p.id, skipped: expect.stringMatching(/já gerada/) });
    expect(w.t['ig_posts']!.rows).toHaveLength(1);
  });

  it('falha libera a reserva da semana, registra o erro e segue com os outros planos', async () => {
    const { w, s, ap } = setup();
    const p1 = plan(w);
    const p2 = plan(w);
    let n = 0;
    s.aiJson['ig_calendar'] = () => {
      if (++n === 1) throw new Error('IA fora do ar');
      return { posts: [{ format: 'feed_image', scheduled_at: '2099-01-05T10:00:00-03:00', theme: 'T', hook: 'h', caption: 'c', hashtags: [], cta: 'x', image_prompt: 'p', slides: [] }] };
    };
    const out = await ap.runWeeklyAutopilot();
    expect(out[1]).toEqual({ plan: p1.id, error: 'IA fora do ar' });
    expect(out[2]).toEqual({ plan: p2.id, created: 1 });
    expect(w.t['ig_autopilot_weeks']!.rows.map((r) => r.plan_id)).toEqual([p2.id]); // a do p1 foi liberada
    expect(w.t['ig_autopilot_events']!.rows.find((e) => e.kind === 'failure')).toMatchObject({ plan_id: p1.id, level: 'error', message: 'Falha ao gerar o calendário: IA fora do ar' });
  });
});

describe('runOptimizer (segunda 9h)', () => {
  const hourBRT = (h: number) => { const d = new Date(Date.now() - 2 * 86400e3); d.setUTCHours(h + 3, 0, 0, 0); return d; };

  it('poucos dados (< 3 posts em 14 dias): pula', async () => {
    const { w, ap } = setup();
    const p = plan(w);
    seedPost(w, { plan_id: p.id, status: 'published', published_at: hourBRT(9) });
    expect(await ap.runOptimizer()).toEqual([{ plan: p.id, skipped: 'poucos dados' }]);
  });

  it('melhores horários por alcance médio (BRT) e pesos dos pilares 70% desempenho + 30% uniforme; anota o resumo', async () => {
    const { w, ap } = setup();
    const p = plan(w, { status: 'paused', content_pillars: ['Bastidores da cozinha', { name: 'Promoções', title: 'x' }], preferred_times: ['10:00'], ai_notes: Array.from({ length: 20 }, (_, i) => ({ n: i })) });
    const mk = (h: number, reach: number, theme: string) => {
      const post = seedPost(w, { plan_id: p.id, status: 'published', published_at: hourBRT(h), theme, caption: '' });
      w.t['ig_post_metrics']!.rows.push({ id: uuid(), workspace_id: WS_A, post_id: post.id, reach, collected_at: new Date() });
      return post;
    };
    mk(9, 100, 'Bastidores da cozinha hoje');
    mk(9, 300, 'Bastidores especial');
    mk(19, 1000, 'Promoções de verão');
    mk(12, 10, 'Outro assunto');
    const out = await ap.runOptimizer();
    expect(out).toEqual([{ plan: p.id, ok: true }]);
    expect(p.preferred_times).toEqual(['19:00', '09:00', '12:00']);
    // Bastidores: média 200; Promoções: 1000 → total 1200; 0,7*(200/1200)+0,15 = 0,27 ; 0,7*(1000/1200)+0,15 = 0,73
    expect(p.pillar_weights).toEqual({ 'Bastidores da cozinha': 0.27, Promoções: 0.73 });
    expect(p.ai_notes).toHaveLength(20);
    const note = p.ai_notes.at(-1);
    expect(note).toMatchObject({ period_days: 14, posts_analyzed: 4, preferred_times: { before: ['10:00'], after: ['19:00', '09:00', '12:00'] } });
    expect(note.summary).toMatch(/Melhores horários por alcance médio: 19h \(1000 de alcance, 1 posts\), 09h \(200 de alcance, 2 posts\)/);
    expect(note.summary).toMatch(/Pilar com melhor desempenho: "Promoções" \(peso 73%\)\./);
    expect(w.t['ig_autopilot_events']!.rows[0]).toMatchObject({ kind: 'optimize', plan_id: p.id });
  });

  it('plano arquivado/draft não é otimizado', async () => {
    const { w, ap } = setup();
    plan(w, { status: 'draft' });
    expect(await ap.runOptimizer()).toEqual([]);
  });
});

describe('learnFromTopPosts', () => {
  it('top 20% por alcance + 5×salvamentos copiam o prompt para brands.visual_style.exemplos_prompt (sem repetir, últimos 10)', async () => {
    const { w, s } = setup();
    const brand = { id: uuid(), workspace_id: WS_A, name: 'B', visual_style: { exemplos_prompt: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'] } };
    w.t['brands']!.rows.push(brand);
    const p = plan(w, { brand_id: brand.id });
    const make = (reach: number, saves: number, prompt: string | null) => {
      const post = seedPost(w, { plan_id: p.id, status: 'published', creative_brief: prompt ? { art_direction: { prompt_final: prompt } } : {} });
      w.t['ig_post_metrics']!.rows.push({ id: uuid(), workspace_id: WS_A, post_id: post.id, reach, saves, collected_at: new Date() });
    };
    make(100, 0, 'fraco-1'); make(120, 0, 'fraco-2'); make(90, 0, 'fraco-3'); make(110, 0, 'fraco-4'); make(80, 0, null);
    make(50, 40, 'campeão'); // 50 + 200 = 250
    expect(await s.metrics.learnFromTopPosts()).toEqual({ added: 2 }); // 6 posts → top 20% = 2 (o campeão e o 2º)
    const ex = brand.visual_style.exemplos_prompt;
    expect(ex).toHaveLength(10);
    expect(ex.slice(-2)).toEqual(['fraco-2', 'campeão']);
    expect(ex[0]).toBe('p3');
    expect(await s.metrics.learnFromTopPosts()).toEqual({ added: 0 });
    // menos de 5 posts medidos: ninguém aprende
    const w2 = igWorld(); const s2 = igServices(w2);
    expect(await s2.metrics.learnFromTopPosts()).toEqual({ added: 0 });
    void OWNER;
  });
});
