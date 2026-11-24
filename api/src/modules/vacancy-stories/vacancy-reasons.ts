import { PUBLISH_SLACK_MS } from './vacancy-slots';
import { dayLabel, hourLabel, spParts } from './vacancy-text';

/**
 * Motivos que a tela mostra quando um story de vaga não vai ao ar (gravados em `vacancy_stories.skip_reason`). Arquivo leve de
 * propósito: a guarda mora no núcleo `@Global` e não pode puxar IA/arte do gerador. Um texto, um lugar.
 *
 * Motivo GRAVADO é lido por dias: nunca "hoje"/"amanhã", sempre dia e hora absolutos (Brasília). A 1ª data do texto leva o dia
 * ("Qua, 29/10 às 15h"); as seguintes só levam o dia quando caem em outro dia que a 1ª.
 */

const MIN = 60_000;

/** Hora de Brasília de um instante ("18h", "9h30"). */
const hourOf = (d: Date) => hourLabel(spParts(d.toISOString()).minutes);
/** "Qua, 29/10 às 15h". */
const fullAt = (d: Date) => `${dayLabel(d.toISOString())} às ${hourOf(d)}`;
const sameDay = (a: Date, b: Date) => dayLabel(a.toISOString()) === dayLabel(b.toISOString());
/** "até as 12h45" (mesmo dia que `ref`) · "até Ter, 28/10 às 21h". */
const untilAt = (d: Date, ref: Date) => (sameDay(d, ref) ? `até as ${hourOf(d)}` : `até ${fullAt(d)}`);
/** "a partir das 7h" (mesmo dia que `ref`) · "a partir de Qua, 29/10 às 7h". */
const fromAt = (d: Date, ref: Date) => (sameDay(d, ref) ? `a partir das ${hourOf(d)}` : `a partir de ${fullAt(d)}`);
/** "08:00" → "8h". */
const hhmm = (s: string) => hourLabel(Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)));

/** A Meta está recusando as publicações da empresa (bloqueio aberto, R5): a linha espera sem gastar IA. */
export const PUBLISH_BLOCKED_WAIT = 'Esperando o Instagram voltar a aceitar publicações para criar a arte.';

/** Marca de `wait_reason` da linha que espera a vez (limite do dia); a tela mostra "Esperando a vez". */
export const WAIT_CAP = 'cap';

/** D11: refações por mudança da vaga (e "Refazer a arte") por linha. */
export const MAX_REDOS = 3;

export const DISABLED_REASON = 'Os stories das vagas foram desligados.';
export const DONT_POST_REASON = 'Você escolheu não postar.';
export const VACANCY_CLOSED_REASON = 'A vaga não está mais aberta no Freela (preenchida ou cancelada).';
export const VACANCY_STARTED_REASON = 'A vaga começou antes de ir ao ar.';
export const VACANCY_CHANGED_REASON = 'A vaga mudou no Freela (valor ou horário). Vamos criar o story de novo.';
export const VACANCY_CHANGED_TOO_OFTEN = 'A vaga mudou muitas vezes no Freela. Crie o story de novo quando ela estiver definida.';
/** Post de vaga sem a vaga de origem (nem linha, nem `creative_brief.vacancy.external_id`): não sai sem conferência. */
export { ORIGIN_UNVERIFIABLE_MSG as VACANCY_UNVERIFIABLE } from '../instagram/origin-guards';

/**
 * Até quando o story teria de ir ao ar: início − antecedência (− 15 min de folga da fila onde ela vale: agenda, "Criar story mesmo
 * assim" e geração — R26; a triagem da consulta e a guarda medem só a antecedência).
 */
export const leadDeadline = (startsAt: Date, leadMinutes: number, slack = false) =>
  new Date(startsAt.getTime() - leadMinutes * MIN - (slack ? PUBLISH_SLACK_MS : 0));

/** "A vaga começa Qua, 29/10 às 15h. Para dar tempo de divulgar, o story teria de ir ao ar até as 12h45" (sem o ponto final). */
const leadIntro = (startsAt: Date, deadline: Date) =>
  `A vaga começa ${fullAt(startsAt)}. Para dar tempo de divulgar, o story teria de ir ao ar ${untilAt(deadline, startsAt)}`;

/** A vaga entrou na antecedência mínima (triagem, expiração da fila, guarda na hora de publicar e "Criar story mesmo assim"). */
export const tooCloseReason = (startsAt: Date, deadline: Date) => `${leadIntro(startsAt, deadline)}.`;

/** R23 — o horário para postar (janela) só abre depois do prazo. */
export const windowReason = (startsAt: Date, deadline: Date, windowStart: string, windowEnd: string) =>
  `${leadIntro(startsAt, deadline)}, antes do seu horário para postar (${hhmm(windowStart)} às ${hhmm(windowEnd)}).`;

