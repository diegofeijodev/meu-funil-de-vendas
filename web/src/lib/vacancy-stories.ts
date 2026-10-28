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

/** Vitrine do Freela sem consulta bem-sucedida há mais de 30 min (só faz sentido com a função ligada). */
export function pollStale(s: { last_poll_ok_at: string | null; enabled: boolean }, now: Date): boolean {
  if (!s.enabled) return false;
  if (!s.last_poll_ok_at) return true;
  return now.getTime() - new Date(s.last_poll_ok_at).getTime() > STALE_MS;
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

type AttemptLike = { n: number; ok: boolean; wrong: string[] };

/**
 * Linha das tentativas do detalhe. Reserva: texto de UI §4 com o campo que mais errou. IA: "Feita pela IA na 2ª tentativa (a 1ª errou
 * o horário)"; de primeira: "Feita pela IA de primeira". Sem log, `null`.
 */
export function attemptsLine(s: { attempts_log: AttemptLike[]; used_fallback: boolean }): string | null {
  const log = s.attempts_log;
  if (s.used_fallback) {
    const count = new Map<string, number>();
    for (const a of log) for (const w of a.wrong) count.set(w, (count.get(w) ?? 0) + 1);
    let top: string | null = null;
    for (const [k, v] of count) if (top === null || v > (count.get(top) ?? 0)) top = k;
    return `Versão de reserva: a IA errou o ${top ? fieldLabel(top) : 'texto'} nas 3 tentativas, então o sistema escreveu os textos por cima de uma foto. Os textos estão certos; o visual é mais simples.`;
  }
  const okIdx = log.findIndex((a) => a.ok);
  if (okIdx < 0) return null;
  if (okIdx === 0) return 'Feita pela IA de primeira';
  const erros = log.slice(0, okIdx).flatMap((a) => a.wrong.map(fieldLabel));
  const unicos = [...new Set(erros)];
  const quando = okIdx === 1 ? 'a 1ª' : `as ${okIdx} primeiras`;
  const verbo = okIdx === 1 ? 'errou' : 'erraram';
  return `Feita pela IA na ${okIdx + 1}ª tentativa (${quando} ${verbo}${unicos.length ? ` o ${unicos.join(' e o ')}` : ''})`;
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

/** Agenda `fn` e devolve `cancel` — o "Desfazer" do "Não postar" (D5). Timers injetáveis para teste. */
export function scheduleDelayed(
  fn: () => void,
  ms: number = DONT_POST_UNDO_MS,
  set: SetT = (f, m) => setTimeout(f, m),
  clear: ClearT = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
): { cancel: () => void } {
  const id = set(fn, ms);
  return { cancel: () => clear(id) };
}

export type PostNowDialog = { title: string; description: string; confirm: string; cancel: string };

/** Diálogo do "Postar agora" (UI §4): esperando o horário (fora da janela) ou esperando a vez (acima do limite). */
export function postNowDialog(
  display: 'waiting_window' | 'waiting_cap',
  s: { window_start: string; window_end: string; today: { posted: number; scheduled: number; cap: number } },
  now: Date,
): PostNowDialog {
  if (display === 'waiting_cap') {
    const n = s.today.posted + s.today.scheduled;
    return {
      title: 'Postar agora, acima do limite?',
      description: `Hoje já foram ${n} stories de vagas (o seu máximo). Este vai ser o ${n + 1}º e conta no limite de 25 do Instagram.`,
      confirm: 'Postar agora',
      cancel: 'Deixar para amanhã',
    };
  }
  return {
    title: 'Postar agora, fora do horário?',
    description: `São ${hhLabel(now.toISOString())}, fora do horário que você definiu (${hhLabel(s.window_start)} às ${hhLabel(s.window_end)}). O story vai ao ar em até 5 minutos e conta no máximo de hoje.`,
    confirm: 'Postar agora',
    cancel: `Esperar as ${hhLabel(s.window_start)}`,
  };
}

/** Vazio de "Vagas que chegaram" com a função ligada. */
export function noStoriesYet(s: { enabled_at: string | null; last_poll_ok_at: string | null }): string {
  const desde = s.enabled_at ? ` desde que você ligou (${dmLabel(s.enabled_at)} às ${hhLabel(s.enabled_at)})` : '';
  const ultima = s.last_poll_ok_at ? ` Consultamos o Freela a cada 10 minutos; a última foi às ${hhLabel(s.last_poll_ok_at)}.` : ' Consultamos o Freela a cada 10 minutos.';
  return `Nenhuma vaga nova${desde}.${ultima}`;
}

/** Aviso do máximo por dia (UI §3): acima de 15 os posts normais podem ficar sem espaço. */
export function capWarning(cap: number): string | null {
  return cap > 15 ? 'Acima de 15, os posts normais da empresa podem ficar sem espaço no dia.' : null;
}

export type Outcomes = { n: number; first_try: number; redone: number; fallback: number; not_posted: number };

/** Frase do diálogo "Postar sozinho" (concordância em número, R4). Sem histórico, `null`. */
export function autoPublishSummary(o: Outcomes): string | null {
  if (o.n <= 0) return null;
  const quando = o.n === 1 ? 'No último story' : `Nos últimos ${o.n} stories`;
  const primeira = `${o.first_try} ${o.first_try === 1 ? 'saiu certo' : 'saíram certos'} de primeira`;
  const refeitos = `${o.redone} ${o.redone === 1 ? 'foi refeito' : 'foram refeitos'}`;
  const reserva = `${o.fallback} ${o.fallback === 1 ? 'foi' : 'foram'} para a reserva`;
  return `${quando}: ${primeira}, ${refeitos}, ${reserva} e você não postou ${o.not_posted}.`;
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
export type PostVacancy = { story_id: string; checked_fields: string[]; requires_approval: boolean };
export function postVacancy(post: { source?: string | null; creative_brief?: unknown }): PostVacancy | null {
  if (post.source !== 'vacancy') return null;
  const v = (post.creative_brief as { vacancy?: Record<string, unknown> } | null | undefined)?.vacancy;
  if (!v || typeof v['story_id'] !== 'string') return null;
  return {
    story_id: v['story_id'],
    checked_fields: Array.isArray(v['checked_fields']) ? (v['checked_fields'] as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    requires_approval: v['requires_approval'] === true,
  };
}

/** Função da vaga a partir do `theme` do post ("Vaga · Garçom · Coco Bambu · Sáb 29/10" → "Garçom"). */
export function funcaoOfTheme(theme: string | null | undefined): string {
  const parts = (theme ?? '').split(' · ');
  return (parts[0] === 'Vaga' ? parts[1] : parts[0])?.trim() || 'selecionada';
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
