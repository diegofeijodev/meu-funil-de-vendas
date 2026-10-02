import { api, API_URL } from '@/modules/shared/infrastructure/http';
import type { AuthSession, MeResponse } from '../domain/auth.types';

export async function login(email: string, password: string): Promise<AuthSession> {
  const { data } = await api.post<AuthSession>('/v1/auth/login', { email, password });
  return data;
}

export async function signup(body: {
  email: string;
  password: string;
  full_name?: string;
  company_name?: string;
}): Promise<AuthSession> {
  const { data } = await api.post<AuthSession>('/v1/auth/signup', body);
  return data;
}

export async function logout(): Promise<void> {
  await api.post('/v1/auth/logout');
}

export async function me(): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>('/v1/auth/me');
  return data;
}

/**
 * Início do login com Google (`GET /v1/auth/google`, §2). Devolve a URL do
 * Google, ou `null` quando a API não consegue iniciar (503
 * `GOOGLE_NOT_CONFIGURED`, rede, etc.). Pede com `redirect: 'manual'` para ler o
 * status sem seguir o 302 para o Google.
 */
export async function googleStartUrl(redirectUri: string): Promise<string | null> {
  const url = `${API_URL}/v1/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`;
  try {
    const res = await fetch(url, { redirect: 'manual' });
    // Resposta cross-origin 302 com `manual` vira `opaqueredirect`: navegar até
    // a própria URL da API faz o navegador seguir o redirecionamento.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return url;
    return null;
  } catch {
    return null;
  }
}

/**
 * Lê a sessão que o callback do Google deixa no fragmento
 * (`#access_token=…&refresh_token=…&token_type=bearer&expires_in=…`, ou `#error=…`).
 * O fragmento não traz o usuário: busca `/v1/auth/me` com o token recém-chegado.
 */
export async function sessionFromOAuthFragment(hash: string): Promise<AuthSession | null> {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const access = p.get('access_token');
  const refresh = p.get('refresh_token');
  if (p.get('error') || !access || !refresh) return null;
  try {
    const { data } = await api.get<MeResponse>('/v1/auth/me', { headers: { Authorization: `Bearer ${access}` } });
    const expiresIn = Number(p.get('expires_in') ?? 3600);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'bearer',
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user: { id: data.user.id, email: data.user.email },
    };
  } catch {
    return null;
  }
}
