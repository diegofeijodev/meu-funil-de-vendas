import { FeedDownError, VacancyFeedClient, type FreelaFetch } from '../vacancy-feed';
import { SKIP, isAfterWatermark, triage } from '../vacancy-triage';
import type { FreelaVacancy } from '../vacancy-types';

const NOW = new Date('2026-10-29T15:00:00Z');
const S = { cities: [] as string[], min_lead_minutes: 120 };
const vac = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: 'v1', title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-10-30',
  startTime: '2026-10-30T20:00:00Z', endTime: '2026-10-31T02:00:00Z', amountInCents: 15000,
  contractorName: 'Bar do Zé', publishedAt: '2026-10-29T10:00:00Z', ...o,
});
const res = (status: number, body?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('bad'); return body; } }) as Response;

describe('VacancyFeedClient', () => {
  const make = (f: FreelaFetch, env: { NODE_ENV: string; FREELA_PUBLIC_API_URL?: string } = { NODE_ENV: 'production' }) =>
    new VacancyFeedClient(env as never, f);

  it('recent devolve só itens válidos', async () => {
    const { id: _id, ...semId } = vac();
    const c = make(async () => res(200, { data: [vac(), semId] }));
    const r = await c.recent();
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('v1');
  });
  it('byId 404 -> null; 500, rede e JSON ruim -> FeedDownError', async () => {
    expect(await make(async () => res(404)).byId('x')).toBeNull();
    await expect(make(async () => res(500)).byId('x')).rejects.toBeInstanceOf(FeedDownError);
    await expect(make(async () => { throw new Error('net'); }).recent()).rejects.toBeInstanceOf(FeedDownError);
    await expect(make(async () => res(200)).recent()).rejects.toThrow('Não conseguimos consultar as vagas do Freela.');
  });
  it('byId devolve a vaga', async () => {
    expect((await make(async () => res(200, { data: vac() })).byId('v1'))?.id).toBe('v1');
  });
  it('URL: produção ignora o override; test usa', async () => {
    const urls: string[] = [];
    const f: FreelaFetch = async (u) => { urls.push(u); return res(200, { data: [] }); };
    await make(f, { NODE_ENV: 'production', FREELA_PUBLIC_API_URL: 'http://x' }).recent();
    await make(f, { NODE_ENV: 'test', FREELA_PUBLIC_API_URL: 'http://x/' }).recent();
    expect(urls).toEqual([
      'https://api.freelaservicosapp.com.br/v1/bars-restaurants/public/vacancies/recent?limit=24',
      'http://x/v1/bars-restaurants/public/vacancies/recent?limit=24',
    ]);
  });
});

describe('triage', () => {
  it('pula teste, valor, cidade e antecedência; aceita o resto', () => {
    expect(triage(vac({ contractorName: 'Enzo teste fernandes ltda' }), S, NOW)).toEqual({ status: 'skipped', reason: SKIP.test });
    expect(triage(vac({ title: 'Vaga Teste' }), S, NOW)).toEqual({ status: 'skipped', reason: SKIP.testTitle });
    expect(triage(vac({ amountInCents: null }), S, NOW)).toEqual({ status: 'skipped', reason: SKIP.noValue });
    expect(triage(vac({ amountInCents: 0 }), S, NOW)).toEqual({ status: 'skipped', reason: SKIP.noValue });
    expect(triage(vac({ city: 'Jundiaí' }), { ...S, cities: ['Campinas'] }, NOW)).toEqual({ status: 'skipped', reason: 'Cidade fora da sua lista: Jundiaí.' });
    expect(triage(vac({ city: null }), S, NOW)).toEqual({ status: 'skipped', reason: SKIP.noCity });
    expect(triage(vac({ city: '  ' }), { ...S, cities: ['Campinas'] }, NOW)).toEqual({ status: 'skipped', reason: SKIP.noCity });
    expect(triage(vac({ startTime: '2026-10-29T18:00:00Z' }), { ...S, min_lead_minutes: 240 }, NOW))
      .toEqual({ status: 'skipped', reason: 'Começa às 15h, em menos de 4 h. Não dá tempo de divulgar.' });
    expect(triage(vac(), S, NOW)).toEqual({ status: 'new' });
  });
  it('marca-d\'água', () => {
    expect(isAfterWatermark(vac({ publishedAt: '2026-10-29T10:00:00Z' }), new Date('2026-10-29T10:00:01Z'))).toBe(false);
    expect(isAfterWatermark(vac({ publishedAt: '2026-10-29T10:00:02Z' }), new Date('2026-10-29T10:00:01Z'))).toBe(true);
  });
});
