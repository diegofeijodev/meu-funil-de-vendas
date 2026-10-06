import { dedupeCadenceRuns, prepareRows, renumberVersions } from '../dedupe';

describe('dedupeCadenceRuns (regra da migração 20261002160000)', () => {
  it('fica uma matrícula por (cadência, lead): a mais recente por created_at, empate pelo id', () => {
    const rows = [
      { id: 'a', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-09-01T10:00:00+00:00' },
      { id: 'b', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-09-02T10:00:00.5+00:00' },
      { id: 'c', cadence_id: 'c1', lead_id: 'l2', created_at: '2026-09-01T10:00:00+00:00' },
      { id: 'e', cadence_id: 'c2', lead_id: 'l1', created_at: '2026-09-03T00:00:00+00:00' },
      { id: 'd', cadence_id: 'c2', lead_id: 'l1', created_at: '2026-09-03T00:00:00+00:00' },
    ];
    const r = dedupeCadenceRuns(rows);
    expect(r.rows.map((x) => x.id)).toEqual(['b', 'c', 'e']);
    expect(r.droppedIds.sort()).toEqual(['a', 'd']);
  });
});

describe('renumberVersions (regra da migração 20261002150000)', () => {
  it('só nos pais com versão repetida: renumera 1..n na ordem (version, created_at, id)', () => {
    const rows = [
      { id: 'x1', campaign_id: 'p1', version: 1, created_at: '2026-09-01T00:00:00Z' },
      { id: 'x2', campaign_id: 'p1', version: 1, created_at: '2026-09-02T00:00:00Z' },
      { id: 'x3', campaign_id: 'p1', version: 2, created_at: '2026-09-03T00:00:00Z' },
      { id: 'y1', campaign_id: 'p2', version: 1, created_at: '2026-09-01T00:00:00Z' },
      { id: 'y2', campaign_id: 'p2', version: 5, created_at: '2026-09-01T00:00:00Z' },
      { id: 'z1', campaign_id: null, version: 1, created_at: '2026-09-01T00:00:00Z' },
      { id: 'z2', campaign_id: null, version: 1, created_at: '2026-09-01T00:00:00Z' },
    ];
    const r = renumberVersions(rows, 'campaign_id');
    expect(r.rows.map((x) => [x.id, x.version])).toEqual([['x1', 1], ['x2', 2], ['x3', 3], ['y1', 1], ['y2', 5], ['z1', 1], ['z2', 1]]);
    expect(r.renumbered).toBe(2);
  });
});

describe('prepareRows', () => {
  it('aplica a regra certa por tabela e deixa as outras intactas', () => {
    const runs = [
      { id: 'a', cadence_id: 'c', lead_id: 'l', created_at: '2026-09-01T00:00:00Z' },
      { id: 'b', cadence_id: 'c', lead_id: 'l', created_at: '2026-09-02T00:00:00Z' },
    ];
    expect(prepareRows('crm_cadence_runs', runs)).toEqual({ rows: [runs[1]], droppedIds: ['a'], renumbered: 0 });
    expect(prepareRows('creative_versions', [{ id: 'v1', creative_id: 'k', version: 1 }, { id: 'v2', creative_id: 'k', version: 1 }]).renumbered).toBe(1);
    const brands = [{ id: 'b1' }];
    expect(prepareRows('brands', brands)).toEqual({ rows: brands, droppedIds: [], renumbered: 0 });
  });
});
