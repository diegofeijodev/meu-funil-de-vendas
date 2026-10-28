import { Global, Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ActivityModule } from '../activity/activity.module';
import { AiModule } from '../ai/ai.module';
import { CreativeModule } from '../creative/creative.module';
import { InstagramModule } from '../instagram/instagram.module';
import { PUBLISH_ORIGIN_GUARDS } from '../instagram/origin-guards';
import { MediaModule } from '../media/media.module';
import { FREELA_VACANCIES_FETCH, FreelaFetch, VacancyFeedClient } from './vacancy-feed';
import { VacancyGate, VacancyGateGuard } from './vacancy-gate.service';
import { VacancyGeneratorService } from './vacancy-generator.service';
import { VacancyGuardService } from './vacancy-guard.service';
import { VacancyPollService } from './vacancy-poll.service';
import { VacancySettingsService } from './vacancy-settings.service';
import { VacancyStoriesController } from './vacancy-stories.controller';
import { VacancyStoriesCronController } from './vacancy-stories-cron.controller';
import { VacancyStoriesCronService } from './vacancy-stories-cron.service';

/**
 * Núcleo dos stories das vagas, sem dependência do Instagram (D10): vitrine do Freela, lista de empresas e a guarda de origem
 * (`PUBLISH_ORIGIN_GUARDS`) que o `PublishingService` recebe daqui — sem ciclo de módulos.
 */
@Global()
@Module({
  providers: [
    // Única porta de rede da vitrine do Freela — nos testes entra um fake.
    { provide: FREELA_VACANCIES_FETCH, useValue: ((url, init) => fetch(url, init)) as FreelaFetch },
    VacancyFeedClient,
    VacancyGate,
    VacancyGateGuard,
    VacancyGuardService,
    { provide: PUBLISH_ORIGIN_GUARDS, useExisting: VacancyGuardService },
  ],
  exports: [FREELA_VACANCIES_FETCH, VacancyFeedClient, VacancyGate, VacancyGateGuard, VacancyGuardService, PUBLISH_ORIGIN_GUARDS],
})
export class VacancyStoriesCoreModule {}

/** Stories das vagas do Freela: ajustes, arte modelo, ligar/desligar, consulta e geração (as Tasks 10–11 somam agenda e ações). */
@Module({
  imports: [VacancyStoriesCoreModule, InstagramModule, AiModule, MediaModule, CreativeModule, AccessModule, ActivityModule],
  controllers: [VacancyStoriesController, VacancyStoriesCronController],
  providers: [VacancySettingsService, VacancyPollService, VacancyGeneratorService, VacancyStoriesCronService],
  exports: [VacancySettingsService, VacancyPollService, VacancyGeneratorService],
})
export class VacancyStoriesModule {}
