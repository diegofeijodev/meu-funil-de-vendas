import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { FeaturesService } from './features.service';
import { WorkspaceDeletionService } from './workspace-deletion.service';

@Module({ controllers: [WorkspacesController], providers: [WorkspacesService, FeaturesService, WorkspaceDeletionService], exports: [WorkspacesService, FeaturesService] })
export class WorkspacesModule {}
