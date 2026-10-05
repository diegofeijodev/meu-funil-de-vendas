import { Module } from '@nestjs/common';
import { CanvaModule } from '../canva/canva.module';
import { McpModule } from '../mcp/mcp.module';
import { AiDiagnosticsService } from './ai-diagnostics.service';
import { AiKeysActionsService } from './ai-keys-actions.service';
import { ExportsCleanupService } from './exports-cleanup.service';
import { AiDiagnosticsController, AiKeysController, PublishingJobsController } from './integrations.controller';

/** Tela Integrações: chaves de IA próprias, diagnóstico das IAs, histórico de publicações e a limpeza dos exports. */
@Module({
  imports: [CanvaModule, McpModule],
  controllers: [AiKeysController, AiDiagnosticsController, PublishingJobsController],
  providers: [AiKeysActionsService, AiDiagnosticsService, ExportsCleanupService],
})
export class IntegrationsModule {}
