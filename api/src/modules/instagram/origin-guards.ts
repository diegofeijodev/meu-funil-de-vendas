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
