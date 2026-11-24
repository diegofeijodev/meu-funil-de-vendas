import { cltDeadline, cltFingerprint, cltForcedTriage, cltTriage } from './vacancy-clt';
import type { VacancyFeedClient } from './vacancy-feed';
import {
  blockedExpireReason, capWaitReason, CLT_CLOSED_REASON, CLT_DISABLED_REASON, CLT_STARTED_REASON, cltBlockedExpireReason, cltCapWaitReason,
  cltDeadlineReason, cltIgLimitReason, cltNoApprovalReason, cltSpacingReason, cltWindowReason, DISABLED_REASON, igLimitReason, noApprovalReason,
  spacingReason, tooCloseReason, VACANCY_CLOSED_REASON, VACANCY_STARTED_REASON, windowReason,
} from './vacancy-reasons';
import { fingerprint } from './vacancy-text';
import { forcedTriage, triage, type TriageResult, type TriageSettings } from './vacancy-triage';
import type { FreelaFixedJob, FreelaVacancy, SettingsRow, VacancySourceId } from './vacancy-types';

/**
 * Uma porta por fonte (desenho 2026-11-24 §2.4.3): diárias (`freela`, vitrine de vagas) e vagas fixas (`freela_clt`, vitrine de vagas
 * fixas). Camada LEVE — vitrine, assinatura, prazo, triagem, interruptor/limite/antecedência e os textos de cada lugar; a arte fica no
 * gerador (a guarda mora no núcleo `@Global` e não pode puxar IA nem arte). Consulta, gerador, agenda, guarda, ações e tela chamam por
 * aqui; a diária responde exatamente o que respondia antes (mesmas funções).
 */

export type SourceItem = FreelaVacancy | FreelaFixedJob;
type Settings = Partial<Pick<SettingsRow, 'enabled' | 'daily_cap' | 'min_lead_minutes' | 'clt_enabled' | 'clt_daily_cap'>>;

export type SourceReasons = {
  /** A vitrine respondeu 404 (guarda, geração). */
  closed: string;
  /** Começou (diária) / prazo passou (CLT) antes de ir ao ar (T10, guarda). */
  started: string;
  /** Desligaram este tipo. */
  disabled: string;
  /** Agenda recusa post com o tipo desligado (`schedule`). */
  off: string;
  /** Ação da tela com o tipo desligado. */
  actionOff: string;
  /** "Criar story mesmo assim" e a vaga não está mais aberta. */
  actionClosed: string;
  tooClose: (startsAt: Date, deadline: Date) => string;
  capWait: (cap: number, startsAt: Date) => string;
  blockedExpire: (startsAt: Date, since: Date) => string;
  noApproval: (until: Date, startsAt: Date) => string;
  window: (startsAt: Date, deadline: Date, windowStart: string, windowEnd: string) => string;
  igLimit: (startsAt: Date, deadline: Date, freesAt: Date) => string;
  spacing: (startsAt: Date, deadline: Date) => string;
};

export interface VacancySource {
  id: VacancySourceId;
  /** Como a tela e as rotas chamam o tipo. */
  kind: 'diaria' | 'clt';
  byId(feed: VacancyFeedClient, id: string): Promise<SourceItem | null>;
  fingerprint(v: SourceItem): string;
  /** `starts_at` da linha: o início da diária; o "divulgar até" da vaga fixa. */
  startsAt(v: SourceItem): Date;
  triage(v: SourceItem, s: TriageSettings, now: Date): TriageResult;
  forcedTriage(v: SourceItem, s: Pick<TriageSettings, 'min_lead_minutes'>, now: Date): TriageResult;
  /** Interruptor, limite por dia e antecedência deste tipo (a configuração pode faltar: padrões do banco). */
  on(s: Settings | null | undefined): boolean;
  cap(s: Settings | null | undefined): number;
  lead(s: Settings | null | undefined): number;
  reasons: SourceReasons;
}

