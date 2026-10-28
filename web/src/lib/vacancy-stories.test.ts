import { describe, expect, it } from 'vitest';
import {
  calendarPosts,
  isOwnArt,
  funcaoOfTheme,
  checkedLine,
  postVacancy,
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
  sameCities,
  settingsSummary,
  vagasTabState,
  fieldWithArticle,
  fallbackLine,
  attemptItemLine,
  checkAlertLine,
  checkAlertDetail,
  atLabel,
  postNowToast,
  APPROVED_TOAST,
  autoPublishOffToast,
  disableDialogText,
  batchToast,
  batchErrorFallback,
  rejectSelectedLabel,
  sinceLabel,
  staleNotice,
  pollLine,
  capFirst,
  aiErrorWantsIntegrations,
  approvableStories,
  vacancyEditorActions,
  ownArtNotice,
  windowHint,
  templateTextsWarning,
  arrivedEmptyText,
  createUndoQueue,
  dontPostKeepaliveRequest,
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

  it('pollStale (A7): conta a partir do maior entre ligar e a última consulta boa', () => {
    const now = new Date('2026-10-29T13:31:00Z');
    const on = { enabled: true, enabled_at: '2026-10-29T10:00:00Z' };
    expect(pollStale({ ...on, last_poll_ok_at: '2026-10-29T13:00:00Z' }, now)).toBe(true);
    expect(pollStale({ ...on, last_poll_ok_at: '2026-10-29T13:10:00Z' }, now)).toBe(false);
    expect(pollStale({ ...on, enabled: false, last_poll_ok_at: '2026-10-29T13:00:00Z' }, now)).toBe(false);
    // Acabou de ligar e a 1ª consulta ainda não rodou: não é desatualizado.
    expect(pollStale({ enabled: true, enabled_at: '2026-10-29T13:25:00Z', last_poll_ok_at: null }, now)).toBe(false);
    // Ligou há 31 min e nunca consultou com sucesso: desatualizado.
    expect(pollStale({ enabled: true, enabled_at: '2026-10-29T13:00:00Z', last_poll_ok_at: null }, now)).toBe(true);
    // Religou agora; a última consulta boa é de antes de ligar: conta a partir de ligar.
    expect(pollStale({ enabled: true, enabled_at: '2026-10-29T13:20:00Z', last_poll_ok_at: '2026-10-20T10:00:00Z' }, now)).toBe(false);
    expect(pollStale({ enabled: true, enabled_at: null, last_poll_ok_at: null }, now)).toBe(false);
  });

  it('pollLine (A7): "Primeira consulta…" enquanto não houve consulta depois de ligar', () => {
    expect(pollLine({ enabled_at: '2026-10-29T13:00:00Z', last_poll_at: null })).toBe('Primeira consulta ao Freela em até 10 minutos.');
    expect(pollLine({ enabled_at: '2026-10-29T13:00:00Z', last_poll_at: '2026-10-29T12:50:00Z' })).toBe('Primeira consulta ao Freela em até 10 minutos.');
    expect(pollLine({ enabled_at: '2026-10-29T13:00:00Z', last_poll_at: '2026-10-29T17:40:00Z' })).toBe('Última consulta: 14h40 (a cada 10 minutos)');
    expect(pollLine({ enabled_at: null, last_poll_at: '2026-10-29T17:40:00Z' })).toBe('Última consulta: 14h40 (a cada 10 minutos)');
  });

  it('staleNotice e sinceLabel: dia só quando não é hoje', () => {
    const now = new Date('2026-10-29T18:00:00Z'); // 15h de Brasília, 29/10
    expect(sinceLabel('2026-10-29T17:20:00Z', now)).toBe('desde as 14h20');
    expect(sinceLabel('2026-10-28T17:20:00Z', now)).toBe('desde 28/10 às 14h20');
    expect(staleNotice({ enabled_at: '2026-10-20T10:00:00Z', last_poll_ok_at: '2026-10-29T17:10:00Z' }, now)).toBe(
      'Não conseguimos consultar as vagas do Freela desde as 14h10. Tentamos de novo sozinhos a cada 10 minutos. Quando voltar, as vagas novas entram normalmente.',
    );
    expect(staleNotice({ enabled_at: '2026-10-29T10:00:00Z', last_poll_ok_at: null }, now)).toBe(
      'Não conseguimos consultar as vagas do Freela ainda. Tentamos de novo sozinhos a cada 10 minutos. Quando voltar, as vagas novas entram normalmente.',
    );
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

  it('fieldWithArticle (B1): rótulos com artigo', () => {
    expect(['funcao', 'valor', 'data', 'inicio', 'fim', 'cidade', 'estabelecimento', 'xyz'].map(fieldWithArticle)).toEqual([
      'a função',
      'o valor',
      'a data',
      'o horário de início',
      'o horário de término',
      'a cidade',
      'o nome do estabelecimento',
      'o texto',
    ]);
  });

  it('attemptsLine (B1): IA com artigos, só texto proibido, de primeira', () => {
    const f = (wrong: string[], forbidden: string[] = []) => ({ n: 1, ok: false, wrong, forbidden });
    expect(
      attemptsLine({ attempts_log: [f(['data']), { n: 2, ok: true, wrong: [], forbidden: [] }], used_fallback: false }),
    ).toBe('Feita pela IA na 2ª tentativa (a 1ª errou a data)');
    expect(
      attemptsLine({
        attempts_log: [f(['funcao']), { ...f(['cidade', 'funcao']), n: 2 }, { n: 3, ok: true, wrong: [], forbidden: [] }],
        used_fallback: false,
      }),
    ).toBe('Feita pela IA na 3ª tentativa (as 2 primeiras erraram a função e a cidade)');
    expect(
      attemptsLine({ attempts_log: [f([], ['www.marca.com.br']), { n: 2, ok: true, wrong: [], forbidden: [] }], used_fallback: false }),
    ).toBe('Feita pela IA na 2ª tentativa (a 1ª pôs na arte um texto que não podia estar lá)');
    expect(
      attemptsLine({
        attempts_log: [f(['data']), { ...f([], ['Rua X']), n: 2 }, { n: 3, ok: true, wrong: [], forbidden: [] }],
        used_fallback: false,
      }),
    ).toBe('Feita pela IA na 3ª tentativa (as 2 primeiras erraram a data e puseram na arte um texto que não podia estar lá)');
    expect(attemptsLine({ attempts_log: [{ n: 1, ok: true, wrong: [], forbidden: [] }], used_fallback: false })).toBe('Feita pela IA de primeira');
    expect(attemptsLine({ attempts_log: [], used_fallback: false })).toBeNull();
  });

  it('fallbackLine / attemptsLine na reserva (B1): com foto e sem foto, pelo `fallback_kind`', () => {
    const tries = [1, 2, 3].map((n) => ({ n, kind: 'ai', ok: false, wrong: n === 1 ? ['valor', 'data'] : ['data'], forbidden: [] }));
    expect(fallbackLine({ attempts: tries, fallback_kind: 'photo' })).toBe(
      'Versão de reserva: a IA errou a data nas 3 tentativas, então o sistema escreveu os textos por cima de uma foto. Os textos estão certos; o visual é mais simples.',
    );
    expect(fallbackLine({ attempts: tries, fallback_kind: 'plain' })).toBe(
      'Versão de reserva: a IA errou a data nas 3 tentativas, então o sistema escreveu os textos sobre um fundo com as cores da sua arte. Os textos estão certos; o visual é mais simples.',
    );
    // só texto proibido nas 3
    const proib = [1, 2, 3].map((n) => ({ n, kind: 'ai', ok: false, wrong: [], forbidden: ['@marca'] }));
    expect(fallbackLine({ attempts: proib, fallback_kind: 'photo' })).toBe(
      'Versão de reserva: a IA pôs na arte um texto que não podia estar lá nas 3 tentativas, então o sistema escreveu os textos por cima de uma foto. Os textos estão certos; o visual é mais simples.',
    );
    // posts antigos sem `fallback_kind`: deduz pelo último passo da reserva
    expect(fallbackLine({ attempts: [...tries, { n: 4, kind: 'fallback_photo', ok: false, wrong: [], forbidden: [] }, { n: 5, kind: 'fallback_plain', ok: true, wrong: [], forbidden: [] }], fallback_kind: null })).toContain(
      'sobre um fundo com as cores da sua arte',
    );
    expect(attemptsLine({ attempts_log: tries, used_fallback: true, fallback_kind: 'photo' })).toBe(fallbackLine({ attempts: tries, fallback_kind: 'photo' }));
  });

  it('attemptItemLine: "Ver as 3 tentativas" com artigos', () => {
    expect(attemptItemLine({ n: 1, ok: false, wrong: ['valor', 'data'], forbidden: [] })).toBe('Tentativa 1: errou o valor e a data');
    expect(attemptItemLine({ n: 2, ok: false, wrong: [], forbidden: ['x'] })).toBe('Tentativa 2: pôs na arte um texto que não podia estar lá');
    expect(attemptItemLine({ n: 3, ok: true, wrong: [], forbidden: [] })).toBe('Tentativa 3: confere');
    expect(attemptItemLine({ n: 3, ok: false, wrong: [], forbidden: [], error: 'A IA não respondeu.' })).toBe('Tentativa 3: A IA não respondeu.');
    expect(attemptItemLine({ n: 3, ok: false, wrong: [], forbidden: [] })).toBe('Tentativa 3: não passou na conferência');
  });

  it('checkAlertLine / checkAlertDetail (A3)', () => {
    expect(checkAlertLine(['www.marca.com.br'])).toBe(
      'A conferência achou na arte um texto que não devia estar lá: “www.marca.com.br”. Olhe a arte antes de aprovar.',
    );
    expect(checkAlertLine(['a', 'b'])).toBe('A conferência achou na arte textos que não deviam estar lá: “a” e “b”. Olhe a arte antes de aprovar.');
    expect(checkAlertDetail(['www.marca.com.br'])).toBe(
      'Versão de reserva: o sistema escreveu os textos da vaga, mas a conferência achou também “www.marca.com.br”, que não devia estar na arte (pode vir da logo). Olhe antes de aprovar.',
    );
    expect(checkAlertDetail(['a', 'b'])).toBe(
      'Versão de reserva: o sistema escreveu os textos da vaga, mas a conferência achou também “a” e “b”, que não deviam estar na arte (podem vir da logo). Olhe antes de aprovar.',
    );
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

  it('postNowDialog (B3): por `wait_kind`', () => {
    const s = { window_start: '08:00', window_end: '21:00', today: { posted: 8, scheduled: 2, cap: 10 } };
    const st = (display: 'waiting_window' | 'waiting_cap', wait_kind: 'cap' | 'instagram' | 'window' | 'spacing' | null, scheduled_at: string | null = null) => ({
      display,
      wait_kind,
      scheduled_at,
    });
    const fora = postNowDialog(st('waiting_window', 'window'), s, new Date('2026-10-29T01:10:00Z'));
    expect(fora).toEqual({
      title: 'Postar agora, fora do horário?',
      description: 'São 22h10, fora do horário que você definiu (8h às 21h). O story vai ao ar em até 5 minutos e conta no máximo de hoje.',
      confirm: 'Postar agora',
      cancel: 'Esperar as 8h',
    });
    const cap = postNowDialog(st('waiting_cap', 'cap'), s, new Date());
    expect(cap).toEqual({
      title: 'Postar agora, acima do seu máximo?',
      description: 'Hoje já tem 10 stories de vagas postados ou agendados (o seu máximo). Este vai ser o 11º.',
      confirm: 'Postar agora',
      cancel: 'Deixar para amanhã',
    });
    expect(postNowDialog(st('waiting_cap', 'cap'), { ...s, today: { posted: 1, scheduled: 0, cap: 1 } }, new Date()).description).toBe(
      'Hoje já tem 1 story de vaga postado ou agendado (o seu máximo). Este vai ser o 2º.',
    );
    expect(postNowDialog(st('waiting_cap', 'instagram'), s, new Date())).toEqual({
      title: 'Postar agora, com a conta perto do limite do Instagram?',
      description:
        'A conta está perto do limite de 25 publicações em 24 h, somando os posts normais. Este story usa o espaço que guardamos para os posts normais da empresa.',
      confirm: 'Postar agora',
      cancel: 'Esperar a vez',
    });
    // 15 min entre stories, janela aberta: marcado para amanhã às 8h (agora: 29/10 15h de Brasília)
    const now = new Date('2026-10-29T18:00:00Z');
    expect(postNowDialog(st('waiting_window', 'spacing', '2026-10-30T11:00:00Z'), s, now)).toEqual({
      title: 'Postar agora, antes do horário marcado?',
      description: 'Este story está marcado para amanhã às 8h. Postar agora conta no máximo de hoje.',
      confirm: 'Postar agora',
      cancel: 'Manter o horário',
    });
    // sem `wait_kind` (API antiga): decide pela situação
    expect(postNowDialog(st('waiting_cap', null), s, now).title).toBe('Postar agora, acima do seu máximo?');
    expect(postNowDialog(st('waiting_window', null), s, now).title).toBe('Postar agora, fora do horário?');
  });

  it('atLabel: hoje, amanhã ou dia (Brasília)', () => {
    const now = new Date('2026-10-29T18:00:00Z');
    expect(atLabel('2026-10-29T20:00:00Z', now)).toBe('às 17h');
    expect(atLabel('2026-10-30T11:00:00Z', now)).toBe('amanhã às 8h');
    expect(atLabel('2026-10-31T11:30:00Z', now)).toBe('dia 31/10 às 8h30');
  });

  it('postNowToast (B3) e toast de aprovação (B5d)', () => {
    expect(postNowToast(true, false)).toBe('O story vai ao ar em até 5 minutos.');
    expect(postNowToast(true, true)).toBe('O story vai ao ar em até 5 minutos.');
    expect(postNowToast(false, false)).toBe('Vamos criar a arte agora. Ela aparece em Para aprovar em até 15 minutos.');
    expect(postNowToast(false, true)).toBe('Vamos criar a arte agora. O story vai ao ar assim que ficar pronto, em até 15 minutos.');
    expect(APPROVED_TOAST).toBe('Story aprovado. Vai ao ar no próximo horário livre; o horário aparece na lista.');
  });

  it('autoPublishOffToast (A1): quantos voltaram para Para aprovar', () => {
    expect(autoPublishOffToast(0)).toBe('Pronto: cada story espera sua aprovação.');
    expect(autoPublishOffToast(1)).toBe('Pronto: cada story espera sua aprovação. 1 story que já estava pronto voltou para Para aprovar.');
    expect(autoPublishOffToast(3)).toBe('Pronto: cada story espera sua aprovação. 3 stories que já estavam prontos voltaram para Para aprovar.');
  });

  it('disableDialogText: só as partes maiores que zero e concordância', () => {
    const resto =
      'Os que já foram postados continuam no Instagram até sumirem sozinhos (24 h). Vagas publicadas enquanto estiver desligado não entram depois, mesmo se você ligar de novo.';
    expect(disableDialogText({ ready: 0, to_approve: 0 })).toBe(resto);
    expect(disableDialogText({ ready: 1, to_approve: 0 })).toBe(`1 story pronto não vai ao ar. ${resto}`);
    expect(disableDialogText({ ready: 0, to_approve: 1 })).toBe(`1 esperando aprovação não vai ao ar. ${resto}`);
    expect(disableDialogText({ ready: 2, to_approve: 1 })).toBe(`2 stories prontos e 1 esperando aprovação não vão ao ar. ${resto}`);
    expect(disableDialogText({ ready: 0, to_approve: 3 })).toBe(`3 esperando aprovação não vão ao ar. ${resto}`);
  });

  it('batchToast / batchErrorFallback / rejectSelectedLabel (Aprovações)', () => {
    expect(batchToast('approve', { posts: 1, vacancies: 0 })).toBe('1 post aprovado.');
    expect(batchToast('approve', { posts: 3, vacancies: 0 })).toBe('3 posts aprovados.');
    expect(batchToast('reject', { posts: 1, vacancies: 0 })).toBe('1 post rejeitado.');
    expect(batchToast('reject', { posts: 2, vacancies: 1 })).toBe('2 posts rejeitados · 1 story de vaga não vai ao ar.');
    expect(batchToast('reject', { posts: 0, vacancies: 2 })).toBe('2 stories de vagas não vão ao ar.');
    expect(batchToast('reject', { posts: 0, vacancies: 0 })).toBeNull();
    expect(batchErrorFallback('approve')).toBe('Não conseguimos aprovar um dos posts. Tente de novo.');
    expect(batchErrorFallback('reject')).toBe('Não conseguimos cancelar um dos posts. Tente de novo.');
    const vac = { source: 'vacancy', creative_brief: { vacancy: { story_id: 's1' } } };
    expect(rejectSelectedLabel([vac, vac])).toBe('Não postar selecionados');
    expect(rejectSelectedLabel([vac, { source: 'plan' }])).toBe('Rejeitar selecionados');
    expect(rejectSelectedLabel([])).toBe('Rejeitar selecionados');
  });

  it('capWarning: só acima de 15', () => {
    expect(capWarning(16)).toBe('Acima de 15, os posts normais da empresa podem ficar sem espaço no dia.');
    expect(capWarning(15)).toBeNull();
  });

  it('autoPublishSummary: sem as partes com zero (concordância, R4)', () => {
    expect(autoPublishSummary({ n: 12, first_try: 9, redone: 2, fallback: 1, not_posted: 1 })).toBe(
      'Nos últimos 12 stories: 9 saíram certos de primeira, 2 foram refeitos e 1 foi para a reserva. Você não postou 1.',
    );
    expect(autoPublishSummary({ n: 3, first_try: 1, redone: 1, fallback: 0, not_posted: 1 })).toBe(
      'Nos últimos 3 stories: 1 saiu certo de primeira e 1 foi refeito. Você não postou 1.',
    );
    expect(autoPublishSummary({ n: 5, first_try: 5, redone: 0, fallback: 0, not_posted: 0 })).toBe('Nos últimos 5 stories: 5 saíram certos de primeira.');
    expect(autoPublishSummary({ n: 1, first_try: 0, redone: 0, fallback: 0, not_posted: 1 })).toBe('No último story: você não postou 1.');
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

  it('sameCities: conjunto, ordem não importa', () => {
    expect(sameCities(['A', 'B'], ['B', 'A'])).toBe(true);
    expect(sameCities([], [])).toBe(true);
    expect(sameCities(['A'], ['A', 'B'])).toBe(false);
    expect(sameCities(['A', 'B'], ['A', 'C'])).toBe(false);
  });

  it('checkedLine: usa os nomes da aba Vagas, sem repetir', () => {
    expect(checkedLine(['funcao', 'valor', 'inicio'])).toBe('Conferido: função, valor, horário');
    expect(checkedLine(['inicio', 'fim'])).toBe('Conferido: horário, horário de término');
    expect(checkedLine([])).toBeNull();
  });

  it('postVacancy: só para source vacancy com story_id; lê o check_alert (A3)', () => {
    const brief = { vacancy: { story_id: 's1', checked_fields: ['valor'], requires_approval: true } };
    expect(postVacancy({ source: 'vacancy', creative_brief: brief })).toEqual({
      story_id: 's1',
      checked_fields: ['valor'],
      requires_approval: true,
      check_alert: null,
    });
    expect(postVacancy({ source: 'vacancy', creative_brief: { vacancy: { ...brief.vacancy, check_alert: ['@marca', 3] } } })?.check_alert).toEqual(['@marca']);
    expect(postVacancy({ source: 'vacancy', creative_brief: { vacancy: { ...brief.vacancy, check_alert: [] } } })?.check_alert).toBeNull();
    expect(postVacancy({ source: 'plan', creative_brief: brief })).toBeNull();
    expect(postVacancy({ source: 'vacancy', creative_brief: null })).toBeNull();
  });

  it('funcaoOfTheme: segunda parte do tema', () => {
    expect(funcaoOfTheme('Vaga · Garçom · Coco Bambu · Sáb 29/10')).toBe('Garçom');
    expect(funcaoOfTheme(null)).toBe('selecionada');
  });

  it('isOwnArt: último passo upload ou library', () => {
    expect(isOwnArt({ ai_generation_log: [{ step: 'vacancy_art' }, { step: 'upload' }] })).toBe(true);
    expect(isOwnArt({ ai_generation_log: [{ step: 'library' }] })).toBe(true);
    expect(isOwnArt({ ai_generation_log: [{ step: 'upload' }, { step: 'vacancy_art' }] })).toBe(false);
    expect(isOwnArt({})).toBe(false);
  });

  it('calendarPosts: esconde stories de vaga por padrão', () => {
    const posts = [{ id: 'a', source: 'vacancy' }, { id: 'b', source: 'plan' }, { id: 'c' }];
    expect(calendarPosts(posts, false).map((p) => p.id)).toEqual(['b', 'c']);
    expect(calendarPosts(posts, true)).toHaveLength(3);
  });

  it('capFirst e aiErrorWantsIntegrations', () => {
    expect(capFirst('horário de início')).toBe('Horário de início');
    expect(capFirst('')).toBe('');
    expect(aiErrorWantsIntegrations('A chave do OpenAI foi recusada. Cole uma chave nova em Integrações.')).toBe(true);
    expect(aiErrorWantsIntegrations('Sua conta OpenAI está sem créditos ou no limite de uso.')).toBe(true);
    expect(aiErrorWantsIntegrations('A IA não devolveu uma arte que dê para usar. Tentamos de novo sozinhos em alguns minutos.')).toBe(false);
    expect(aiErrorWantsIntegrations(null)).toBe(false);
  });

  it('approvableStories (A4): "Para aprovar" = to_approve e can.approve, sem os escondidos', () => {
    const st = (id: string, display: string, approve: boolean) => ({ id, display, can: { approve } });
    const rows = [st('a', 'to_approve', true), st('b', 'to_approve', false), st('c', 'ready', false), st('d', 'to_approve', true)];
    expect(approvableStories(rows, new Set(['d'])).map((r) => r.id)).toEqual(['a']);
  });

  it('vacancyEditorActions (A2): story de vaga no editor', () => {
    expect(vacancyEditorActions('pending_approval')).toEqual({ approve: true, dontPost: true, redo: true, upload: true });
    for (const st of ['approved', 'ready', 'scheduled'])
      expect(vacancyEditorActions(st)).toEqual({ approve: false, dontPost: true, redo: true, upload: true });
    for (const st of ['published', 'publishing', 'cancelled', 'failed', 'needs_review'])
      expect(vacancyEditorActions(st)).toEqual({ approve: false, dontPost: false, redo: false, upload: false });
    expect(ownArtNotice(true)).toBe('A sua arte não passa pela conferência.');
    expect(ownArtNotice(false)).toBe('Se você enviar a sua própria arte, ela não passa pela conferência.');
  });

  it('windowHint (B7), templateTextsWarning (I5), arrivedEmptyText', () => {
    expect(windowHint('08:00')).toBe('Vaga que chegar fora desse horário espera e vai ao ar a partir das 8h.');
    expect(windowHint('09:30')).toBe('Vaga que chegar fora desse horário espera e vai ao ar a partir das 9h30.');
    expect(windowHint('')).toBe('Vaga que chegar fora desse horário espera e vai ao ar quando o horário abrir.');
    expect(templateTextsWarning({ texts_count: 0 })).toBe(
      'Não conseguimos ler os textos desta arte modelo. Sem eles, o sistema não consegue barrar texto copiado do modelo. Envie a arte de novo ou use uma com textos mais nítidos.',
    );
    expect(templateTextsWarning({ texts_count: 4 })).toBeNull();
    expect(templateTextsWarning(null)).toBeNull();
    const s = { enabled: false, enabled_at: null, last_poll_ok_at: null };
    expect(arrivedEmptyText('all', s)).toBe('Ligue os stories das vagas para as vagas novas aparecerem aqui.');
    expect(arrivedEmptyText('all', { ...s, enabled: true, enabled_at: '2026-10-28T17:30:00Z' })).toBe(
      'Nenhuma vaga nova desde que você ligou (28/10 às 14h30). Consultamos o Freela a cada 10 minutos.',
    );
    expect(arrivedEmptyText('live', s)).toBe('Nenhum story no ar agora.');
    expect(arrivedEmptyText('not_posted', s)).toBe('Nenhuma vaga deixou de ir ao ar.');
  });

  it('createUndoQueue (M3): roda no prazo, Desfazer cancela, flush manda já os pendentes', () => {
    const timers = new Map<number, () => void>();
    let seq = 0;
    const set = (fn: () => void) => (timers.set(++seq, fn), seq);
    const clear = (id: unknown) => void timers.delete(id as number);
    const q = createUndoQueue(set, clear);
    const ran: string[] = [];
    const flushed: string[] = [];
    q.add('a', () => ran.push('a'), () => flushed.push('a'), 6000);
    q.add('b', () => ran.push('b'), () => flushed.push('b'), 6000);
    q.add('c', () => ran.push('c'), () => flushed.push('c'), 6000);
    const fire = (id: number) => {
      const fn = timers.get(id)!;
      timers.delete(id); // como o setTimeout de verdade: dispara uma vez
      fn();
    };
    fire(1); // prazo de "a"
    expect(ran).toEqual(['a']);
    expect(q.has('a')).toBe(false);
    expect(q.cancel('b')).toBe(true); // Desfazer
    expect(q.cancel('b')).toBe(false);
    q.flush(); // aba fechando: "c" sai já, sem esperar o timer
    expect(flushed).toEqual(['c']);
    expect(timers.size).toBe(0);
    expect(q.size()).toBe(0);
    q.flush();
    expect(flushed).toEqual(['c']);
  });

  it('dontPostKeepaliveRequest (M3): mesma rota, bearer e keepalive', () => {
    expect(dontPostKeepaliveRequest('http://api.test', 'ws1', 'st1', 'tok')).toEqual([
      'http://api.test/v1/workspaces/ws1/vacancy-stories/stories/st1/dont-post',
      { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: '{}' },
    ]);
    expect(dontPostKeepaliveRequest('http://api.test', 'ws1', 'st1', null)[1].headers).toEqual({ 'Content-Type': 'application/json' });
  });
});
