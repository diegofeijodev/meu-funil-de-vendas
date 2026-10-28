import { nextWindowSlot, spDay, windowStartOn } from '../vacancy-slots';

const utc = (iso: string) => new Date(iso);
const win = { windowStart: '08:00', windowEnd: '21:00', spacingMin: 15 };

describe('horário livre dos stories das vagas (Brasília)', () => {
  it('casos do plano', () => {
    // 2026-10-29T13:00:00Z = 10h em Brasília
    expect(nextWindowSlot({ now: utc('2026-10-29T13:00:00Z'), windowStart: '08:00', windowEnd: '21:00', after: null, spacingMin: 15 })).toEqual(utc('2026-10-29T13:01:00Z'));
    expect(nextWindowSlot({ now: utc('2026-10-29T13:00:00Z'), windowStart: '08:00', windowEnd: '21:00', after: utc('2026-10-29T12:55:00Z'), spacingMin: 15 })).toEqual(utc('2026-10-29T13:10:00Z'));
    // 22h10 em Brasília → 8h do dia seguinte
    expect(nextWindowSlot({ now: utc('2026-10-30T01:10:00Z'), windowStart: '08:00', windowEnd: '21:00', after: null, spacingMin: 15 })).toEqual(utc('2026-10-30T11:00:00Z'));
    expect(spDay(utc('2026-10-30T02:00:00Z'))).toBe('2026-10-29');
  });

  it('antes da janela → início dela no mesmo dia; espaçamento que passa do fim → dia seguinte', () => {
    // 6h em Brasília
    expect(nextWindowSlot({ ...win, now: utc('2026-10-29T09:00:00Z'), after: null })).toEqual(utc('2026-10-29T11:00:00Z'));
    // último story às 20h50 → 21h05 já está fora (fim exclusivo) → 8h do dia seguinte
    expect(nextWindowSlot({ ...win, now: utc('2026-10-29T23:00:00Z'), after: utc('2026-10-29T23:50:00Z') })).toEqual(utc('2026-10-30T11:00:00Z'));
    // fim da janela exato = fora
    expect(nextWindowSlot({ ...win, now: utc('2026-10-29T23:59:00Z'), after: null })).toEqual(utc('2026-10-30T11:00:00Z'));
  });

  it('windowStartOn monta o instante do dia de Brasília', () => {
    expect(windowStartOn('2026-10-30', '08:00')).toEqual(utc('2026-10-30T11:00:00Z'));
    expect(windowStartOn('2026-10-31', '21:30')).toEqual(utc('2026-11-01T00:30:00Z'));
    expect(spDay(utc('2026-10-30T03:00:00Z'))).toBe('2026-10-30');
  });
});
