import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import Fastify from 'fastify';
import { parseTrustProxy, toFastifyTrustProxy, validateEnv } from '../config/env.validation';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

import fs from 'node:fs';
import path from 'node:path';

const base = { DATABASE_URL: 'x', JWT_SECRET: 'test-secret-with-16+chars' };
const prod = { NODE_ENV: 'production', CREDENTIALS_ENCRYPTION_KEY: 'k', UNSUBSCRIBE_SECRET: 'u', PUBLIC_URL: 'https://api.meufunil.app', APP_URL: 'https://meufunil.app' };

describe('validateEnv — chave do cofre', () => {
  it('NODE_ENV ausente ou production sem CREDENTIALS_ENCRYPTION_KEY falha no boot', () => {
    expect(() => validateEnv(base)).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', PUBLIC_URL: prod.PUBLIC_URL, APP_URL: prod.APP_URL })).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });
  it('development/test sem chave passam; production com chave passa', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateEnv({ ...base, NODE_ENV: 'test' })).not.toThrow();
    expect(() => validateEnv({ ...base, ...prod })).not.toThrow();
  });
});

describe('validateEnv — PUBLIC_URL/APP_URL em produção', () => {
  it('não definidas (default localhost) ou apontando para localhost/loopback/URL inválida falham o boot', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', CREDENTIALS_ENCRYPTION_KEY: 'k', UNSUBSCRIBE_SECRET: 'u' })).toThrow(/PUBLIC_URL/);
    expect(() => validateEnv({ ...base, ...prod, PUBLIC_URL: 'http://localhost:3015' })).toThrow(/PUBLIC_URL/);
    expect(() => validateEnv({ ...base, ...prod, APP_URL: 'http://127.0.0.1:3025' })).toThrow(/APP_URL/);
    expect(() => validateEnv({ ...base, ...prod, APP_URL: 'não é url' })).toThrow(/APP_URL/);
    expect(() => validateEnv({ ...base, ...prod, PUBLIC_URL: 'https://api.meufunil.app' })).not.toThrow();
  });
  it('em development/test o default localhost vale', () => {
    expect(validateEnv({ ...base, NODE_ENV: 'development' }).PUBLIC_URL).toBe('http://localhost:3015');
    expect(() => validateEnv({ ...base, NODE_ENV: 'test' })).not.toThrow();
  });
});

describe('validateEnv — chaves do schema declaradas no compose e no .env.example', () => {
  const root = path.resolve(__dirname, '../../../..');
  const schema = fs.readFileSync(path.resolve(__dirname, '../config/env.validation.ts'), 'utf8');
  const keys = [...schema.slice(schema.indexOf('z\n  .object({'), schema.indexOf('.superRefine')).matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!);
  it('toda chave aparece em docker-compose.yml (serviço api) e em api/.env.example (ativa ou comentada)', () => {
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    const example = fs.readFileSync(path.join(root, 'api/.env.example'), 'utf8');
    expect(keys.length).toBeGreaterThan(40);
    expect(keys.filter((k) => !new RegExp(`^\\s+${k}:`, 'm').test(compose))).toEqual([]);
    expect(keys.filter((k) => !new RegExp(`^#?\\s*${k}=`, 'm').test(example))).toEqual([]);
  });
  it('WHATSAPP_WEBHOOK_SECRET é lida do ambiente (fallback do cofre)', () => {
    expect(validateEnv({ ...base, ...prod, WHATSAPP_WEBHOOK_SECRET: 'abc' }).WHATSAPP_WEBHOOK_SECRET).toBe('abc');
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
    expect(validateEnv({ ...dev, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(validateEnv(dev).TRUST_PROXY).toBe(false);
    expect(() => validateEnv({ ...dev, TRUST_PROXY: 'xx' })).toThrow(/TRUST_PROXY/);
  });
  it('com 1 salto (peer = Next), o cliente real é escolhido e um X-Forwarded-For forjado à esquerda NÃO muda o req.ip (com true muda)', async () => {
    const ipFor = async (trustProxy: boolean | number, xff: string) => {
      const app = Fastify({ trustProxy: toFastifyTrustProxy(trustProxy) as never });
      app.get('/ip', async (req) => ({ ip: req.ip }));
      const r = await app.inject({ method: 'GET', url: '/ip', remoteAddress: '10.0.0.3', headers: { 'x-forwarded-for': xff } });
      await app.close();
      return (r.json() as { ip: string }).ip;
    };
    // cadeia real: cliente → nginx → Next (peer TCP 10.0.0.3, que NÃO anexa ao XFF) → API. Com `1` salto o peer é o Next.
    // nginx sobrescrevendo o XFF com $remote_addr: cadeia vista = [cliente]
    expect(await ipFor(1, '203.0.113.9')).toBe('203.0.113.9');
    // o cliente tenta forjar o cabeçalho, mas o nginx sobrescreve: nada do que ele mandou chega
    // nginx anexando ($proxy_add_x_forwarded_for): [forjado, cliente] — o `1` ainda pega o cliente, não o item forjado
    expect(await ipFor(1, '1.2.3.4, 203.0.113.9')).toBe('203.0.113.9');
    expect(await ipFor(1, '9.9.9.9, 8.8.8.8, 203.0.113.9')).toBe('203.0.113.9');
    expect(await ipFor(true, '1.2.3.4, 203.0.113.9')).toBe('1.2.3.4');
  });
});
describe('validateEnv — produção automática e vídeo (05/10/2026)', () => {
  it('padrões: 4 por rodada, janela de 48 h, meta de 24 h, nota mínima 28; FFMPEG_PATH opcional', () => {
    const e = validateEnv({ ...base, NODE_ENV: 'test' });
    expect([e.IG_PRODUCTION_PER_TICK, e.IG_PRODUCTION_WINDOW_HOURS, e.IG_PRODUCTION_TARGET_HOURS, e.MIN_VIDEO_SCORE, e.FFMPEG_PATH]).toEqual([4, 48, 24, 28, undefined]);
    const c = validateEnv({ ...base, NODE_ENV: 'test', IG_PRODUCTION_PER_TICK: '2', MIN_VIDEO_SCORE: '30', FFMPEG_PATH: '/usr/bin/ffmpeg' });
    expect([c.IG_PRODUCTION_PER_TICK, c.MIN_VIDEO_SCORE, c.FFMPEG_PATH]).toEqual([2, 30, '/usr/bin/ffmpeg']);
  });

  it('valores fora da faixa e meta maior que a janela falham o boot', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'test', IG_PRODUCTION_PER_TICK: '0' })).toThrow(/IG_PRODUCTION_PER_TICK/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'test', MIN_VIDEO_SCORE: '51' })).toThrow(/MIN_VIDEO_SCORE/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'test', IG_PRODUCTION_WINDOW_HOURS: '12', IG_PRODUCTION_TARGET_HOURS: '24' })).toThrow(/IG_PRODUCTION_TARGET_HOURS/);
  });
});
