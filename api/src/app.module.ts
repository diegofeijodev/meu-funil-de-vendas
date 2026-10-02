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
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { CrmDefaultsModule } from './modules/crm-defaults/crm-defaults.module';
import { FilesModule } from './modules/files/files.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
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
