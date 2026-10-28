import type { Prisma } from '@prisma/client';
import { addDays } from '../../common/time/dates';
import { DONT_POST_REASON, MAX_REDOS, VACANCY_CLOSED_REASON, WAIT_CAP } from './vacancy-reasons';
import { PUBLISH_SLACK_MS, spDay, windowStartOn } from './vacancy-slots';
import { cleanEstablishment, cleanFunction, formatMoney, formatWhen, hourLabel, isTestText, shortDay, spParts, vacancyFields } from './vacancy-text';
import { SKIP } from './vacancy-triage';
import type { AttemptLog, FieldCheck, FieldKey, FreelaVacancy, SettingsRow, StoryRow } from './vacancy-types';
import { FIELD_LABELS } from './vacancy-verify';

/**
 * Situação de cada story de vaga na tela (UI §4), calculada da linha (`vacancy_stories`) e, depois da entrega, do post (`ig_posts`):
 * depois de `handed_off` quem manda é o status do post (design §6.9). Funções puras — a lista, o detalhe e as ações usam as mesmas.
 */

export type Display =
  | 'queued'
  | 'generating'
  | 'waiting_window'
  | 'waiting_cap'
  | 'to_approve'
  | 'ready'
  | 'live'
  | 'was_live'
  | 'skipped'
  | 'cancelled'
  | 'failed';

/** O que a tela lê do post de vaga. */
export type StoryPost = Pick<
  Prisma.ig_postsGetPayload<object>,
  'id' | 'status' | 'scheduled_at' | 'published_at' | 'last_error' | 'rejection_reason' | 'ig_permalink' | 'media' | 'creative_brief' | 'ai_generation_log'
>;

export type DisplayResult = { display: Display; label: string; support: string | null; reason: string | null; approve_until: Date | null };
/**
 * O que a tela precisa saber da empresa agora: `capFull` = o limite de hoje está cheio (ausente = cheio); `todayCount` = stories de vaga
 * de hoje (`countVacancyStoriesOnDay`, R3; ausente = o limite); `igFull` = sem espaço no limite de publicações da Meta.
 */
export type DisplayContext = { capFull?: boolean; todayCount?: number; igFull?: boolean };

export type StoryCan = { approve: boolean; dont_post: boolean; post_now: boolean; create_anyway: boolean; redo: boolean; retry: boolean };

export type StoryView = {
  id: string;
  external_id: string;
  status: string;
  display: Display;
  label: string;
  support: string | null;
  reason: string | null;
  funcao: string;
  estabelecimento: string | null;
  /** Nome da empresa como veio da vitrine (o diálogo "Essa vaga parece de teste ({nome})"). */
  contractor_name: string | null;
  valor: string | null;
  quando: string;
  cidade: string | null;
  starts_at: Date;
  approve_until: Date | null;
  scheduled_at: Date | null;
  published_at: Date | null;
  permalink: string | null;
  thumb_url: string | null;
  media_url: string | null;
  attempts: number;
  used_fallback: boolean;
  redo_count: number;
  ig_post_id: string | null;
  is_test: boolean;
  freela_url: string;
  /** R29: a mídia veio de "Enviar minha própria" — ninguém conferiu a arte. */
  own_art: boolean;
  can: StoryCan;
};

/** `own_art`: a mídia foi trocada por "Enviar minha própria" (R29) — ninguém conferiu, então `checks` vem vazio. */
export type StoryDetail = StoryView & { checks: FieldCheck[]; attempts_log: AttemptLog[]; alt: string };

/** Página pública da vaga no Freela. */
export const FREELA_VACANCY_URL = 'https://www.freelaservicosapp.com.br/vagas/';
const MIN = 60_000;
const DAY_MS = 24 * 60 * MIN;
const AI_TRIES = 3;

const LABEL = {
  queued: 'Na fila para criar a arte',
  generating: 'Criando a arte',
  waiting_window: 'Esperando o horário',
  waiting_cap: 'Esperando a vez',
  to_approve: 'Esperando sua aprovação',
  ready_no_time: 'Pronto para ir ao ar',
  was_live: 'Ficou 24 h no ar',
  skipped: 'Não virou story',
  cancelled: 'Não foi ao ar',
  failed: 'Não conseguimos criar o story',
};

