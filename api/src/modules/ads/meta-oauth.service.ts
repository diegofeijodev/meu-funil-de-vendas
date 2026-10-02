/**
 * "Entrar com Facebook" (porte de `meta/oauth.server.ts`): troca o token colado à mão por login OAuth. O token de usuário de
 * longa duração (~60 dias) vai para o cofre da empresa (cifrado) com a data de expiração.
 * Diferenças de segurança em relação ao protótipo: `state` aleatório, de uso único, com validade e preso ao usuário que
 * iniciou (e ele ainda precisa ser owner|admin da empresa no retorno); redirect_uri e destino saem de PUBLIC_URL/APP_URL.
 */
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { WorkspaceAccessService } from '../access/access.service';
import { GRAPH_VERSION, META_FETCH, MetaError, MetaFetch, MetaGraphClient } from '../instagram/meta-graph';
import { VaultService } from '../vault/vault.service';
import { OAuthStateService } from './oauth-state.service';

export const META_SCOPES = [
  'ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads', 'pages_manage_metadata',
  'pages_messaging', 'leads_retrieval', 'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'instagram_manage_messages', 'instagram_manage_comments',
];
export const MSG_ONLY_MANAGER_CONNECTS = 'Só o dono ou um administrador conecta a Meta.';

@Injectable()
export class MetaOAuthService {
  constructor(
    private readonly vault: VaultService,
    private readonly graphClient: MetaGraphClient,
    private readonly states: OAuthStateService,
    private readonly access: WorkspaceAccessService,
    @Inject(META_FETCH) private readonly http: MetaFetch,
    @Inject(ENV) private readonly env: Pick<Env, 'PUBLIC_URL' | 'APP_URL'>,
  ) {}

  get redirectUri(): string {
    return `${this.env.PUBLIC_URL.replace(/\/$/, '')}/api/public/meta/oauth/callback`;
  }

  /** Para onde o callback devolve o navegador (`/integrations?meta=conectado` | `?meta_erro=…`). */
  backUrl(q: { meta?: string; meta_erro?: string }): string {
    const to = new URL('/integrations', this.env.APP_URL);
    if (q.meta) to.searchParams.set('meta', q.meta);
    if (q.meta_erro) to.searchParams.set('meta_erro', q.meta_erro.slice(0, 300));
    return to.toString();
  }

  async buildLoginUrl(workspaceId: string, userId: string): Promise<string> {
    const cfg = await this.graphClient.config(workspaceId);
    if (!cfg.appId || !cfg.appSecret) throw new MetaError('Salve primeiro o ID e a chave secreta do app da Meta.');
    const state = await this.states.issue('meta', workspaceId, userId);
    const qs = new URLSearchParams({ client_id: cfg.appId, redirect_uri: this.redirectUri, state, response_type: 'code', scope: META_SCOPES.join(',') });
    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${qs}`;
  }

  private async json(url: string): Promise<{ ok: boolean; body: any }> {
    let res: Response;
    try {
      res = await this.http(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new MetaError('Não foi possível falar com a Meta agora. Tente de novo em instantes.');
    }
    return { ok: res.ok, body: await res.json().catch(() => ({})) };
  }

  /** Retorno do login: valida/consome o state, troca o `code` por token curto e depois longo e grava no cofre. */
  async handleCallback(code: string, state: string): Promise<{ workspaceId: string; expiresAt: string }> {
    const { workspaceId, userId } = await this.states.consume('meta', state);
    if (!(await this.access.can(userId, workspaceId, 'manage'))) throw new MetaError(MSG_ONLY_MANAGER_CONNECTS);
    const cfg = await this.graphClient.config(workspaceId);
    if (!cfg.appId || !cfg.appSecret) throw new MetaError('App da Meta não configurado nesta empresa.');
    const base = `${this.graphClient.base}/oauth/access_token`;
    const short = await this.json(`${base}?${new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: this.redirectUri, code })}`);
    if (!short.ok || !short.body.access_token) throw new MetaError(short.body.error?.message ?? 'O Facebook não liberou o acesso.');
    const long = await this.json(`${base}?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: short.body.access_token })}`);
    if (!long.ok || !long.body.access_token) throw new MetaError(long.body.error?.message ?? 'Não foi possível obter o token de longa duração.');
    const expiresAt = new Date(Date.now() + (Number(long.body.expires_in) || 60 * 86400) * 1000).toISOString();
    await this.vault.set(workspaceId, { META_SYSTEM_USER_TOKEN: long.body.access_token, META_TOKEN_EXPIRES_AT: expiresAt, META_TOKEN_SOURCE: 'facebook_login' });
    return { workspaceId, expiresAt };
  }

  /** Contas de anúncios, Páginas e Instagram que o token enxerga (para escolher na tela). */
  async listAssets(workspaceId: string) {
    const [accounts, pages] = await Promise.all([
      this.graphClient.graph<{ data?: { id: string; name: string; account_status: number; currency?: string }[] }>(workspaceId, '/me/adaccounts', { params: { fields: 'id,name,account_status,currency', limit: 100 } }),
      this.graphClient.graph<{ data?: { id: string; name: string; instagram_business_account?: { id: string; username?: string } }[] }>(workspaceId, '/me/accounts', { params: { fields: 'id,name,instagram_business_account{id,username}', limit: 100 } }),
    ]);
    return {
      adAccounts: (accounts.data ?? []).map((a) => ({ id: a.id, name: a.name, active: a.account_status === 1, currency: a.currency ?? null })),
      pages: (pages.data ?? []).map((p) => ({ id: p.id, name: p.name, instagramId: p.instagram_business_account?.id ?? null, instagramUsername: p.instagram_business_account?.username ?? null })),
    };
  }

  async saveAssets(workspaceId: string, v: { adAccountId: string; pageId: string; instagramId: string | null }) {
    await this.vault.set(workspaceId, { META_AD_ACCOUNT_ID: v.adAccountId, META_PAGE_ID: v.pageId, ...(v.instagramId ? { META_INSTAGRAM_ACCOUNT_ID: v.instagramId } : {}) });
  }

  async saveApp(workspaceId: string, appId: string, appSecret: string) {
    await this.vault.set(workspaceId, { META_APP_ID: appId, META_APP_SECRET: appSecret });
  }

  async tokenInfo(workspaceId: string) {
    const [expiresAt, source] = await Promise.all([this.vault.get(workspaceId, 'META_TOKEN_EXPIRES_AT'), this.vault.get(workspaceId, 'META_TOKEN_SOURCE')]);
    return { expiresAt, source: source ?? 'system_user' };
  }
}
