import { createWithNextVersion, isUniqueViolation } from '../database/next-version';

const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

describe('createWithNextVersion', () => {
  it('sem conflito: max+1 (ou 1 quando não há linhas)', async () => {
    expect(await createWithNextVersion(async () => undefined, async (v) => `v${v}`)).toEqual({ row: 'v1', version: 1 });
    expect(await createWithNextVersion(async () => 4, async (v) => `v${v}`)).toEqual({ row: 'v5', version: 5 });
  });

  it('P2002: recalcula max+1 e tenta de novo', async () => {
    let max = 1;
    let calls = 0;
    const r = await createWithNextVersion(async () => max, async (v) => {
      calls++;
      if (calls === 1) { max = 2; throw p2002(); }
      return v;
    });
    expect(r).toEqual({ row: 3, version: 3 });
    expect(calls).toBe(2);
  });

  it('desiste depois de 3 tentativas; outro erro sobe na hora', async () => {
    let calls = 0;
    await expect(createWithNextVersion(async () => 0, async () => { calls++; throw p2002(); })).rejects.toMatchObject({ code: 'P2002' });
    expect(calls).toBe(3);
    calls = 0;
    await expect(createWithNextVersion(async () => 0, async () => { calls++; throw new Error('boom'); })).rejects.toThrow('boom');
    expect(calls).toBe(1);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
