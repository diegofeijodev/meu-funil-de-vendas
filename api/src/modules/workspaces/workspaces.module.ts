import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { FeaturesService } from './features.service';

@Module({ controllers: [WorkspacesController], providers: [WorkspacesService, FeaturesService], exports: [WorkspacesService, FeaturesService] })
export class WorkspacesModule {}
