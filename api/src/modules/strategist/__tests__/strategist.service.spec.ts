import { AiError } from '../../ai/ai-error';
import { MARKETING, OWNER, seedCampaign, status, STRANGER, VIEWER, WS_A, world } from '../../campaigns/__tests__/world';
import { normalizeStrategy, strategyBrief, STRATEGY_SCHEMA } from '../strategist.prompt';
import { StrategistService } from '../strategist.service';

const RAW = {
  resumo_executivo: 'R', problema: 'P', objetivo_smart: 'O', icp: 'I', oferta: 'F', big_idea: 'Chopp que une', mensagem_principal: 'M',
  funil: 'Fu', canais: 'Meta', plano_testes: 'T', cronograma: 'C', hipoteses: ['h1'], recomendacoes: ['r1'],
  objecoes: [{ objecao: 'caro', resposta: 'vale' }],
  distribuicao_verba: [{ destino: 'Meta', percentual: 70 }, { destino: 'Google', percentual: 30 }],
  kpis: [{ nome: 'CPL', meta: 'R$ 10' }],
  angulos_detalhados: [{ nome: 'Promo', dor_ou_desejo: 'economia', mensagem: 'Chopp em dobro', gancho: 'Dobrou', formato_sugerido: 'reels', etapa_funil: 'topo' }],
  publicos_meta: [{ nome: 'Frio', tipo: 'frio', interesses: ['bar'], descricao: 'd' }],
  briefing_criativo: { direcao_visual: 'copos', formatos: ['story'], quantidade_por_angulo: 2, cta: 'Venha' },
  briefing_video: { duracao_segundos: 15, roteiro: 'rot', cenas: ['c1'] },
  plano_instagram: { pilares: [{ nome: 'Bastidores', peso: 3 }, { nome: 'Promo', peso: 1 }], temas: ['t1', 't2'], frequencia: { feed: 5, reels: 3, stories: 10 } },
};

function setup(ai: any = { json: async () => RAW }) {
  const w = world();
  const calls: any[] = [];
  const fakeAi: any = { json: async (ws: string, req: any) => { calls.push([ws, req]); return typeof ai.json === 'function' ? ai.json(ws, req) : ai; } };
  const svc = new StrategistService(w.prisma, fakeAi, w.guards, w.access, w.activity);
  return { w, svc, calls };
}

