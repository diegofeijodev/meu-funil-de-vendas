/** Funções puras da aba "Vagas" do Instagram (stories automáticos das vagas do Freela). Horários sempre em Brasília. */

const TZ = 'America/Sao_Paulo';
const VENDORS: Record<string, string> = { openai: 'OpenAI', gemini: 'Gemini' };

const partsOf = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hourCycle: 'h23', ...opts })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );

/** "08:00" → "8h", "14:40" → "14h40"; também aceita ISO (convertido para Brasília). */
export function hhLabel(value: string): string {
  let h: number;
  let m: number;
  const hhmm = /^(\d{1,2}):(\d{2})/.exec(value);
  if (hhmm && !value.includes('T')) {
    h = Number(hhmm[1]);
    m = Number(hhmm[2]);
  } else {
    const p = partsOf(value, { hour: '2-digit', minute: '2-digit' });
    h = Number(p.hour);
    m = Number(p.minute);
  }
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** "28/10" (dia de Brasília) a partir de um ISO. */
export function dmLabel(iso: string): string {
  const p = partsOf(iso, { day: '2-digit', month: '2-digit' });
  return `${p.day}/${p.month}`;
}

export type SummaryInput = { cities: string[]; window_start: string; window_end: string; daily_cap: number; vendor: string };

/** Resumo de 1 linha dos Ajustes: "Todas as cidades · 8h às 21h · até 10/dia · OpenAI". */
export function settingsSummary(s: SummaryInput): string {
  const cidades = s.cities.length === 0 ? 'Todas as cidades' : s.cities.length === 1 ? '1 cidade' : `${s.cities.length} cidades`;
  return [cidades, `${hhLabel(s.window_start)} às ${hhLabel(s.window_end)}`, `até ${s.daily_cap}/dia`, VENDORS[s.vendor] ?? s.vendor].join(' · ');
}

/** "Hoje: 4 postados de 10 (o máximo por dia que você definiu)". */
export function dayLine(s: { today: { posted: number; cap: number; scheduled?: number } }): string {
  const { posted, cap } = s.today;
  return `Hoje: ${posted} ${posted === 1 ? 'postado' : 'postados'} de ${cap} (o máximo por dia que você definiu)`;
}

const STALE_MS = 30 * 60 * 1000;
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/**
 * Vitrine do Freela desatualizada (A7): ligado e mais de 30 min desde o MAIOR entre ligar e a última consulta boa. Logo depois de
 * ligar a 1ª consulta ainda não rodou: não é atraso.
 */
export function pollStale(s: { enabled: boolean; enabled_at: string | null; last_poll_ok_at: string | null }, now: Date): boolean {
  if (!s.enabled) return false;
  const base = Math.max(...[ms(s.enabled_at), ms(s.last_poll_ok_at)].filter((t) => !Number.isNaN(t)));
  return Number.isFinite(base) && now.getTime() - base > STALE_MS;
}

/** Linha da consulta (A7): antes da 1ª consulta depois de ligar, "Primeira consulta ao Freela em até 10 minutos.". */
export function pollLine(s: { enabled_at: string | null; last_poll_at: string | null }): string {
  if (!s.last_poll_at || (s.enabled_at && ms(s.last_poll_at) < ms(s.enabled_at))) return 'Primeira consulta ao Freela em até 10 minutos.';
  return `Última consulta: ${hhLabel(s.last_poll_at)} (a cada 10 minutos)`;
}

/** "desde as 14h20" (hoje) · "desde 28/10 às 14h20" (outro dia). */
export function sinceLabel(iso: string, now: Date): string {
  return dmLabel(iso) === dmLabel(now.toISOString()) ? `desde as ${hhLabel(iso)}` : `desde ${dmLabel(iso)} às ${hhLabel(iso)}`;
}

/** Aviso amarelo da vitrine fora. Consulta boa de antes de ligar não conta ("ainda"). */
export function staleNotice(s: { enabled_at: string | null; last_poll_ok_at: string | null }, now: Date): string {
  const ok = s.last_poll_ok_at && !(s.enabled_at && ms(s.last_poll_ok_at) < ms(s.enabled_at)) ? s.last_poll_ok_at : null;
  return `Não conseguimos consultar as vagas do Freela ${ok ? sinceLabel(ok, now) : 'ainda'}. Tentamos de novo sozinhos a cada 10 minutos. Quando voltar, as vagas novas entram normalmente.`;
}

export type VagasTabState = 'hidden' | 'loading' | 'error' | 'ready';

/**
 * Estado da aba "Vagas" a partir da consulta das configurações: 404 (`data === null`) esconde a aba; erro SEM dados (1ª carga)
 * mostra o painel de erro; erro de um refetch com dados continua `ready` (o usuário não perde a tela por um soluço).
 */
export function vagasTabState(q: { data: unknown; isLoading: boolean; isError: boolean }): VagasTabState {
  if (q.data === null) return 'hidden';
  if (q.data !== undefined) return 'ready';
  if (q.isError) return 'error';
  return 'loading';
}

const FIELD_LABELS: Record<string, string> = {
  funcao: 'função',
  valor: 'valor',
  data: 'data',
  inicio: 'horário',
  fim: 'horário de término',
  cidade: 'cidade',
  estabelecimento: 'estabelecimento',
};

/** Nome do campo da arte em português ("inicio" → "horário"). Desconhecido vira "texto". */
export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? 'texto';
}

