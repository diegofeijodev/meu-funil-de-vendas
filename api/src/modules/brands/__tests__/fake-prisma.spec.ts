import { FakeTable } from './fake-prisma';

describe('FakeTable (fiel ao Postgres)', () => {
  const t = () => {
    const f = new FakeTable();
    f.rows.push({ id: '1', x: 'a', d: new Date('2026-01-02') }, { id: '2', x: 'b', d: null }, { id: '3', x: null, d: new Date('2026-01-01') });
    return f;
  };

  it('not: "a" exclui o igual e NÃO casa com nulo (x <> a é nulo no Postgres)', async () => {
    expect((await t().findMany({ where: { x: { not: 'a' } } })).map((r) => r.id)).toEqual(['2']);
  });

  it('not: null exclui só os nulos', async () => {
    expect((await t().findMany({ where: { x: { not: null } } })).map((r) => r.id)).toEqual(['1', '2']);
  });

  it('orderBy com nulls first/last explícito', async () => {
    expect((await t().findMany({ orderBy: { d: { sort: 'asc', nulls: 'first' } } })).map((r) => r.id)).toEqual(['2', '3', '1']);
    expect((await t().findMany({ orderBy: { d: { sort: 'asc', nulls: 'last' } } })).map((r) => r.id)).toEqual(['3', '1', '2']);
    expect((await t().findMany({ orderBy: { d: { sort: 'desc', nulls: 'last' } } })).map((r) => r.id)).toEqual(['1', '3', '2']);
  });

  it('orderBy sem nulls: asc = nulos por último; desc = nulos primeiro', async () => {
    expect((await t().findMany({ orderBy: { d: 'asc' } })).map((r) => r.id)).toEqual(['3', '1', '2']);
    expect((await t().findMany({ orderBy: { d: 'desc' } })).map((r) => r.id)).toEqual(['2', '1', '3']);
  });

  it('deleteMany apaga as que casam e devolve count', async () => {
    const f = t();
    expect(await f.deleteMany({ where: { x: { not: null } } })).toEqual({ count: 2 });
    expect(f.rows.map((r) => r.id)).toEqual(['3']);
    expect(await f.deleteMany({ where: { id: 'zzz' } })).toEqual({ count: 0 });
  });
});
