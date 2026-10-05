import { MetaError } from '../../instagram/meta-graph';
import { status } from '../../media/__tests__/mem';
import { sanitizeAdsConfig, sanitizeRules } from '../ads-config';
import { ADMIN, adsWorld, MARKETING, OWNER, STRANGER, uid, VIEWER, WS_A, WS_B } from './harness';

const day = (n: number) => new Date(Date.now() - n * 86400e3);
const perfRow = (w: ReturnType<typeof adsWorld>, c: any, o: Record<string, any>) =>
  w.t['performance_daily']!.rows.push({ id: uid(), workspace_id: c.workspace_id, campaign_id: c.id, source: 'meta', date: day(1), spend: 0, impressions: 1000, clicks: 20, leads: 0, conversions: 0, revenue: 0, ...o });

const publishedCamp = (w: ReturnType<typeof adsWorld>, over: Record<string, any> = {}) =>
  w.seedCampaign({ meta_campaign_id: '9001', meta_adset_id: '9101', meta_adset_ids: ['9101'], meta_ad_ids: ['9301', '9302'], meta_delivery_status: 'ACTIVE', status: 'active', ...over });

describe('sincronização (2.1)', () => {
  it('sem campanha publicada: {0,0} e nenhuma chamada à Meta', async () => {
    const w = adsWorld();
    expect(await w.adsOps.syncNow(VIEWER, WS_A)).toEqual({ campaigns: 0, rows: 0 });
    expect(w.calls).toHaveLength(0);
  });

  it('qualquer membro sincroniza; estranho não; linhas por anúncio/dia viram performance_daily com o criativo do mapa', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    const cr = w.seedCreative(c.id);
    c.meta_ad_map = { '9301': { creativeId: cr.id, adsetId: '9101', angle: null }, '9302': { creativeId: uid(), adsetId: '9101', angle: null } };
    w.respond((path) => (path.endsWith('/insights') ? { data: [
      { date_start: '2026-09-30', campaign_id: '9001', adset_id: '9101', adset_name: 'Conj', ad_id: '9301', ad_name: 'A1', spend: '10.5', impressions: '1000', reach: '800', inline_link_clicks: '30', actions: [{ action_type: 'lead', value: '3' }, { action_type: 'onsite_conversion.lead_grouped', value: '2' }], action_values: [] },
      { date_start: '2026-09-30', campaign_id: '9001', adset_id: '9101', adset_name: 'Conj', ad_id: '9302', ad_name: 'A2', spend: '5', impressions: '500', clicks: '10', actions: [{ action_type: 'purchase', value: '1' }, { action_type: 'omni_purchase', value: '1' }], action_values: [{ action_type: 'purchase', value: '99.9' }, { action_type: 'omni_purchase', value: '99.9' }] },
      { date_start: '2026-09-30', campaign_id: 'OUTRA', adset_id: '1', ad_id: '2', spend: '1' },
    ] } : undefined));
    expect(await status(w.adsOps.syncNow(STRANGER, WS_A))).toBe('403:Você não tem acesso a esta empresa.');
    expect(await w.adsOps.syncNow(VIEWER, WS_A)).toEqual({ campaigns: 1, rows: 2 });
    const [a, b] = w.perf.meta;
    expect(a).toMatchObject({ workspace_id: WS_A, campaign_id: c.id, creative_id: cr.id, adset_name: 'Conj', ad_name: 'A1', date: '2026-09-30', spend: 10.5, impressions: 1000, reach: 800, clicks: 30, leads: 3, conversions: 0, source: 'meta', meta_ad_id: '9301', meta_adset_id: '9101' });
    // criativo do mapa que não é desta empresa vira null; compra repetida (purchase + omni) não soma
    expect(b).toMatchObject({ creative_id: null, conversions: 1, revenue: 99.9, clicks: 10 });
    const ins = w.calls[0]!;
    expect(ins.path).toBe('/act_1001/insights');
    expect(ins.opts.params.filtering).toEqual([{ field: 'campaign.id', operator: 'IN', value: ['9001'] }]);
    expect(ins.opts.params.time_range.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.last_insights_sync_at).toBeInstanceOf(Date);
  });

  it('pagina o cursor da Graph e respeita 30 páginas', async () => {
    const w = adsWorld();
    publishedCamp(w);
    let n = 0;
    w.respond((path) => (path.endsWith('/insights') ? { data: [], paging: { next: 'x', cursors: { after: `c${++n}` } } } : undefined));
    await w.ops.fetchDailyAdInsights(WS_A, ['9001'], '2026-09-01', '2026-09-30');
    expect(w.calls).toHaveLength(30);
    expect(w.calls[1]!.opts.params.after).toBe('c1');
  });

  it('Google/TikTok viram linhas source google/tiktok; falha de um canal não derruba o outro', async () => {
    const w = adsWorld();
    const c = w.seedCampaign({ google_campaign_id: '555', tiktok_campaign_id: '777' });
    w.google.dailyResults = jest.fn(async () => [{ externalCampaignId: '555', date: '2026-09-30', spend: 12, impressions: 100, clicks: 5, conversions: 2.4, revenue: 50, name: 'G' }]);
    w.tiktok.dailyResults = jest.fn(async () => { throw new Error('fora do ar'); });
    const r = await w.adsOps.syncExternalChannels(WS_A, 7);
    expect(r.rows).toBe(1);
    expect(r.errors).toEqual(['TikTok: fora do ar']);
    expect(w.perf.external[0]).toMatchObject({ campaign_id: c.id, source: 'google', external_id: '555', leads: 2, conversions: 2, revenue: 50 });
  });

  it('syncAll (cron): uma empresa com erro não impede as outras', async () => {
    const w = adsWorld();
    publishedCamp(w);
    w.seedCampaign({ workspace_id: WS_B, meta_campaign_id: '8001' });
    w.respond((path, _o, ws) => (path.endsWith('/insights') ? (ws === WS_B ? new MetaError('Token inválido') : { data: [] }) : undefined));
    const out = await w.adsOps.syncAllInsights();
    expect(out).toEqual(expect.arrayContaining([{ workspace: WS_A, rows: 0 }, { workspace: WS_B, error: 'Token inválido' }]));
  });
});

