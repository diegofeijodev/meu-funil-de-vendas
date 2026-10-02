import { Module } from '@nestjs/common';
import { StrategistModule } from '../strategist/strategist.module';
import { CopyAiController } from './copy-ai.controller';
import { CopyAiService } from './copy-ai.service';

@Module({ imports: [StrategistModule], controllers: [CopyAiController], providers: [CopyAiService], exports: [CopyAiService] })
export class CopyAiModule {}
