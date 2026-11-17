import { describe, expect, it } from 'vitest';
import {
  BRAND_PHOTOS_TEXT,
  brandCounter,
  brandPhotosToast,
  liveAnnouncement,
  packageInvite,
  styleInvite,
  INVITE_CTA,
  SELECTION_TEXT,
  promotedToast,
  refsPollInterval,
  allSelectionSourcesFailed,
  branchConsequence,
  branchToast,
  branchSubmitLabel,
  selectionPollInterval,
  selectionSignature,
  selectionAnnouncement,
  selectionState,
  type SelectionCtx,
  type SelectionViewLike,
  photoLabel,
  refOrigin,
  refScope,
  refStateText,
  removedToast,
  removeLabel,
  seeAllLabel,
  stopSourceQuestion,
  visibleRefs,
  type StyleRefLike,
} from './style-refs';

const r = (o: Partial<StyleRefLike> = {}): StyleRefLike => ({ source: 'upload', from_source: false, source_title: null, campaign_id: null, campaign_name: null, status: 'ready', attempts: 0, summary: 'cores laranja; luz quente', ...o });

describe('style-refs', () => {
  it('origem e onde vale', () => {
    expect(refOrigin(r())).toBe('Imagem enviada');
    expect(refOrigin(r({ source: 'pinterest' }))).toBe('Pin do Pinterest');
    expect(refOrigin(r({ source: 'pinterest', from_source: true, source_title: 'Bares escuros' }))).toBe('Pasta Bares escuros');
    expect(refOrigin(r({ source: 'pinterest', from_source: true }))).toBe('Pasta do Pinterest');
    expect(refScope(r())).toBe('vale para toda a marca');
    expect(refScope(r({ campaign_id: 'c', campaign_name: 'Jundiaí' }))).toBe('só na campanha Jundiaí');
  });
  it('estados', () => {
    expect(refStateText(r({ status: 'processing' }))).toBe('Lendo o estilo…');
    expect(refStateText(r({ status: 'processing', attempts: 1 }))).toBe('Não deu para ler agora. Tentando de novo sozinho (2 de 3).');
    expect(refStateText(r())).toBe('Em uso. O que eu peguei: cores laranja; luz quente');
    expect(refStateText(r({ summary: null }))).toBe('Em uso. O que eu peguei: estilo lido.');
    expect(refStateText(r({ status: 'failed' }))).toBe('Não conseguimos ler esta imagem. Remova e tente outra.');
  });
  it('contador, parar, remover, lista de 4', () => {
    expect(brandCounter(12)).toBe('12 de 30 referências nesta marca. Quando enche, as mais antigas das pastas dão lugar às novas.');
    expect(stopSourceQuestion(5)).toBe('Parar de acompanhar esta pasta? As 5 referências que vieram dela saem da marca.');
    expect(removedToast({ from_source: true })).toBe('Referência removida. Ela não volta, mesmo continuando na pasta.');
    expect(removedToast({ from_source: false })).toBe('Referência removida.');
    expect(removeLabel(r({ source: 'pinterest' }))).toBe('Remover referência: Pin do Pinterest');
    expect(visibleRefs([1, 2, 3, 4, 5, 6], false)).toEqual([1, 2, 3, 4]);
    expect(visibleRefs([1, 2, 3, 4, 5, 6], true)).toHaveLength(6);
    expect(seeAllLabel(38)).toBe('Ver todas (38)');
  });
  it('região viva: anuncia leitura nova, pronta e falha (uma frase por vez)', () => {
    expect(liveAnnouncement(undefined, [{ id: 'a', status: 'processing' }])).toBeNull();
    expect(liveAnnouncement([], [{ id: 'a', status: 'processing' }])).toBe('Lendo o estilo…');
    expect(liveAnnouncement([{ id: 'a', status: 'processing' }], [{ id: 'a', status: 'ready' }])).toBe('Referência pronta. O estilo já está em uso.');
    expect(liveAnnouncement([{ id: 'a', status: 'processing' }], [{ id: 'a', status: 'failed' }])).toBe('Não conseguimos ler uma referência.');
    // prioridade: falha > pronta > lendo
    expect(
      liveAnnouncement(
        [{ id: 'a', status: 'processing' }, { id: 'b', status: 'processing' }],
        [{ id: 'a', status: 'ready' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'processing' }],
      ),
    ).toBe('Não conseguimos ler uma referência.');
    expect(
      liveAnnouncement([{ id: 'a', status: 'processing' }], [{ id: 'a', status: 'ready' }, { id: 'c', status: 'processing' }]),
    ).toBe('Referência pronta. O estilo já está em uso.');
  });

  it('fotos da marca: rótulo da grade e aviso de envio', () => {
    expect(photoLabel('Produto')).toBe('Foto de: Produto');
    expect(photoLabel(null)).toBe('Foto da sua marca');
    expect(brandPhotosToast(1)).toBe('Foto enviada. Ela pode aparecer nas artes.');
    expect(brandPhotosToast(3)).toBe('3 fotos enviadas. Elas podem aparecer nas artes.');
    expect(BRAND_PHOTOS_TEXT.option('Ambiente')).toBe('Foto de: Ambiente');
  });
  it('convite onde a arte é vista', () => {
    expect(styleInvite(null)).toBeNull(); // peça antiga / prompt escrito à mão
    expect(styleInvite(undefined)).toBeNull();
    expect(styleInvite({ own: [], library: [], brand_id: 'b1' })).toEqual({ text: 'Estilo: sem referências.', cta: true, brandId: 'b1' });
    expect(styleInvite({ own: ['a'], library: [], brand_id: 'b1' })).toEqual({ text: 'Estilo: seguiu 1 referência sua.', cta: false, brandId: 'b1' });
    expect(styleInvite({ own: ['a', 'b', 'c'], library: [], brand_id: null })?.text).toBe('Estilo: seguiu 3 referências suas.');
    expect(packageInvite([null, { own: ['a'], library: [], brand_id: 'b' }, { own: ['a', 'b'], library: [], brand_id: 'b' }])?.text).toBe('Estilo: seguiu 2 referências suas.');
    expect(packageInvite([undefined, null])).toBeNull();
    expect(INVITE_CTA).toBe('Mostrar o estilo que eu quero');
  });
  it('convite: suas e da Seleção juntas (sem botão)', () => {
    expect(styleInvite({ own: [], library: ['x'], brand_id: 'b' })).toEqual({ text: 'Estilo: seguiu a Seleção do Meu Funil.', cta: true, brandId: 'b' });
    expect(styleInvite({ own: [], library: [], brand_id: 'b' })?.text).toBe('Estilo: sem referências.');
    expect(styleInvite({ own: ['a'], library: ['x'], brand_id: 'b' })).toEqual({ text: 'Estilo: seguiu 1 referência sua e a Seleção do Meu Funil.', cta: false, brandId: 'b' });
    expect(styleInvite({ own: ['a', 'b'], library: ['x'], brand_id: 'b' })?.text).toBe('Estilo: seguiu 2 referências suas e a Seleção do Meu Funil.');
  });
});

