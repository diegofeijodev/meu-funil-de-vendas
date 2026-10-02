import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { ApprovalsActionController, ApprovalsReadController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  imports: [CampaignsModule],
  controllers: [ApprovalsReadController, ApprovalsActionController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
