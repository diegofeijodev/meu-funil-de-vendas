import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Env } from '../../common/config/env.validation';
import { ENV } from '../../common/config/env.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// @Global(): o JwtAuthGuard (APP_GUARD) precisa do JwtService em qualquer módulo.
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_SECRET,
        signOptions: { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL as never },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
