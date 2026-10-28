import { hourLabel, leadLabel, spParts } from './vacancy-text';

/**
 * Motivos que a tela mostra quando um story de vaga não vai ao ar (gravados em `vacancy_stories.skip_reason`). Arquivo leve de
 * propósito: a guarda mora no núcleo `@Global` e não pode puxar IA/arte do gerador. Um texto, um lugar.
 */

/** Hora de Brasília de um instante ("18h", "9h30"). */
const hourOf = (d: Date) => hourLabel(spParts(d.toISOString()).minutes);

/** D11: refações por mudança da vaga (e "Refazer a arte") por linha. */
export const MAX_REDOS = 3;

export const VACANCY_CLOSED_REASON = 'A vaga não está mais aberta no Freela (preenchida ou cancelada).';
export const VACANCY_STARTED_REASON = 'A vaga começou antes de ir ao ar.';
export const VACANCY_CHANGED_REASON = 'A vaga mudou no Freela (valor ou horário). Vamos criar o story de novo.';
export const VACANCY_CHANGED_TOO_OFTEN = 'A vaga mudou muitas vezes no Freela. Crie o story de novo quando ela estiver definida.';
/** Post de vaga sem a vaga de origem (nem linha, nem `creative_brief.vacancy.external_id`): não sai sem conferência. */
export const VACANCY_UNVERIFIABLE = 'Não conseguimos conferir a vaga deste story.';

/** A vaga entrou na antecedência mínima (triagem, expiração da fila e guarda na hora de publicar). */
export const tooCloseReason = (startsAt: Date, leadMinutes: number) =>
  `Começa às ${hourOf(startsAt)}, em menos de ${leadLabel(leadMinutes)}. Não dá tempo de divulgar.`;

/** A linha/post esperou a vez (limite do dia) e a vaga começou antes. */
export const capWaitReason = (cap: number) => `Ficou esperando a vez (máximo de ${cap} por dia) e a vaga começou antes.`;

/** Post que esperava aprovação e a vaga entrou na antecedência. */
export const noApprovalReason = (startsAt: Date) => `Ninguém aprovou a tempo: a vaga começou às ${hourOf(startsAt)}.`;

/** R23: o próximo horário livre (janela, espaço da Meta, 15 min entre stories) já fica dentro da antecedência. */
export const slotTooCloseReason = (at: Date, startsAt: Date, leadMinutes: number) =>
  `O próximo horário livre (${hourOf(at)}) fica a menos de ${leadLabel(leadMinutes)} do início (${hourOf(startsAt)}). Não dá tempo de divulgar.`;
