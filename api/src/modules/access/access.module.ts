import { Global, Module } from '@nestjs/common';
import { WorkspaceAccessService } from './access.service';
import { WorkspaceAccessGuard } from './workspace-access.guard';

@Global()
@Module({
  providers: [WorkspaceAccessService, WorkspaceAccessGuard],
  exports: [WorkspaceAccessService, WorkspaceAccessGuard],
})
export class AccessModule {}
