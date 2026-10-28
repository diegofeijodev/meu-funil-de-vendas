import type { PostRow } from './ig-types';

/**
 * Guardas de origem (ponto de extensão no molde de `CRM_CHANNEL_HOOKS`): o módulo dono da origem de um post (ex.: os stories das
 * vagas do Freela, `source = 'vacancy'`) decide, logo antes de criar o container, se o post ainda pode sair. Servida por um módulo
 * `@Global` fora do Instagram; sem implementação, nada muda na publicação.
 */
export interface PublishOriginGuard {
  /**
   * `null` = pode publicar; texto = cancelar o post (o texto é o motivo); lança `OriginUnavailable` = a fonte está fora do ar
   * (a fila tenta de novo em 10 min sem gastar tentativa). `at` = o instante da publicação (agora, ou a próxima tentativa da fila).
   */
  blockReason(post: PostRow, at: Date): Promise<string | null>;
  /** Chamado depois que um post dessa origem é aprovado (o módulo dono agenda a publicação). */
  afterApproval?(workspaceId: string, postId: string): Promise<void>;
}
export const PUBLISH_ORIGIN_GUARDS = Symbol('PUBLISH_ORIGIN_GUARDS');

/** Post de vaga que ninguém consegue conferir (sem a vaga de origem, ou sem a guarda): não sai. */
export const ORIGIN_UNVERIFIABLE_MSG = 'Não conseguimos conferir a vaga deste story. Por segurança, ele não vai ao ar.';
/** Agendar à mão (ou trocar o horário pelo editor) um story de vaga pularia janela, limite e espaço (R25). */
export const VACANCY_SCHEDULE_MSG = 'O horário dos stories de vagas segue os Ajustes da aba Vagas.';
/** Aprovar story de vaga fora de "esperando aprovação" o agendaria de novo (publicado sairia duplicado; cancelado ressuscitaria). */
export const VACANCY_NOT_PENDING_MSG = 'Este story não está esperando aprovação.';
