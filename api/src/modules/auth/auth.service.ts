import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { Env } from '../../common/config/env.validation';
import { ENV } from '../../common/config/env.module';
import { deriveKey } from '../../common/crypto/hkdf';
import { PrismaService } from '../../common/database/prisma.service';
import { provisionUser } from './provision-user';

// Mensagens do GoTrue (Supabase Auth) que `routes/auth.tsx` do protótipo mapeia.
export const MSG = {
  ALREADY_REGISTERED: 'User already registered',
  INVALID_CREDENTIALS: 'Invalid login credentials',
  WEAK_PASSWORD: 'Password is known to be weak and easy to guess, please choose a different one.',
  LONG_PASSWORD: 'Password should be at most 72 bytes.',
  SHORT_PASSWORD: 'Password should be at least 6 characters.',
  NO_PASSWORD: 'Signup requires a valid password',
  INVALID_EMAIL: 'Unable to validate email address: invalid format',
  BAD_REFRESH: 'Invalid Refresh Token: Refresh Token Not Found',
} as const;

const COMMON_PASSWORDS = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', '111111', '000000', '654321', 'password', 'password1', 'passw0rd',
  'qwerty', 'qwerty123', 'abc123', 'abcdef', 'iloveyou', 'admin', 'letmein', 'senha', 'senha123', 'mudar123', '123123', '121212',
]);

export interface SessionView {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  user: { id: string; email: string };
}

