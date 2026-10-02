import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { validateEnv } from '../../../common/config/env.validation';
import { AuthService, MSG } from '../auth.service';

// Prisma em memória: só o que o AuthService toca.
function fakePrisma() {
  const users: any[] = [];
  const profiles: any[] = [];
  const workspaces: any[] = [];
  const members: any[] = [];
  const pick = (rows: any[], where: any) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null;
  const db: any = {
    users: {
      findUnique: async ({ where }: any) => pick(users, where),
      create: async ({ data }: any) => { const u = { token_version: 0, created_at: new Date(), ...data }; users.push(u); return u; },
      update: async ({ where, data }: any) => {
        const u = pick(users, where);
        for (const [k, v] of Object.entries<any>(data)) u[k] = v && typeof v === 'object' && 'increment' in v ? u[k] + v.increment : v;
        return u;
      },
    },
    profiles: {
      findUnique: async ({ where }: any) => pick(profiles, where),
      create: async ({ data }: any) => { profiles.push(data); return data; },
    },
    workspaces: { create: async ({ data }: any) => { const w = { id: randomUUID(), ...data }; workspaces.push(w); return w; } },
    workspace_members: { create: async ({ data }: any) => { members.push(data); return data; } },
    $transaction: async (fn: any) => fn(db),
  };
  return { db, users, profiles, workspaces, members };
}

const env = validateEnv({ DATABASE_URL: 'x', JWT_SECRET: 'test-secret-with-16+chars', NODE_ENV: 'test' });
const make = () => {
  const p = fakePrisma();
  const jwt = new JwtService({ secret: env.JWT_SECRET, signOptions: { algorithm: 'HS256' } });
  return { ...p, svc: new AuthService(p.db, jwt, env), jwt };
};
const rejects = async (promise: Promise<unknown>) => {
  try { await promise; } catch (e: any) { return { status: e.getStatus?.(), ...(e.getResponse?.() ?? {}) }; }
  throw new Error('esperava rejeição');
};

describe('AuthService — mensagens (iguais ao GoTrue que auth.tsx mapeia)', () => {
  it('e-mail repetido → "User already registered" (422)', async () => {
    const { svc } = make();
    await svc.signup({ email: 'a@b.com', password: 'segredo1' });
    const e = await rejects(svc.signup({ email: 'A@B.com ', password: 'segredo1' }));
    expect(e.message).toBe('User already registered');
    expect(e.message).toBe(MSG.ALREADY_REGISTERED);
    expect(e.status).toBe(422);
  });

  it('senha curta → "Password should be at least 6 characters." e fraca → contém "weak"', async () => {
    const { svc } = make();
    const curta = await rejects(svc.signup({ email: 'a@b.com', password: '123' }));
    expect(curta.message).toBe('Password should be at least 6 characters.');
    expect(curta.message.toLowerCase()).not.toContain('weak'); // auth.tsx testa "weak" ANTES de "password"
    const fraca = await rejects(svc.signup({ email: 'a@b.com', password: '123456' }));
    expect(fraca.message).toBe('Password is known to be weak and easy to guess, please choose a different one.');
    expect(fraca.message.toLowerCase()).toContain('weak');
  });

  it('login inválido (e-mail inexistente, senha errada, conta só-Google) → "Invalid login credentials"', async () => {
    const { svc, users } = make();
    await svc.signup({ email: 'a@b.com', password: 'segredo1' });
    users.push({ id: randomUUID(), email: 'g@b.com', password_hash: null, google_sub: 'sub', token_version: 0 });
    for (const input of [{ email: 'x@b.com', password: 'segredo1' }, { email: 'a@b.com', password: 'errada' }, { email: 'g@b.com', password: 'qualquer' }, {}]) {
      const e = await rejects(svc.login(input));
      expect(e.message).toBe('Invalid login credentials');
      expect(e.status).toBe(400);
    }
  });

  it('e-mail inválido e senha ausente', async () => {
    const { svc } = make();
    expect((await rejects(svc.signup({ email: 'nao-e-email', password: 'segredo1' }))).message).toBe('Unable to validate email address: invalid format');
    expect((await rejects(svc.signup({ email: 'a@b.com' }))).message).toBe('Signup requires a valid password');
  });
});