const WITH_ARTICLE: Record<string, string> = {
  funcao: 'a função',
  valor: 'o valor',
  data: 'a data',
  inicio: 'o horário de início',
  fim: 'o horário de término',
  cidade: 'a cidade',
  estabelecimento: 'o nome do estabelecimento',
};

/** Campo com artigo para as frases das tentativas (B1): "a função", "o horário de início". Desconhecido vira "o texto". */
export function fieldWithArticle(key: string): string {
  return WITH_ARTICLE[key] ?? 'o texto';
}

/** "a", "a e b", "a, b e c". */
const joinE = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);
const FORBIDDEN_PUT = (plural: boolean) => `${plural ? 'puseram' : 'pôs'} na arte um texto que não podia estar lá`;

type AttemptLike = { n: number; ok: boolean; wrong: string[]; forbidden?: string[]; kind?: string; error?: string | null };
export type FallbackKind = 'photo' | 'plain' | null | undefined;

/** Reserva com foto ou sem foto; posts antigos sem `fallback_kind`: pelo último passo da reserva no log. */
function kindOf(attempts: AttemptLike[], k: FallbackKind): 'photo' | 'plain' {
  if (k) return k;
  const last = [...attempts].reverse().find((a) => a.kind === 'fallback_photo' || a.kind === 'fallback_plain');
  return last?.kind === 'fallback_plain' ? 'plain' : 'photo';
}

/**
 * Linha da versão de reserva (B1) no detalhe e na prévia: o campo que a IA mais errou, com artigo; com foto ("por cima de uma foto")
 * ou sem foto ("sobre um fundo com as cores da sua arte").
 */
export function fallbackLine(p: { attempts: AttemptLike[]; fallback_kind?: FallbackKind }): string {
  const ai = p.attempts.filter((a) => !a.kind || a.kind === 'ai');
  const count = new Map<string, number>();
  for (const a of ai) for (const w of a.wrong) count.set(w, (count.get(w) ?? 0) + 1);
  let top: string | null = null;
  for (const [k, v] of count) if (top === null || v > (count.get(top) ?? 0)) top = k;
  const errou = top
    ? `a IA errou ${fieldWithArticle(top)}`
    : ai.some((a) => a.forbidden?.length)
      ? `a IA ${FORBIDDEN_PUT(false)}`
      : 'a IA errou os textos';
  const onde = kindOf(p.attempts, p.fallback_kind) === 'plain' ? 'sobre um fundo com as cores da sua arte' : 'por cima de uma foto';
  return `Versão de reserva: ${errou} nas 3 tentativas, então o sistema escreveu os textos ${onde}. Os textos estão certos; o visual é mais simples.`;
}

