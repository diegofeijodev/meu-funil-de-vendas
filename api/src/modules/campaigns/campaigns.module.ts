import { Module } from '@nestjs/common';
import { CampaignGuardsService } from './campaign-guards.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignGuardsService],
  exports: [CampaignGuardsService, CampaignsService],
})
export class CampaignsModule {}