describe('regras automáticas (2.3)', () => {
  const setup = () => {
    const w = adsWorld();
    const c = publishedCamp(w, { automation_rules: { enabled: true, maxCpl: 20, minSpendToJudge: 30, scaleBelowCpl: 10, scaleStepPct: 20, maxDailyBudget: 60 } });
    return { w, c };
  };

  it('pausa o anúncio caro quando há irmão ativo; nunca o último; não repete em 7 dias; registra a regra', async () => {
    const { w, c } = setup();
    perfRow(w, c, { meta_ad_id: '9301', meta_adset_id: '9101', ad_name: 'Caro', spend: 100, leads: 2 });   // CPL 50 > 20
    perfRow(w, c, { meta_ad_id: '9302', meta_adset_id: '9101', ad_name: 'Bom', spend: 40, leads: 8 });     // CPL 5
    w.respond((path, opts) => (opts.params?.fields === 'effective_status' ? { effective_status: 'ACTIVE' } : undefined));
    const acts = await w.adsOps.runRulesForCampaign(c);
    expect(acts).toEqual(['Regra: anúncio "Caro" pausado']);
    expect(w.calls.find((x) => x.opts.method === 'POST')).toMatchObject({ path: '/9301', opts: { params: { status: 'PAUSED' } } });
    expect(w.t['ai_recommendations']!.rows[0]).toMatchObject({ action: 'pause_ad', source: 'rule', status: 'applied', requires_approval: false, payload: { target: '9301', adId: '9301' }, result: 'Pausado na Meta' });
    expect(w.t['ai_recommendations']!.rows[0]!.reason).toBe('CPL de R$ 50,00 acima do teto de R$ 20,00 nos últimos 7 dias.');
    w.calls.length = 0;
    expect(await w.adsOps.runRulesForCampaign(c)).toEqual([]);  // dedupe 7 dias
    expect(w.calls.filter((x) => x.opts.method === 'POST')).toHaveLength(0);
  });

  it('sem lead depois do gasto mínimo também pausa; abaixo do mínimo ou único do conjunto não', async () => {
    const { w, c } = setup();
    perfRow(w, c, { meta_ad_id: '9301', meta_adset_id: '9101', ad_name: 'Zero', spend: 31, leads: 0 });
    perfRow(w, c, { meta_ad_id: '9302', meta_adset_id: '9101', ad_name: 'Novo', spend: 10, leads: 0 });   // abaixo do mínimo
    w.respond((path, opts) => (opts.params?.fields === 'effective_status' ? { effective_status: 'ACTIVE' } : undefined));
    expect(await w.adsOps.runRulesForCampaign(c)).toEqual(['Regra: anúncio "Zero" pausado']);
    const { w: w2, c: c2 } = setup();
    perfRow(w2, c2, { meta_ad_id: '9301', meta_adset_id: '9101', ad_name: 'Único', spend: 100, leads: 0 });
    w2.respond((path, opts) => (opts.params?.fields === 'effective_status' ? { effective_status: 'ACTIVE' } : undefined));
    expect(await w2.adsOps.runRulesForCampaign(c2)).toEqual([]);
  });

  it('só pausa o que está ACTIVE na Meta', async () => {
    const { w, c } = setup();
    perfRow(w, c, { meta_ad_id: '9301', meta_adset_id: '9101', ad_name: 'Caro', spend: 100, leads: 2 });
    perfRow(w, c, { meta_ad_id: '9302', meta_adset_id: '9101', ad_name: 'Bom', spend: 40, leads: 8 });
    w.respond((path, opts) => (opts.params?.fields === 'effective_status' ? { effective_status: 'PAUSED' } : undefined));
    expect(await w.adsOps.runRulesForCampaign(c)).toEqual([]);
  });

  it('escala o conjunto barato (+20%, teto 60) no máximo 1x a cada 24 h', async () => {
    const { w, c } = setup();
    perfRow(w, c, { meta_ad_id: '9301', meta_adset_id: '9101', adset_name: 'Conj', ad_name: 'A', spend: 40, leads: 8 }); // CPL 5 < 10, 8 leads
    w.respond((path, opts) => (path === '/9101' && opts.params?.fields ? { daily_budget: '5000', name: 'Conj', effective_status: 'ACTIVE' } : undefined));
    expect(await w.adsOps.runRulesForCampaign(c)).toEqual(['Regra: verba de "Conj" de R$ 50,00 para R$ 60,00/dia']);   // 50*1.2 = 60 (= teto)
    expect(w.calls.find((x) => x.opts.method === 'POST')!.opts.params.daily_budget).toBe(6000);
    w.calls.length = 0;
    expect(await w.adsOps.runRulesForCampaign(c)).toEqual([]);
  });

  it('duas execuções sobrepostas escalam a verba UMA vez (reserva antes da Meta)', async () => {
    const { w, c } = setup();
    perfRow(w, c, { meta_ad_id: '9301', meta_adset_id: '9101', adset_name: 'Conj', ad_name: 'A', spend: 40, leads: 8 });
    w.respond((path, opts) => (path === '/9101' && opts.params?.fields ? { daily_budget: '5000', name: 'Conj', effective_status: 'ACTIVE' } : undefined));
    const [a, b] = await Promise.all([w.adsOps.runRulesForCampaign(c), w.adsOps.runRulesForCampaign(c)]);
    expect([...a, ...b]).toHaveLength(1);
    expect(w.calls.filter((x) => x.opts.method === 'POST')).toHaveLength(1);
    expect(w.t['ai_recommendations']!.rows.filter((r) => r.source === 'rule')).toHaveLength(1);
  });

  it('se a Meta falha, a reserva é solta (a próxima rodada tenta de novo)', async () => {
    const { w, c } = setup();
    perfRow(w, c, { meta_ad_id: '9301', meta_adset_id: '9101', adset_name: 'Conj', ad_name: 'A', spend: 40, leads: 8 });
    w.respond((path, opts) => (path === '/9101' && opts.params?.fields ? { daily_budget: '5000', name: 'Conj', effective_status: 'ACTIVE' } : opts.method === 'POST' ? new Error('Meta fora') : undefined));
    await expect(w.adsOps.runRulesForCampaign(c)).rejects.toThrow('Meta fora');
    expect(w.t['ai_recommendations']!.rows.filter((r) => r.source === 'rule')).toHaveLength(0);
  });

  it('não escala com menos de 3 leads, CPL acima da meta ou já no teto; regra desligada não faz nada', async () => {
    const { w, c } = setup();
    perfRow(w, c, { meta_ad_id: '9301', meta_adset_id: '9101', spend: 10, leads: 2 });
    expect(await w.adsOps.runRulesForCampaign(c)).toEqual([]);
    c.automation_rules = { enabled: false };
    expect(await w.adsOps.runRulesForCampaign(c)).toEqual([]);
    expect(w.calls).toHaveLength(0);
    c.automation_rules = { enabled: true, scaleBelowCpl: 10, maxDailyBudget: 50 };
    perfRow(w, c, { meta_ad_id: '9302', meta_adset_id: '9102', spend: 40, leads: 8 });
    w.respond((path, opts) => (path === '/9102' && opts.params?.fields ? { daily_budget: '5000', name: 'C2', effective_status: 'ACTIVE' } : undefined));
    expect(await w.adsOps.runRulesForCampaign(c)).toEqual([]);   // 50 → teto 50: sem aumento
  });

  it('runAllRules só considera campanhas publicadas com regra ligada e isola erros', async () => {
    const { w } = setup();
    w.seedCampaign({ meta_campaign_id: '8001', automation_rules: { enabled: false } });
    const out = await w.adsOps.runAllRules();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ actions: [] });
  });
});

