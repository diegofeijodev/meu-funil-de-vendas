import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EnvModule } from './common/config/env.module';
import { PrismaModule } from './common/database/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { HealthModule } from './common/health/health.module';
import { WireInterceptor } from './common/http/wire.interceptor';
import { AccessModule } from './modules/access/access.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AgencyModule } from './modules/agency/agency.module';
import { AiModule } from './modules/ai/ai.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuthModule } from './modules/auth/auth.module';
import { BrandsModule } from './modules/brands/brands.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { CanvaModule } from './modules/canva/canva.module';
import { CopyAiModule } from './modules/copy-ai/copy-ai.module';
import { CreativeModule } from './modules/creative/creative.module';
import { CrmDefaultsModule } from './modules/crm-defaults/crm-defaults.module';
import { InstagramModule } from './modules/instagram/instagram.module';
import { FilesModule } from './modules/files/files.module';
import { McpModule } from './modules/mcp/mcp.module';
import { MediaModule } from './modules/media/media.module';
import { OverviewModule } from './modules/overview/overview.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SetupModule } from './modules/setup/setup.module';
import { StrategistModule } from './modules/strategist/strategist.module';
import { VaultModule } from './modules/vault/vault.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

@Module({
  imports: [
    // Só carrega o .env em process.env; a validação (zod) fica no EnvModule.
    ConfigModule.forRoot({ isGlobal: true }),
    EnvModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    AccessModule,
    WorkspacesModule,
    VaultModule,
    FilesModule,
    AiModule,
    SchedulerModule,
    CrmDefaultsModule,
    ActivityModule,
    BrandsModule,
    OverviewModule,
    SetupModule,
    AgencyModule,
    CampaignsModule,
    StrategistModule,
    CopyAiModule,
    ApprovalsModule,
    MediaModule,
    McpModule,
    CanvaModule,
    CreativeModule,
    InstagramModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Depois do Throttler: barra abuso antes de gastar CPU verificando token.
    // Global — rotas ficam fechadas por padrão; `@Public()` é a exceção explícita.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: WireInterceptor },
  ],
})
export class AppModule {}