describe('StrategistService.generate', () => {
  it('monta o prompt com marca/personas/produtos/aprendizados/histórico, chama a IA com o schema estrito e salva v1 em rascunho', async () => {
    const { w, svc, calls } = setup();
    const { brand, campaign } = await seedCampaign(w, { offer_product: 'Chopp', budget_total: 3000, start_date: new Date('2026-10-05T00:00:00Z') });
    await w.t.personas.create({ data: { workspace_id: WS_A, brand_id: brand.id, name: 'Ana', age_range: '25-35' } });
    await w.t.products.create({ data: { workspace_id: WS_A, brand_id: brand.id, name: 'Chopp', price: 12 } });
    await w.t.brand_learnings.create({ data: { workspace_id: WS_A, brand_id: brand.id, category: 'copy', value: 'humor', score: 9 } });
    // campanha antiga da marca, com resultado real e outra só demo
    const old = await w.t.campaigns.create({ data: { workspace_id: WS_A, brand_id: brand.id, name: 'Antiga', objective: 'sales' } });
    await w.t.performance_daily.create({ data: { workspace_id: WS_A, campaign_id: old.id, spend: 200, impressions: 1000, clicks: 50, leads: 10, conversions: 2, revenue: 600, source: 'meta' } });
    await w.t.performance_daily.create({ data: { workspace_id: WS_A, campaign_id: old.id, spend: 999, source: 'demo' } });

    const r = await svc.generate(MARKETING, campaign.id);
    expect(r.version).toBe(1);
    expect(r.content.big_idea).toBe('Chopp que une');
    const [ws, req] = calls[0];
    expect(ws).toBe(WS_A);
    expect(req.name).toBe('campaign_strategy');
    expect(req.schema).toBe(STRATEGY_SCHEMA);
    expect(req.prompt).toContain('Você é o estrategista-chefe de uma agência de marketing digital de performance no Brasil.');
    expect(req.prompt).toContain('MARCA: {"nome":"Bar do Zé"');
    expect(req.prompt).toContain('"tom_de_voz":"descontraído"');
    expect(req.prompt).toMatch(/PERSONAS: \[\{.*"name":"Ana","age_range":"25-35"/);
    expect(req.prompt).toMatch(/PRODUTOS: \[\{.*"name":"Chopp","price":12/);
    expect(req.prompt).toContain('"objetivo":"Leads"');
    expect(req.prompt).toContain('"inicio":"2026-10-05"');
    expect(req.prompt).toContain('"verba_total":3000');
    expect(req.prompt).toMatch(/APRENDIZADOS DA MARCA: \[\{.*"category":"copy","value":"humor"/);
    expect(req.prompt).toContain('RESULTADOS ANTERIORES: [{"campanha":"Antiga","objetivo":"Vendas / Conversão","gasto":200,"ctr":5,"cpl":20,"roas":3}]');
    expect(w.t.campaign_strategies.rows[0]).toMatchObject({ campaign_id: campaign.id, status: 'draft', version: 1 });
    expect(w.logs.at(-1)).toEqual([WS_A, MARKETING, 'campaign.strategy_generated', 'campaign', { campaign_id: campaign.id, version: 1 }]);
  });

  it('regerar cria nova versão (v2) sem apagar a anterior', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    await svc.generate(OWNER, campaign.id);
    const r2 = await svc.generate(OWNER, campaign.id);
    expect(r2.version).toBe(2);
    expect(w.t.campaign_strategies.rows.map((s) => s.version)).toEqual([1, 2]);
  });

  it('versão concorrente: P2002 recalcula max+1 e tenta de novo (sem duplicar a versão)', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    const real = w.t.campaign_strategies.create.bind(w.t.campaign_strategies);
    let calls = 0;
    w.t.campaign_strategies.create = (async (args: any) => {
      calls++;
      if (calls === 1) {
        await real({ data: { workspace_id: WS_A, campaign_id: campaign.id, content: {}, status: 'draft', version: 1 } }); // outra geração gravou a v1 primeiro
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      }
      return real(args);
    }) as any;
    const r = await svc.generate(OWNER, campaign.id);
    expect(r.version).toBe(2);
    expect(w.t.campaign_strategies.rows.map((s) => s.version)).toEqual([1, 2]);
    expect(w.logs.at(-1)![4]).toEqual({ campaign_id: campaign.id, version: 2 });
  });

  it('autorização: viewer 403, de outro workspace 404, id malformado 404 — e a IA nem é chamada', async () => {
    const { w, svc, calls } = setup();
    const { campaign } = await seedCampaign(w);
    expect(await status(svc.generate(VIEWER, campaign.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(svc.generate(STRANGER, campaign.id))).toBe('404:Campanha não encontrada.');
    expect(await status(svc.generate(OWNER, 'xxx'))).toBe('404:Campanha não encontrada.');
    expect(calls).toHaveLength(0);
  });

  it('resposta incompleta (sem big_idea ou sem ângulos) → AiError e nada é salvo', async () => {
    for (const raw of [{ ...RAW, big_idea: '' }, { ...RAW, angulos_detalhados: [] }]) {
      const { w, svc } = setup({ json: async () => raw });
      const { campaign } = await seedCampaign(w);
      const e: any = await svc.generate(OWNER, campaign.id).catch((x) => x);
      expect(e).toBeInstanceOf(AiError);
      expect(e.getResponse().message).toBe('A IA não devolveu uma estratégia completa. Tente de novo.');
      expect(w.t.campaign_strategies.rows).toHaveLength(0);
    }
  });

  it('erro da IA (créditos/config) sobe com a mensagem original', async () => {
    const { w, svc } = setup({ json: async () => { throw new AiError('IA do app não configurada.', 'AI_NOT_CONFIGURED'); } });
    const { campaign } = await seedCampaign(w);
    expect(await status(svc.generate(OWNER, campaign.id))).toBe('502:IA do app não configurada.');
  });
});

describe('normalizeStrategy / strategyBrief', () => {
  it('converte listas em mapas (verba, kpis), deriva `angulos` e preenche gerado_por/gerado_em', () => {
    const s = normalizeStrategy(RAW, new Date('2026-10-02T12:00:00Z'))!;
    expect(s.distribuicao_verba).toEqual({ Meta: 70, Google: 30 });
    expect(s.kpis).toEqual({ CPL: 'R$ 10' });
    expect(s.angulos).toEqual(['Promo: Chopp em dobro']);
    expect(s.gerado_por).toBe('IA');
    expect(s.gerado_em).toBe('2026-10-02T12:00:00.000Z');
  });

  it('strategyBrief: sem ângulo traz todos; com ângulo traz só ele; limita objeções a 4', () => {
    const s = normalizeStrategy({ ...RAW, objecoes: Array.from({ length: 6 }, (_, i) => ({ objecao: `o${i}`, resposta: 'r' })) })!;
    expect(strategyBrief(null)).toBeNull();
    const all = strategyBrief(s)!;
    expect(all.angulo).toBeNull();
    expect(all.angulos).toEqual([{ nome: 'Promo', gancho: 'Dobrou', mensagem: 'Chopp em dobro' }]);
    expect(all.objecoes).toHaveLength(4);
    const one = strategyBrief(s, 'Promo')!;
    expect(one.angulo?.nome).toBe('Promo');
    expect(one.angulos).toBeUndefined();
    expect(strategyBrief(s, 'Inexistente')!.angulo).toBeNull();
  });
});

describe('StrategistService.approve — versionamento', () => {
  it('aprovar a v2 marca a v1 aprovada como superseded; outras campanhas ficam intactas', async () => {
    const { w, svc } = setup();
    const { campaign, brand } = await seedCampaign(w);
    const other = await w.t.campaigns.create({ data: { workspace_id: WS_A, brand_id: brand.id, name: 'Outra' } });
    const s1 = await w.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: 1, status: 'approved', content: {} } });
    const s2 = await w.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: 2, status: 'draft', content: {} } });
    const o1 = await w.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: other.id, version: 1, status: 'approved', content: {} } });
    expect(await svc.approve(MARKETING, s2.id)).toEqual({ ok: true });
    const st = (id: string) => w.t.campaign_strategies.rows.find((r) => r.id === id)!.status;
    expect([st(s1.id), st(s2.id), st(o1.id)]).toEqual(['superseded', 'approved', 'approved']);
    expect(w.logs.at(-1)).toEqual([WS_A, MARKETING, 'campaign.strategy_approved', 'campaign', { campaign_id: campaign.id, version: 2 }]);
  });

  it('viewer 403; estranho e id inexistente/malformado 404 "Estratégia não encontrada."', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    const s = await w.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: 1, content: {} } });
    expect(await status(svc.approve(VIEWER, s.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(svc.approve(STRANGER, s.id))).toBe('404:Estratégia não encontrada.');
    expect(await status(svc.approve(OWNER, 'xxx'))).toBe('404:Estratégia não encontrada.');
    expect(w.t.campaign_strategies.rows[0]!.status).toBe('draft');
  });
});

