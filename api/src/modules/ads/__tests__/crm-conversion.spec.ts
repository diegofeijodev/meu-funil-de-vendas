import { createHash, randomUUID } from 'node:crypto';
import { WorkspaceAccessService } from '../../access/access.service';
import { IgTable } from '../../instagram/__tests__/harness';
import { MetaError } from '../../instagram/meta-graph';
import { CrmConversionService } from '../crm-conversion.service';

const WS_A = randomUUID();
const WS_B = randomUUID();
const OWNER = randomUUID();
const VIEWER = randomUUID();
const STRANGER = randomUUID();
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const status = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus()}:${e.getResponse().message}`; } };

async function world(config: Record<string, unknown> = { pixel_id: '123456789' }, integrationStatus = 'connected') {
  const members = new IgTable();
  members.rows.push({ workspace_id: WS_A, user_id: OWNER, role: 'owner' }, { workspace_id: WS_A, user_id: VIEWER, role: 'viewer' }, { workspace_id: WS_B, user_id: STRANGER, role: 'owner' });
  const prisma: any = { workspace_members: members, crm_integrations: new IgTable(), crm_leads: new IgTable() };
  await prisma.crm_integrations.create({ data: { workspace_id: WS_A, kind: 'meta_lead_ads', status: integrationStatus, config } });
  const lead = await prisma.crm_leads.create({ data: { workspace_id: WS_A, name: 'Ana', email: ' Ana@Ex.com ', phone: '+55 (11) 99999-0000', estimated_value: 1500 } });
  const alheio = await prisma.crm_leads.create({ data: { workspace_id: WS_B, name: 'Alheio', email: 'x@y.co' } });
  const calls: any[] = [];
  const graph: any = { graph: async (ws: string, path: string, opts: any) => { calls.push({ ws, path, ...opts }); if (calls.length && (graph as any).fail) throw new MetaError('Meta fora'); return { events_received: 1 }; } };
  const svc = new CrmConversionService(prisma, new WorkspaceAccessService(prisma), graph);
  return { svc, lead, alheio, calls, graph };
}

describe('notifyMetaConversion (API de Conversões)', () => {
  it('envia Qualificado/Ganho: POST /{pixel}/events com e-mail e telefone em SHA-256, system_generated e valor em BRL', async () => {
    const { svc, lead, calls } = await world();
    expect(await svc.notify(OWNER, WS_A, lead.id, 'Ganho')).toEqual({ sent: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({ ws: WS_A, path: '/123456789/events', method: 'POST' }));
    const ev = calls[0].params.data[0];
    expect(ev).toEqual(expect.objectContaining({ event_name: 'Ganho', action_source: 'system_generated', custom_data: { value: 1500, currency: 'BRL' } }));
    expect(ev.user_data).toEqual({ em: [sha('ana@ex.com')], ph: [sha('5511999990000')] });
    expect(ev.event_time).toBeGreaterThan(Date.now() / 1000 - 10);
  });

  it('sem integração conectada, sem lead ou lead de OUTRO workspace → { skipped: true } sem chamar a Meta', async () => {
    const off = await world({ pixel_id: '123456789' }, 'disconnected');
    expect(await off.svc.notify(OWNER, WS_A, off.lead.id, 'Ganho')).toEqual({ skipped: true });
    const w = await world();
    expect(await w.svc.notify(OWNER, WS_A, w.alheio.id, 'Ganho')).toEqual({ skipped: true });
    expect(await w.svc.notify(OWNER, WS_A, randomUUID(), 'Qualificado')).toEqual({ skipped: true });
    expect(off.calls.length + w.calls.length).toBe(0);
  });

  it('sem pixel configurado ou pixel malformado: não chama a Meta; falha da Meta nunca lança (sent:false)', async () => {
    const semPixel = await world({});
    expect(await semPixel.svc.notify(OWNER, WS_A, semPixel.lead.id, 'Ganho')).toEqual({ sent: true });
    expect(semPixel.calls).toHaveLength(0);
    const ruim = await world({ pixel_id: '../me' });
    expect(await ruim.svc.notify(OWNER, WS_A, ruim.lead.id, 'Ganho')).toEqual({ sent: false });
    expect(ruim.calls).toHaveLength(0);
    const w = await world();
    (w.graph as any).fail = true;
    expect(await w.svc.notify(OWNER, WS_A, w.lead.id, 'Qualificado')).toEqual({ sent: false });
  });

  it('acesso: viewer (só lê) e quem não é membro não disparam conversão', async () => {
    const w = await world();
    expect(await status(w.svc.notify(VIEWER, WS_A, w.lead.id, 'Ganho'))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.svc.notify(STRANGER, WS_A, w.lead.id, 'Ganho'))).toBe('403:Você não tem acesso a esta empresa.');
    expect(w.calls).toHaveLength(0);
  });
});