/**
 * Linha das tentativas do detalhe (B1). Reserva: `fallbackLine`. IA: "Feita pela IA na 2ª tentativa (a 1ª errou a data)"; só texto
 * proibido: "(a 1ª pôs na arte um texto que não podia estar lá)"; de primeira: "Feita pela IA de primeira". Sem log, `null`.
 */
export function attemptsLine(s: { attempts_log: AttemptLike[]; used_fallback: boolean; fallback_kind?: FallbackKind }): string | null {
  const log = s.attempts_log;
  if (s.used_fallback) return fallbackLine({ attempts: log, fallback_kind: s.fallback_kind });
  const okIdx = log.findIndex((a) => a.ok);
  if (okIdx < 0) return null;
  if (okIdx === 0) return 'Feita pela IA de primeira';
  const before = log.slice(0, okIdx);
  const campos = [...new Set(before.flatMap((a) => a.wrong))].map(fieldWithArticle);
  const proibido = before.some((a) => a.forbidden?.length);
  const plural = okIdx > 1;
  const quem = plural ? `as ${okIdx} primeiras` : 'a 1ª';
  const partes = [
    ...(campos.length ? [`${plural ? 'erraram' : 'errou'} ${joinE([...new Set(campos)])}`] : []),
    ...(proibido ? [FORBIDDEN_PUT(plural)] : []),
  ];
  const oQue = partes.length ? partes.join(' e ') : plural ? 'não passaram na conferência' : 'não passou na conferência';
  return `Feita pela IA na ${okIdx + 1}ª tentativa (${quem} ${oQue})`;
}

/** Item de "Ver as 3 tentativas": "Tentativa 1: errou o valor e a data". */
export function attemptItemLine(a: AttemptLike): string {
  const oQue = a.ok
    ? 'confere'
    : a.wrong.length
      ? `errou ${joinE(a.wrong.map(fieldWithArticle))}`
      : a.forbidden?.length
        ? FORBIDDEN_PUT(false)
        : (a.error ?? 'não passou na conferência');
  return `Tentativa ${a.n}: ${oQue}`;
}

const quoted = (texts: string[]) => joinE(texts.map((t) => `“${t}”`));

/** A3, cartão e Aprovações: a reserva que a leitura reprovou nunca aparece como "✓ Conferido". */
export function checkAlertLine(texts: string[]): string {
  return texts.length > 1
    ? `A conferência achou na arte textos que não deviam estar lá: ${quoted(texts)}. Olhe a arte antes de aprovar.`
    : `A conferência achou na arte um texto que não devia estar lá: ${quoted(texts)}. Olhe a arte antes de aprovar.`;
}

/** A3, detalhe: no lugar da linha da reserva. */
export function checkAlertDetail(texts: string[]): string {
  const n = texts.length > 1;
  return `Versão de reserva: o sistema escreveu os textos da vaga, mas a conferência achou também ${quoted(texts)}, que não ${n ? 'deviam' : 'devia'} estar na arte (${n ? 'podem' : 'pode'} vir da logo). Olhe antes de aprovar.`;
}

/** Selo "Refeita 1 vez" / "Refeita 2 vezes" (R4); nunca refeita = `null`. */
export function redoLabel(n: number): string | null {
  return n > 0 ? `Refeita ${n} ${n === 1 ? 'vez' : 'vezes'}` : null;
}

/** Chips depois de "Não postar" (D5): rótulo da tela → valor da API. */
export const reasonChipsFeedback = {
  'Texto errado': 'texto_errado',
  'Foto estranha': 'foto_estranha',
  'Não quero divulgar esta vaga': 'nao_divulgar',
} as const;

