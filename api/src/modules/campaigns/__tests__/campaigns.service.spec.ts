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

  it('lista traz pilot_summary da execução mais recente do piloto; sem execução = null', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    const two = await w.t.campaigns.create({ data: { workspace_id: WS_A, brand_id: campaign.brand_id, name: 'Sem piloto' } });
    await w.t.campaign_pilot_runs.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, status: 'cancelled', current_step: 'copies', steps: {}, created_at: new Date('2026-10-29T10:00:00Z') } });
    await w.t.campaign_pilot_runs.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, status: 'running', current_step: 'creatives', created_at: new Date('2026-10-30T10:00:00Z'),
      steps: { creatives: { status: 'running', attempts: 0, slots: [{ status: 'done' }, { status: 'pending' }] } } } });
    const list = (await svc.list(WS_A)) as any[];
    expect(list.find((c) => c.id === campaign.id).pilot_summary).toEqual({ status: 'running', current_step: 'creatives', first_block_code: null, counts: { done: 1, total: 2 } });
    expect(list.find((c) => c.id === two.id).pilot_summary).toBeNull();
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
    expect(d.instagram).toEqual({ linked: false, pending_posts: 0 });
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

describe('CampaignsService.createCopy — versão concorrente', () => {
  it('P2002 no índice (campaign_id, version): recalcula max+1 e tenta de novo', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    const real = w.t.copies.create.bind(w.t.copies);
    let calls = 0;
    w.t.copies.create = (async (args: any) => {
      calls++;
      if (calls === 1) {
        await real({ data: { workspace_id: WS_A, campaign_id: campaign.id, content: {}, status: 'draft', version: 1 } }); // geração concorrente venceu
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      }
      return real(args);
    }) as any;
    const copy = await svc.createCopy(MARKETING, WS_A, campaign.id, { content: { headline: 'A' } });
    expect(copy.version).toBe(2);
    expect(calls).toBe(2);
  });

  it('conflito persistente: desiste após 3 tentativas e sobe o erro; erro que não é de unicidade não repete', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    let calls = 0;
    w.t.copies.create = (async () => { calls++; throw Object.assign(new Error('x'), { code: 'P2002' }); }) as any;
    await expect(svc.createCopy(MARKETING, WS_A, campaign.id, { content: {} })).rejects.toMatchObject({ code: 'P2002' });
    expect(calls).toBe(3);
    calls = 0;
    w.t.copies.create = (async () => { calls++; throw new Error('boom'); }) as any;
    await expect(svc.createCopy(MARKETING, WS_A, campaign.id, { content: {} })).rejects.toThrow('boom');
    expect(calls).toBe(1);
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

describe('CampaignsService.setLandingUrl', () => {
  it('grava a URL (trim), registra a atividade e libera a publicação que exige o destino', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w, { status: 'approved', landing_url: null });
    const c = await svc.setLandingUrl(OWNER, WS_A, campaign.id, '  https://www.freelaservicosapp.com.br/cadastro-contratante  ');
    expect(c.landing_url).toBe('https://www.freelaservicosapp.com.br/cadastro-contratante');
    expect(w.t.campaigns.rows[0]!.landing_url).toBe('https://www.freelaservicosapp.com.br/cadastro-contratante');
    expect(w.logs.at(-1)).toEqual([WS_A, OWNER, 'campaign.landing_updated', 'campaign', { campaign_id: campaign.id }]);
  });

  it('só http/https válido: vazio, texto solto e esquemas perigosos → 400', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w);
    const msg = '400:Informe uma URL válida, começando com http:// ou https://.';
    for (const bad of ['', '   ', 'freelaservicosapp.com.br', 'javascript:alert(1)', 'ftp://x.com', 'https://']) {
      expect(await status(svc.setLandingUrl(OWNER, WS_A, campaign.id, bad))).toBe(msg);
    }
    expect(w.t.campaigns.rows[0]!.landing_url ?? null).toBeNull();
  });

  it('com o anúncio já no ar (status active) não muda; campanha de outro workspace → 404', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w, { status: 'active' });
    expect(await status(svc.setLandingUrl(OWNER, WS_A, campaign.id, 'https://exemplo.com'))).toBe(
      '400:A campanha já foi publicada: mude o destino direto na Meta.',
    );
    expect(await status(svc.setLandingUrl(OWNER, WS_B, campaign.id, 'https://exemplo.com'))).toBe('404:Campanha não encontrada.');
  });
});

