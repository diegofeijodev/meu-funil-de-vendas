import { Module } from '@nestjs/common';
import { AgencyController } from './agency.controller';
import { AgencyService } from './agency.service';

@Module({ controllers: [AgencyController], providers: [AgencyService] })
export class AgencyModule {}