export const DONT_POST_UNDO_MS = 6000;

type SetT = (fn: () => void, ms: number) => unknown;
type ClearT = (id: unknown) => void;

export type PostNowDialog = { title: string; description: string; confirm: string; cancel: string };
export type WaitKind = 'cap' | 'instagram' | 'window' | 'spacing';

/** Dia de Brasília ("2026-10-29") de um instante. */
const spDayOf = (d: Date) => {
  const p = partsOf(d.toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
};

/** "às 8h" (hoje) · "amanhã às 8h" · "dia 31/10 às 8h" — calculado na hora, como o apoio da API. */
export function atLabel(iso: string, now: Date): string {
  const day = spDayOf(new Date(iso));
  if (day === spDayOf(now)) return `às ${hhLabel(iso)}`;
  if (day === spDayOf(new Date(now.getTime() + 24 * 3600 * 1000))) return `amanhã às ${hhLabel(iso)}`;
  return `dia ${dmLabel(iso)} às ${hhLabel(iso)}`;
}

/**
 * Diálogo do "Postar agora" (B3) pelo `wait_kind` da API: máximo do dia, limite da Meta, empurrado pelos 15 min entre stories com a
 * janela aberta, ou fora do horário (UI §4). Sem `wait_kind`, decide pela situação.
 */
export function postNowDialog(
  story: { display: string; wait_kind?: WaitKind | null; scheduled_at?: string | null },
  s: { window_start: string; window_end: string; today: { posted: number; scheduled: number; cap: number } },
  now: Date,
): PostNowDialog {
  const kind = story.wait_kind ?? (story.display === 'waiting_cap' ? 'cap' : 'window');
  if (kind === 'cap') {
    const n = s.today.posted + s.today.scheduled;
    const ja = n === 1 ? '1 story de vaga postado ou agendado' : `${n} stories de vagas postados ou agendados`;
    return {
      title: 'Postar agora, acima do seu máximo?',
      description: `Hoje já tem ${ja} (o seu máximo). Este vai ser o ${n + 1}º.`,
      confirm: 'Postar agora',
      cancel: 'Deixar para amanhã',
    };
  }
  if (kind === 'instagram')
    return {
      title: 'Postar agora, com a conta perto do limite do Instagram?',
      description:
        'A conta está perto do limite de 25 publicações em 24 h, somando os posts normais. Este story usa o espaço que guardamos para os posts normais da empresa.',
      confirm: 'Postar agora',
      cancel: 'Esperar a vez',
    };
  if (kind === 'spacing' && story.scheduled_at) {
    const at = atLabel(story.scheduled_at, now);
    return {
      title: 'Postar agora, antes do horário marcado?',
      description: `Este story está marcado para ${at.startsWith('às ') ? `hoje ${at}` : at}. Postar agora conta no máximo de hoje.`,
      confirm: 'Postar agora',
      cancel: 'Manter o horário',
    };
  }
  return {
    title: 'Postar agora, fora do horário?',
    description: `São ${hhLabel(now.toISOString())}, fora do horário que você definiu (${hhLabel(s.window_start)} às ${hhLabel(s.window_end)}). O story vai ao ar em até 5 minutos e conta no máximo de hoje.`,
    confirm: 'Postar agora',
    cancel: `Esperar as ${hhLabel(s.window_start)}`,
  };
}

/** Toast do "Postar agora" (B3): com arte vai em até 5 min; sem arte (esperava o limite) a arte é criada antes. */
export function postNowToast(hasArt: boolean, autoPublish: boolean): string {
  if (hasArt) return 'O story vai ao ar em até 5 minutos.';
  return autoPublish
    ? 'Vamos criar a arte agora. O story vai ao ar assim que ficar pronto, em até 15 minutos.'
    : 'Vamos criar a arte agora. Ela aparece em Para aprovar em até 15 minutos.';
}

/** Toast de "Aprovar" de um story de vaga (B5d). */
export const APPROVED_TOAST = 'Story aprovado. Vai ao ar no próximo horário livre; o horário aparece na lista.';

/** Toast de voltar para "Eu aprovo" (A1), com quantos stories prontos voltaram para "Para aprovar". */
export function autoPublishOffToast(moved: number): string {
  const base = 'Pronto: cada story espera sua aprovação.';
  if (moved <= 0) return base;
  return moved === 1
    ? `${base} 1 story que já estava pronto voltou para Para aprovar.`
    : `${base} ${moved} stories que já estavam prontos voltaram para Para aprovar.`;
}

/** Texto do diálogo "Desligar": só as partes maiores que zero; sem nenhuma, a 1ª frase sai. */
export function disableDialogText(c: { ready: number; to_approve: number }): string {
  const resto =
    'Os que já foram postados continuam no Instagram até sumirem sozinhos (24 h). Vagas publicadas enquanto estiver desligado não entram depois, mesmo se você ligar de novo.';
  const partes = [
    ...(c.ready > 0 ? [c.ready === 1 ? '1 story pronto' : `${c.ready} stories prontos`] : []),
    ...(c.to_approve > 0 ? [`${c.to_approve} esperando aprovação`] : []),
  ];
  if (!partes.length) return resto;
  return `${partes.join(' e ')} ${c.ready + c.to_approve === 1 ? 'não vai ao ar.' : 'não vão ao ar.'} ${resto}`;
}

/** Toast do lote em Aprovações: partes maiores que zero juntadas com " · ". */
export function batchToast(kind: 'approve' | 'reject', n: { posts: number; vacancies: number }): string | null {
  if (kind === 'approve') {
    const t = n.posts + n.vacancies;
    return t <= 0 ? null : t === 1 ? '1 post aprovado.' : `${t} posts aprovados.`;
  }
  const partes = [
    ...(n.posts > 0 ? [n.posts === 1 ? '1 post rejeitado' : `${n.posts} posts rejeitados`] : []),
    ...(n.vacancies > 0 ? [n.vacancies === 1 ? '1 story de vaga não vai ao ar' : `${n.vacancies} stories de vagas não vão ao ar`] : []),
  ];
  return partes.length ? `${partes.join(' · ')}.` : null;
}

/** Erro de um item do lote quando a API não mandou mensagem. */
export function batchErrorFallback(kind: 'approve' | 'reject'): string {
  return kind === 'approve' ? 'Não conseguimos aprovar um dos posts. Tente de novo.' : 'Não conseguimos cancelar um dos posts. Tente de novo.';
}

/** Seleção só de stories de vaga: "Não postar selecionados". */
export function rejectSelectedLabel(selected: { source?: string | null; creative_brief?: unknown }[]): string {
  return selected.length > 0 && selected.every((p) => postVacancy(p)) ? 'Não postar selecionados' : 'Rejeitar selecionados';
}

/** Vazio de "Vagas que chegaram" com a função ligada. */
export function noStoriesYet(s: { enabled_at: string | null; last_poll_ok_at: string | null }): string {
  const desde = s.enabled_at ? ` desde que você ligou (${dmLabel(s.enabled_at)} às ${hhLabel(s.enabled_at)})` : '';
  const ultima = s.last_poll_ok_at ? ` Consultamos o Freela a cada 10 minutos; a última foi às ${hhLabel(s.last_poll_ok_at)}.` : ' Consultamos o Freela a cada 10 minutos.';
  return `Nenhuma vaga nova${desde}.${ultima}`;
}

/** Vazio de "Vagas que chegaram" por filtro; desligado convida a ligar. */
export function arrivedEmptyText(
  filter: 'all' | 'live' | 'not_posted',
  s: { enabled: boolean; enabled_at: string | null; last_poll_ok_at: string | null },
): string {
  if (filter === 'live') return 'Nenhum story no ar agora.';
  if (filter === 'not_posted') return 'Nenhuma vaga deixou de ir ao ar.';
  return s.enabled ? noStoriesYet(s) : 'Ligue os stories das vagas para as vagas novas aparecerem aqui.';
}

/** Aviso do máximo por dia (UI §3): acima de 15 os posts normais podem ficar sem espaço. */
export function capWarning(cap: number): string | null {
  return cap > 15 ? 'Acima de 15, os posts normais da empresa podem ficar sem espaço no dia.' : null;
}

export type Outcomes = { n: number; first_try: number; redone: number; fallback: number; not_posted: number };

/** Frase do diálogo "Postar sozinho" sem as partes com zero (concordância em número, R4). Sem histórico, `null`. */
export function autoPublishSummary(o: Outcomes): string | null {
  if (o.n <= 0) return null;
  const quando = o.n === 1 ? 'No último story' : `Nos últimos ${o.n} stories`;
  const partes = [
    ...(o.first_try > 0 ? [`${o.first_try} ${o.first_try === 1 ? 'saiu certo' : 'saíram certos'} de primeira`] : []),
    ...(o.redone > 0 ? [`${o.redone} ${o.redone === 1 ? 'foi refeito' : 'foram refeitos'}`] : []),
    ...(o.fallback > 0 ? [`${o.fallback} ${o.fallback === 1 ? 'foi' : 'foram'} para a reserva`] : []),
  ];
  if (!partes.length) return `${quando}: você não postou ${o.not_posted}.`;
  return `${quando}: ${joinE(partes)}.${o.not_posted > 0 ? ` Você não postou ${o.not_posted}.` : ''}`;
}

/** Aviso semanal: ≥ 30% dos stories dos últimos 7 dias na reserva, com pelo menos 5 stories. */
export function weeklyFallbackWarning(w: { total: number; fallback: number }): string | null {
  if (w.total < 5 || w.fallback / w.total < 0.3) return null;
  return `Nos últimos 7 dias, ${w.fallback} de ${w.total} stories foram para a reserva. Uma arte modelo com menos texto costuma ajudar a IA.`;
}

export const TEMPLATE_MAX_BYTES = 10 * 1024 * 1024;

/** Validação do navegador da arte modelo (mesmos textos da API, R19): só PNG/JPG e até 10 MB. */
export function templateFileError(f: { type: string; size: number }): string | null {
  if (f.type !== 'image/png' && f.type !== 'image/jpeg') return 'Esse arquivo não serve. Envie uma imagem PNG ou JPG.';
  if (f.size > TEMPLATE_MAX_BYTES) {
    const mb = (Math.ceil((f.size / 1048576) * 10) / 10).toFixed(1).replace('.', ',');
    return `A imagem tem ${mb} MB e o máximo é 10 MB. Envie uma menor.`;
  }
  return null;
}

export const LANDSCAPE_WARNING =
  'Essa arte está deitada. Story é em pé: envie uma arte em pé para não sobrar faixa grande em cima e embaixo.';

/** Início precisa vir antes do fim ("HH:MM" compara como texto). Campo vazio não acusa erro. */
export function windowError(start: string, end: string): string | null {
  if (!start || !end) return null;
  return start < end ? null : 'O início precisa ser antes do fim.';
}

/** Passo da prévia em andamento. A reserva aparece como "Conferindo os textos"; a tentativa nunca passa de 3. */
export function previewProgress(p: { step?: 'art' | 'check' | 'fallback'; attempt?: number }): string {
  if (p.step === 'check' || p.step === 'fallback') return 'Conferindo os textos';
  const n = Math.min(3, Math.max(1, p.attempt ?? 1));
  return `Criando a arte (tentativa ${n} de 3)`;
}

/** Frase quando a prévia usou a vaga de exemplo. */
export function sampleLine(v: { funcao: string; valor: string; dia: string; horario: string; cidade: string }): string {
  return `Não há vaga aberta no Freela agora. Usamos uma vaga de exemplo: ${v.funcao}, ${v.valor}, ${v.dia}, ${v.horario}, ${v.cidade}.`;
}

/** Cidades como conjunto: a ordem em que foram marcadas não conta como mudança. */
export function sameCities(a: string[], b: string[]): boolean {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((c) => y.has(c));
}

/** O que o post de vaga carrega em `creative_brief.vacancy`; `null` para qualquer outro post. */
export type PostVacancy = { story_id: string; checked_fields: string[]; requires_approval: boolean; check_alert: string[] | null };
export function postVacancy(post: { source?: string | null; creative_brief?: unknown }): PostVacancy | null {
  if (post.source !== 'vacancy') return null;
  const v = (post.creative_brief as { vacancy?: Record<string, unknown> } | null | undefined)?.vacancy;
  if (!v || typeof v['story_id'] !== 'string') return null;
  return {
    story_id: v['story_id'],
    checked_fields: Array.isArray(v['checked_fields']) ? (v['checked_fields'] as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    requires_approval: v['requires_approval'] === true,
    check_alert: textsOf(v['check_alert']),
  };
}

/** Lista de textos (só strings); vazia ou ausente vira `null`. */
function textsOf(x: unknown): string[] | null {
  const t = Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : [];
  return t.length ? t : null;
}

/** Função da vaga a partir do `theme` do post ("Vaga · Garçom · Coco Bambu · Sáb 29/10" → "Garçom"). */
export function funcaoOfTheme(theme: string | null | undefined): string {
  const parts = (theme ?? '').split(' · ');
  return (parts[0] === 'Vaga' ? parts[1] : parts[0])?.trim() || 'selecionada';
}

/** Arte própria (R35): último passo do `ai_generation_log` é `upload` ou `library` — ninguém conferiu. */
export function isOwnArt(post: { ai_generation_log?: unknown }): boolean {
  const log = Array.isArray(post.ai_generation_log) ? (post.ai_generation_log as { step?: unknown }[]) : [];
  const last = log[log.length - 1]?.step;
  return last === 'upload' || last === 'library';
}

/** "Conferido: função, valor, horário" a partir dos `checked_fields` (mesmos nomes da aba Vagas, sem repetir). `null` sem campos. */
export function checkedLine(fields: string[]): string | null {
  const labels = [...new Set(fields.map(fieldLabel))];
  return labels.length ? `Conferido: ${labels.join(', ')}` : null;
}

/** Calendário (D14): stories de vaga ficam de fora, a menos que o usuário peça. */
export function calendarPosts<T extends { source?: string | null }>(posts: T[], showVacancies: boolean): T[] {
  return showVacancies ? posts : posts.filter((p) => p.source !== 'vacancy');
}

/** Só a 1ª letra maiúscula ("horário de início" → "Horário de início"); o `capitalize` do CSS subiria todas. */
export function capFirst(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** "Abrir Integrações" só para erro de chave/crédito (o erro genérico "não devolveu uma arte" se resolve sozinho). */
export function aiErrorWantsIntegrations(msg: string | null | undefined): boolean {
  return !!msg && /chave|crédito|Integrações/i.test(msg);
}

/** "Para aprovar" (A4): `to_approve` com `can.approve` (depois do prazo some, mesmo antes da expiração), sem os escondidos pelo Desfazer. */
export function approvableStories<T extends { id: string; display: string; can: { approve: boolean } }>(rows: T[], hidden: ReadonlySet<string>): T[] {
  return rows.filter((s) => s.display === 'to_approve' && s.can.approve && !hidden.has(s.id));
}

/** Post entregue e ainda não publicado (mesma regra da API para Não postar / Refazer a arte). */
const POST_UNPUBLISHED = ['pending_approval', 'approved', 'ready', 'scheduled'];

/**
 * Botões do editor para um story de vaga (A2/I1): "Aprovar" só em `pending_approval`; "Não postar", "Refazer a arte" e "Enviar minha
 * própria" só antes de publicar; publicado, cancelado ou com falha: nenhum (o "Publicar agora" genérico nunca aparece).
 */
export function vacancyEditorActions(status: string): { approve: boolean; dontPost: boolean; redo: boolean; upload: boolean } {
  const open = POST_UNPUBLISHED.includes(status);
  return { approve: status === 'pending_approval', dontPost: open, redo: open, upload: open };
}

/** Aviso do editor ao lado de "Enviar minha própria". */
export function ownArtNotice(isOwn: boolean): string {
  return isOwn ? 'A sua arte não passa pela conferência.' : 'Se você enviar a sua própria arte, ela não passa pela conferência.';
}

/** Dica do horário para postar (B7): "… vai ao ar a partir das 8h." */
export function windowHint(start: string): string {
  return /^\d{1,2}:\d{2}$/.test(start)
    ? `Vaga que chegar fora desse horário espera e vai ao ar a partir das ${hhLabel(start)}.`
    : 'Vaga que chegar fora desse horário espera e vai ao ar quando o horário abrir.';
}

/** I5: a leitura da arte modelo não achou texto nenhum — a detecção de cópia do modelo fica sem base. */
export function templateTextsWarning(t: { texts_count: number } | null): string | null {
  return t && t.texts_count === 0
    ? 'Não conseguimos ler os textos desta arte modelo. Sem eles, o sistema não consegue barrar texto copiado do modelo. Envie a arte de novo ou use uma com textos mais nítidos.'
    : null;
}

/** Cidades ainda vazias (B6). */
export const CITIES_EMPTY = 'As cidades das vagas aparecem aqui depois da primeira consulta ao Freela (até 10 minutos depois de ligar).';

/** Aviso vermelho do Instagram desconectado (A6). */
export const INSTAGRAM_DISCONNECTED =
  'O Instagram está desconectado. Enquanto isso nenhuma arte é criada e nada vai ao ar. Vagas que começarem antes de você reconectar ficam de fora.';

/**
 * Fila do "Desfazer" (M3): cada item roda no prazo; `cancel` é o Desfazer; `flush` (aba fechando ou indo para o fundo) cancela os
 * timers e dispara já o envio de cada pendente. Timers injetáveis para teste.
 */
export function createUndoQueue(set: SetT = (f, m) => setTimeout(f, m), clear: ClearT = (id) => clearTimeout(id as ReturnType<typeof setTimeout>)) {
  const items = new Map<string, { timer: unknown; now: () => void }>();
  return {
    add(id: string, run: () => void, now: () => void, delay: number = DONT_POST_UNDO_MS) {
      const old = items.get(id);
      if (old) clear(old.timer);
      const timer = set(() => {
        items.delete(id);
        run();
      }, delay);
      items.set(id, { timer, now });
    },
    cancel(id: string): boolean {
      const it = items.get(id);
      if (!it) return false;
      clear(it.timer);
      items.delete(id);
      return true;
    },
    flush() {
      for (const [id, it] of [...items]) {
        clear(it.timer);
        items.delete(id);
        it.now();
      }
    },
    has: (id: string) => items.has(id),
    size: () => items.size,
  };
}

/** Chamada do "Não postar" que sobrevive ao fechar a aba (`keepalive`), com o mesmo bearer do cliente http. */
export function dontPostKeepaliveRequest(apiUrl: string, ws: string, id: string, token: string | null | undefined): [string, RequestInit & { headers: Record<string, string> }] {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return [`${apiUrl}/v1/workspaces/${ws}/vacancy-stories/stories/${id}/dont-post`, { method: 'POST', keepalive: true, headers, body: '{}' }];
}
