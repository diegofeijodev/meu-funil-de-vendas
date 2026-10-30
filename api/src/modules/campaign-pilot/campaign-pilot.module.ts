import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { CopyAiModule } from '../copy-ai/copy-ai.module';
import { CreativeModule } from '../creative/creative.module';
import { InstagramModule } from '../instagram/instagram.module';
import { StrategistModule } from '../strategist/strategist.module';
import { PilotCronService } from './pilot-cron.service';
import { PilotController } from './pilot.controller';
import { PilotGate } from '../../common/config/pilot-gate';
import { PILOT_STEPS, PilotRunnerService } from './pilot-runner.service';
import { PilotService } from './pilot.service';
import { CopiesStep } from './steps/copies.step';
import { CreativesStep } from './steps/creatives.step';
import { InstagramStep } from './steps/instagram.step';
import { MetaStep } from './steps/meta.step';
import { StrategyStep } from './steps/strategy.step';

/** Piloto do estrategista (Fatia 3). Depende dos módulos de sempre; **nenhum módulo importa este** (só o `AppModule`). */
@Module({
  imports: [ApprovalsModule, CampaignsModule, CopyAiModule, CreativeModule, InstagramModule, StrategistModule],
  controllers: [PilotController],
  providers: [
    PilotGate, PilotService, PilotRunnerService, PilotCronService, StrategyStep, CopiesStep, InstagramStep, CreativesStep, MetaStep,
    {
      provide: PILOT_STEPS,
      useFactory: (strategy: StrategyStep, copies: CopiesStep, instagram: InstagramStep, creatives: CreativesStep, meta: MetaStep) => ({ strategy, copies, instagram, creatives, meta }),
      inject: [StrategyStep, CopiesStep, InstagramStep, CreativesStep, MetaStep],
    },
  ],
})
export class CampaignPilotModule {}
