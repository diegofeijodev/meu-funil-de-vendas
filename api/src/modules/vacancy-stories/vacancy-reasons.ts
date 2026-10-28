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

/** Post que esperava aprovação e o prazo de aprovação (`approveUntil`) passou. */
export const noApprovalReason = (deadline: Date, startsAt: Date) =>
  `Ninguém aprovou a tempo. O prazo era ${fullAt(deadline)}; a vaga começa ${sameDay(startsAt, deadline) ? `às ${hourOf(startsAt)}` : fullAt(startsAt)}.`;