/** Linha antes da entrega: "Não postar" cancela a própria linha. */
export const ROW_QUEUED = ['new', 'waiting', 'generating'];
/** Post entregue e ainda não publicado: "Não postar" e "Refazer a arte" valem. */
export const POST_UNPUBLISHED = ['pending_approval', 'approved', 'ready', 'scheduled'];
/** Linhas que "Criar story mesmo assim" traz de volta (e a entregue cujo post foi cancelado). */
const ROW_REVIVABLE = ['skipped', 'cancelled', 'expired'];
/** Motivos que "Criar story mesmo assim" não desfaz (R30): a vaga continua sem como virar story. */
const NO_REVIVE = [VACANCY_CLOSED_REASON, SKIP.noValue, SKIP.noCity];
const LATER = ['approved', 'ready', 'scheduled'];

// ------------------------------------------------------------------ horários (Brasília)

const two = (n: number) => String(n).padStart(2, '0');
const hourOf = (d: Date) => hourLabel(spParts(d.toISOString()).minutes);
const dayMonth = (d: Date) => {
  const p = spParts(d.toISOString());
  return `${two(p.day)}/${two(p.month)}`;
};
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "às 8h" (hoje) · "amanhã às 8h" · "dia 31/10 às 8h" — para "Vai ao ar …". */
export function atLabel(d: Date, now: Date): string {
  const day = spDay(d);
  if (day === spDay(now)) return `às ${hourOf(d)}`;
  if (day === addDays(spDay(now), 1)) return `amanhã às ${hourOf(d)}`;
  return `dia ${dayMonth(d)} às ${hourOf(d)}`;
}

/** "16h" (hoje) · "amanhã às 16h" · "dia 31/10 às 16h" — para "Aprove até …" e "No ar até …". */
export function untilLabel(d: Date, now: Date): string {
  return spDay(d) === spDay(now) ? hourOf(d) : atLabel(d, now);
}

const inWindow = (now: Date, s: Pick<SettingsRow, 'window_start' | 'window_end'>) => {
  const m = spParts(now.toISOString()).minutes;
  return m >= minutesOf(s.window_start) && m < minutesOf(s.window_end);
};

/**
 * Até quando dá para aprovar: o início menos a antecedência e a folga de 15 min da fila (R26 — aprovar depois disso cancela o story
 * na agenda), puxado para dentro da janela (depois do fim → fim da janela; antes do início → fim da janela do dia anterior).
 */
export function approveUntil(startsAt: Date, s: Pick<SettingsRow, 'min_lead_minutes' | 'window_start' | 'window_end'>): Date {
  const t = new Date(startsAt.getTime() - s.min_lead_minutes * MIN - PUBLISH_SLACK_MS);
  const day = spDay(t);
  const end = windowStartOn(day, s.window_end);
  if (t.getTime() >= end.getTime()) return end;
  if (t.getTime() < windowStartOn(day, s.window_start).getTime()) return windowStartOn(addDays(day, -1), s.window_end);
  return t;
}

/** "Hoje já foram 10 (o máximo por dia). Vai ao ar amanhã às 8h, …" — `n` = a contagem real do dia; com 1, "já foi 1" (R4). */
function capSupport(n: number, at: Date, now: Date): string {
  const done = n === 1 ? 'Hoje já foi 1' : `Hoje já foram ${n}`;
  return `${done} (o máximo por dia). Vai ao ar ${atLabel(at, now)}, se a vaga ainda não tiver começado.`;
}

/** Espera pelo limite de publicações da Meta (não pelo limite do dia): a 1ª frase do aviso de limite dos Ajustes (UI §3) + o horário. */
function igSupport(at: Date, now: Date): string {
  return `O Instagram aceita até 25 publicações por dia na conta, somando os posts normais. Vai ao ar ${atLabel(at, now)}.`;
}

const noPeriod = (s: string) => s.trim().replace(/[.\s]+$/, '');
const asLog = (v: unknown): AttemptLog[] => (Array.isArray(v) ? (v as AttemptLog[]) : []);
const aiAttempts = (log: unknown) => asLog(log).filter((a) => a?.kind === 'ai').length;

// ------------------------------------------------------------------ situação

/**
 * Situação, rótulo, apoio e motivo de um story (UI §4). Antes da entrega pela linha; depois, pelo post. Post agendado: hoje e com a
 * janela aberta → pronto; fora da janela → esperando o horário; empurrado para outro dia com a janela aberta → esperando a vez (se
 * o limite de hoje está cheio, ou se a conta está sem espaço no limite da Meta; senão o horário). "Tentativa {n} de 3" = o contador
 * ao vivo do gerador (`mismatch_attempts` + 1, máx. 3 — R28).
 */
