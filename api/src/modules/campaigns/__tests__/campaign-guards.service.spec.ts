import { MSG_ACTIVATE_DELIVERY, MSG_APPROVE_CAMPAIGN, MSG_DECIDE_APPROVAL } from '../campaign-guards.service';
import { ADMIN, MARKETING, OWNER, status, STRANGER, VIEWER, world, WS_A } from './world';

describe('CampaignGuardsService — gatilhos de papel do banco (db.md §4)', () => {
  const { guards } = world();

  it('guard_campaign_approval: status virar approved|active exige owner|admin', async () => {
    expect(await status(guards.assertCanSetCampaignStatus(MARKETING, WS_A, 'pending_approval', 'approved'))).toBe(`403:${MSG_APPROVE_CAMPAIGN}`);
    expect(await status(guards.assertCanSetCampaignStatus(VIEWER, WS_A, 'draft', 'active'))).toBe(`403:${MSG_APPROVE_CAMPAIGN}`);
    expect(await status(guards.assertCanSetCampaignStatus(STRANGER, WS_A, null, 'approved'))).toBe(`403:${MSG_APPROVE_CAMPAIGN}`);
    expect(await status(guards.assertCanSetCampaignStatus(OWNER, WS_A, 'pending_approval', 'approved'))).toBe('ok');
    expect(await status(guards.assertCanSetCampaignStatus(ADMIN, WS_A, null, 'active'))).toBe('ok');
  });

  it('alternar approved<->active é livre; outros status não passam pelo gatilho', async () => {
    expect(await status(guards.assertCanSetCampaignStatus(MARKETING, WS_A, 'approved', 'active'))).toBe('ok');
    expect(await status(guards.assertCanSetCampaignStatus(MARKETING, WS_A, 'active', 'approved'))).toBe('ok');
    expect(await status(guards.assertCanSetCampaignStatus(MARKETING, WS_A, 'draft', 'pending_approval'))).toBe('ok');
    expect(await status(guards.assertCanSetCampaignStatus(VIEWER, WS_A, 'active', 'paused'))).toBe('ok');
  });

  it('guard_campaign_delivery: meta_delivery_status virar ACTIVE exige owner|admin (PAUSED é livre)', async () => {
    expect(await status(guards.assertCanSetDelivery(MARKETING, WS_A, 'PAUSED', 'ACTIVE'))).toBe(`403:${MSG_ACTIVATE_DELIVERY}`);
    expect(await status(guards.assertCanSetDelivery(MARKETING, WS_A, null, 'ACTIVE'))).toBe(`403:${MSG_ACTIVATE_DELIVERY}`);
    expect(await status(guards.assertCanSetDelivery(ADMIN, WS_A, 'PAUSED', 'ACTIVE'))).toBe('ok');
    expect(await status(guards.assertCanSetDelivery(MARKETING, WS_A, 'ACTIVE', 'PAUSED'))).toBe('ok');
    expect(await status(guards.assertCanSetDelivery(MARKETING, WS_A, 'ACTIVE', 'ACTIVE'))).toBe('ok');
  });

  it('guard_approval_decision: só owner|admin', async () => {
    expect(await status(guards.assertCanDecideApproval(MARKETING, WS_A))).toBe(`403:${MSG_DECIDE_APPROVAL}`);
    expect(await status(guards.assertCanDecideApproval(VIEWER, WS_A))).toBe(`403:${MSG_DECIDE_APPROVAL}`);
    expect(await status(guards.assertCanDecideApproval(OWNER, WS_A))).toBe('ok');
  });

  it('resolveCampaign: não-membro e id malformado = 404; viewer em escrita = 403', async () => {
    const w = world();
    const brand = await w.t.brands.create({ data: { workspace_id: WS_A, name: 'M' } });
    const c = await w.t.campaigns.create({ data: { workspace_id: WS_A, brand_id: brand.id, name: 'C' } });
    expect(await status(w.guards.resolveCampaign(STRANGER, c.id, 'write'))).toBe('404:Campanha não encontrada.');
    expect(await status(w.guards.resolveCampaign(OWNER, 'xxx', 'write'))).toBe('404:Campanha não encontrada.');
    expect(await status(w.guards.resolveCampaign(VIEWER, c.id, 'write'))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.guards.resolveCampaign(VIEWER, c.id, 'read'))).toBe('ok');
    expect((await w.guards.resolveCampaign(MARKETING, c.id, 'write')).workspace_id).toBe(WS_A);
  });
});
