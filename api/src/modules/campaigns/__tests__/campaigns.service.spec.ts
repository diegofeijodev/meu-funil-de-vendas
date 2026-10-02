import { CampaignsService } from '../campaigns.service';
import { MARKETING, OWNER, seedCampaign, status, WS_A, WS_B, world } from './world';

function setup() {
  const w = world();
  return { w, svc: new CampaignsService(w.prisma, w.activity, w.guards) };
}
const dto = (brand_id: string, extra: Record<string, unknown> = {}) => ({
  brand_id, name: '  Lançamento  ', objective: 'leads', audience: { persona: 'Ana', idade: '25-45' }, formats: ['static_image', 'video'],
  offer_product: 'Chopp', offer_price: 12.5, budget_total: 3000, budget_daily: 100, start_date: '2026-10-05', end_date: null, ...extra,
}) as any;

describe('CampaignsService — wizard e leituras', () => {
  it('cria SEMPRE em rascunho (trim do nome, datas só-dia) e grava campaign.created', async () => {
    const { w, svc } = setup();
    const { brand } = await seedCampaign(w);
    const c = await svc.create(OWNER, WS_A, dto(brand.id));
    expect(c.status).toBe('draft');
    expect(c.name).toBe('Lançamento');
    expect(c.start_date).toEqual(new Date('2026-10-05T00:00:00.000Z'));
    expect(c.end_date).toBeNull();
    expect(w.logs.at(-1)).toEqual([WS_A, OWNER, 'campaign.created', 'campaign', { campaign_id: c.id, name: 'Lançamento' }]);
  });

  it('marca de OUTRO workspace → 404; nome em branco → 400', async () => {
    const { w, svc } = setup();
    const other = await w.t.brands.create({ data: { workspace_id: WS_B, name: 'Alheia' } });
    expect(await status(svc.create(OWNER, WS_A, dto(other.id)))).toBe('404:Marca não encontrada.');
    const { brand } = await seedCampaign(w);
    expect(await status(svc.create(OWNER, WS_A, dto(brand.id, { name: '   ' })))).toBe('400:Informe o nome da campanha.');
  });

  it('lista com `brands(name)` só do workspace; get com `brands(*)`; de outro workspace → 404', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    const bOther = await w.t.brands.create({ data: { workspace_id: WS_B, name: 'B' } });
    const cOther = await w.t.campaigns.create({ data: { workspace_id: WS_B, brand_id: bOther.id, name: 'Alheia' } });
    const list = await svc.list(WS_A);
    expect(list).toHaveLength(1);
    expect((list[0] as any).brands.name).toBe('Bar do Zé');
    expect((await svc.get(WS_A, campaign.id) as any).brands.segment).toBe('Bar');
    expect(await status(svc.get(WS_A, cOther.id))).toBe('404:Campanha não encontrada.');
  });

  it('detail traz estratégia/copy mais novas, criativos, perf sem demo e custos', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    for (const version of [1, 2]) {
      await w.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version, content: { v: version } } });
      await w.t.copies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version, content: { v: version } } });
    }
    await w.t.creatives.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, title: 'C1' } });
    await w.t.performance_daily.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, spend: 10, source: 'demo' } });
    await w.t.performance_daily.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, spend: 20, source: 'meta' } });
    await w.t.campaign_costs.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, amount: 5 } });
    const d = await svc.detail(WS_A, campaign.id);
    expect((d.strategy as any).version).toBe(2);
    expect((d.copy as any).version).toBe(2);
    expect(d.creatives).toHaveLength(1);
    expect(d.perf.map((p: any) => p.spend)).toEqual([20]);
    expect(d.costs).toHaveLength(1);
    expect(await status(svc.detail(WS_B, campaign.id))).toBe('404:Campanha não encontrada.');
  });

  it('createCopy: versão = anterior + 1, status draft, atividade campaign.copy_generated; campanha alheia → 404', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    const v1 = await svc.createCopy(MARKETING, WS_A, campaign.id, { content: { headline: 'A' } });
    const v2 = await svc.createCopy(MARKETING, WS_A, campaign.id, { content: { headline: 'B' } });
    expect([v1.version, v2.version, v2.status]).toEqual([1, 2, 'draft']);
    expect(w.logs.filter((l) => l[2] === 'campaign.copy_generated')).toHaveLength(2);
    expect(await status(svc.createCopy(MARKETING, WS_B, campaign.id, { content: {} }))).toBe('404:Campanha não encontrada.');
    expect(await status(svc.createCopy(MARKETING, WS_A, campaign.id, { content: { x: 'y'.repeat(60_000) } }))).toBe('400:Copy grande demais.');
  });
});

describe('CampaignsService.requestApproval', () => {
  it('cria o pedido (título/resumo do protótipo), leva a campanha a pending_approval e registra a atividade', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    await w.t.creatives.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, title: 'C' } });
    const req = await svc.requestApproval(MARKETING, WS_A, campaign.id);
    expect(req).toMatchObject({
      entity_type: 'campaign', entity_id: campaign.id, campaign_id: campaign.id, status: 'pending', requested_by: MARKETING,
      title: 'Publicar campanha "Black Friday" na Meta',
    });
    expect(req.summary).toBe(`Verba diária de ${(100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, 1 criativo(s), objetivo Leads.`);
    expect(w.t.campaigns.rows[0]!.status).toBe('pending_approval');
    expect(w.logs.at(-1)).toEqual([WS_A, MARKETING, 'campaign.approval_requested', 'campaign', { campaign_id: campaign.id }]);
  });

  it('só a partir de rascunho (sem duplicar pedido); campanha de outro workspace → 404', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    await svc.requestApproval(OWNER, WS_A, campaign.id);
    expect(await status(svc.requestApproval(OWNER, WS_A, campaign.id))).toBe('400:Só campanhas em rascunho podem solicitar aprovação.');
    expect(w.t.approval_requests.rows).toHaveLength(1);
    expect(await status(svc.requestApproval(OWNER, WS_B, campaign.id))).toBe('404:Campanha não encontrada.');
  });
});
