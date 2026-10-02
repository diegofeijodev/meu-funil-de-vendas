import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { AdsChannelsService } from './ads-channels.service';
import { AdsOpsService } from './ads-ops.service';
import {
  ChannelDto, ChannelLoginUrlDto, CreateExternalCampaignDto, DecideRecommendationDto, GenerateRecommendationsDto, LinkExternalCampaignDto, MetaCampaignDto,
  MetaInsightsDto, MetaLoginUrlDto, MetaSaveAppDto, MetaSaveAssetsDto, MetaSaveCredentialsDto, MetaSetStatusDto, SaveCampaignAdsSettingsDto, SaveChannelAppDto,
  SetExternalStatusDto, SyncCrmAudienceDto, WorkspaceDto,
} from './ads.dto';
import { MetaAdsService } from './meta-ads.service';

/** Server fns de `meta-ads.functions.ts` e `meta/ads-ops.functions.ts`: `POST /v1/meta/<nome-em-kebab>` (corpo = o `data` do protótipo). */
@ApiTags('Meta Ads')
@ApiBearerAuth()
@Controller('v1/meta')
export class MetaAdsController {
  constructor(
    private readonly meta: MetaAdsService,
    private readonly ops: AdsOpsService,
  ) {}

  // ---- meta-ads.functions (11)
  @Post('meta-ads-save-credentials') @HttpCode(200)
  saveCredentials(@CurrentUser() u: AuthUser, @Body() d: MetaSaveCredentialsDto) { return this.meta.saveCredentials(u.id, d); }

  @Post('meta-ads-status') @HttpCode(200)
  status(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) { return this.meta.status(u.id, d.workspaceId); }

  @Post('meta-ads-test') @HttpCode(200)
  test(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) { return this.meta.test(u.id, d.workspaceId); }

  @Post('meta-ads-list') @HttpCode(200)
  list(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) { return this.meta.list(u.id, d.workspaceId); }

  @Post('meta-ads-insights') @HttpCode(200)
  insights(@CurrentUser() u: AuthUser, @Body() d: MetaInsightsDto) { return this.meta.insights(u.id, d); }

  @Post('meta-ads-publish') @HttpCode(200)
  publish(@CurrentUser() u: AuthUser, @Body() d: MetaCampaignDto) { return this.meta.publish(u.id, d.workspaceId, d.campaignId); }

  @Post('meta-ads-set-status') @HttpCode(200)
  setStatus(@CurrentUser() u: AuthUser, @Body() d: MetaSetStatusDto) { return this.meta.setStatus(u.id, d.workspaceId, d.campaignId, d.status); }

  @Post('meta-save-app') @HttpCode(200)
  saveApp(@CurrentUser() u: AuthUser, @Body() d: MetaSaveAppDto) { return this.meta.saveApp(u.id, d.workspaceId, d.appId, d.appSecret); }

  @Post('meta-login-url') @HttpCode(200)
  loginUrl(@CurrentUser() u: AuthUser, @Body() d: MetaLoginUrlDto) { return this.meta.loginUrl(u.id, d.workspaceId); }

  @Post('meta-list-assets') @HttpCode(200)
  listAssets(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) { return this.meta.listAssets(u.id, d.workspaceId); }

  @Post('meta-save-assets') @HttpCode(200)
  saveAssets(@CurrentUser() u: AuthUser, @Body() d: MetaSaveAssetsDto) { return this.meta.saveAssets(u.id, d); }

  // ---- ads-ops.functions (6)
  @Post('sync-ads-insights-now') @HttpCode(200)
  syncNow(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) { return this.ops.syncNow(u.id, d.workspaceId); }

  @Post('generate-ads-recommendations') @HttpCode(200)
  generate(@CurrentUser() u: AuthUser, @Body() d: GenerateRecommendationsDto) { return this.ops.generate(u.id, d.workspaceId, d.campaignId); }

  @Post('decide-ads-recommendation') @HttpCode(200)
  decide(@CurrentUser() u: AuthUser, @Body() d: DecideRecommendationDto) { return this.ops.decide(u.id, d.id, d.decision); }

