import { CampaignsService } from '../campaigns.service';
import { geoLabel, parseGeoTargets } from '../geo-targets';
import { MARKETING, OWNER, seedCampaign, status, WS_A, world } from './world';

const J = { type: 'city', name: 'Jundiaí', uf: 'sp', meta_key: '269969', radius_km: 20 };
const err = async (fn: () => unknown) => status(Promise.resolve().then(fn));

describe('parseGeoTargets / geoLabel', () => {
  it('normaliza a UF, aceita só a cidade (raio null) e monta o rótulo', () => {
    const t = parseGeoTargets([J, { type: 'city', name: ' Campinas ', uf: 'SP', meta_key: null, radius_km: null }]);
    expect(t).toEqual([
      { type: 'city', name: 'Jundiaí', uf: 'SP', meta_key: '269969', radius_km: 20 },
      { type: 'city', name: 'Campinas', uf: 'SP', meta_key: null, radius_km: null },
    ]);
    expect(geoLabel(t)).toBe('Jundiaí – SP (+20 km), Campinas – SP (só a cidade)');
    expect(parseGeoTargets(undefined)).toEqual([]);
  });

  it('raio fora de 17–80, chave com letra, sem nome ou mais de 10 → 400', async () => {
    expect(await err(() => parseGeoTargets([{ ...J, radius_km: 10 }]))).toBe('400:A Meta aceita de 17 a 80 km em volta de uma cidade.');
    expect(await err(() => parseGeoTargets([{ ...J, radius_km: 100 }]))).toBe('400:A Meta aceita de 17 a 80 km em volta de uma cidade.');
    expect(await err(() => parseGeoTargets([{ ...J, meta_key: '12a' }]))).toBe('400:Cidade inválida. Escolha de novo na lista.');
    expect(await err(() => parseGeoTargets([{ ...J, name: ' ' }]))).toBe('400:Informe a cidade (ex.: Jundiaí, SP).');
    expect(await err(() => parseGeoTargets(Array.from({ length: 11 }, () => J)))).toBe('400:No máximo 10 cidades por campanha.');
  });
});

describe('CampaignsService — geo_targets', () => {
  it('create grava a região; setGeoTargets grava a região e o texto legível juntos', async () => {
    const w = world();
    const svc = new CampaignsService(w.prisma, w.activity, w.guards);
    const { brand } = await seedCampaign(w);
    const c = await svc.create(OWNER, WS_A, { brand_id: brand.id, name: 'X', objective: 'traffic', audience: {}, formats: [], geo_targets: [J] } as any);
    expect(c.geo_targets).toEqual([{ ...J, uf: 'SP' }]);
    const { campaign } = await seedCampaign(w, { status: 'draft', audience: { idade: '25-45' } });
    await svc.setGeoTargets(MARKETING, WS_A, campaign.id, [{ ...J, radius_km: 40 }]);
    const row = w.t.campaigns.rows.find((r: any) => r.id === campaign.id)!;
    expect(row.geo_targets).toEqual([{ ...J, uf: 'SP', radius_km: 40 }]);
    expect(row.audience).toEqual({ idade: '25-45', localizacao: 'Jundiaí, SP' });
    expect(await status(svc.setGeoTargets(OWNER, WS_A, campaign.id, []))).toBe('400:Escolha pelo menos uma cidade.');
  });
});

describe('geo_targets — depois da revisão da Fatia 2', () => {
  it('create com região: o texto legível sai da lista (o cliente não manda as duas coisas desencontradas)', async () => {
    const w = world();
    const svc = new CampaignsService(w.prisma, w.activity, w.guards);
    const { brand } = await seedCampaign(w);
    const c = await svc.create(OWNER, WS_A, { brand_id: brand.id, name: 'X', objective: 'traffic', audience: { persona: 'Dono' }, formats: [], geo_targets: [J] } as any);
    expect(c.audience).toEqual({ persona: 'Dono', localizacao: 'Jundiaí, SP' });
  });
});