describe('recomendações da IA (1.4)', () => {
  it('editores geram; viewer não; empresa sem campanha publicada recebe o aviso', async () => {
    const w = adsWorld();
    expect(await status(w.adsOps.generate(VIEWER, WS_A))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await w.adsOps.generate(MARKETING, WS_A)).toEqual({ created: 0, errors: ['Nenhuma campanha publicada na Meta ainda.'] });
  });

  it('sem resultados sincronizados: erro por campanha; com resultados: valida ids do que a IA devolveu', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    expect((await w.adsOps.generate(OWNER, WS_A)).errors).toEqual([`Campanha X: Ainda não há resultados da Meta para esta campanha. Sincronize depois que ela veicular.`]);
    perfRow(w, c, { meta_ad_id: '9301', meta_adset_id: '9101', ad_name: 'A', adset_name: 'S', spend: 50, leads: 5 });
    w.respond((path) => (path === '/9101' ? { daily_budget: '3000', name: 'S', effective_status: 'ACTIVE' } : undefined));
    w.ai.json.mockResolvedValue({ recomendacoes: [
      { action: 'pause_ad', title: 'Pausar A', reason: 'caro', estimated_impact: '-10%', severity: 'high', target_ad_id: '9301', target_adset_id: '', new_daily_budget: 0 },
      { action: 'pause_ad', title: 'Id inventado', reason: 'x', estimated_impact: '', severity: 'low', target_ad_id: '666', target_adset_id: '', new_daily_budget: 0 },
      { action: 'increase_budget', title: 'Sem valor', reason: 'x', estimated_impact: '', severity: 'low', target_ad_id: '', target_adset_id: '9101', new_daily_budget: 0 },
      { action: 'increase_budget', title: 'Mais verba', reason: 'bom', estimated_impact: '+5 leads', severity: 'medium', target_ad_id: '', target_adset_id: '9101', new_daily_budget: 36 },
      { action: 'new_audience', title: 'Novo público', reason: 'x', estimated_impact: '', severity: 'weird', target_ad_id: '', target_adset_id: '', new_daily_budget: 0 },
    ] });
    expect(await w.adsOps.generate(OWNER, WS_A, c.id)).toEqual({ created: 3, errors: [] });
    const rows = w.t['ai_recommendations']!.rows;
    expect(rows.map((r) => r.title)).toEqual(['Pausar A', 'Mais verba', 'Novo público']);
    expect(rows[0]).toMatchObject({ status: 'pending', source: 'ai', requires_approval: true, payload: { executable: true, adId: '9301', adsetId: null, newDailyBudget: null } });
    expect(rows[1]!.payload).toMatchObject({ executable: true, adsetId: '9101', newDailyBudget: 36, currentDailyBudget: 30 });
    expect(rows[2]).toMatchObject({ severity: 'medium', payload: { executable: false } });
    const prompt = w.ai.json.mock.calls[0]![1].prompt as string;
    expect(prompt).toContain('últimos 14 dias');
    expect(prompt).toContain('"id":"9301"');
  });
});

