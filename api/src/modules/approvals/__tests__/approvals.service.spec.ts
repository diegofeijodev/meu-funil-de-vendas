import { ADMIN, MARKETING, OWNER, seedCampaign, status, STRANGER, VIEWER, WS_A, WS_B, world } from '../../campaigns/__tests__/world';
import { ApprovalsService } from '../approvals.service';

function setup() {
  const w = world();
  return { w, svc: new ApprovalsService(w.prisma, w.access, w.activity, w.guards) };
}
async function pendingCampaignRequest(w: ReturnType<typeof world>) {
  const { campaign } = await seedCampaign(w, { status: 'pending_approval' });
  const req = await w.t.approval_requests.create({ data: { workspace_id: WS_A, entity_type: 'campaign', entity_id: campaign.id, campaign_id: campaign.id, title: 'Publicar' } });
  return { campaign, req };
}

describe('ApprovalsService.decide', () => {
  it('owner aprova: pedido decidido, campanha vira approved e atividade approval.approved', async () => {
    const { w, svc } = setup();
    const { campaign, req } = await pendingCampaignRequest(w);
    expect(await svc.decide(OWNER, req.id, 'approved')).toEqual({ ok: true });
    expect(w.t.approval_requests.rows[0]).toMatchObject({ status: 'approved', decided_by: OWNER });
    expect(w.t.approval_requests.rows[0]!.decided_at).toBeInstanceOf(Date);
    expect(w.t.campaigns.rows.find((c) => c.id === campaign.id)!.status).toBe('approved');
    expect(w.logs.at(-1)).toEqual([WS_A, OWNER, 'approval.approved', 'campaign', { request_id: req.id, entity_id: campaign.id }]);
  });

  it('admin rejeita: a campanha volta para draft', async () => {
    const { w, svc } = setup();
    const { campaign, req } = await pendingCampaignRequest(w);
    await svc.decide(ADMIN, req.id, 'rejected');
    expect(w.t.approval_requests.rows[0]!.status).toBe('rejected');
    expect(w.t.campaigns.rows.find((c) => c.id === campaign.id)!.status).toBe('draft');
    expect(w.logs.at(-1)![2]).toBe('approval.rejected');
  });

  it('pedido de criativo: o criativo recebe o status da decisão', async () => {
    const { w, svc } = setup();
    const cr = await w.t.creatives.create({ data: { workspace_id: WS_A, title: 'C', status: 'ready' } });
    const req = await w.t.approval_requests.create({ data: { workspace_id: WS_A, entity_type: 'creative', entity_id: cr.id, title: 'Aprovar criativo' } });
    await svc.decide(OWNER, req.id, 'approved');
    expect(w.t.creatives.rows[0]!.status).toBe('approved');
  });

  it('entity_id de OUTRO workspace não é tocado', async () => {
    const { w, svc } = setup();
    const foreign = await w.t.creatives.create({ data: { workspace_id: WS_B, title: 'Alheio', status: 'ready' } });
    const req = await w.t.approval_requests.create({ data: { workspace_id: WS_A, entity_type: 'creative', entity_id: foreign.id, title: 'x' } });
    await svc.decide(OWNER, req.id, 'approved');
    expect(foreign.status).toBe('ready');
    expect(w.t.creatives.rows[0]!.status).toBe('ready');
  });

  it('marketing e viewer não decidem (403, nada muda); o gatilho do banco virou guarda de serviço', async () => {
    const { w, svc } = setup();
    const { campaign, req } = await pendingCampaignRequest(w);
    for (const u of [MARKETING, VIEWER]) {
      expect(await status(svc.decide(u, req.id, 'approved'))).toBe('403:Só o dono ou um administrador da empresa pode aprovar ou rejeitar.');
    }
    expect(w.t.approval_requests.rows[0]!.status).toBe('pending');
    expect(w.t.campaigns.rows.find((c) => c.id === campaign.id)!.status).toBe('pending_approval');
  });

  it('pedido de outro workspace → 404 (não vaza); inexistente/malformado → 404', async () => {
    const { w, svc } = setup();
    const { req } = await pendingCampaignRequest(w);
    expect(await status(svc.decide(STRANGER, req.id, 'approved'))).toBe('404:Pedido de aprovação não encontrado.');
    expect(await status(svc.decide(OWNER, 'xxx', 'approved'))).toBe('404:Pedido de aprovação não encontrado.');
    expect(await status(svc.decide(OWNER, '00000000-0000-4000-8000-000000000000', 'approved'))).toBe('404:Pedido de aprovação não encontrado.');
  });

  it('já decidido → 409 "Este pedido já foi decidido." (sem repetir efeitos)', async () => {
    const { w, svc } = setup();
    const { campaign, req } = await pendingCampaignRequest(w);
    await svc.decide(OWNER, req.id, 'approved');
    w.t.campaigns.rows.find((c) => c.id === campaign.id)!.status = 'paused';
    expect(await status(svc.decide(OWNER, req.id, 'rejected'))).toBe('409:Este pedido já foi decidido.');
    expect(w.t.campaigns.rows.find((c) => c.id === campaign.id)!.status).toBe('paused');
    expect(w.logs.filter((l) => String(l[2]).startsWith('approval.'))).toHaveLength(1);
  });
});

describe('ApprovalsService — leituras', () => {
  it('list: só do workspace, mais novos primeiro, com `campaigns(name)`', async () => {
    const { w, svc } = setup();
    const { campaign, req } = await pendingCampaignRequest(w);
    await w.t.approval_requests.create({ data: { workspace_id: WS_B, entity_type: 'campaign', title: 'alheio' } });
    const second = await w.t.approval_requests.create({ data: { workspace_id: WS_A, entity_type: 'creative', title: 'segundo' } });
    const list = await svc.list(WS_A);
    expect(list.map((r: any) => r.id)).toEqual([second.id, req.id]);
    expect((list[1] as any).campaigns).toEqual(expect.objectContaining({ id: campaign.id, name: 'Black Friday' }));
    expect((list[0] as any).campaigns).toBeNull();
  });

  it('logs: só do workspace, mais novos primeiro, limite 30 por padrão e teto 200', async () => {
    const { w, svc } = setup();
    for (let i = 0; i < 40; i++) await w.t.activity_logs.create({ data: { workspace_id: WS_A, action: `a${i}` } });
    await w.t.activity_logs.create({ data: { workspace_id: WS_B, action: 'alheio' } });
    expect(await svc.logs(WS_A)).toHaveLength(30);
    expect((await svc.logs(WS_A))[0]!.action).toBe('a39');
    expect(await svc.logs(WS_A, 5)).toHaveLength(5);
    expect(await svc.logs(WS_A, 9999)).toHaveLength(40);
    expect(await svc.logs(WS_A, Number.NaN)).toHaveLength(30);
  });
});
