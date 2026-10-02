import { Prisma } from '@prisma/client';
import { toWire } from '../http/wire';

describe('toWire (formato de fio do protótipo)', () => {
  it('Decimal e BigInt viram number; timestamps ISO; colunas date viram YYYY-MM-DD', () => {
    const out = toWire({
      budget_total: new Prisma.Decimal('12.5'),
      impressions: BigInt(1234),
      created_at: new Date('2026-10-02T03:04:05.000Z'),
      start_date: new Date('2026-10-02T00:00:00.000Z'),
      date: new Date('2026-10-01T00:00:00.000Z'),
      nested: [{ price: new Prisma.Decimal(7), end_date: null }],
    });
    expect(out).toEqual({
      budget_total: 12.5,
      impressions: 1234,
      created_at: '2026-10-02T03:04:05.000Z',
      start_date: '2026-10-02',
      date: '2026-10-01',
      nested: [{ price: 7, end_date: null }],
    });
  });
  it('deixa null/undefined/strings e Buffer intactos', () => {
    const buf = Buffer.from('x');
    expect(toWire({ a: null, b: undefined, c: 'x', d: buf })).toEqual({ a: null, b: undefined, c: 'x', d: buf });
  });
});