/** R23 — o limite de publicações da Meta só libera espaço depois do prazo. */
export const igLimitReason = (startsAt: Date, deadline: Date, freesAt: Date) =>
  `${leadIntro(startsAt, deadline)}, mas a conta só tem espaço no Instagram ${fromAt(freesAt, startsAt)}.`;

/** R23 — os 15 min entre stories de vaga empurram o horário para depois do prazo. */
export const spacingReason = (startsAt: Date, deadline: Date) =>
  `${leadIntro(startsAt, deadline)}, e os horários até lá já têm outros stories de vagas.`;

/** A linha/post esperou a vez (limite do dia) e não coube antes do início ("1 story de vaga" no singular — R40/M2). */
export const capWaitReason = (cap: number, startsAt: Date) =>
  `Não coube no máximo de ${cap === 1 ? '1 story de vaga' : `${cap} stories de vagas`} por dia antes do início da vaga (${fullAt(startsAt)}).`;

/**
 * R5 — a vaga perdeu o prazo enquanto a Meta recusava as publicações da empresa (linha esperando o bloqueio, ou post parado por ele que a
 * expiração ou a guarda cancelaram). Nunca o `tooCloseReason` genérico nesses casos.
 */
export const blockedExpireReason = (startsAt: Date, since: Date) =>
  `Não foi ao ar: o Instagram recusava as publicações desta empresa desde ${fullAt(since)}, e a vaga começa ${sameDay(startsAt, since) ? `às ${hourOf(startsAt)}` : fullAt(startsAt)}.`;

/** Post que esperava aprovação e o prazo de aprovação (`approveUntil`) passou. */
export const noApprovalReason = (deadline: Date, startsAt: Date) =>
  `Ninguém aprovou a tempo. O prazo era ${fullAt(deadline)}; a vaga começa ${sameDay(startsAt, deadline) ? `às ${hourOf(startsAt)}` : fullAt(startsAt)}.`;

// ------------------------------------------------------------------ vagas fixas (CLT, 25/11/2026; desenho §2.4.3, UI §4.4)
// Na CLT, `starts_at` da linha é o "divulgar até" (mín(expiresAt, publishedAt + 30 dias)) e a antecedência é 0.

const two = (n: number) => String(n).padStart(2, '0');
/** "24/12" (Brasília). */
export const dayMonth = (d: Date) => {
  const p = spParts(d.toISOString());
  return `${two(p.day)}/${two(p.month)}`;
};

export const CLT_DISABLED_REASON = 'Os stories das vagas fixas foram desligados.';
export const CLT_CLOSED_REASON = 'A vaga fixa foi fechada ou venceu no Freela.';
export const CLT_STARTED_REASON = 'O prazo para divulgar esta vaga fixa terminou antes de ir ao ar.';

/** O "divulgar até" já passou (triagem, expiração da fila, guarda e "Criar story mesmo assim"). */
export const cltDeadlineReason = (deadline: Date) => `O prazo para divulgar esta vaga fixa terminou em ${dayMonth(deadline)}.`;

/** A linha esperou a vez (limite próprio das vagas fixas) e o prazo para divulgar terminou. */
export const cltCapWaitReason = (cap: number, deadline: Date) =>
  `Não coube no máximo de ${cap === 1 ? '1 story de vaga fixa' : `${cap} stories de vagas fixas`} por dia até ${dayMonth(deadline)}.`;

/** P19: perdeu o prazo enquanto a Meta recusava as publicações da empresa. */
export const cltBlockedExpireReason = (deadline: Date, since: Date) =>
  `Não foi ao ar: o Instagram recusava as publicações desta empresa desde ${fullAt(since)}, e o prazo para divulgar esta vaga fixa terminou em ${dayMonth(deadline)}.`;

/** Esperava aprovação e o prazo de aprovação passou. */
export const cltNoApprovalReason = (until: Date) => `Ninguém aprovou a tempo. O prazo era ${dayMonth(until)}.`;

/** "O prazo para divulgar esta vaga fixa vai até Qua, 24/12 às 14h" (sem o ponto final) — introdução dos motivos da agenda. */
const cltIntro = (deadline: Date) => `O prazo para divulgar esta vaga fixa vai até ${fullAt(deadline)}`;
export const cltWindowReason = (deadline: Date, windowStart: string, windowEnd: string) =>
  `${cltIntro(deadline)}, e o seu horário para postar (${hhmm(windowStart)} às ${hhmm(windowEnd)}) só abre depois.`;
export const cltIgLimitReason = (deadline: Date, freesAt: Date) =>
  `${cltIntro(deadline)}, mas a conta só tem espaço no Instagram ${fromAt(freesAt, deadline)}.`;
export const cltSpacingReason = (deadline: Date) => `${cltIntro(deadline)}, e os horários até lá já têm outros stories de vagas.`;