describe('Seleção do Meu Funil: textos', () => {
  it('textos fixos e plural', () => {
    expect(SELECTION_TEXT.title).toBe('Seleção do Meu Funil');
    expect(SELECTION_TEXT.explanation).toBe(
      'Quando você tem menos de 4 referências suas, o Meu Funil põe sozinho nesta marca referências de pastas públicas do Pinterest do seu ramo, escolhidas pela nossa equipe. Cada uma é lida uma vez com a chave de IA da empresa (em Integrações), e isso gasta crédito dela. São no máximo 12 por vez, e as suas vêm sempre primeiro.',
    );
    expect(SELECTION_TEXT.toggle).toBe('Usar a Seleção do Meu Funil nesta marca');
    expect(SELECTION_TEXT.toggleHint).toBe('Liga e desliga na hora, sem precisar salvar.');
    expect(SELECTION_TEXT.viewerNote).toBe('Só quem edita a marca pode ligar, desligar ou trocar o ramo.');
    expect(SELECTION_TEXT.branchAuto('Açaí e sorvete')).toBe('Ramo: Açaí e sorvete, pelo Segmento da marca (aba DNA).');
    expect(SELECTION_TEXT.branchChosen('Bar e bebidas')).toBe('Ramo: Bar e bebidas, escolhido por você.');
    expect(SELECTION_TEXT.counter(8)).toBe('8 de 12 referências da seleção nesta marca.');
    expect(SELECTION_TEXT.sourcesTitle).toBe('Pastas da seleção');
    expect(SELECTION_TEXT.refsTitle).toBe('Referências da seleção');
    expect(SELECTION_TEXT.seeAll(8)).toBe('Ver todas da seleção (8)');
    expect(SELECTION_TEXT.changeBranch).toBe('Trocar o ramo');
    expect(SELECTION_TEXT.chooseBranch).toBe('Escolher o ramo');
    expect(SELECTION_TEXT.pickQuestion).toBe('Escolha o ramo mais parecido com o seu negócio:');
    expect(SELECTION_TEXT.noneOption).toBe('Nenhum desses');
    expect(SELECTION_TEXT.currentSuffix).toBe(' (atual)');
    expect(SELECTION_TEXT.useBranch).toBe('Usar este ramo');
    expect(SELECTION_TEXT.stayWithout).toBe('Ficar sem seleção');
    expect(SELECTION_TEXT.cancel).toBe('Cancelar');
    expect(SELECTION_TEXT.openIntegrations).toBe('Abrir Integrações');
    expect(SELECTION_TEXT.retry).toBe('Tentar de novo');
  });
  it('troca de ramo: consequência, toasts e erro', () => {
    expect(SELECTION_TEXT.branchChangeConsequence(3, 'Bar e bebidas')).toBe('As 3 referências da seleção de agora saem desta marca. Entram as do ramo Bar e bebidas, lidas com a chave de IA da empresa.');
    expect(SELECTION_TEXT.branchChangeConsequence(1, 'Bar e bebidas')).toBe('A referência da seleção de agora sai desta marca. Entram as do ramo Bar e bebidas, lidas com a chave de IA da empresa.');
    expect(SELECTION_TEXT.branchNoneConsequence(2)).toBe('As 2 referências da seleção saem desta marca e nada entra no lugar.');
    expect(SELECTION_TEXT.branchNoneConsequence(1)).toBe('A referência da seleção sai desta marca e nada entra no lugar.');
    expect(SELECTION_TEXT.branchChosenToast('Restaurante')).toBe('Ramo escolhido: Restaurante.');
    expect(SELECTION_TEXT.branchChangedToast('Restaurante', false)).toBe('Ramo trocado para Restaurante.');
    expect(SELECTION_TEXT.branchChangedToast('Restaurante', true)).toBe('Ramo trocado para Restaurante. As referências da seleção anterior saíram.');
    expect(SELECTION_TEXT.branchNoneToast).toBe('Pronto. A seleção não traz referências para esta marca.');
    expect(SELECTION_TEXT.branchError).toBe('Não conseguimos trocar o ramo. Verifique a conexão e tente de novo.');
  });
  it('ligar e desligar', () => {
    expect(SELECTION_TEXT.onToast).toBe('Seleção ligada.');
    expect(SELECTION_TEXT.offToast).toBe('Seleção desligada.');
    expect(SELECTION_TEXT.offWithRefsToast).toBe('Seleção desligada. As referências dela saíram desta marca.');
    expect(SELECTION_TEXT.toggleError).toBe('Não conseguimos mudar a seleção. Verifique a conexão e tente de novo.');
    expect(SELECTION_TEXT.offTitle).toBe('Desligar a Seleção do Meu Funil?');
    expect(SELECTION_TEXT.offQuestion(4)).toBe('As 4 referências da seleção saem desta marca. Se você ligar de novo, elas são lidas outra vez com a chave de IA da empresa.');
    expect(SELECTION_TEXT.offQuestion(1)).toBe('A referência da seleção sai desta marca. Se você ligar de novo, ela é lida outra vez com a chave de IA da empresa.');
    expect(SELECTION_TEXT.offConfirm).toBe('Desligar a seleção');
    expect(SELECTION_TEXT.offCancel).toBe('Manter ligada');
  });
  it('pasta, referência e painel de cima', () => {
    expect(SELECTION_TEXT.folderLabel).toBe('Seleção do Meu Funil');
    expect(SELECTION_TEXT.folderFallbackTitle).toBe('Pasta do Pinterest');
    expect(SELECTION_TEXT.folderHelp).toBe('Para tirar, desligue a seleção ou troque o ramo.');
    expect(SELECTION_TEXT.folderError).toBe('Esta pasta não respondeu agora. Tentamos de novo amanhã, sozinhos; as outras pastas da seleção continuam.');
    expect(SELECTION_TEXT.ownSources).toBe('Suas pastas acompanhadas');
    expect(SELECTION_TEXT.ownRefs).toBe('Suas referências');
    expect(SELECTION_TEXT.emptyWithSelection).toBe(
      'Nenhuma referência sua ainda. Por enquanto as artes seguem a Seleção do Meu Funil. Cole o link de uma pasta do Pinterest com o estilo que você quer.',
    );
    expect(SELECTION_TEXT.campaignHelp).toBe('Para tirar, desligue a Seleção do Meu Funil na marca, aba Guia visual.');
    expect(SELECTION_TEXT.sourceStopError).toBe(
      'Esta pasta é da Seleção do Meu Funil e não dá para parar por aqui. Para tirar, desligue a seleção ou troque o ramo na marca, aba Guia visual.',
    );
    expect(SELECTION_TEXT.liveStarted).toBe('A Seleção do Meu Funil está trazendo referências.');
    expect(SELECTION_TEXT.liveReady).toBe('Referências da seleção prontas.');
  });
  it('referência da Seleção: origem, estados, toasts', () => {
    expect(refOrigin(r({ source: 'pinterest', from_source: true, source_title: 'X', origin: 'selection' }))).toBe('Seleção do Meu Funil');
    expect(removeLabel(r({ source: 'pinterest', from_source: true, origin: 'selection' }))).toBe('Remover referência: Seleção do Meu Funil');
    const sel = { selection: true, paused: false };
    expect(refStateText(r({ origin: 'selection' }), sel)).toBe('Em uso. O que eu peguei: cores laranja; luz quente');
    expect(refStateText(r({ origin: 'selection' }), { selection: true, paused: true })).toBe(
      'Guardada: entra se você ficar com menos de 4 referências suas. O que eu peguei: cores laranja; luz quente',
    );
    expect(refStateText(r({ origin: 'selection', status: 'processing' }), sel)).toBe('Lendo o estilo…');
    expect(refStateText(r({ origin: 'selection', status: 'processing', attempts: 1 }), sel)).toBe('Não deu para ler agora. Tentando de novo sozinho (2 de 3).');
    expect(refStateText(r({ origin: 'selection', status: 'failed', attempts: 1 }), sel)).toBe('Não conseguimos ler esta imagem. Ela sai sozinha da seleção.');
    expect(refStateText(r({ origin: 'selection', status: 'failed', attempts: 3 }), sel)).toBe('Não deu para ler agora. Tentamos de novo mais tarde, sozinhos.');
    // própria: igual a antes, mesmo com o parâmetro
    expect(refStateText(r({ status: 'failed' }), { selection: false, paused: true })).toBe('Não conseguimos ler esta imagem. Remova e tente outra.');
    expect(removedToast({ from_source: true, origin: 'selection' })).toBe('Referência removida. Ela não volta; outra da seleção pode entrar no lugar.');
    expect(removedToast({ from_source: true })).toBe('Referência removida. Ela não volta, mesmo continuando na pasta.');
    expect(promotedToast('board')).toBe('Essa pasta já vinha da Seleção do Meu Funil. Agora ela é sua e fica mesmo se a seleção for desligada.');
    expect(promotedToast('pin')).toBe('Esse Pin já vinha da Seleção do Meu Funil. Agora ele é seu e fica mesmo se a seleção for desligada.');
  });
  it('região viva da Seleção', () => {
    const p = (id: string, status: string) => ({ id, status });
    expect(selectionAnnouncement(undefined, [p('a', 'processing')])).toBeNull();
    expect(selectionAnnouncement([], [p('a', 'processing')])).toBe('A Seleção do Meu Funil está trazendo referências.');
    expect(selectionAnnouncement([p('a', 'processing')], [p('a', 'ready')])).toBe('Referências da seleção prontas.');
    expect(selectionAnnouncement([p('a', 'ready')], [p('a', 'ready')])).toBeNull();
    // uma frase só, mesmo com os dois acontecendo
    expect(selectionAnnouncement([p('a', 'processing')], [p('a', 'ready'), p('b', 'processing')])).toBe('Referências da seleção prontas.');
  });
});

