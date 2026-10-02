import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { StrategistController } from './strategist.controller';
import { StrategistService } from './strategist.service';

@Module({
  imports: [CampaignsModule],
  controllers: [StrategistController],
  providers: [StrategistService],
  exports: [StrategistService],
})
export class StrategistModule {}
