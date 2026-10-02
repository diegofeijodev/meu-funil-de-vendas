import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { CrmConfigService } from './crm-config.service';
import { CrmCoreService } from './crm-core.service';
import { CrmLeadsService } from './crm-leads.service';
import { CrmPublicController } from './crm-public.controller';
import { CrmReportsService } from './crm-reports.service';
import { CrmResourcesController } from './crm-resources.controller';
import { SiteFormService } from './site-form.service';
import { UnsubscribeLinkService } from './unsubscribe-link.service';
import { UnsubscribeService } from './unsubscribe.service';

/**
 * CRM núcleo (Task 7): funil/etapas/leads/interações/tarefas/indicadores/configurações + formulário público do site e
 * descadastro. `UnsubscribeLinkService` é exportado: o envio de e-mail da Task 8 monta o link com `link(workspaceId, leadId)`.
 */
@Module({
  imports: [WebhooksModule],
  controllers: [CrmResourcesController, CrmPublicController],
  providers: [CrmCoreService, CrmLeadsService, CrmConfigService, CrmReportsService, SiteFormService, UnsubscribeLinkService, UnsubscribeService],
  exports: [CrmCoreService, UnsubscribeLinkService],
})
export class CrmModule {}
