import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { clearStoredAuth, getStoredAuth, storeAuth } from '@/modules/auth/infrastructure/auth.storage';
import type { AuthSession } from '@/modules/auth/domain/auth.types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3015';

export const api = axios.create({ baseURL: API_URL });

const AUTH_PATHS = ['/v1/auth/login', '/v1/auth/signup', '/v1/auth/refresh'];

api.interceptors.request.use((config) => {
  // Só anexa o token quando o chamador não definiu um (ver nota do freela-web-v2:
  // sobrescrever um Authorization explícito já misturou contas).
  if (!config.headers.Authorization) {
    const auth = getStoredAuth();
    if (auth?.access_token) config.headers.Authorization = `Bearer ${auth.access_token}`;
  }
  return config;
});

let refreshing: Promise<AuthSession | null> | null = null;

/**
 * Troca o refresh token por uma sessão nova. Várias 401 paralelas dividem UMA chamada.
 * Devolve `null` só quando a API REJEITA o refresh (400/401: sessão morta).
 * Rede caindo ou 5xx: a promessa rejeita com o erro original e a sessão é mantida.
 */
function refreshSession(): Promise<AuthSession | null> {
  const current = getStoredAuth();
  if (!current?.refresh_token) return Promise.resolve(null);
  refreshing ??= axios
    .post<AuthSession>(`${API_URL}/v1/auth/refresh`, { refresh_token: current.refresh_token })
    .then(({ data }) => {
      storeAuth(data);
      return data;
    })
    .catch((e: unknown) => {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      if (status === 400 || status === 401) return null;
      throw e;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

let redirecionando = false;

function sessionDied() {
  clearStoredAuth();
  if (typeof window === 'undefined') return;
  // Uma vez por página: cinco consultas paralelas com 401 não podem virar cinco `replace`.
  if (!window.location.pathname.startsWith('/auth') && !redirecionando) {
    redirecionando = true;
    window.location.replace('/auth');
  }
}

type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as RetryConfig | undefined;
  if (error.response?.status === 401 && config && typeof window !== 'undefined') {
    const url = String(config.url ?? '');
    if (!AUTH_PATHS.some((p) => url.includes(p))) {
      // 401 uma única vez: tenta o refresh e repete a chamada com o token novo.
      if (!config._retried) {
        config._retried = true;
        let fresh: AuthSession | null;
        try {
          fresh = await refreshSession();
        } catch {
          // Falha transitória (rede/5xx): mantém a sessão e devolve o 401 original.
          return Promise.reject(error);
        }
        if (fresh) {
          config.headers.Authorization = `Bearer ${fresh.access_token}`;
          return api.request(config);
        }
      }
      sessionDied();
    }
  }
  return Promise.reject(error);
});

/**
 * A mensagem real da API vive em `error.response.data.error.message`
 * (`{ error: { code, message } }`). NUNCA achate para `error.message`.
 */
export function apiErrorMessage(error: unknown, fallback = 'Erro inesperado'): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error?.message;
    if (typeof message === 'string' && message.length > 0) return message;
    if (error.code === 'ERR_NETWORK') return 'Sem conexão com o servidor';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