  @Post('save-campaign-ads-settings') @HttpCode(200)
  saveSettings(@CurrentUser() u: AuthUser, @Body() d: SaveCampaignAdsSettingsDto) { return this.ops.saveSettings(u.id, d); }

  @Post('list-meta-audiences') @HttpCode(200)
  audiences(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) { return this.ops.listAudiences(u.id, d.workspaceId); }

  @Post('sync-crm-customer-audience') @HttpCode(200)
  crmAudience(@CurrentUser() u: AuthUser, @Body() d: SyncCrmAudienceDto) { return this.ops.syncCrmAudience(u.id, d.workspaceId, d.onlyWon ?? false); }
}

/** Server fns de `ads/channels.functions.ts` (Google Ads / TikTok Ads): `POST /v1/ads/<nome-em-kebab>`. */
@ApiTags('Ads channels')
@ApiBearerAuth()
@Controller('v1/ads')
export class AdsChannelsController {
  constructor(private readonly channels: AdsChannelsService) {}

  @Post('ads-channels-status') @HttpCode(200)
  status(@CurrentUser() u: AuthUser, @Body() d: WorkspaceDto) { return this.channels.status(u.id, d.workspaceId); }

  @Post('save-ads-channel-app') @HttpCode(200)
  saveApp(@CurrentUser() u: AuthUser, @Body() d: SaveChannelAppDto) { return this.channels.saveApp(u.id, d.workspaceId, d.channel, d.values); }

  @Post('ads-channel-login-url') @HttpCode(200)
  loginUrl(@CurrentUser() u: AuthUser, @Body() d: ChannelLoginUrlDto) { return this.channels.loginUrl(u.id, d.workspaceId, d.channel); }

  @Post('list-ads-channel-accounts') @HttpCode(200)
  accounts(@CurrentUser() u: AuthUser, @Body() d: ChannelDto) { return this.channels.listAccounts(u.id, d.workspaceId, d.channel); }

  @Post('link-external-campaign') @HttpCode(200)
  link(@CurrentUser() u: AuthUser, @Body() d: LinkExternalCampaignDto) { return this.channels.link(u.id, d.campaignId, d.channel, d.externalId); }

  @Post('create-external-campaign') @HttpCode(200)
  create(@CurrentUser() u: AuthUser, @Body() d: CreateExternalCampaignDto) { return this.channels.create(u.id, d.campaignId, d.channel); }

  @Post('set-external-campaign-status') @HttpCode(200)
  setStatus(@CurrentUser() u: AuthUser, @Body() d: SetExternalStatusDto) { return this.channels.setStatus(u.id, d.campaignId, d.channel, d.active); }
}

/** Leituras diretas das telas Performance e AI Insights (GET = read). */
@ApiTags('Ads')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId')
export class AdsResourcesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ops: AdsOpsService,
  ) {}

  /** `performance_daily select *` eq workspace_id neq source 'demo' order date. */
  @Get('performance-daily')
  performance(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.prisma.performance_daily.findMany({ where: { workspace_id: ws, source: { not: 'demo' } }, orderBy: [{ date: 'asc' }, { created_at: 'asc' }] });
  }

  /** `campaign_costs select *` eq workspace_id. */
  @Get('campaign-costs')
  costs(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.prisma.campaign_costs.findMany({ where: { workspace_id: ws }, orderBy: { created_at: 'asc' } });
  }

  /** `ai_recommendations select *, campaigns(name)` eq workspace_id order created_at desc limit 200. */
  @Get('ai-recommendations')
  async recommendations(@Param('workspaceId', ParseUuidPipe) ws: string) {
    await this.ops.recoverStaleApplying(ws).catch(() => 0);
    const rows = await this.prisma.ai_recommendations.findMany({ where: { workspace_id: ws }, orderBy: { created_at: 'desc' }, take: 200, include: { campaign: { select: { name: true } } } });
    return rows.map(({ campaign, ...r }) => ({ ...r, campaigns: campaign }));
  }
}
