import { FakeTable } from '../../brands/__tests__/fake-prisma';
import { PilotGate } from '../pilot-gate';

const A = '7309ae62-15c2-48d3-8990-4dbe75a29c4e';
const B = '11111111-2222-4333-8444-555555555555';
const gate = (env: Record<string, unknown>) => new PilotGate({ NODE_ENV: 'production', CAMPAIGN_PILOT_ENABLED: false, CAMPAIGN_PILOT_WORKSPACE_IDS: '', ...env } as any);

describe('PilotGate (piloto liberado por empresa)', () => {
  it('desligado = false mesmo com a empresa na lista', () => {
    expect(gate({ CAMPAIGN_PILOT_WORKSPACE_IDS: A }).enabled(A)).toBe(false);
  });
  it('ligado + na lista = true; ligado + fora = false', () => {
    const g = gate({ CAMPAIGN_PILOT_ENABLED: true, CAMPAIGN_PILOT_WORKSPACE_IDS: A });
    expect(g.enabled(A)).toBe(true);
    expect(g.enabled(A.toUpperCase())).toBe(true);
    expect(g.enabled(B)).toBe(false);
  });
  it('"*" em produção derruba a subida citando a variável', () => {
    expect(() => gate({ CAMPAIGN_PILOT_ENABLED: true, CAMPAIGN_PILOT_WORKSPACE_IDS: '*' })).toThrow(/CAMPAIGN_PILOT_WORKSPACE_IDS/);
    expect(gate({ NODE_ENV: 'test', CAMPAIGN_PILOT_ENABLED: true, CAMPAIGN_PILOT_WORKSPACE_IDS: '*' }).enabled(B)).toBe(true);
  });
});

describe('FakeTable entende lt/lte/gt/gte (runner do piloto)', () => {
  it('compara datas e números', async () => {
    const t = new FakeTable();
    const now = new Date('2026-10-30T12:00:00Z');
    await t.create({ data: { id: '1', at: new Date('2026-10-30T11:00:00Z'), n: 1 } });
    await t.create({ data: { id: '2', at: new Date('2026-10-30T13:00:00Z'), n: 5 } });
    expect((await t.findMany({ where: { at: { lte: now } } })).map((r: any) => r.id)).toEqual(['1']);
    expect((await t.findMany({ where: { at: { gt: now } } })).map((r: any) => r.id)).toEqual(['2']);
    expect((await t.findMany({ where: { n: { gte: 1, lt: 5 } } })).map((r: any) => r.id)).toEqual(['1']);
    expect((await t.findMany({ where: { OR: [{ at: null }, { at: { lt: now } }] } })).map((r: any) => r.id)).toEqual(['1']);
  });
});
