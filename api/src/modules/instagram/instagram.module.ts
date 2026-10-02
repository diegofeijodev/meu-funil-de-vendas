import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CreativeModule } from '../creative/creative.module';
import { MediaModule } from '../media/media.module';
import { StrategistModule } from '../strategist/strategist.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AccountService } from './account.service';
import { AutoCalendarService } from './auto-calendar.service';
import { AutopilotService } from './autopilot.service';
import { ContentService } from './content.service';
import { IgStore } from './ig-store.service';
import { InboundService } from './inbound.service';
import { InstagramActionsService } from './instagram-actions.service';
import { InstagramController } from './instagram.controller';
import { InstagramCronController } from './instagram-cron.controller';
import { InstagramCronService } from './instagram-cron.service';
import { InstagramResourcesController } from './instagram-resources.controller';
import { InstagramResourcesService } from './instagram-resources.service';
import { InstagramWebhookController } from './instagram-webhook.controller';
import { MediaGenerationService } from './media-generation.service';
import { META_FETCH, MetaConfigService, MetaFetch, MetaGraphClient } from './meta-graph';
import { MetricsService } from './metrics.service';
import { PublishingService } from './publishing.service';

@Module({
  imports: [AccessModule, MediaModule, CreativeModule, StrategistModule, WebhooksModule],
  controllers: [InstagramController, InstagramResourcesController, InstagramWebhookController, InstagramCronController],
  providers: [
    // Única porta de rede do Instagram/Facebook Graph — nos testes entra um fake.
    { provide: META_FETCH, useValue: ((url, init) => fetch(url, init)) as MetaFetch },
    MetaConfigService,
    MetaGraphClient,
    IgStore,
    ContentService,
    PublishingService,
    MediaGenerationService,
    MetricsService,
    AccountService,
    AutoCalendarService,
    AutopilotService,
    InstagramActionsService,
    InstagramResourcesService,
    InboundService,
    InstagramCronService,
  ],
  exports: [MetaGraphClient, MetaConfigService, IgStore, InboundService],
})
export class InstagramModule {}