describe('selectionState (tabela do ui.md §3.3, primeira linha que bater)', () => {
  const v = (o: Partial<SelectionViewLike> = {}): SelectionViewLike => ({
    segment: 'acai_sorvete',
    segment_label: 'Açaí e sorvete',
    segment_source: 'auto',
    brand_segment: 'Açaiteria',
    enabled: true,
    needs_ai_key: false,
    ai_credit: null,
    daily_left: 12,
    sources_count: 2,
    count: 0,
    reading: 0,
    own_ready: 0,
    in_use: false,
    ...o,
  });
  const c = (o: Partial<SelectionCtx> = {}): SelectionCtx => ({ loading: false, error: false, canEdit: true, isAdmin: true, justChanged: false, allSourcesFailed: false, ...o });
  const run = (view: SelectionViewLike | null | undefined, ctx?: Partial<SelectionCtx>) => selectionState(view, c(ctx));

  it('1 carregando e 2 erro', () => {
    expect(run(undefined, { loading: true })).toEqual({ id: '1', text: 'Carregando a Seleção do Meu Funil…', tone: 'muted', action: null });
    expect(run(null, { error: true })).toEqual({
      id: '2',
      text: 'Não conseguimos carregar a Seleção do Meu Funil. Verifique a conexão e toque em Tentar de novo.',
      tone: 'error',
      action: 'retry',
    });
    // erro vale mesmo com vista antiga em cache
    expect(run(v(), { error: true }).id).toBe('2');
    expect(run(v(), { loading: true }).id).toBe('1');
  });
  it('3 desligada', () => {
    expect(run(v({ enabled: false }))).toEqual({ id: '3', text: 'Desligada. As artes seguem só as suas referências.', tone: 'muted', action: null });
  });
  it('4 sem ramo ("Nenhum desses")', () => {
    const t = 'Ligada, mas sem ramo: você escolheu “Nenhum desses”, então a seleção não traz referências. Escolha um ramo ou desligue a seleção.';
    expect(run(v({ segment_source: 'none', segment: null }))).toEqual({ id: '4', text: t, tone: 'muted', action: 'choose' });
    expect(run(v({ segment_source: 'none', segment: null }), { canEdit: false }).action).toBeNull();
  });
  it('5, 5b e 5c ramo não reconhecido', () => {
    const tail = 'Até você escolher, a seleção não traz nada nem gasta a chave de IA.';
    expect(run(v({ segment: null, segment_label: null, brand_segment: 'Floricultura' }))).toEqual({
      id: '5',
      text: `Ainda não temos seleção para “Floricultura”. Escolha o ramo mais parecido com o seu negócio:\n${tail}`,
      tone: 'muted',
      action: null,
    });
    expect(run(v({ segment: null, brand_segment: null }))).toEqual({ id: '5b', text: `Escolha o ramo do seu negócio:\n${tail}`, tone: 'muted', action: null });
    expect(run(v({ segment: null, brand_segment: '  ' })).id).toBe('5b');
    expect(run(v({ segment: null, brand_segment: 'Floricultura' }), { canEdit: false })).toEqual({
      id: '5c',
      text: 'Esta marca ainda não tem ramo para a seleção. Só quem edita a marca pode escolher.',
      tone: 'muted',
      action: null,
    });
    expect(run(v({ segment: null, brand_segment: null }), { canEdit: false }).id).toBe('5c');
  });
  it('6 em pausa vem antes de 7', () => {
    const t = 'Em pausa: você já tem 4 ou mais referências suas para a marca toda, e elas bastam. A seleção para de trazer referências novas e volta sozinha se você ficar com menos de 4.';
    expect(run(v({ own_ready: 4, needs_ai_key: true }))).toEqual({ id: '6', text: t, tone: 'muted', action: null });
    expect(run(v({ own_ready: 9 })).id).toBe('6');
  });
  it('7 e 7b falta chave', () => {
    expect(run(v({ needs_ai_key: true }))).toEqual({
      id: '7',
      text: 'Falta a chave de IA da empresa. A seleção usa essa chave para ler as referências. Cadastre uma chave do ChatGPT ou do Gemini em Integrações; até lá, a seleção não traz nada novo.',
      tone: 'warning',
      action: 'integrations',
    });
    expect(run(v({ needs_ai_key: true }), { isAdmin: false })).toEqual({
      id: '7b',
      text: 'Falta a chave de IA da empresa. A seleção usa essa chave para ler as referências. Peça ao dono ou a um administrador para cadastrar uma chave do ChatGPT ou do Gemini em Integrações; até lá, a seleção não traz nada novo.',
      tone: 'warning',
      action: null,
    });
  });
  it('8 e 8b crédito', () => {
    expect(run(v({ ai_credit: 'no_credit' }))).toEqual({
      id: '8',
      text: 'Sua IA está sem créditos, então a seleção parou de trazer referências novas. As que já estão aqui continuam valendo, e ela volta sozinha quando a conta tiver crédito.',
      tone: 'warning',
      action: 'integrations',
    });
    expect(run(v({ ai_credit: 'no_credit' }), { isAdmin: false }).action).toBeNull();
    expect(run(v({ ai_credit: 'daily_limit' }))).toEqual({
      id: '8b',
      text: 'Sua IA chegou ao limite de uso de hoje. A seleção para de trazer referências novas e continua amanhã, sozinha.',
      tone: 'warning',
      action: null,
    });
  });
  it('9 pastas sem resposta', () => {
    expect(run(v(), { allSourcesFailed: true })).toEqual({
      id: '9',
      text: 'As pastas do Pinterest deste ramo não responderam agora. Tentamos de novo amanhã, sozinhos.',
      tone: 'error',
      action: null,
    });
    // com sources_count 0 ou com referências, a linha 9 não vale
    expect(run(v({ sources_count: 0 }), { allSourcesFailed: true }).id).not.toBe('9');
    expect(run(v({ count: 3, in_use: true }), { allSourcesFailed: true }).id).toBe('12');
    expect(run(v({ reading: 1 }), { allSourcesFailed: true }).id).toBe('11');
  });
  it('10, 10b e 10c trazendo as primeiras', () => {
    expect(run(v({ daily_left: 0 }), { justChanged: true })).toEqual({
      id: '10',
      text: 'Trazendo as referências do ramo Açaí e sorvete. As primeiras chegam amanhã, sozinhas.',
      tone: 'muted',
      action: null,
    });
    expect(run(v(), { justChanged: true })).toEqual({
      id: '10b',
      text: 'Trazendo as referências do ramo Açaí e sorvete. As primeiras chegam em alguns minutos; pode sair desta tela.',
      tone: 'muted',
      action: null,
    });
    expect(run(v())).toEqual({
      id: '10c',
      text: 'Trazendo as referências do ramo Açaí e sorvete. As primeiras chegam nas próximas horas, sozinhas; pode sair desta tela.',
      tone: 'muted',
      action: null,
    });
    // sem rótulo, cai no id do ramo
    expect(run(v({ segment_label: null })).text).toContain('do ramo acai_sorvete.');
  });
  it('11 lendo a primeira', () => {
    expect(run(v({ reading: 1 })).text).toBe('Lendo o estilo de 1 referência da seleção… Pode sair desta tela.');
    expect(run(v({ reading: 3 }))).toEqual({ id: '11', text: 'Lendo o estilo de 3 referências da seleção… Pode sair desta tela.', tone: 'muted', action: null });
  });
  it('12 em uso', () => {
    const base = 'Em uso. As suas referências vêm sempre primeiro; a seleção completa o estilo enquanto você tiver menos de 4 para a marca toda.';
    expect(run(v({ count: 8, in_use: true }))).toEqual({ id: '12', text: base, tone: 'muted', action: null });
    expect(run(v({ count: 8, in_use: true, reading: 1 })).text).toBe(`${base} Lendo o estilo de mais 1 referência…`);
    expect(run(v({ count: 8, in_use: true, reading: 4 })).text).toBe(`${base} Lendo o estilo de mais 4 referências…`);
  });
  it('a ordem vale: desligada ganha de tudo, ramo ganha de chave', () => {
    expect(run(v({ enabled: false, needs_ai_key: true, own_ready: 5 })).id).toBe('3');
    expect(run(v({ segment_source: 'none', segment: null, needs_ai_key: true })).id).toBe('4');
    expect(run(v({ segment: null, needs_ai_key: true, own_ready: 5 })).id).toBe('5');
    expect(run(v({ needs_ai_key: true, ai_credit: 'no_credit' })).id).toBe('7');
  });
});