export function displayOf(row: StoryRow, post: StoryPost | null, s: SettingsRow, now: Date, ctx: DisplayContext = {}): DisplayResult {
  const out = (display: Display, label: string, support: string | null = null, reason: string | null = null, approve_until: Date | null = null) =>
    ({ display, label, support, reason, approve_until }) as DisplayResult;
  switch (row.status) {
    case 'new':
      return out('queued', LABEL.queued, row.wait_reason);
    case 'waiting': {
      if (row.wait_reason !== WAIT_CAP) return out('queued', LABEL.queued, row.wait_reason);
      const at = row.not_before ?? windowStartOn(addDays(spDay(now), 1), s.window_start);
      return out('waiting_cap', LABEL.waiting_cap, capSupport(ctx.todayCount ?? s.daily_cap, at, now));
    }
    case 'generating':
      return out('generating', LABEL.generating, `Tentativa ${Math.min(AI_TRIES, row.mismatch_attempts + 1)} de ${AI_TRIES}`);
    case 'skipped':
      return out('skipped', LABEL.skipped, null, row.skip_reason);
    case 'expired':
    case 'cancelled':
      return out('cancelled', LABEL.cancelled, null, row.skip_reason);
    case 'failed':
      return out('failed', LABEL.failed, null, row.skip_reason);
  }
  // Entregue: o post manda. Sem post (apagado no editor) = não foi ao ar.
  if (!post) return out('cancelled', LABEL.cancelled, null, row.skip_reason);
  switch (post.status) {
    case 'pending_approval': {
      const until = approveUntil(row.starts_at, s);
      return out('to_approve', LABEL.to_approve, `Aprove até ${untilLabel(until, now)}. Depois disso não dá tempo de divulgar.`, null, until);
    }
    case 'published': {
      const end = new Date((post.published_at ?? now).getTime() + DAY_MS);
      return end.getTime() > now.getTime() ? out('live', `No ar até ${untilLabel(end, now)}`) : out('was_live', LABEL.was_live);
    }
    case 'cancelled':
      return out('cancelled', LABEL.cancelled, null, row.skip_reason ?? (post.rejection_reason ? DONT_POST_REASON : post.last_error));
    case 'failed':
      return out('failed', LABEL.failed, null, post.last_error ? `O Instagram recusou a publicação: ${noPeriod(post.last_error)}.` : 'O Instagram recusou a publicação.');
  }
  const at = post.scheduled_at;
  if (LATER.includes(post.status) && at && at.getTime() > now.getTime()) {
    const otherDay = spDay(at) !== spDay(now);
    const open = inWindow(now, s);
    if (otherDay && open && ctx.capFull !== false) return out('waiting_cap', LABEL.waiting_cap, capSupport(ctx.todayCount ?? s.daily_cap, at, now));
    if (otherDay && open && ctx.igFull) return out('waiting_cap', LABEL.waiting_cap, igSupport(at, now));
    if (otherDay || !open) return out('waiting_window', LABEL.waiting_window, `Vai ao ar ${atLabel(at, now)}`);
  }
  // Pronto (também `publishing`); sem horário (Instagram desconectado, token vencido) o apoio diz por quê.
  return at ? out('ready', `Pronto, vai ao ar ${atLabel(at, now)}`) : out('ready', LABEL.ready_no_time, post.last_error);
}

/** Botões de cada situação (UI §4). Postar agora, criar mesmo assim, refazer e tentar de novo exigem a função ligada. */
export function canOf(row: StoryRow, post: StoryPost | null, d: Display, s: SettingsRow, now: Date): StoryCan {
  const on = s.enabled;
  const unpublished = row.status === 'handed_off' && !!post && POST_UNPUBLISHED.includes(post.status);
  return {
    approve: d === 'to_approve',
    dont_post: ROW_QUEUED.includes(row.status) ? row.status !== 'generating' : unpublished,
    post_now: on && (d === 'waiting_window' || d === 'waiting_cap'),
    // R30: some se a vaga não tem como virar story (fechada, sem valor, sem cidade, ou já dentro da antecedência + 15 min de folga).
    create_anyway:
      on && (d === 'skipped' || d === 'cancelled') && canRevive(row, post) && !NO_REVIVE.includes(row.skip_reason ?? '') &&
      row.starts_at.getTime() - s.min_lead_minutes * MIN - PUBLISH_SLACK_MS > now.getTime(),
    redo: on && unpublished && row.redo_count < MAX_REDOS,
    retry: on && (row.status === 'failed' || (row.status === 'handed_off' && post?.status === 'failed')),
  };
}

/** Linha que "Criar story mesmo assim" pode trazer de volta: pulada, cancelada, expirada, ou entregue com o post cancelado/apagado. */
export function canRevive(row: StoryRow, post: StoryPost | null): boolean {
  if (ROW_REVIVABLE.includes(row.status)) return true;
  return row.status === 'handed_off' && (!post || post.status === 'cancelled');
}

