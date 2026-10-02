import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { isUuid } from '../../common/ids/uuid';

export type WorkspaceRole = 'owner' | 'admin' | 'marketing' | 'viewer';
/** read = qualquer membro (inclui viewer) · write = owner|admin|marketing · manage = owner|admin. */
export type AccessLevel = 'read' | 'write' | 'manage';

export const EDITORS: WorkspaceRole[] = ['owner', 'admin', 'marketing'];
export const MANAGERS: WorkspaceRole[] = ['owner', 'admin'];

const ALLOWED: Record<AccessLevel, WorkspaceRole[]> = {
  read: ['owner', 'admin', 'marketing', 'viewer'],
  write: EDITORS,
  manage: MANAGERS,
};

/** Mensagens iguais às de `membership.ts#requireRole` do protótipo. */
export const NOT_A_MEMBER = 'Você não tem acesso a esta empresa.';
export const ROLE_NOT_ALLOWED = 'Seu perfil não tem permissão para esta ação.';

export const roleAllows = (role: WorkspaceRole, level: AccessLevel): boolean => ALLOWED[level].includes(role);

/**
 * Substitui o RLS do Supabase: toda rota de workspace passa por aqui.
 * - read: qualquer membro. write: owner|admin|marketing (viewer só lê).
 * - manage: owner|admin (aprovar decisão, aprovar/ativar campanha, conectar contas, chaves…).
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Papel do usuário no workspace, ou null se não for membro. */
  async roleOf(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
    if (!isUuid(workspaceId) || !isUuid(userId)) return null;
    const m = await this.prisma.workspace_members.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
      select: { role: true },
    });
    return (m?.role as WorkspaceRole | undefined) ?? null;
  }

  /** Garante o nível de acesso e devolve o papel. 404 se o id da URL for malformado; 403 caso contrário. */
  async require(userId: string, workspaceId: string, level: AccessLevel): Promise<WorkspaceRole> {
    if (!isUuid(workspaceId)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
    const role = await this.roleOf(userId, workspaceId);
    if (!role) throw new ForbiddenException({ code: 'FORBIDDEN', message: NOT_A_MEMBER });
    if (!roleAllows(role, level)) throw new ForbiddenException({ code: 'FORBIDDEN', message: ROLE_NOT_ALLOWED });
    return role;
  }

  /** Versão booleana (para ramos condicionais), sem lançar. */
  async can(userId: string, workspaceId: string, level: AccessLevel): Promise<boolean> {
    const role = await this.roleOf(userId, workspaceId);
    return !!role && roleAllows(role, level);
  }
}
