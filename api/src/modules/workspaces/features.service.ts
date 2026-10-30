/**
 * Fonte única do "liberado para a empresa" (`GET /v1/workspaces/:id/features`): a tela pergunta aqui em vez de adivinhar por 404.
 * Cada função liga na sua fatia: entrada por conversa (F1), stories das vagas, piloto (F3) e Pinterest (F6).
 */
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import type { Env } from '../../common/config/env.validation';
import { inWorkspaceList, parseVacancyWorkspaces, parseWorkspaceList } from '../../common/config/vacancy-workspaces';
import { WorkspaceAccessService } from '../access/access.service';
import { PilotGate } from '../../common/config/pilot-gate';

export type WorkspaceFeatures = { campaign_intake: boolean; campaign_pilot: boolean; style_refs_pinterest: boolean; vacancy_stories: boolean };

@Injectable()
export class FeaturesService {
  private readonly intake: '*' | Set<string>;
  private readonly vacancy: '*' | Set<string>;
  private readonly pinterest: boolean;
  private readonly pilot: PilotGate;

  constructor(
    private readonly access: WorkspaceAccessService,
    @Inject(ENV)
    env: Pick<Env, 'NODE_ENV' | 'CAMPAIGN_INTAKE_WORKSPACE_IDS' | 'VACANCY_STORIES_WORKSPACE_IDS' | 'STYLE_REFS_PINTEREST_ENABLED' | 'CAMPAIGN_PILOT_ENABLED' | 'CAMPAIGN_PILOT_WORKSPACE_IDS'>,
  ) {
    this.pilot = new PilotGate(env);
    this.intake = parseWorkspaceList('CAMPAIGN_INTAKE_WORKSPACE_IDS', env.CAMPAIGN_INTAKE_WORKSPACE_IDS, env.NODE_ENV);
    this.vacancy = parseVacancyWorkspaces(env.VACANCY_STORIES_WORKSPACE_IDS, env.NODE_ENV);
    this.pinterest = env.STYLE_REFS_PINTEREST_ENABLED === true;
  }

  intakeEnabled(workspaceId: string): boolean {
    return inWorkspaceList(this.intake, workspaceId);
  }

  async forWorkspace(userId: string, workspaceId: string): Promise<WorkspaceFeatures> {
    await this.access.require(userId, workspaceId, 'read');
    return {
      campaign_intake: this.intakeEnabled(workspaceId),
      campaign_pilot: this.pilot.enabled(workspaceId),
      style_refs_pinterest: this.pinterest,
      vacancy_stories: inWorkspaceList(this.vacancy, workspaceId),
    };
  }
}