describe('idempotência e frescor (fix round 1)', () => {
  it('generate duas vezes não duplica pendentes (mesma campanha + ação + alvo)', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    perfRow(w, c, { meta_ad_id: '9301', meta_adset_id: '9101', ad_name: 'A', adset_name: 'S', spend: 50, leads: 5 });
    w.respond((path) => (path === '/9101' ? { daily_budget: '3000', name: 'S', effective_status: 'ACTIVE' } : undefined));
    w.ai.json.mockResolvedValue({ recomendacoes: [
      { action: 'pause_ad', title: 'Pausar A', reason: 'caro', estimated_impact: '', severity: 'high', target_ad_id: '9301', target_adset_id: '', new_daily_budget: 0 },
      { action: 'pause_ad', title: 'Pausar A (de novo)', reason: 'caro', estimated_impact: '', severity: 'high', target_ad_id: '9301', target_adset_id: '', new_daily_budget: 0 },
    ] });
    expect((await w.adsOps.generate(OWNER, WS_A, c.id)).created).toBe(1);
    expect((await w.adsOps.generate(OWNER, WS_A, c.id)).created).toBe(0);
    expect(w.t['ai_recommendations']!.rows).toHaveLength(1);
  });

  it('applying preso: vencida volta a pending e pode ser aplicada; viva nunca é tocada nem aplicada de novo', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    const mk = (over: Record<string, any>) => { const r: any = { id: uid(), workspace_id: WS_A, campaign_id: c.id, action: 'pause_ad', title: 't', reason: 'r', status: 'applying', source: 'ai', payload: { executable: true, adId: '9301' }, created_at: new Date(), ...over }; w.t['ai_recommendations']!.rows.push(r); return r; };
    const live = mk({ applying_at: new Date() });
    expect(await status(w.adsOps.decide(OWNER, live.id, 'apply'))).toBe('400:Esta recomendação já foi decidida.');
    expect(live.status).toBe('applying');
    expect(w.calls.filter((x) => x.opts.method === 'POST')).toHaveLength(0);
    const stale = mk({ applying_at: new Date(Date.now() - 11 * 60 * 1000) });
    const legacy = mk({ applying_at: null });
    expect(await w.adsOps.recoverStaleApplying(WS_A)).toBe(2);
    expect([live.status, stale.status, legacy.status]).toEqual(['applying', 'pending', 'pending']);
    const r = await w.adsOps.decide(OWNER, stale.id, 'apply');
    expect(r.result).toBe('Anúncio pausado na Meta.');
    expect(stale).toMatchObject({ status: 'applied', applying_at: null });
  });

  it('applyRecommendation recupera a presa da própria empresa antes de reservar', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    const r: any = { id: uid(), workspace_id: WS_A, campaign_id: c.id, action: 'pause_ad', title: 't', reason: 'r', status: 'applying', source: 'ai', payload: { executable: true, adId: '9301' }, created_at: new Date(), applying_at: new Date(Date.now() - 20 * 60 * 1000) };
    w.t['ai_recommendations']!.rows.push(r);
    expect((await w.adsOps.decide(ADMIN, r.id, 'apply')).result).toBe('Anúncio pausado na Meta.');
  });

  it('syncNow: segunda chamada em 60 s da mesma empresa devolve aviso sem chamar a Meta; outra empresa e falha não são freadas', async () => {
    const w = adsWorld();
    publishedCamp(w);
    const first = await w.adsOps.syncNow(VIEWER, WS_A);
    expect(first).not.toHaveProperty('message');
    const calls = w.calls.length;
    expect(await w.adsOps.syncNow(OWNER, WS_A)).toEqual({ campaigns: 0, rows: 0, message: 'Sincronização feita há pouco — aguarde um minuto.' });
    expect(w.calls).toHaveLength(calls);
    jest.useFakeTimers({ now: Date.now() + 61_000, doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    try { expect(await w.adsOps.syncNow(OWNER, WS_A)).not.toHaveProperty('message'); } finally { jest.useRealTimers(); }
  });
});