const MAX_PASSWORD_BYTES = 72; // limite do bcrypt
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e: string | undefined) => (e ?? '').trim().toLowerCase();

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.refreshSecret = deriveKey(env.JWT_SECRET, 'refresh-token-secret').toString('hex');
  }

  // ---------- e-mail + senha ----------

  async signup(input: { email?: string; password?: string; full_name?: string; company_name?: string }): Promise<SessionView> {
    const email = normEmail(input.email);
    if (!EMAIL_RE.test(email)) throw new UnprocessableEntityException({ code: 'EMAIL_ADDRESS_INVALID', message: MSG.INVALID_EMAIL });
    const password = input.password ?? '';
    if (!password) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: MSG.NO_PASSWORD });
    if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) throw new UnprocessableEntityException({ code: 'WEAK_PASSWORD', message: MSG.LONG_PASSWORD });
    if (password.length < 6) throw new UnprocessableEntityException({ code: 'WEAK_PASSWORD', message: MSG.SHORT_PASSWORD });
    if (COMMON_PASSWORDS.has(password.toLowerCase())) throw new UnprocessableEntityException({ code: 'WEAK_PASSWORD', message: MSG.WEAK_PASSWORD });

    const existing = await this.prisma.users.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new UnprocessableEntityException({ code: 'USER_ALREADY_EXISTS', message: MSG.ALREADY_REGISTERED });

    const passwordHash = await bcrypt.hash(password, 10);
    try {
      const { user } = await this.prisma.$transaction((tx) =>
        provisionUser(tx, { email, passwordHash, fullName: input.full_name, companyName: input.company_name }),
      );
      return this.issueSession(user);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new UnprocessableEntityException({ code: 'USER_ALREADY_EXISTS', message: MSG.ALREADY_REGISTERED });
      }
      throw e;
    }
  }

  async login(input: { email?: string; password?: string }): Promise<SessionView> {
    const email = normEmail(input.email);
    const user = email ? await this.prisma.users.findUnique({ where: { email } }) : null;
    // Sem hash (conta só-Google) também é "credenciais inválidas", como no GoTrue.
    const pwd = input.password ?? '';
    // bcrypt sempre roda (hash falso se o e-mail não existe) para não vazar existência por tempo.
    const match = await bcrypt.compare(Buffer.byteLength(pwd) > MAX_PASSWORD_BYTES ? '' : pwd, user?.password_hash || DUMMY_HASH);
    const ok = !!user?.password_hash && !!pwd && Buffer.byteLength(pwd) <= MAX_PASSWORD_BYTES && match;
    if (!user || !ok) throw new BadRequestException({ code: 'INVALID_CREDENTIALS', message: MSG.INVALID_CREDENTIALS });
    return this.issueSession(user);
  }

  async refresh(refreshToken: string | undefined): Promise<SessionView> {
    const bad = () => new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: MSG.BAD_REFRESH });
    if (!refreshToken) throw bad();
    let payload: { sub?: string; typ?: string; ver?: number };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: this.refreshSecret, algorithms: ['HS256'] });
    } catch {
      throw bad();
    }
    if (payload.typ !== 'refresh' || !payload.sub) throw bad();
    const user = await this.prisma.users.findUnique({ where: { id: payload.sub } });
    if (!user || user.token_version !== payload.ver) throw bad();
    return this.issueSession(user);
  }

  /** Encerra as sessões: invalida todos os refresh tokens do usuário (stateless, por `token_version`). */
  async logout(userId: string): Promise<void> {
    await this.prisma.users.update({ where: { id: userId }, data: { token_version: { increment: 1 } } });
  }

  async me(userId: string) {
    const [user, profile] = await Promise.all([
      this.prisma.users.findUnique({ where: { id: userId }, select: { id: true, email: true, created_at: true } }),
      this.prisma.profiles.findUnique({ where: { id: userId } }),
    ]);
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized: Invalid token' });
    return { user, profile };
  }

  // ---------- tokens ----------

  async issueSession(user: { id: string; email: string; token_version: number }): Promise<SessionView> {
    const access_token = await this.jwt.signAsync({ sub: user.id, email: user.email, typ: 'access', ver: user.token_version }, { expiresIn: this.env.ACCESS_TOKEN_TTL as never });
    const refresh_token = await this.jwt.signAsync(
      { sub: user.id, typ: 'refresh', ver: user.token_version, jti: randomUUID() },
      { secret: this.refreshSecret, expiresIn: this.env.REFRESH_TOKEN_TTL as never },
    );
    const { exp } = this.jwt.decode(access_token) as { exp: number };
    return {
      access_token,
      refresh_token,
      token_type: 'bearer',
      expires_in: Math.max(0, exp - Math.floor(Date.now() / 1000)),
      expires_at: exp,
      user: { id: user.id, email: user.email },
    };
  }

  // ---------- Google OAuth (opcional) ----------

  googleConfigured(): boolean {
    return !!(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET);
  }

  private assertGoogle() {
    if (!this.googleConfigured()) {
      throw new ServiceUnavailableException({
        code: 'GOOGLE_NOT_CONFIGURED',
        message: 'Login com Google não está configurado neste ambiente.',
      });
    }
  }

  /** Origens aceitas para o redirecionamento final (o web). */
  private allowedOrigins(): string[] {
    const list = [this.env.APP_URL, ...this.env.CORS_ORIGINS.split(',')].map((s) => s.trim()).filter(Boolean);
    return list.map((u) => { try { return new URL(u).origin; } catch { return ''; } }).filter(Boolean);
  }

  private callbackUrl() {
    return `${this.env.PUBLIC_URL.replace(/\/$/, '')}/v1/auth/google/callback`;
  }

  async googleAuthUrl(redirectUri?: string): Promise<string> {
    this.assertGoogle();
    const target = redirectUri || this.env.APP_URL;
    let origin: string;
    try { origin = new URL(target).origin; } catch { throw new BadRequestException({ code: 'BAD_REQUEST', message: 'redirect_uri inválido.' }); }
    if (!this.allowedOrigins().includes(origin)) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'redirect_uri não permitido.' });
    const state = await this.jwt.signAsync({ typ: 'oauth_state', redirect: target, n: randomUUID() }, { expiresIn: '10m' });
    const q = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID!,
      redirect_uri: this.callbackUrl(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
  }

  /** Troca o `code`, cria/associa o usuário e devolve a URL do web com a sessão no fragmento. */
  async googleCallback(code: string | undefined, state: string | undefined, fetchFn: typeof fetch = fetch): Promise<string> {
    this.assertGoogle();
    let redirect = this.env.APP_URL;
    try {
      const st = (await this.jwt.verifyAsync(state ?? '', { algorithms: ['HS256'] })) as { typ?: string; redirect?: string };
      if (st.typ !== 'oauth_state' || !st.redirect) throw new Error('state');
      redirect = st.redirect;
    } catch {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Estado do login com Google inválido ou expirado.' });
    }
    const fail = (reason: string) => `${redirect}${redirect.includes('#') ? '&' : '#'}error=${encodeURIComponent(reason)}`;
    if (!code) return fail('access_denied');
    try {
      const tokenRes = await fetchFn('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.env.GOOGLE_CLIENT_ID!,
          client_secret: this.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: this.callbackUrl(),
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return fail('google_token_failed');
      const { access_token } = (await tokenRes.json()) as { access_token?: string };
      const infoRes = await fetchFn('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access_token}` } });
      if (!infoRes.ok) return fail('google_userinfo_failed');
      const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
      if (!info.sub || !info.email || info.email_verified !== true) return fail('google_email_unverified');
      const user = await this.findOrCreateGoogleUser({ sub: info.sub, email: normEmail(info.email), name: info.name, picture: info.picture });
      const s = await this.issueSession(user);
      const frag = new URLSearchParams({ access_token: s.access_token, refresh_token: s.refresh_token, token_type: 'bearer', expires_in: String(s.expires_in) });
      return `${redirect}${redirect.includes('#') ? '&' : '#'}${frag.toString()}`;
    } catch (e) {
      this.logger.error(`google callback: ${e instanceof Error ? e.message : e}`);
      return fail('google_failed');
    }
  }

  private async findOrCreateGoogleUser(g: { sub: string; email: string; name?: string; picture?: string }) {
    const bySub = await this.prisma.users.findUnique({ where: { google_sub: g.sub } });
    if (bySub) return bySub;
    const byEmail = await this.prisma.users.findUnique({ where: { email: g.email } });
    if (byEmail) {
      // O Google prova a posse do e-mail: a senha criada por quem cadastrou primeiro (sem verificação) morre,
      // e as sessões existentes caem (pre-hijack).
      return this.prisma.users.update({
        where: { id: byEmail.id },
        data: { google_sub: g.sub, password_hash: null, token_version: { increment: 1 } },
      });
    }
    const { user } = await this.prisma.$transaction((tx) =>
      provisionUser(tx, { email: g.email, passwordHash: null, googleSub: g.sub, fullName: g.name, avatarUrl: g.picture, companyName: g.name ? `Workspace de ${g.name}` : null }),
    );
    return user;
  }
}
