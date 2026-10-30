import { Inject, Injectable } from '@nestjs/common';
import { ENV } from './env.module';
import type { Env } from './env.validation';
import { inWorkspaceList, parseWorkspaceList } from './vacancy-workspaces';

/** Piloto liberado para a empresa = chave geral `CAMPAIGN_PILOT_ENABLED` **e** empresa em `CAMPAIGN_PILOT_WORKSPACE_IDS`. */
@Injectable()
export class PilotGate {
  private readonly on: boolean;
  private readonly list: '*' | Set<string>;

  constructor(@Inject(ENV) env: Pick<Env, 'NODE_ENV' | 'CAMPAIGN_PILOT_ENABLED' | 'CAMPAIGN_PILOT_WORKSPACE_IDS'>) {
    this.on = env.CAMPAIGN_PILOT_ENABLED === true;
    this.list = parseWorkspaceList('CAMPAIGN_PILOT_WORKSPACE_IDS', env.CAMPAIGN_PILOT_WORKSPACE_IDS, env.NODE_ENV);
  }

  enabled(workspaceId: string): boolean {
    return this.on && inWorkspaceList(this.list, workspaceId);
  }
}