describe('AuthService — signup (o que on_auth_user_created fazia)', () => {
  it('cria usuário, profile (mesmo id), workspace e membership owner', async () => {
    const { svc, users, profiles, workspaces, members } = make();
    const s = await svc.signup({ email: 'Maria@Empresa.com', password: 'segredo1', full_name: 'Maria', company_name: 'Padaria da Maria' });
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('maria@empresa.com');
    expect(users[0].password_hash).not.toBe('segredo1');
    expect(profiles[0]).toMatchObject({ id: users[0].id, email: 'maria@empresa.com', full_name: 'Maria' });
    expect(workspaces[0]).toMatchObject({ name: 'Padaria da Maria', owner_id: users[0].id });
    expect(workspaces[0].slug).toBe(`ws-${users[0].id.replace(/-/g, '').slice(0, 10)}`);
    expect(members[0]).toEqual({ workspace_id: workspaces[0].id, user_id: users[0].id, role: 'owner' });
    expect(s.user).toEqual({ id: users[0].id, email: 'maria@empresa.com' });
  });

  it('defaults do trigger: full_name = parte local do e-mail; empresa = "Meu Workspace"', async () => {
    const { svc, profiles, workspaces } = make();
    await svc.signup({ email: 'joao@x.com', password: 'segredo1' });
    expect(profiles[0].full_name).toBe('joao');
    expect(workspaces[0].name).toBe('Meu Workspace');
  });

  it('devolve sessão já pronta (access + refresh) e o access token tem typ=access', async () => {
    const { svc, jwt } = make();
    const s = await svc.signup({ email: 'a@b.com', password: 'segredo1' });
    expect(s.token_type).toBe('bearer');
    expect(s.expires_in).toBeGreaterThan(0);
    const p = (await jwt.verifyAsync(s.access_token)) as any;
    expect(p).toMatchObject({ sub: s.user.id, typ: 'access', email: 'a@b.com' });
    // o refresh NÃO é aceito como access (segredo e typ diferentes)
    await expect(jwt.verifyAsync(s.refresh_token)).rejects.toBeTruthy();
  });
});

describe('AuthService — login, refresh, logout', () => {
  it('login ok devolve sessão; refresh gera sessão nova', async () => {
    const { svc } = make();
    await svc.signup({ email: 'a@b.com', password: 'segredo1' });
    const l = await svc.login({ email: ' A@b.com', password: 'segredo1' });
    const r = await svc.refresh(l.refresh_token);
    expect(r.user.email).toBe('a@b.com');
    expect(r.access_token).toBeTruthy();
  });

  it('refresh inválido → 401 "Invalid Refresh Token…"', async () => {
    const { svc } = make();
    for (const t of [undefined, 'lixo']) {
      const e = await rejects(svc.refresh(t));
      expect(e.status).toBe(401);
      expect(e.message).toBe(MSG.BAD_REFRESH);
    }
  });

  it('o access token não serve como refresh', async () => {
    const { svc } = make();
    const s = await svc.signup({ email: 'a@b.com', password: 'segredo1' });
    expect((await rejects(svc.refresh(s.access_token))).status).toBe(401);
  });

  it('logout invalida os refresh tokens existentes', async () => {
    const { svc } = make();
    const s = await svc.signup({ email: 'a@b.com', password: 'segredo1' });
    await svc.logout(s.user.id);
    expect((await rejects(svc.refresh(s.refresh_token))).status).toBe(401);
    const novo = await svc.login({ email: 'a@b.com', password: 'segredo1' });
    expect((await svc.refresh(novo.refresh_token)).user.id).toBe(s.user.id);
  });
});

