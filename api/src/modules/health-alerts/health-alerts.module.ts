import { Module } from '@nestjs/common';
import { HealthAlertsController } from './health-alerts.controller';
import { HealthAlertsService } from './health-alerts.service';

/** Avisos da empresa (IA sem créditos, posts do Instagram que falharam): leitura composta para a faixa do topo das telas. */
@Module({ controllers: [HealthAlertsController], providers: [HealthAlertsService] })
export class HealthAlertsModule {}
