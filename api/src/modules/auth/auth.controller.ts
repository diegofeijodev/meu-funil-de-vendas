import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, SignupDto } from './dto/auth.dto';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refresh_token);
  }

  @HttpCode(204)
  @Post('logout')
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user.id);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  // Google OAuth — só funciona com GOOGLE_CLIENT_ID/SECRET; senão 503 GOOGLE_NOT_CONFIGURED.
  @Public()
  @Get('google')
  async googleStart(@Query('redirect_uri') redirectUri: string | undefined, @Res() reply: FastifyReply) {
    const url = await this.auth.googleAuthUrl(redirectUri);
    return reply.redirect(url, 302);
  }

  @Public()
  @Get('google/callback')
  async googleCallback(@Query() query: Record<string, string | undefined>, @Res() reply: FastifyReply) {
    const url = await this.auth.googleCallback(query['code'], query['state']);
    return reply.redirect(url, 302);
  }
}
