import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import type { Env } from '../../common/config/env.validation';
import { parseVacancyWorkspaces } from '../../common/config/vacancy-workspaces';
import { notFound } from '../media/user-error';

export const GATE_NOT_FOUND = 'Página não encontrada.';

/**
 * Empresas com os stories das vagas (`VACANCY_STORIES_WORKSPACE_IDS`). Fora da lista a função não existe: as rotas respondem 404
 * (o mesmo de uma página que não existe) e o job não toca na empresa.
 */
@Injectable()
export class VacancyGate {
  private readonly list: '*' | Set<string>;

  constructor(@Inject(ENV) env: Pick<Env, 'VACANCY_STORIES_WORKSPACE_IDS' | 'NODE_ENV'>) {
    this.list = parseVacancyWorkspaces(env.VACANCY_STORIES_WORKSPACE_IDS, env.NODE_ENV);
  }

  allowed(workspaceId: string): boolean {
    if (this.list === '*') return true;
    return typeof workspaceId === 'string' && this.list.has(workspaceId.toLowerCase());
  }

  assert(workspaceId: string): void {
    if (!this.allowed(workspaceId)) throw notFound(GATE_NOT_FOUND);
  }
}

/** Para `/v1/workspaces/:workspaceId/vacancy-stories/*`: depois do `WorkspaceAccessGuard`. */
@Injectable()
export class VacancyGateGuard implements CanActivate {
  constructor(private readonly gate: VacancyGate) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ params?: { workspaceId?: string } }>();
    this.gate.assert(req.params?.workspaceId ?? '');
    return true;
  }
}