describe('CampaignsService.setBudget / setLocation (Fatia 0: ajustar antes de publicar)', () => {
  it('grava a verba por dia e o teto do mês, registra a atividade', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w, { status: 'approved', budget_daily: 0 });
    const c = await svc.setBudget(OWNER, WS_A, campaign.id, { budget_daily: 35.5, budget_total: 900 });
    expect(Number(c.budget_daily)).toBe(35.5);
    expect(Number(w.t.campaigns.rows[0]!.budget_total)).toBe(900);
    expect(w.logs.at(-1)).toEqual([WS_A, OWNER, 'campaign.budget_updated', 'campaign', { campaign_id: campaign.id, from: { daily: 0, total: null }, to: { daily: 35.5, total: 900 } }]);
    await svc.setBudget(OWNER, WS_A, campaign.id, { budget_daily: 20, budget_total: null });
    expect(w.t.campaigns.rows[0]!.budget_total ?? null).toBeNull();
  });

  it('verba ≤ 0 e teto menor que um dia → 400 com a frase da tela', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w, { status: 'approved' });
    expect(await status(svc.setBudget(OWNER, WS_A, campaign.id, { budget_daily: 0 }))).toBe('400:Informe um valor por dia maior que zero.');
    expect(await status(svc.setBudget(OWNER, WS_A, campaign.id, { budget_daily: 50, budget_total: 30 }))).toBe(
      '400:O teto do mês não pode ser menor que a verba de um dia.',
    );
  });

  it('grava a cidade em audience.localizacao (trim) sem perder o resto do público', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w, { status: 'approved', audience: { idade: '25-45', persona: 'Dono de bar' } });
    await svc.setLocation(OWNER, WS_A, campaign.id, '  Jundiaí, SP ');
    expect(w.t.campaigns.rows[0]!.audience).toEqual({ idade: '25-45', persona: 'Dono de bar', localizacao: 'Jundiaí, SP' });
    expect(w.logs.at(-1)).toEqual([WS_A, OWNER, 'campaign.location_updated', 'campaign', { campaign_id: campaign.id, from: '', to: 'Jundiaí, SP' }]);
    expect(await status(svc.setLocation(OWNER, WS_A, campaign.id, '  '))).toBe('400:Informe a cidade (ex.: Jundiaí, SP).');
  });

  it('já enviada à Meta ou no ar não muda; outro workspace → 404', async () => {
    const { w, svc } = setup();
    const { campaign: sent } = await seedCampaign(w, { status: 'approved', meta_campaign_id: '9001' });
    const msg = '400:A campanha já foi publicada: mude direto na Meta.';
    expect(await status(svc.setBudget(OWNER, WS_A, sent.id, { budget_daily: 10 }))).toBe(msg);
    expect(await status(svc.setLocation(OWNER, WS_A, sent.id, 'Jundiaí'))).toBe(msg);
    const { campaign: live } = await seedCampaign(w, { status: 'active' });
    expect(await status(svc.setBudget(OWNER, WS_A, live.id, { budget_daily: 10 }))).toBe(msg);
    expect(await status(svc.setLocation(OWNER, WS_B, live.id, 'Jundiaí'))).toBe('404:Campanha não encontrada.');
  });
});

describe('verba e cidade — depois da revisão da Fatia 0', () => {
  it('depois do pedido de aprovação só dono/admin muda (a aprovação viu o valor antigo); em rascunho o marketing muda', async () => {
    const { w, svc } = setup();
    const { campaign: appr } = await seedCampaign(w, { status: 'approved', budget_daily: 30 });
    const msg = '403:Depois do pedido de aprovação, só o dono ou um administrador muda verba e cidade.';
    expect(await status(svc.setBudget(MARKETING, WS_A, appr.id, { budget_daily: 50 }))).toBe(msg);
    expect(await status(svc.setLocation(MARKETING, WS_A, appr.id, 'Campinas, SP'))).toBe(msg);
    const { campaign: draft } = await seedCampaign(w, { status: 'draft', budget_daily: 0 });
    expect(await status(svc.setBudget(MARKETING, WS_A, draft.id, { budget_daily: 50 }))).toBe('ok');
  });

  it('sem mandar o total, o total de antes fica (o campo opcional não apaga a "Verba total")', async () => {
    const { w, svc } = setup();
    const { campaign } = await seedCampaign(w, { status: 'approved', budget_daily: 0, budget_total: 3000 });
    await svc.setBudget(OWNER, WS_A, campaign.id, { budget_daily: 40 });
    expect(Number(w.t.campaigns.rows.find((r: any) => r.id === campaign.id)!.budget_total)).toBe(3000);
  });

  it('já na Meta sem verba gravada (o R$ 20 antigo): dá para preencher a verba (Google/TikTok precisam dela); com verba, não muda', async () => {
    const { w, svc } = setup();
    const { campaign: empty } = await seedCampaign(w, { status: 'active', meta_campaign_id: '9001', budget_daily: 0 });
    expect(await status(svc.setBudget(OWNER, WS_A, empty.id, { budget_daily: 20 }))).toBe('ok');
    const { campaign: full } = await seedCampaign(w, { status: 'active', meta_campaign_id: '9002', budget_daily: 30 });
    expect(await status(svc.setBudget(OWNER, WS_A, full.id, { budget_daily: 20 }))).toBe('400:A campanha já foi publicada: mude direto na Meta.');
  });
});
