import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { validateEnv } from '../config/env.validation';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

const base = { DATABASE_URL: 'x', JWT_SECRET: 'test-secret-with-16+chars' };

describe('validateEnv — chave do cofre', () => {
  it('NODE_ENV ausente ou production sem CREDENTIALS_ENCRYPTION_KEY falha no boot', () => {
    expect(() => validateEnv(base)).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });
  it('development/test sem chave passam; production com chave passa', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateEnv({ ...base, NODE_ENV: 'test' })).not.toThrow();
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', CREDENTIALS_ENCRYPTION_KEY: 'k' })).not.toThrow();
  });
});

describe('JwtAuthGuard — ver do access token', () => {
  const jwt = new JwtService({ secret: base.JWT_SECRET });
  const guard = (dbVersion: number) =>
    new JwtAuthGuard({ getAllAndOverride: () => false } as any, jwt, { users: { findUnique: async () => ({ id: 'u', email: 'e', token_version: dbVersion }) } } as any);
  const ctx = (token: string) => ({ getHandler: () => 0, getClass: () => 0, switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) }) as any;

  it('aceita ver igual e rejeita token antigo (pós-logout) ou sem ver', async () => {
    const tok = (ver?: number) => jwt.signAsync({ sub: 'u', email: 'e', typ: 'access', ...(ver === undefined ? {} : { ver }) });
    expect(await guard(2).canActivate(ctx(await tok(2)))).toBe(true);
    await expect(guard(3).canActivate(ctx(await tok(2)))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard(0).canActivate(ctx(await tok()))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