// ------------------------------------------------------------------ visão (wire)

const snap = (row: StoryRow) => (row.snapshot ?? {}) as unknown as Partial<FreelaVacancy>;
const briefOf = (post: StoryPost | null) =>
  (post?.creative_brief as unknown as { vacancy?: { checked_fields?: string[]; used_fallback?: boolean } } | null)?.vacancy;

function whenOf(row: StoryRow): { day: string; horario: string } {
  const v = snap(row);
  const start = v.startTime ?? row.starts_at.toISOString();
  return { day: shortDay(start), horario: v.endTime ? formatWhen(start, v.endTime).horario : hourOf(row.starts_at) };
}

export function storyView(row: StoryRow, post: StoryPost | null, s: SettingsRow, now: Date, ctx: DisplayContext = {}): StoryView {
  const d = displayOf(row, post, s, now, ctx);
  const v = snap(row);
  const when = whenOf(row);
  const media = (Array.isArray(post?.media) ? (post!.media as unknown as { url?: string | null }[]) : [])[0]?.url ?? null;
  const city = (v.city ?? '').trim();
  return {
    id: row.id,
    external_id: row.external_id,
    status: row.status,
    display: d.display,
    label: d.label,
    support: d.support,
    reason: d.reason,
    funcao: cleanFunction(v.title ?? null, v.serviceType ?? null),
    estabelecimento: cleanEstablishment(v.contractorName ?? null),
    contractor_name: v.contractorName ?? null,
    valor: v.amountInCents ? formatMoney(v.amountInCents) : null,
    quando: `${when.day} · ${when.horario}`,
    cidade: city || null,
    starts_at: row.starts_at,
    approve_until: d.approve_until,
    scheduled_at: post?.scheduled_at ?? null,
    published_at: post?.published_at ?? null,
    permalink: post?.ig_permalink ?? null,
    thumb_url: media,
    media_url: media,
    attempts: aiAttempts(row.attempts_log),
    used_fallback: row.used_fallback,
    redo_count: row.redo_count,
    ig_post_id: row.ig_post_id,
    is_test: isTestText(v.contractorName) || isTestText(v.title),
    freela_url: `${FREELA_VACANCY_URL}${encodeURIComponent(row.external_id)}`,
    own_art: ownArt(post),
    can: canOf(row, post, d.display, s, now),
  };
}

/**
 * Conferência campo a campo da arte entregue: os valores esperados da vaga e se cada um conferiu (`checked_fields` do post; na
 * reserva todo texto é do sistema, então todos conferem). O que a leitura viu (`read`) não é guardado — só as chaves erradas de cada
 * tentativa ficam em `attempts_log`. Antes da entrega, ou com a arte trocada por "Enviar minha própria" (R29): vazia.
 */
export function storyChecks(row: StoryRow, post: StoryPost | null): FieldCheck[] {
  const v = snap(row);
  if (row.status !== 'handed_off' || !post || !v.startTime || !v.endTime || ownArt(post)) return [];
  const f = vacancyFields(v as FreelaVacancy);
  const brief = briefOf(post);
  const ok = new Set(brief?.checked_fields ?? []);
  const all = row.used_fallback || brief?.used_fallback === true;
  const expected: [FieldKey, string | null][] = [
    ['funcao', f.funcao],
    ['valor', f.valor],
    ['data', f.data],
    ['inicio', hourLabel(f.expected.startMin)],
    ['fim', hourLabel(f.expected.endMin)],
    ['cidade', f.cidade],
    ['estabelecimento', f.estabelecimento],
  ];
  return expected
    .filter(([key, e]) => key !== 'estabelecimento' || e != null)
    .map(([key, e]) => ({ key, label: FIELD_LABELS[key], ok: all || ok.has(key), read: null, expected: e }));
}

/** A mídia do post foi trocada por "Enviar minha própria" (último passo do `ai_generation_log` = `upload`): ninguém conferiu. */
export function ownArt(post: StoryPost | null): boolean {
  const log = Array.isArray(post?.ai_generation_log) ? (post!.ai_generation_log as unknown as { step?: unknown }[]) : [];
  return log.length > 0 && log[log.length - 1]?.step === 'upload';
}

export function storyDetail(row: StoryRow, post: StoryPost | null, s: SettingsRow, now: Date, ctx: DisplayContext = {}): StoryDetail {
  const view = storyView(row, post, s, now, ctx);
  const when = whenOf(row);
  const alt = `Story: ${[view.funcao, view.valor, when.day, when.horario, view.cidade].filter(Boolean).join(', ')}`;
  return { ...view, checks: storyChecks(row, post), attempts_log: asLog(row.attempts_log), alt };
}