const DIARIA: VacancySource = {
  id: 'freela',
  kind: 'diaria',
  byId: (feed, id) => feed.byId(id),
  fingerprint: (v) => fingerprint(v as FreelaVacancy),
  startsAt: (v) => new Date((v as FreelaVacancy).startTime),
  triage: (v, s, now) => triage(v as FreelaVacancy, s, now),
  forcedTriage: (v, s, now) => forcedTriage(v as FreelaVacancy, s, now),
  on: (s) => !!s?.enabled,
  cap: (s) => s?.daily_cap ?? 10,
  lead: (s) => s?.min_lead_minutes ?? 120,
  reasons: {
    closed: VACANCY_CLOSED_REASON,
    started: VACANCY_STARTED_REASON,
    disabled: DISABLED_REASON,
    off: 'Os stories das vagas estão desligados nesta empresa.',
    actionOff: 'Ligue os stories das vagas para usar esta ação.',
    actionClosed: 'A vaga não está mais aberta no Freela.',
    tooClose: tooCloseReason,
    capWait: capWaitReason,
    blockedExpire: blockedExpireReason,
    noApproval: noApprovalReason,
    window: windowReason,
    igLimit: igLimitReason,
    spacing: spacingReason,
  },
};

/** Vaga fixa: antecedência 0 (o prazo é o "divulgar até"); limite e interruptor próprios. */
const CLT: VacancySource = {
  id: 'freela_clt',
  kind: 'clt',
  byId: (feed, id) => feed.cltById(id),
  fingerprint: (v) => cltFingerprint(v as FreelaFixedJob),
  startsAt: (v) => cltDeadline(v as FreelaFixedJob),
  triage: (v, s, now) => cltTriage(v as FreelaFixedJob, s, now),
  forcedTriage: (v, _s, now) => cltForcedTriage(v as FreelaFixedJob, now),
  on: (s) => !!s?.clt_enabled,
  cap: (s) => s?.clt_daily_cap ?? 2,
  lead: () => 0,
  reasons: {
    closed: CLT_CLOSED_REASON,
    started: CLT_STARTED_REASON,
    disabled: CLT_DISABLED_REASON,
    off: 'Os stories das vagas fixas estão desligados nesta empresa.',
    actionOff: 'Ligue os stories das vagas fixas para usar esta ação.',
    actionClosed: 'A vaga fixa não está mais aberta no Freela.',
    tooClose: (startsAt) => cltDeadlineReason(startsAt),
    capWait: cltCapWaitReason,
    blockedExpire: cltBlockedExpireReason,
    noApproval: (until) => cltNoApprovalReason(until),
    window: (startsAt, _d, ws, we) => cltWindowReason(startsAt, ws, we),
    igLimit: (startsAt, _d, freesAt) => cltIgLimitReason(startsAt, freesAt),
    spacing: (startsAt) => cltSpacingReason(startsAt),
  },
};

export const SOURCES: Record<VacancySourceId, VacancySource> = { freela: DIARIA, freela_clt: CLT };

/** Fonte da linha (`vacancy_stories.source`); qualquer outro valor (linhas antigas) é diária. */
export const sourceOf = (id: string | null | undefined): VacancySource => (id === 'freela_clt' ? CLT : DIARIA);
/** Fonte pelo `kind` da tela/rota. */
export const sourceOfKind = (kind: 'diaria' | 'clt'): VacancySource => (kind === 'clt' ? CLT : DIARIA);

/** Fonte de um post de vaga: `creative_brief.vacancy.kind = 'clt'` (posts de antes deste lote não têm `kind` = diária). */
export function sourceOfPost(post: { creative_brief?: unknown } | null | undefined): VacancySource {
  const kind = (post?.creative_brief as { vacancy?: { kind?: unknown } } | null | undefined)?.vacancy?.kind;
  return kind === 'clt' ? CLT : DIARIA;
}

/** Janela + antecedência do tipo, para `approveUntil` (CLT: antecedência 0). */
export function timingOf(src: VacancySource, s: Pick<SettingsRow, 'window_start' | 'window_end'> & Settings) {
  return { min_lead_minutes: src.lead(s), window_start: s.window_start, window_end: s.window_end };
}
