/**
 * Cliente da Graph API da Meta (Instagram / Facebook) — a ÚNICA porta de rede deste módulo (`META_FETCH`, injetável:
 * nos testes entra um fake). Todas as chamadas levam `access_token` + `appsecret_proof`. As credenciais vêm do cofre
 * (empresa → global) com as variáveis de ambiente como reserva, como `metaConfig` do protótipo.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { VaultService } from '../vault/vault.service';

export const GRAPH_VERSION = 'v24.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type MetaFetch = (url: string, init?: RequestInit) => Promise<Response>;
export const META_FETCH = Symbol('META_FETCH');

export type MetaConfig = {
  appId: string | null;
  appSecret: string | null;
  token: string | null;
  adAccountId: string | null;
  pageId: string | null;
  instagramId: string | null;
};

const KEYS = ['META_APP_ID', 'META_APP_SECRET', 'META_SYSTEM_USER_TOKEN', 'META_AD_ACCOUNT_ID', 'META_PAGE_ID', 'META_INSTAGRAM_ACCOUNT_ID'] as const;
type MetaEnv = Pick<Env, 'META_APP_ID' | 'META_APP_SECRET' | 'META_SYSTEM_USER_TOKEN' | 'META_GRAPH_TOKEN' | 'META_AD_ACCOUNT_ID' | 'META_PAGE_ID' | 'META_INSTAGRAM_ACCOUNT_ID'>;

export class MetaError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
  }
}

/** Traduz os erros mais comuns da Meta para português claro (mensagens do protótipo). */
export function translateMetaError(err: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string }): string {
  const code = err.code;
  const base = err.error_user_msg || err.message || 'erro desconhecido';
  if (code === 190) return 'O token da Meta é inválido ou expirou. Gere um novo token do usuário do sistema e atualize no cofre.';
  if (code === 10 || code === 200 || (code && code >= 200 && code < 300))
    return `Permissão insuficiente na Meta. Confira se o usuário do sistema tem acesso à conta de anúncios/página e as permissões necessárias. (${base})`;
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'Limite de chamadas da Meta atingido. Aguarde alguns minutos e tente de novo.';
  if (code === 100) return `A Meta recusou um dos dados enviados: ${base}`;
  if (code === 2635) return 'Versão da API da Meta não suportada. Atualize a versão configurada.';
  if (code === 1487390 || /payment/i.test(base)) return 'A conta de anúncios está sem forma de pagamento válida.';
  return `A Meta respondeu com erro: ${base}`;
}

/** Credenciais efetivas da Meta: cofre da empresa → cofre global → ambiente (`metaConfig` do protótipo). */
@Injectable()
export class MetaConfigService {
  constructor(
    private readonly vault: VaultService,
    @Inject(ENV) private readonly env: MetaEnv,
  ) {}

  private envValue(name: string): string | null {
    const v = (this.env as unknown as Record<string, unknown>)[name];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  private async pick(workspaceId: string | null, key: (typeof KEYS)[number]): Promise<string | null> {
    return (workspaceId ? await this.vault.get(workspaceId, key) : null) ?? (await this.vault.get(null, key)) ?? this.envValue(key);
  }

  async config(workspaceId: string | null): Promise<MetaConfig> {
    const [appId, appSecret, token, rawAccount, pageId, instagramId] = await Promise.all(KEYS.map((k) => this.pick(workspaceId, k)));
    return {
      appId: appId ?? null,
      appSecret: appSecret ?? null,
      token: token ?? this.envValue('META_GRAPH_TOKEN'),
      adAccountId: rawAccount ? (rawAccount.startsWith('act_') ? rawAccount : `act_${rawAccount}`) : null,
      pageId: pageId ?? null,
      instagramId: instagramId ?? null,
    };
  }
}

export type GraphOpts = { method?: 'GET' | 'POST' | 'DELETE'; params?: Record<string, unknown>; token?: string };

@Injectable()
export class MetaGraphClient {
  private readonly logger = new Logger(MetaGraphClient.name);

  constructor(
    private readonly cfg: MetaConfigService,
    @Inject(META_FETCH) private readonly http: MetaFetch,
    @Optional() @Inject(ENV) private readonly env?: Pick<Env, 'NODE_ENV' | 'META_GRAPH_BASE_URL'>,
  ) {}

  /** Base da Graph API. `META_GRAPH_BASE_URL` (Graph falsa de smoke/browser-check) só vale fora de produção. */
  get base(): string {
    const o = this.env?.META_GRAPH_BASE_URL;
    return o && this.env?.NODE_ENV !== 'production' ? o.replace(/\/$/, '') : GRAPH_BASE;
  }

  config(workspaceId: string | null) {
    return this.cfg.config(workspaceId);
  }

  /** `graph(path, …)` do protótipo, com a empresa explícita. Erros viram `MetaError` (mensagem pt-BR). */
  async graph<T = any>(workspaceId: string | null, path: string, opts: GraphOpts = {}): Promise<T> {
    const cfg = await this.cfg.config(workspaceId);
    const token = opts.token ?? cfg.token;
    if (!token) throw new MetaError('Token da Meta não configurado no cofre (META_SYSTEM_USER_TOKEN).');
    if (!cfg.appSecret) throw new MetaError('META_APP_SECRET não configurado no cofre.');
    const proof = createHmac('sha256', cfg.appSecret).update(token).digest('hex');

    const method = opts.method ?? 'GET';
    const form = new URLSearchParams();
    form.set('access_token', token);
    form.set('appsecret_proof', proof);
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      if (v === undefined || v === null) continue;
      form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    const url = `${this.base}${path.startsWith('/') ? path : `/${path}`}`;
    let res: Response;
    try {
      res =
        method === 'GET'
          ? await this.http(`${url}${url.includes('?') ? '&' : '?'}${form.toString()}`, { redirect: 'follow', signal: AbortSignal.timeout(60_000) })
          : await this.http(url, {
              method,
              redirect: 'follow',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: form.toString(),
              signal: AbortSignal.timeout(60_000),
            });
    } catch {
      throw new MetaError('Não foi possível falar com a Meta agora. Tente de novo em instantes.');
    }
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok || json.error) {
      const e = json.error ?? { message: `HTTP ${res.status}` };
      this.logger.warn(`[meta-graph] ${method} ${path} ${res.status} ${JSON.stringify(e).slice(0, 300)}`);
      throw new MetaError(translateMetaError(e), e.code, e.error_subcode);
    }
    return json as T;
  }
}
