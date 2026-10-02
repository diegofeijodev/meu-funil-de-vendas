import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessLevel, WorkspaceAccessService } from './access.service';

export const ACCESS_LEVEL_KEY = 'workspaceAccessLevel';

/** Nível exigido pela rota. Sem o decorator: GET/HEAD = read, o resto = write. */
export const RequireAccess = (level: AccessLevel) => SetMetadata(ACCESS_LEVEL_KEY, level);

/**
 * Para controllers em `/v1/workspaces/:workspaceId/...`: `@UseGuards(WorkspaceAccessGuard)`.
 * Roda depois do guard global de JWT. Deixa `request.workspaceRole` para o handler.
 */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const explicit = this.reflector.getAllAndOverride<AccessLevel>(ACCESS_LEVEL_KEY, [context.getHandler(), context.getClass()]);
    const level: AccessLevel = explicit ?? (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'read' : 'write');
    req.workspaceRole = await this.access.require(req.user.id, req.params?.workspaceId, level);
    return true;
  }
}
