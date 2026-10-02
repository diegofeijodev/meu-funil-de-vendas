import { Global, Module } from '@nestjs/common';
import { InstagramModule } from '../instagram/instagram.module';
import { CRM_CHANNEL_HOOKS } from '../instagram/inbound.service';
import { CrmModule } from '../crm/crm.module';
import { MediaModule } from '../media/media.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { CadenceService } from './cadence.service';
import { CalendarService } from './calendar.service';
import { ChannelHttp, ChannelSecrets } from './channel-http';
import { CrmChannelHooksService } from './crm-channel-hooks.service';
import { CrmCadencesController, CrmChannelsResourcesController, CrmIntegrationsController, CrmSdrController } from './crm-channels.controller';
import { CrmCronController, CrmCronService } from './crm-cron.service';
import { LeadgenWebhookController, WhatsAppWebhookController } from './crm-webhooks.controller';
import { EmailService } from './email.service';
import { IntegrationsService } from './integrations.service';
import { LeadgenService } from './leadgen.service';
import { MediaUnderstandingService } from './media-understanding.service';
import { SdrAgentService } from './sdr-agent.service';
import { SdrService } from './sdr.service';
import { WhatsAppService } from './whatsapp.service';

/**
 * Núcleo dos canais do CRM sem dependência do Instagram: agente SDR, agenda, mídia e o provedor global de `CRM_CHANNEL_HOOKS`
 * (o `InboundService` do Instagram o recebe daqui, sem ciclo de módulos).
 */
@Global()
@Module({
  imports: [CrmModule, MediaModule],
  providers: [ChannelHttp, ChannelSecrets, CalendarService, MediaUnderstandingService, SdrService, CrmChannelHooksService, { provide: CRM_CHANNEL_HOOKS, useExisting: CrmChannelHooksService }],
  exports: [CRM_CHANNEL_HOOKS, ChannelHttp, ChannelSecrets, CalendarService, MediaUnderstandingService, SdrService],
})
export class CrmChannelsCoreModule {}

/** Canais do CRM (Task 8): integrações, WhatsApp, e-mail, cadências, SDR, webhooks e crons. */
@Module({
  imports: [CrmChannelsCoreModule, CrmModule, InstagramModule, MediaModule, WebhooksModule],
  controllers: [CrmIntegrationsController, CrmCadencesController, CrmSdrController, CrmChannelsResourcesController, WhatsAppWebhookController, LeadgenWebhookController, CrmCronController],
  providers: [LeadgenService, WhatsAppService, EmailService, IntegrationsService, CadenceService, SdrAgentService, CrmCronService],
})
export class CrmChannelsModule {}