describe('decidir recomendação (2.2)', () => {
  const rec = (w: ReturnType<typeof adsWorld>, c: any, over: Record<string, any> = {}) => {
    const r: any = { id: uid(), workspace_id: WS_A, campaign_id: c.id, action: 'pause_ad', title: 't', reason: 'r', status: 'pending', source: 'ai', payload: { executable: true, adId: '9301' }, created_at: new Date(), ...over };
    w.t['ai_recommendations']!.rows.push(r);
    return r;
  };

  it('só owner|admin decidem; recomendação de outra empresa = "não encontrada"', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    const r = rec(w, c);
    expect(await status(w.adsOps.decide(MARKETING, r.id, 'apply'))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.adsOps.decide(VIEWER, r.id, 'dismiss'))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.adsOps.decide(STRANGER, r.id, 'apply'))).toBe('404:Recomendação não encontrada.');
    expect(await status(w.adsOps.decide(OWNER, uid(), 'apply'))).toBe('404:Recomendação não encontrada.');
    expect(r.status).toBe('pending');
    expect(w.calls).toHaveLength(0);
  });

  it('descartar marca "dismissed"; decidir de novo é recusado (e uma aplicada não vira descartada)', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    const r = rec(w, c);
    expect(await w.adsOps.decide(ADMIN, r.id, 'dismiss')).toEqual({ result: 'Descartada.' });
    expect(r.status).toBe('dismissed');
    expect(await status(w.adsOps.decide(ADMIN, r.id, 'dismiss'))).toBe('400:Esta recomendação já foi decidida.');
    expect(await status(w.adsOps.decide(ADMIN, r.id, 'apply'))).toBe('400:Esta recomendação já foi decidida.');
    const applied = rec(w, c, { status: 'applied' });
    expect(await status(w.adsOps.decide(ADMIN, applied.id, 'dismiss'))).toBe('400:Esta recomendação já foi decidida.');
    expect(applied.status).toBe('applied');
  });

  it('aplicar pausa o anúncio na Meta, registra quem aplicou e o resultado', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    const r = rec(w, c);
    expect(await w.adsOps.decide(OWNER, r.id, 'apply')).toEqual({ result: 'Anúncio pausado na Meta.' });
    expect(w.calls).toEqual([expect.objectContaining({ ws: WS_A, path: '/9301', opts: expect.objectContaining({ method: 'POST', params: { status: 'PAUSED' } }) })]);
    expect(r).toMatchObject({ status: 'applied', applied_by: OWNER, result: 'Anúncio pausado na Meta.' });
    expect(r.applied_at).toBeInstanceOf(Date);
  });

  it('aumento de verba é limitado a +30% sobre a verba atual', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    const r = rec(w, c, { action: 'increase_budget', payload: { executable: true, adsetId: '9101', newDailyBudget: 100 } });
    w.respond((path, opts) => (path === '/9101' && opts.params?.fields ? { daily_budget: '5000', name: 'S', effective_status: 'ACTIVE' } : undefined));
    expect(await w.adsOps.decide(OWNER, r.id, 'apply')).toEqual({ result: 'Verba do conjunto alterada de R$ 50,00 para R$ 65,00/dia na Meta.' });
    expect(w.calls.find((x) => x.opts.method === 'POST')!.opts.params.daily_budget).toBe(6500);
  });

  it('ação manual só registra; alvo que não é da campanha é recusado SEM chamar a Meta e volta a pendente', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    const manual = rec(w, c, { action: 'create_variation', payload: { executable: false } });
    expect((await w.adsOps.decide(OWNER, manual.id, 'apply')).result).toMatch(/^Registrada\./);
    expect(w.calls).toHaveLength(0);
    const alien = rec(w, c, { payload: { executable: true, adId: '1234567' } });
    expect(await status(w.adsOps.decide(OWNER, alien.id, 'apply'))).toBe('400:Recomendação sem alvo válido.');
    expect(alien.status).toBe('pending');
    const bad = rec(w, c, { payload: { executable: true, adId: '../me' } });
    expect(await status(w.adsOps.decide(OWNER, bad.id, 'apply'))).toBe('400:Recomendação sem alvo válido.');
    expect(w.calls).toHaveLength(0);
  });

  it('falha na Meta devolve a recomendação para "pending" (dá para tentar de novo)', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    const r = rec(w, c);
    w.respond(() => new MetaError('Limite de chamadas da Meta atingido. Aguarde alguns minutos e tente de novo.', 4));
    expect(await status(w.adsOps.decide(OWNER, r.id, 'apply'))).toBe('502:Limite de chamadas da Meta atingido. Aguarde alguns minutos e tente de novo.');
    expect(r.status).toBe('pending');
  });

  it('dois "Aplicar" simultâneos executam UMA vez', async () => {
    const w = adsWorld();
    const c = publishedCamp(w);
    const r = rec(w, c);
    const orig = w.graphClient.graph.getMockImplementation()!;
    w.graphClient.graph.mockImplementation(async (...a: any[]) => { await new Promise((x) => setTimeout(x, 10)); return orig(...a); });
    const out = await Promise.allSettled([w.adsOps.decide(OWNER, r.id, 'apply'), w.adsOps.decide(ADMIN, r.id, 'apply')]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(w.calls.filter((x) => x.opts.method === 'POST')).toHaveLength(1);
  });
});

