import { WS_A, WS_B } from '../../media/__tests__/mem';
import { igServices, igWorld, seedPost, uuid } from './harness';

function world() {
  const w = igWorld();
  const s = igServices(w);
  const brand = { id: uuid(), workspace_id: WS_A, name: 'Zé' };
  w.t['brands']!.rows.push(brand);
  const plan = { id: uuid(), workspace_id: WS_A, brand_id: brand.id, objective: 'objetivo do plano' };
  w.t['ig_content_plans']!.rows.push(plan);
  return { w, s, brand, plan };
}

describe('PostContextService (contexto completo do post, sempre dentro da empresa)', () => {
  it('produto, persona (dores/desejos), pilar, funil, objetivo e estratégia da execução, campanha (oferta + estratégia aprovada) e data', async () => {
    const { w, s, brand, plan } = world();
    const prod = { id: uuid(), workspace_id: WS_A, brand_id: brand.id, name: 'Chope Pilsen', description: 'claro', price: '12.90' };
    w.t['products']!.rows.push(prod);
    w.t['personas']!.rows.push({ id: uuid(), workspace_id: WS_A, brand_id: brand.id, name: 'Ana', pains: 'sem tempo', desires: 'relaxar' });
    const camp = { id: uuid(), workspace_id: WS_A, offer_product: 'Chope em dobro', offer_promise: 'até as 20h' };
    w.t['campaigns']!.rows.push(camp);
    s.strategist.currentStrategy.mockResolvedValue({ big_idea: 'Dobradinha', mensagem_principal: 'm', angulos_detalhados: [], objecoes: [], briefing_criativo: { direcao_visual: 'copos cheios', cta: 'Venha' } });
    const run = { id: uuid(), workspace_id: WS_A, plan_id: plan.id, focus: 'Lotar o happy hour de sexta', campaign_id: camp.id, strategy: { mensagem_central: 'O melhor chope', publico_foco: 'adultos', proibicoes: ['preço baixo'] } };
    w.t['ig_auto_runs']!.rows.push(run);
    const post = seedPost(w, { run_id: run.id, plan_id: plan.id, product_id: prod.id, persona: 'Ana', pillar: 'Bastidores', funnel_stage: 'conversao', scheduled_at: new Date('2099-01-02T21:00:00Z') });
    expect(await s.postContext.build(post, brand.id)).toEqual({
      product: { name: 'Chope Pilsen', description: 'claro', price: 12.9 },
      pillar: 'Bastidores',
      persona: { name: 'Ana', pains: 'sem tempo', desires: 'relaxar' },
      funnelStage: 'conversao',
      objective: 'Lotar o happy hour de sexta',
      strategy: { mensagem_central: 'O melhor chope', publico_foco: 'adultos', proibicoes: ['preço baixo'] },
      campaign: { offer: 'Chope em dobro', promise: 'até as 20h', brief: expect.objectContaining({ big_idea: 'Dobradinha', direcao_visual: 'copos cheios' }) },
      scheduledAt: '2099-01-02T21:00:00.000Z',
    });
    expect(s.strategist.currentStrategy).toHaveBeenCalledWith(WS_A, camp.id);
  });

  it('produto, campanha e execução de OUTRA empresa nunca entram; sem execução vale o objetivo do plano e o nome do produto do briefing', async () => {
    const { w, s, brand, plan } = world();
    const alienProd = { id: uuid(), workspace_id: WS_B, brand_id: uuid(), name: 'Alheio', description: null, price: 1 };
    const alienCamp = { id: uuid(), workspace_id: WS_B, offer_product: 'Oferta alheia', offer_promise: null };
    w.t['products']!.rows.push(alienProd);
    w.t['campaigns']!.rows.push(alienCamp);
    const post = seedPost(w, { plan_id: plan.id, product_id: alienProd.id, persona: 'Bia', creative_brief: { campaign_id: alienCamp.id, product_name: 'Chope da Casa', pillar: 'Promo', funnel_stage: 'atracao' } });
    const ctx = await s.postContext.build(post, brand.id);
    expect(ctx).toMatchObject({ product: { name: 'Chope da Casa', description: null, price: null }, campaign: null, objective: 'objetivo do plano', strategy: null, pillar: 'Promo', funnelStage: 'atracao', persona: { name: 'Bia', pains: null, desires: null } });
    expect(s.strategist.currentStrategy).not.toHaveBeenCalled();
  });
});