describe('refsPollInterval', () => {
  const r = (status: string, attempts: number) => ({ status, attempts }) as never;
  it('5 s com leitura inicial; 60 s só com tentativas espaçadas; nada sem processing', () => {
    expect(refsPollInterval(undefined)).toBe(false);
    expect(refsPollInterval([r('ready', 0), r('failed', 3)])).toBe(false);
    expect(refsPollInterval([r('processing', 0)])).toBe(5000);
    expect(refsPollInterval([r('processing', 2), r('processing', 0)])).toBe(5000);
    expect(refsPollInterval([r('processing', 2), r('ready', 0)])).toBe(60000);
  });
});

describe('conferência da vista da Seleção (ui.md §3.7)', () => {
  it('10 s nos estados 10b, 11 e 12 com leitura; para depois de 10 min', () => {
    expect(selectionPollInterval('10b', 0, 0)).toBe(10000);
    expect(selectionPollInterval('11', 2, 5000)).toBe(10000);
    expect(selectionPollInterval('12', 1, 599999)).toBe(10000);
    expect(selectionPollInterval('12', 0, 0)).toBe(false);
    expect(selectionPollInterval('10c', 0, 0)).toBe(false);
    expect(selectionPollInterval('3', 0, 0)).toBe(false);
    expect(selectionPollInterval('10b', 0, 600000)).toBe(false);
    expect(selectionPollInterval('11', 3, 700000)).toBe(false);
  });
  it('a assinatura só muda com count, reading ou sources_count', () => {
    const a = { count: 1, reading: 2, sources_count: 3 };
    expect(selectionSignature(a)).toBe(selectionSignature({ ...a }));
    expect(selectionSignature(a)).not.toBe(selectionSignature({ ...a, count: 2 }));
    expect(selectionSignature(a)).not.toBe(selectionSignature({ ...a, reading: 0 }));
    expect(selectionSignature(a)).not.toBe(selectionSignature({ ...a, sources_count: 2 }));
  });
  it('estado 9: todas as pastas com erro (e só com pastas)', () => {
    expect(allSelectionSourcesFailed([])).toBe(false);
    expect(allSelectionSourcesFailed([{ last_error: 'x' }, { last_error: null }])).toBe(false);
    expect(allSelectionSourcesFailed([{ last_error: 'x' }, { last_error: 'y' }])).toBe(true);
  });
});

