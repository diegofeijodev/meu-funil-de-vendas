import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { InstagramModule } from '../instagram/instagram.module';
import { MediaModule } from '../media/media.module';
import { StrategistModule } from '../strategist/strategist.module';
import { ADS_FETCH, AdsFetch } from './ads-fetch';
import { AdsChannelsService } from './ads-channels.service';
import { AdsCronService } from './ads-cron.service';
import { CrmConversionController } from './crm-conversion.controller';
import { CrmConversionService } from './crm-conversion.service';
import { AdsOpsService } from './ads-ops.service';
import { AdsPublicController } from './ads-public.controller';
import { AdsChannelsController, AdsResourcesController, MetaAdsController } from './ads.controller';
import { GoogleAdsClient } from './google-ads.client';
import { MetaAdsService } from './meta-ads.service';
import { MetaOAuthService } from './meta-oauth.service';
import { MetaOpsService } from './meta-ops.service';
import { OAuthStateService } from './oauth-state.service';
import { PerfStore } from './perf-store';
import { TikTokAdsClient } from './tiktok-ads.client';

/**
 * Meta Ads (Marketing API), gestor de tráfego, Google Ads / TikTok Ads, desempenho e insights.
 * Reaproveita `MetaGraphClient` (Task 5), `CronAuthService`/`SchedulerService`, os guardas de campanha (Task 3) e o
 * `AssetsService` guardado contra SSRF (Task 4) para baixar a imagem dos criativos.
 */
@Module({
  imports: [InstagramModule, CampaignsModule, StrategistModule, MediaModule],
  controllers: [MetaAdsController, AdsChannelsController, AdsResourcesController, AdsPublicController, CrmConversionController],
  providers: [
    // Única porta de rede do Google Ads / TikTok Business / OAuth do Google (hosts fixos) — nos testes entra um fake.
    { provide: ADS_FETCH, useValue: ((url, init) => fetch(url, init)) as AdsFetch },
    GoogleAdsClient,
    TikTokAdsClient,
    OAuthStateService,
    PerfStore,
    MetaOpsService,
    MetaOAuthService,
    MetaAdsService,
    AdsOpsService,
    AdsChannelsService,
    AdsCronService,
    CrmConversionService,
  ],
  exports: [AdsOpsService, MetaOpsService],
})
export class AdsModule {}
