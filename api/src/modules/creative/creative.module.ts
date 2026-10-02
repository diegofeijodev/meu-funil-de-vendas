import { Module } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { MediaModule } from '../media/media.module';
import { StrategistModule } from '../strategist/strategist.module';
import { AiKeysHealthController, CreativeController, CreativePollJob, CreativeResourceController, CreativeResourcesService } from './creative.controller';
import { CreativeService } from './creative.service';
import { PipelineService } from './pipeline.service';
import { ProviderResolverService } from './provider-resolver.service';
import { RefsService } from './refs.service';
import { VideoExtrasService } from './video-extras.service';

@Module({
  imports: [MediaModule, McpModule, StrategistModule],
  controllers: [CreativeController, CreativeResourceController, AiKeysHealthController],
  providers: [CreativeService, CreativeResourcesService, PipelineService, ProviderResolverService, RefsService, VideoExtrasService, CreativePollJob],
  exports: [CreativeService, ProviderResolverService, RefsService, PipelineService, VideoExtrasService],
})
export class CreativeModule {}