describe('StrategistService.currentStrategy / createIgPlan', () => {
  it('a aprovada vence a mais nova; sem aprovada vale a última versão; só dentro do workspace', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    await w.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: 1, status: 'approved', content: { big_idea: 'v1' } } });
    await w.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: 2, status: 'draft', content: { big_idea: 'v2' } } });
    expect((await svc.currentStrategy(WS_A, campaign.id))!.big_idea).toBe('v1');
    expect(await svc.currentStrategy('00000000-0000-4000-8000-000000000000', campaign.id)).toBeNull();
    expect(await svc.currentStrategy(WS_A, null)).toBeNull();
    w.t.campaign_strategies.rows[0]!.status = 'superseded';
    expect((await svc.currentStrategy(WS_A, campaign.id))!.big_idea).toBe('v2');
  });

  it('cria o plano do Instagram: pesos normalizados, frequência derivada, tom da marca, rascunho com aprovação', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    await w.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: 1, status: 'approved', content: normalizeStrategy(RAW) } });
    const { planId } = await svc.createIgPlan(MARKETING, campaign.id);
    const plan = w.t.ig_content_plans.rows.find((p) => p.id === planId)!;
    expect(plan).toMatchObject({
      name: 'Instagram · Black Friday', objective: 'O', tone_of_voice: 'descontraído', content_pillars: ['Bastidores', 'Promo'],
      pillar_weights: { Bastidores: 0.75, Promo: 0.25 }, cta_default: 'Venha', requires_approval: true, auto_publish: false, status: 'draft',
      posting_frequency: { feed_image: 3, feed_carousel: 2, feed: 5, reels: 3, stories: 10 },
    });
    expect(plan.hashtag_strategy).toEqual({ notes: 'Temas da campanha: t1; t2', audience: 'I' });
  });

  it('sem estratégia → "Gere a estratégia da campanha primeiro."; sem plano → pede para regerar; viewer 403', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    expect(await status(svc.createIgPlan(OWNER, campaign.id))).toBe('400:Gere a estratégia da campanha primeiro.');
    await w.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: 1, content: { big_idea: 'x' } } });
    expect(await status(svc.createIgPlan(OWNER, campaign.id))).toBe('400:Esta versão da estratégia não tem plano do Instagram. Regere a estratégia.');
    expect(await status(svc.createIgPlan(VIEWER, campaign.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(svc.createIgPlan(STRANGER, campaign.id))).toBe('404:Campanha não encontrada.');
    expect(w.t.ig_content_plans.rows).toHaveLength(0);
  });
});
