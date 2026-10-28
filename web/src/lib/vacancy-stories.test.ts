import { describe, expect, it } from 'vitest';
import {
  attemptsLine,
  autoPublishSummary,
  capWarning,
  previewProgress,
  sampleLine,
  templateFileError,
  weeklyFallbackWarning,
  windowError,
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

  it('capWarning: só acima de 15', () => {
    expect(capWarning(16)).toBe('Acima de 15, os posts normais da empresa podem ficar sem espaço no dia.');
    expect(capWarning(15)).toBeNull();
  });

  it('autoPublishSummary: concordância (R4)', () => {
    expect(autoPublishSummary({ n: 12, first_try: 8, redone: 2, fallback: 1, not_posted: 1 })).toBe(
      'Nos últimos 12 stories: 8 saíram certos de primeira, 2 foram refeitos, 1 foi para a reserva e você não postou 1.',
    );
    expect(autoPublishSummary({ n: 3, first_try: 1, redone: 1, fallback: 0, not_posted: 1 })).toBe(
      'Nos últimos 3 stories: 1 saiu certo de primeira, 1 foi refeito, 0 foram para a reserva e você não postou 1.',
    );
    expect(autoPublishSummary({ n: 0, first_try: 0, redone: 0, fallback: 0, not_posted: 0 })).toBeNull();
  });

  it('weeklyFallbackWarning: ≥ 30% e pelo menos 5 stories', () => {
    expect(weeklyFallbackWarning({ total: 12, fallback: 5 })).toBe(
      'Nos últimos 7 dias, 5 de 12 stories foram para a reserva. Uma arte modelo com menos texto costuma ajudar a IA.',
    );
    expect(weeklyFallbackWarning({ total: 10, fallback: 3 })).not.toBeNull();
    expect(weeklyFallbackWarning({ total: 10, fallback: 2 })).toBeNull();
    expect(weeklyFallbackWarning({ total: 4, fallback: 4 })).toBeNull();
    expect(weeklyFallbackWarning({ total: 6, fallback: 1 })).toBeNull();
  });

  it('templateFileError: tipo e tamanho (R19)', () => {
    const f = (type: string, size: number) => ({ type, size });
    expect(templateFileError(f('image/png', 1000))).toBeNull();
    expect(templateFileError(f('image/jpeg', 1000))).toBeNull();
    expect(templateFileError(f('image/webp', 1000))).toBe('Esse arquivo não serve. Envie uma imagem PNG ou JPG.');
    expect(templateFileError(f('application/pdf', 1000))).toBe('Esse arquivo não serve. Envie uma imagem PNG ou JPG.');
    expect(templateFileError(f('image/png', 12.34 * 1024 * 1024))).toBe('A imagem tem 12,4 MB e o máximo é 10 MB. Envie uma menor.');
    expect(templateFileError(f('image/png', 10 * 1024 * 1024))).toBeNull();
  });

  it('windowError: início antes do fim', () => {
    expect(windowError('08:00', '21:00')).toBeNull();
    expect(windowError('21:00', '08:00')).toBe('O início precisa ser antes do fim.');
    expect(windowError('08:00', '08:00')).toBe('O início precisa ser antes do fim.');
    expect(windowError('', '08:00')).toBeNull();
  });

  it('previewProgress: reserva vira "Conferindo os textos", tentativa nunca passa de 3', () => {
    expect(previewProgress({ step: 'art', attempt: 2 })).toBe('Criando a arte (tentativa 2 de 3)');
    expect(previewProgress({ step: 'art', attempt: 4 })).toBe('Criando a arte (tentativa 3 de 3)');
    expect(previewProgress({ step: 'check', attempt: 1 })).toBe('Conferindo os textos');
    expect(previewProgress({ step: 'fallback', attempt: 3 })).toBe('Conferindo os textos');
    expect(previewProgress({})).toBe('Criando a arte (tentativa 1 de 3)');
  });

  it('sampleLine: vaga de exemplo', () => {
    expect(sampleLine({ funcao: 'Garçom', valor: 'R$ 150', dia: 'Sáb 31/10', horario: '18h às 23h', cidade: 'Campinas' })).toBe(
      'Não há vaga aberta no Freela agora. Usamos uma vaga de exemplo: Garçom, R$ 150, Sáb 31/10, 18h às 23h, Campinas.',
    );
  });
});
