import { addDays, daysBetween, monthDayOf, weekdayOf } from '../time/dates';
describe('dates', () => {
  it('weekdayOf: 2026-09-01 é terça (2)', () => expect(weekdayOf('2026-09-01')).toBe(2));
  it('addDays cruza mês', () => expect(addDays('2026-09-30', 1)).toBe('2026-10-01'));
  it('daysBetween', () => expect(daysBetween('2026-09-01', '2026-09-08')).toBe(7));
  it('monthDayOf', () => expect(monthDayOf('2026-09-15')).toBe(15));
});