describe('configuração dos anúncios (2.4–2.6)', () => {
  it('editores salvam; viewer e empresa alheia não; saneia chaves, ids e URL', async () => {
    const w = adsWorld();
    const c = w.seedCampaign();
    const d = { campaignId: c.id, adsConfig: { structure: 'hack', cta: 'NOPE', placements: ['instagram_feed', 'x'], advantageAudience: 'sim', carousel: true, customAudienceIds: ['123456', '../x', 42], lookalikeSourceId: 'abc', extra: 1 }, rules: { enabled: true, maxCpl: '15,5', minSpendToJudge: 1, scaleStepPct: 99, bogus: true }, privacyUrl: 'https://s.test/p' };
    expect(await status(w.adsOps.saveSettings(VIEWER, d))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.adsOps.saveSettings(STRANGER, d))).toBe('404:Campanha não encontrada.');
    expect(await w.adsOps.saveSettings(MARKETING, d)).toEqual({ ok: true });
    expect(c.ads_config).toEqual({ structure: 'single', cta: 'LEARN_MORE', placements: ['instagram_feed'], advantageAudience: false, carousel: true, customAudienceIds: ['123456'], excludeAudienceIds: [], lookalikeSourceId: null, useStrategyAudiences: true, privacyUrl: 'https://s.test/p' });
    expect(c.automation_rules).toEqual({ enabled: true, maxCpl: null, minSpendToJudge: 5, scaleBelowCpl: null, scaleStepPct: 30, maxDailyBudget: null });
    expect(await status(w.adsOps.saveSettings(OWNER, { ...d, privacyUrl: 'javascript:alert(1)' }))).toBe('400:O link da política de privacidade é inválido.');
  });

  it('sanitizeAdsConfig/Rules: padrões do protótipo', () => {
    expect(sanitizeAdsConfig({})).toMatchObject({ structure: 'single', cta: 'LEARN_MORE', placements: 'auto', useStrategyAudiences: true });
    expect(sanitizeAdsConfig({ placements: [] }).placements).toBe('auto');
    expect(sanitizeRules({ maxCpl: 12.5, scaleBelowCpl: 8, maxDailyBudget: 70, scaleStepPct: 10, minSpendToJudge: 40, enabled: true })).toEqual({ enabled: true, maxCpl: 12.5, minSpendToJudge: 40, scaleBelowCpl: 8, scaleStepPct: 10, maxDailyBudget: 70 });
  });
});

