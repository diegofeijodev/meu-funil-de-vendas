import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { McpClient } from './mcp-client';
import { McpCallbackController, McpConnectionsController, McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [MediaModule],
  controllers: [McpController, McpConnectionsController, McpCallbackController],
  providers: [McpClient, McpService],
  exports: [McpService, McpClient],
})
export class McpModule {}
