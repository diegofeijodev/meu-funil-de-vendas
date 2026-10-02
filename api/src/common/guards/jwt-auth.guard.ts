import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthUser } from '../auth/auth-user';
import { PrismaService } from '../database/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const unauthorized = (message: string) => new UnauthorizedException({ code: 'UNAUTHORIZED', message });

/**
 * Guard global: toda rota exige `Authorization: Bearer <access token>` salvo `@Public()`.
 * Mensagens iguais às do auth-middleware do protótipo.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    if (!header) throw unauthorized('Unauthorized: No authorization header provided');
    if (!header.startsWith('Bearer ')) throw unauthorized('Unauthorized: Only Bearer tokens are supported');
    const token = header.slice(7).trim();
    if (!token) throw unauthorized('Unauthorized: No token provided');

    let payload: { sub?: string; email?: string; typ?: string; ver?: number };
    try {
      payload = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      throw unauthorized('Unauthorized: Invalid token');
    }
    if (!payload.sub || payload.typ !== 'access') throw unauthorized('Unauthorized: Invalid token');

    // Conferir no banco: conta removida não pode continuar usando um token ainda válido.
    const user = await this.prisma.users.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, token_version: true } });
    // `ver` != users.token_version: logout/troca de credencial invalida o access token na hora.
    if (!user || payload.ver !== user.token_version) throw unauthorized('Unauthorized: Invalid token');

    request.user = { id: user.id, email: user.email } satisfies AuthUser;
    return true;
  }
}