describe('públicos (listMetaAudiences / syncCrmCustomerAudience)', () => {
  it('lista os públicos da conta (qualquer membro)', async () => {
    const w = adsWorld();
    w.respond((path) => (path.endsWith('/customaudiences') ? { data: [{ id: 11, name: 'A', subtype: 'CUSTOM', approximate_count_lower_bound: 1000 }, { id: 12, name: 'B' }] } : undefined));
    expect(await w.adsOps.listAudiences(VIEWER, WS_A)).toEqual([{ id: '11', name: 'A', subtype: 'CUSTOM', size: 1000 }, { id: '12', name: 'B', subtype: '', size: null }]);
    expect(await status(w.adsOps.listAudiences(STRANGER, WS_A))).toBe('403:Você não tem acesso a esta empresa.');
  });

  it('CRM → Meta: só owner|admin; hash SHA-256 normalizado; descadastrados e outras empresas ficam de fora; guarda o id cifrado e reaproveita', async () => {
    const w = adsWorld();
    const won = uid();
    w.t['crm_stages']!.rows.push({ id: won, workspace_id: WS_A, is_won: true }, { id: uid(), workspace_id: WS_A, is_won: false });
    w.t['crm_leads']!.rows.push(
      { id: uid(), workspace_id: WS_A, email: ' Ana@Teste.com ', phone: '(11) 99999-0000', stage_id: won, unsubscribed: false },
      { id: uid(), workspace_id: WS_A, email: null, phone: null, stage_id: won, unsubscribed: false },
      { id: uid(), workspace_id: WS_A, email: 'x@x.com', phone: null, stage_id: won, unsubscribed: true },
      { id: uid(), workspace_id: WS_A, email: 'perdido@x.com', phone: null, stage_id: uid(), unsubscribed: false },
      { id: uid(), workspace_id: WS_B, email: 'outra@x.com', phone: null, stage_id: won, unsubscribed: false },
    );
    expect(await status(w.adsOps.syncCrmAudience(MARKETING, WS_A, false))).toBe('403:Seu perfil não tem permissão para esta ação.');
    w.respond((path, opts) => (path.endsWith('/customaudiences') && opts.method === 'POST' ? { id: '5005' } : undefined));
    const r = await w.adsOps.syncCrmAudience(ADMIN, WS_A, true);
    expect(r).toEqual({ id: '5005', uploaded: 1 });
    const up = w.calls.find((x) => x.path === '/5005/users')!;
    const { createHash } = await import('node:crypto');
    const h = (v: string) => createHash('sha256').update(v).digest('hex');
    expect(up.opts.params.payload).toEqual({ schema: ['EMAIL', 'PHONE'], data: [[h('ana@teste.com'), h('11999990000')]] });
    expect(w.calls.find((x) => x.path.endsWith('/customaudiences'))!.opts.params.name).toBe('Clientes do CRM (ganhos)');
    expect(await w.vault.get(WS_A, 'META_AUDIENCE_CRM_WON')).toBe('5005');
    expect([...w.store.rows.values()].join('')).not.toContain('5005');
    w.calls.length = 0;
    await w.adsOps.syncCrmAudience(ADMIN, WS_A, true);
    expect(w.calls.filter((x) => x.path.endsWith('/customaudiences'))).toHaveLength(0);   // reaproveita o público
    expect(w.calls.find((x) => x.path === '/5005/users')).toBeTruthy();
  });

  it('mensagens: sem etapa de ganho / sem contatos', async () => {
    const w = adsWorld();
    expect(await status(w.adsOps.syncCrmAudience(OWNER, WS_A, true))).toBe('400:Nenhuma etapa marcada como ganho no funil do CRM.');
    expect(await status(w.adsOps.syncCrmAudience(OWNER, WS_A, false))).toBe('400:Nenhum lead com e-mail ou telefone no CRM.');
    expect(w.crm.ensure).toHaveBeenCalledWith(WS_A);
  });
});
