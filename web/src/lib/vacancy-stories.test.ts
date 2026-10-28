import { describe, expect, it } from 'vitest';
import { dayLine, hhLabel, pollStale, settingsSummary, vagasTabState } from '@/lib/vacancy-stories';

describe('vacancy-stories (puro)', () => {
  it('settingsSummary', () => {
    expect(settingsSummary({ cities: [], window_start: '08:00', window_end: '21:00', daily_cap: 10, vendor: 'openai' })).toBe(
      'Todas as cidades · 8h às 21h · até 10/dia · OpenAI',
    );
    expect(settingsSummary({ cities: ['Campinas', 'Jundiaí'], window_start: '09:30', window_end: '20:00', daily_cap: 5, vendor: 'gemini' })).toBe(
      '2 cidades · 9h30 às 20h · até 5/dia · Gemini',
    );
    expect(settingsSummary({ cities: ['Campinas'], window_start: '08:00', window_end: '21:00', daily_cap: 1, vendor: 'openai' })).toBe(
      '1 cidade · 8h às 21h · até 1/dia · OpenAI',
    );
  });

  it('hhLabel aceita HH:MM e ISO (Brasília)', () => {
    expect(hhLabel('08:00')).toBe('8h');
    expect(hhLabel('14:40')).toBe('14h40');
    expect(hhLabel('2026-10-29T17:40:00Z')).toBe('14h40');
    expect(hhLabel('2026-10-29T03:05:00Z')).toBe('0h05');
  });

  it('dayLine', () => {
    expect(dayLine({ today: { posted: 4, scheduled: 1, cap: 10 } })).toBe('Hoje: 4 postados de 10 (o máximo por dia que você definiu)');
    expect(dayLine({ today: { posted: 1, scheduled: 0, cap: 10 } })).toBe('Hoje: 1 postado de 10 (o máximo por dia que você definiu)');
  });

  it('pollStale: mais de 30 min sem sucesso', () => {
    const now = new Date('2026-10-29T13:31:00Z');
    expect(pollStale({ last_poll_ok_at: '2026-10-29T13:00:00Z', enabled: true }, now)).toBe(true);
    expect(pollStale({ last_poll_ok_at: '2026-10-29T13:10:00Z', enabled: true }, now)).toBe(false);
    expect(pollStale({ last_poll_ok_at: '2026-10-29T13:00:00Z', enabled: false }, now)).toBe(false);
    expect(pollStale({ last_poll_ok_at: null, enabled: true }, now)).toBe(true);
  });

  it('vagasTabState', () => {
    expect(vagasTabState({ data: null, isLoading: false, isError: false })).toBe('hidden');
    expect(vagasTabState({ data: undefined, isLoading: true, isError: false })).toBe('loading');
    expect(vagasTabState({ data: undefined, isLoading: false, isError: true })).toBe('error');
    expect(vagasTabState({ data: {}, isLoading: false, isError: true })).toBe('ready');
    expect(vagasTabState({ data: {}, isLoading: false, isError: false })).toBe('ready');
  });
});
