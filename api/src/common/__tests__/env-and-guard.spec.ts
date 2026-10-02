import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import Fastify from 'fastify';
import { parseTrustProxy, toFastifyTrustProxy, validateEnv } from '../config/env.validation';
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
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', CREDENTIALS_ENCRYPTION_KEY: 'k', UNSUBSCRIBE_SECRET: 'u' })).not.toThrow();
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

describe('TRUST_PROXY', () => {
  it('aceita saltos (inteiro), lista de IPs/CIDRs e os atalhos true/false; vazio/0 = false', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('10.0.0.0/8, 172.16.0.1,::1')).toEqual(['10.0.0.0/8', '172.16.0.1', '::1']);
  });
  it('rejeita lixo, CIDR fora da faixa e número negativo', () => {
    for (const bad of ['dois', '-1', '1.5', '10.0.0.0/33', '999.1.1.1', '10.0.0.1,abc']) expect(() => parseTrustProxy(bad)).toThrow(/TRUST_PROXY inválido/);
  });
  it('validateEnv aplica o parse (e falha no boot com valor inválido)', () => {
    const dev = { ...base, NODE_ENV: 'development' };
    expect(validateEnv({ ...dev, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(validateEnv(dev).TRUST_PROXY).toBe(false);
    expect(() => validateEnv({ ...dev, TRUST_PROXY: 'xx' })).toThrow(/TRUST_PROXY/);
  });
  it('com saltos, um X-Forwarded-For forjado no início da cadeia NÃO muda o req.ip (com true muda)', async () => {
    const ipFor = async (trustProxy: boolean | number, xff: string) => {
      const app = Fastify({ trustProxy: toFastifyTrustProxy(trustProxy) as never });
      app.get('/ip', async (req) => ({ ip: req.ip }));
      const r = await app.inject({ method: 'GET', url: '/ip', remoteAddress: '10.0.0.3', headers: { 'x-forwarded-for': xff } });
      await app.close();
      return (r.json() as { ip: string }).ip;
    };
    // cadeia real: cliente 203.0.113.9 → nginx (10.0.0.1, anexado pelo Next) → Next (10.0.0.3, conexão direta)
    expect(await ipFor(2, '203.0.113.9, 10.0.0.1')).toBe('203.0.113.9');
    // o atacante prefixa um IP falso (nginx que não sobrescreve): com 2 saltos o IP seguro continua sendo o real
    expect(await ipFor(2, '1.2.3.4, 203.0.113.9, 10.0.0.1')).toBe('203.0.113.9');
    expect(await ipFor(2, '9.9.9.9, 203.0.113.9, 10.0.0.1')).toBe('203.0.113.9');
    // `true` confia na cadeia inteira: pega o primeiro item, controlado pelo cliente
    expect(await ipFor(true, '1.2.3.4, 203.0.113.9, 10.0.0.1')).toBe('1.2.3.4');
  });
});
