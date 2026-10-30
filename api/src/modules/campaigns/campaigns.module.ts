import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { CampaignGuardsService } from './campaign-guards.service';
import { CampaignIntakeService } from './campaign-intake.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignGuardsService, CampaignIntakeService],
  exports: [CampaignGuardsService, CampaignsService],
})
export class CampaignsModule {}
