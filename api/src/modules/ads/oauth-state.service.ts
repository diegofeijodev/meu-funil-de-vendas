import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';

export type OAuthChannel = 'meta' | 'google' | 'tiktok';
export const OAUTH_STATE_TTL_MS = 15 * 60_000;

export class OAuthStateError extends Error {}
export const MSG_STATE_EXPIRED = 'O login expirou. Tente de novo.';
export const MSG_STATE_INVALID = 'Assinatura do retorno inválida.';

const hash = (state: string) => createHash('sha256').update(state).digest('hex');

/**
 * `state` do OAuth dos logins de anúncios. O protótipo assinava `{w,u,e}` com HMAC do segredo do app e não prendia o navegador;
 * aqui o `state` é aleatório (32 bytes), vive SÓ como hash no banco, tem validade, é de USO ÚNICO (consumo atômico: `DELETE`
 * condicional) e fica preso ao usuário + empresa + canal que iniciaram o login.
 */
@Injectable()
export class OAuthStateService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(channel: OAuthChannel, workspaceId: string, userId: string): Promise<string> {
    // Limpeza oportunista dos vencidos (a tabela nunca cresce sem limite).
    await this.prisma.oauth_states.deleteMany({ where: { expires_at: { lt: new Date() } } }).catch(() => undefined);
    const state = randomBytes(32).toString('base64url');
    await this.prisma.oauth_states.create({
      data: { state_hash: hash(state), channel, workspace_id: workspaceId, user_id: userId, expires_at: new Date(Date.now() + OAUTH_STATE_TTL_MS) },
    });
    return state;
  }

  /** Consome o `state` (uma vez só). Desconhecido/já usado/de outro canal = inválido; vencido = expirado. */
  async consume(channel: OAuthChannel, state: string): Promise<{ workspaceId: string; userId: string }> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) throw new OAuthStateError(MSG_STATE_INVALID);
    const h = hash(state);
    const row = await this.prisma.oauth_states.findUnique({ where: { state_hash: h } });
    if (!row || row.channel !== channel) throw new OAuthStateError(MSG_STATE_INVALID);
    // O DELETE é o consumo: só quem apaga a linha (count = 1) continua; a segunda chamada simultânea perde.
    const gone = await this.prisma.oauth_states.deleteMany({ where: { state_hash: h } });
    if (gone.count !== 1) throw new OAuthStateError(MSG_STATE_INVALID);
    if (row.expires_at.getTime() < Date.now()) throw new OAuthStateError(MSG_STATE_EXPIRED);
    return { workspaceId: row.workspace_id, userId: row.user_id };
  }
}