describe('AuthService — Google OAuth opcional', () => {
  it('sem GOOGLE_CLIENT_ID/SECRET → 503 GOOGLE_NOT_CONFIGURED', async () => {
    const { svc } = make();
    expect(svc.googleConfigured()).toBe(false);
    const e = await rejects(svc.googleAuthUrl());
    expect(e.status).toBe(503);
    expect(e.code).toBe('GOOGLE_NOT_CONFIGURED');
    expect((await rejects(svc.googleCallback('c', 's'))).code).toBe('GOOGLE_NOT_CONFIGURED');
  });

  it('configurado: monta a URL do Google e recusa redirect_uri de outra origem', async () => {
    const p = fakePrisma();
    const e2 = validateEnv({ DATABASE_URL: 'x', JWT_SECRET: env.JWT_SECRET, NODE_ENV: 'test', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' });
    const svc = new AuthService(p.db, new JwtService({ secret: e2.JWT_SECRET }), e2);
    const url = new URL(await svc.googleAuthUrl('http://localhost:3025/overview'));
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3015/v1/auth/google/callback');
    expect((await rejects(svc.googleAuthUrl('https://evil.example.com/x'))).message).toBe('redirect_uri não permitido.');
  });

  it('callback cria o usuário (profile+workspace+owner) e devolve a sessão no fragmento da URL do web', async () => {
    const p = fakePrisma();
    const e2 = validateEnv({ DATABASE_URL: 'x', JWT_SECRET: env.JWT_SECRET, NODE_ENV: 'test', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' });
    const svc = new AuthService(p.db, new JwtService({ secret: e2.JWT_SECRET }), e2);
    const state = new URL(await svc.googleAuthUrl()).searchParams.get('state')!;
    const fakeFetch = (async (url: string) =>
      String(url).includes('token')
        ? new Response(JSON.stringify({ access_token: 'g-at' }), { status: 200 })
        : new Response(JSON.stringify({ sub: 'g-123', email: 'Gente@Gmail.com', email_verified: true, name: 'Gente' }), { status: 200 })) as unknown as typeof fetch;
    const redirect = await svc.googleCallback('code', state, fakeFetch);
    expect(redirect.startsWith('http://localhost:3025#access_token=')).toBe(true);
    expect(p.users[0]).toMatchObject({ email: 'gente@gmail.com', google_sub: 'g-123', password_hash: null });
    expect(p.members[0].role).toBe('owner');
    // state adulterado
    expect((await rejects(svc.googleCallback('code', 'lixo', fakeFetch))).status).toBe(400);
  });
});

describe('AuthService — fixes de segurança', () => {
  const gEnv = validateEnv({ DATABASE_URL: 'x', JWT_SECRET: env.JWT_SECRET, NODE_ENV: 'test', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' });
  const fetchFor = (verified: boolean | undefined) => (async (url: string) =>
    String(url).includes('token')
      ? new Response(JSON.stringify({ access_token: 'x' }), { status: 200 })
      : new Response(JSON.stringify({ sub: 'g-1', email: 'vitima@x.com', ...(verified === undefined ? {} : { email_verified: verified }) }), { status: 200 })) as unknown as typeof fetch;

  it('Google vinculando por e-mail apaga a senha pré-existente e derruba sessões (pre-hijack)', async () => {
    const p = fakePrisma();
    const svc = new AuthService(p.db, new JwtService({ secret: gEnv.JWT_SECRET }), gEnv);
    const atacante = await svc.signup({ email: 'vitima@x.com', password: 'senha-do-atacante' });
    const state = new URL(await svc.googleAuthUrl()).searchParams.get('state')!;
    await svc.googleCallback('c', state, fetchFor(true));
    expect(p.users[0].google_sub).toBe('g-1');
    expect(p.users[0].password_hash).toBeNull();
    expect(p.users[0].token_version).toBe(1);
    expect((await rejects(svc.login({ email: 'vitima@x.com', password: 'senha-do-atacante' }))).message).toBe('Invalid login credentials');
    expect((await rejects(svc.refresh(atacante.refresh_token))).status).toBe(401);
  });

  it.each([undefined, false])('Google com email_verified=%s é recusado (sem criar usuário)', async (v) => {
    const p = fakePrisma();
    const svc = new AuthService(p.db, new JwtService({ secret: gEnv.JWT_SECRET }), gEnv);
    const state = new URL(await svc.googleAuthUrl()).searchParams.get('state')!;
    expect(await svc.googleCallback('c', state, fetchFor(v))).toContain('error=google_email_unverified');
    expect(p.users).toHaveLength(0);
  });

  it('access token carrega ver = token_version; senha > 72 bytes é recusada', async () => {
    const { svc, jwt } = make();
    const s = await svc.signup({ email: 'a@b.com', password: 'segredo1' });
    expect(((await jwt.verifyAsync(s.access_token)) as any).ver).toBe(0);
    expect((await rejects(svc.signup({ email: 'c@b.com', password: 'a'.repeat(73) }))).message).toBe('Password should be at most 72 bytes.');
    expect((await rejects(svc.login({ email: 'a@b.com', password: 'a'.repeat(73) }))).message).toBe('Invalid login credentials');
  });
});
