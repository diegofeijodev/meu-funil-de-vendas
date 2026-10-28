import { describe, expect, it } from 'vitest';
import {
  attemptsLine,
  dayLine,
  fieldLabel,
  hhLabel,
  pollStale,
  postNowDialog,
  reasonChipsFeedback,
  redoLabel,
  scheduleDelayed,
  settingsSummary,
  vagasTabState,
} from '@/lib/vacancy-stories';

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

  it('fieldLabel', () => {
    expect(fieldLabel('inicio')).toBe('horário');
    expect(fieldLabel('funcao')).toBe('função');
    expect(fieldLabel('fim')).toBe('horário de término');
    expect(fieldLabel('xyz')).toBe('texto');
  });

  it('attemptsLine: IA na 2ª tentativa, de primeira, reserva', () => {
    expect(
      attemptsLine({ attempts_log: [{ n: 1, ok: false, wrong: ['inicio'] }, { n: 2, ok: true, wrong: [] }], used_fallback: false }),
    ).toBe('Feita pela IA na 2ª tentativa (a 1ª errou o horário)');
    expect(attemptsLine({ attempts_log: [{ n: 1, ok: true, wrong: [] }], used_fallback: false })).toBe('Feita pela IA de primeira');
    expect(
      attemptsLine({
        attempts_log: [1, 2, 3].map((n) => ({ n, ok: false, wrong: ['valor'] })),
        used_fallback: true,
      }),
    ).toBe(
      'Versão de reserva: a IA errou o valor nas 3 tentativas, então o sistema escreveu os textos por cima de uma foto. Os textos estão certos; o visual é mais simples.',
    );
    expect(attemptsLine({ attempts_log: [], used_fallback: false })).toBeNull();
  });

  it('redoLabel concorda no plural', () => {
    expect(redoLabel(1)).toBe('Refeita 1 vez');
    expect(redoLabel(2)).toBe('Refeita 2 vezes');
    expect(redoLabel(0)).toBeNull();
  });

  it('reasonChipsFeedback: rótulo → valor da API', () => {
    expect(reasonChipsFeedback['Texto errado']).toBe('texto_errado');
    expect(reasonChipsFeedback['Foto estranha']).toBe('foto_estranha');
    expect(reasonChipsFeedback['Não quero divulgar esta vaga']).toBe('nao_divulgar');
  });

  it('postNowDialog: fora do horário e acima do limite', () => {
    const s = { window_start: '08:00', window_end: '21:00', today: { posted: 8, scheduled: 2, cap: 10 } };
    const fora = postNowDialog('waiting_window', s, new Date('2026-10-29T01:10:00Z'));
    expect(fora.title).toBe('Postar agora, fora do horário?');
    expect(fora.description).toBe(
      'São 22h10, fora do horário que você definiu (8h às 21h). O story vai ao ar em até 5 minutos e conta no máximo de hoje.',
    );
    expect(fora.confirm).toBe('Postar agora');
    expect(fora.cancel).toBe('Esperar as 8h');
    const cap = postNowDialog('waiting_cap', s, new Date());
    expect(cap.description).toBe('Hoje já foram 10 stories de vagas (o seu máximo). Este vai ser o 11º e conta no limite de 25 do Instagram.');
    expect(cap.cancel).toBe('Deixar para amanhã');
  });

  it('scheduleDelayed: dispara depois do prazo e cancela', () => {
    let fired = 0;
    const timers: { fn: () => void; ms: number }[] = [];
    const set = (fn: () => void, ms: number) => (timers.push({ fn, ms }), timers.length);
    const cleared: number[] = [];
    const clear = (id: unknown) => void cleared.push(id as number);
    const a = scheduleDelayed(() => fired++, 6000, set, clear);
    expect(timers[0].ms).toBe(6000);
    timers[0].fn();
    expect(fired).toBe(1);
    const b = scheduleDelayed(() => fired++, 6000, set, clear);
    b.cancel();
    expect(cleared).toEqual([2]);
    expect(a).toBeDefined();
  });
});