describe('troca de ramo (ui.md §3.4)', () => {
  it('consequência só com opção diferente da atual e referências na marca', () => {
    expect(branchConsequence({ picked: 'bebida_bar', current: 'acai_sorvete', pickedLabel: 'Bar e bebidas', count: 3 })).toBe(
      'As 3 referências da seleção de agora saem desta marca. Entram as do ramo Bar e bebidas, lidas com a chave de IA da empresa.',
    );
    expect(branchConsequence({ picked: 'bebida_bar', current: 'acai_sorvete', pickedLabel: 'Bar e bebidas', count: 1 })).toBe(
      'A referência da seleção de agora sai desta marca. Entram as do ramo Bar e bebidas, lidas com a chave de IA da empresa.',
    );
    expect(branchConsequence({ picked: 'none', current: 'acai_sorvete', pickedLabel: 'Nenhum desses', count: 2 })).toBe(
      'As 2 referências da seleção saem desta marca e nada entra no lugar.',
    );
    expect(branchConsequence({ picked: 'none', current: 'acai_sorvete', pickedLabel: 'Nenhum desses', count: 1 })).toBe(
      'A referência da seleção sai desta marca e nada entra no lugar.',
    );
    expect(branchConsequence({ picked: 'acai_sorvete', current: 'acai_sorvete', pickedLabel: 'Açaí e sorvete', count: 3 })).toBeNull();
    expect(branchConsequence({ picked: 'bebida_bar', current: 'acai_sorvete', pickedLabel: 'Bar e bebidas', count: 0 })).toBeNull();
    expect(branchConsequence({ picked: 'bebida_bar', current: null, pickedLabel: 'Bar e bebidas', count: 5 })).toBeNull();
  });
  it('toast e rótulo do botão', () => {
    expect(branchToast({ picked: 'acai_sorvete', pickedLabel: 'Açaí e sorvete', first: true, hadRefs: false })).toBe('Ramo escolhido: Açaí e sorvete.');
    expect(branchToast({ picked: 'bebida_bar', pickedLabel: 'Bar e bebidas', first: false, hadRefs: false })).toBe('Ramo trocado para Bar e bebidas.');
    expect(branchToast({ picked: 'bebida_bar', pickedLabel: 'Bar e bebidas', first: false, hadRefs: true })).toBe(
      'Ramo trocado para Bar e bebidas. As referências da seleção anterior saíram.',
    );
    expect(branchToast({ picked: 'none', pickedLabel: 'Nenhum desses', first: false, hadRefs: true })).toBe('Pronto. A seleção não traz referências para esta marca.');
    expect(branchToast({ picked: 'none', pickedLabel: 'Nenhum desses', first: true, hadRefs: false })).toBe('Pronto. A seleção não traz referências para esta marca.');
    expect(branchSubmitLabel('none')).toBe('Ficar sem seleção');
    expect(branchSubmitLabel('acai_sorvete')).toBe('Usar este ramo');
  });
});
