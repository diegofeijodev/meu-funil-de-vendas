import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { AiKeysService } from '../ai/ai-keys.service';
import { errMessage, UserError } from '../media/user-error';
import { VaultService } from '../vault/vault.service';
import { buildAuthorizationUrl, McpAuthRequiredError, McpCallResult, McpClient, pickTool, pkcePair, randomToken } from './mcp-client';

export const MCP_PROVIDERS = ['higgsfield', 'meta', 'canva'] as const;
export type McpProvider = (typeof MCP_PROVIDERS)[number];

/** A conexão do OAuth em andamento vale por 30 min (o protótipo não expirava). */
const OAUTH_TTL_MS = 30 * 60_000;

/** Conexão com os tokens JÁ decifrados — nunca devolva isto ao navegador. */
export interface LiveConnection {
  id: string;
  workspace_id: string;
  provider: string;
  server_url: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: Date | null;
  status: string;
  tools: { name: string; description?: string | null }[];
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
  oauth_token_endpoint: string | null;
  oauth_resource: string | null;
}

/**
 * Conexões MCP por workspace (Higgsfield / Meta / Canva). Os tokens (access/refresh/client secret/verifier PKCE)
 * ficam CIFRADOS no banco (`VaultService.encryptValue`, AES-256-GCM) — o protótipo os guardava em texto puro.
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly vault: VaultService,
    private readonly keys: AiKeysService,
    private readonly client: McpClient,
    @Inject(ENV) private readonly env: Pick<Env, 'PUBLIC_URL' | 'APP_URL'>,
  ) {}

  get redirectUri(): string {
    return `${this.env.PUBLIC_URL.replace(/\/$/, '')}/api/public/mcp/callback`;
  }

  private enc = (v: string | null | undefined) => (v ? this.vault.encryptValue(v) : null);
  private dec = (v: string | null | undefined) => this.vault.decryptValue(v);

  /** `assertMember` de `mcp.functions.ts` (mensagens próprias). */
  private async assertMember(userId: string, workspaceId: string, manage: boolean): Promise<void> {
    const role = await this.access.roleOf(userId, workspaceId);
    if (!role) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem acesso a este workspace.' });
    if (manage && role !== 'owner' && role !== 'admin') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Só o dono ou um administrador conecta contas.' });
  }

  /** Testa a conexão listando as ferramentas; devolve o status pronto para gravar. */
  async probe(serverUrl: string, token: string | null) {
    const none = [] as { name: string; description: string | null }[];
    try {
      const found = await this.client.listTools(serverUrl, token);
      return { status: 'connected', tools: found.map((t) => ({ name: t.name, description: t.description ?? null })), error: null as string | null, needsAuth: false };
    } catch (e) {
      if (e instanceof McpAuthRequiredError) return { status: 'error', tools: none, error: e.message, needsAuth: true };
      return { status: 'error', tools: none, error: errMessage(e, 'Erro desconhecido na integração.'), needsAuth: false };
    }
  }

  // ------------------------------------------------------------------ ações

  async connect(userId: string, d: { workspaceId: string; provider: McpProvider; serverUrl: string; accessToken?: string | null; label?: string | null }) {
    await this.assertMember(userId, d.workspaceId, true);
    const typed = d.accessToken?.trim() ? d.accessToken.trim() : null;
    const existing = await this.prisma.mcp_connections.findUnique({
      where: { workspace_id_provider: { workspace_id: d.workspaceId, provider: d.provider } },
      select: { access_token: true },
    });
    const token = typed ?? this.dec(existing?.access_token);
    const probe = await this.probe(d.serverUrl, token);
    const row = {
      label: d.label ?? null,
      server_url: d.serverUrl,
      access_token: this.enc(token),
      status: probe.status,
      tools: probe.tools as Prisma.InputJsonValue,
      last_error: probe.error,
      connected_at: probe.status === 'connected' ? new Date() : null,
    };
    await this.prisma.mcp_connections.upsert({
      where: { workspace_id_provider: { workspace_id: d.workspaceId, provider: d.provider } },
      create: { workspace_id: d.workspaceId, provider: d.provider, ...row },
      update: row,
    });
    return { status: probe.status, tools: probe.tools, error: probe.error, needsAuth: probe.needsAuth };
  }

  /** Inicia o login OAuth (PKCE) no servidor MCP e devolve a URL de autorização. */
  async oauthStart(userId: string, d: { workspaceId: string; provider: McpProvider; serverUrl: string; label?: string | null }) {
    await this.assertMember(userId, d.workspaceId, true);
    const redirectUri = this.redirectUri;
    const discovery = await this.client.discoverAuthServer(d.serverUrl);
    // Registra de novo sempre: o cliente antigo pode ter sido registrado com outro endereço de retorno.
    if (!discovery.metadata.registration_endpoint) {
      throw new UserError('Este servidor MCP não aceita registro automático de aplicativo. Informe uma chave de acesso manualmente.');
    }
    const reg = await this.client.registerClient(discovery.metadata.registration_endpoint, redirectUri);
    const { verifier, challenge } = pkcePair();
    const state = randomToken(24);
    const row = {
      label: d.label ?? null,
      server_url: d.serverUrl,
      status: 'connecting',
      last_error: null,
      oauth_client_id: reg.clientId,
      oauth_client_secret: this.enc(reg.clientSecret),
      oauth_state: state,
      oauth_code_verifier: this.enc(verifier),
      oauth_redirect_uri: redirectUri,
      oauth_authorization_endpoint: discovery.metadata.authorization_endpoint,
      oauth_token_endpoint: discovery.metadata.token_endpoint,
      oauth_scope: discovery.scope ?? null,
      oauth_resource: discovery.resource,
    };
    await this.prisma.mcp_connections.upsert({
      where: { workspace_id_provider: { workspace_id: d.workspaceId, provider: d.provider } },
      create: { workspace_id: d.workspaceId, provider: d.provider, ...row },
      update: row,
    });
    return {
      authUrl: buildAuthorizationUrl({
        authorizationEndpoint: discovery.metadata.authorization_endpoint,
        clientId: reg.clientId,
        redirectUri,
        state,
        challenge,
        scope: discovery.scope,
        resource: discovery.resource,
      }),
    };
  }

  async disconnect(userId: string, workspaceId: string, provider: McpProvider) {
    await this.assertMember(userId, workspaceId, true);
    await this.prisma.mcp_connections.deleteMany({ where: { workspace_id: workspaceId, provider } });
    return { ok: true };
  }

  /** Executa uma ferramenta MCP do provedor conectado ao workspace (editores: gasta crédito da conta conectada). */
  async run(userId: string, d: { workspaceId: string; provider: McpProvider; keywords: string[]; toolName?: string | null; args: Record<string, unknown> }) {
    await this.access.require(userId, d.workspaceId, 'write');
    const conn = await this.getLiveConnection(d.workspaceId, d.provider);
    if (!conn || conn.status !== 'connected') throw new UserError('Nenhuma conexão MCP ativa para este provedor.');
    const tool = d.toolName ? (conn.tools.find((t) => t.name === d.toolName) ?? { name: d.toolName }) : pickTool(conn.tools.map((t) => ({ name: t.name, description: t.description ?? undefined })), d.keywords);
    if (!tool) throw new UserError('O servidor MCP não expôs nenhuma ferramenta utilizável.');
    const result = await this.client.callTool(conn.server_url, conn.access_token, tool.name, d.args);
    return { tool: tool.name, ...result };
  }

  /** Chamada interna (provedores): tool + args numa conexão já resolvida. */
  callTool(conn: Pick<LiveConnection, 'server_url' | 'access_token'>, name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    return this.client.callTool(conn.server_url, conn.access_token, name, args);
  }

  // ------------------------------------------------------------------ leitura

  /** `select id,provider,label,server_url,status,tools,last_error,connected_at,expires_at` — nunca as colunas de token. */
  async list(workspaceId: string) {
    const rows = await this.prisma.mcp_connections.findMany({
      where: { workspace_id: workspaceId },
      select: { id: true, provider: true, label: true, server_url: true, status: true, tools: true, last_error: true, connected_at: true, expires_at: true },
    });
    return rows;
  }

  /** Status de um provedor em todos os workspaces do usuário (`select workspace_id, provider, status`). */
  async statusForUser(userId: string, provider: McpProvider) {
    const members = await this.prisma.workspace_members.findMany({ where: { user_id: userId }, select: { workspace_id: true } });
    if (!members.length) return [];
    return this.prisma.mcp_connections.findMany({
      where: { workspace_id: { in: members.map((m) => m.workspace_id) }, provider },
      select: { workspace_id: true, provider: true, status: true },
    });
  }

  // ------------------------------------------------------------------ conexão viva (renova o token)

  /**
   * Conexão do workspace com o token renovado quando estiver perto de expirar.
   * Sem conexão própria ativa, usa a da empresa de onde esta herda as IAs (agência).
   */
  async getLiveConnection(workspaceId: string, provider: string, inherited = false): Promise<LiveConnection | null> {
    const data = await this.prisma.mcp_connections.findUnique({ where: { workspace_id_provider: { workspace_id: workspaceId, provider } } });
    if ((!data || data.status !== 'connected') && !inherited) {
      const source = await this.keys.inheritSource(workspaceId);
      if (source) {
        const shared = await this.getLiveConnection(source, provider, true);
        if (shared?.status === 'connected') return shared;
      }
    }
    if (!data) return null;
    let conn: LiveConnection = {
      id: data.id,
      workspace_id: data.workspace_id,
      provider: data.provider,
      server_url: data.server_url,
      access_token: this.dec(data.access_token),
      refresh_token: this.dec(data.refresh_token),
      expires_at: data.expires_at,
      status: data.status,
      tools: (Array.isArray(data.tools) ? data.tools : []) as LiveConnection['tools'],
      oauth_client_id: data.oauth_client_id,
      oauth_client_secret: this.dec(data.oauth_client_secret),
      oauth_token_endpoint: data.oauth_token_endpoint,
      oauth_resource: data.oauth_resource,
    };
    const expiringSoon = conn.expires_at ? conn.expires_at.getTime() - Date.now() < 60_000 : false;
    if (expiringSoon && conn.refresh_token && conn.oauth_token_endpoint && conn.oauth_client_id) {
      try {
        const t = await this.client.refreshAccessToken({
          tokenEndpoint: conn.oauth_token_endpoint,
          refreshToken: conn.refresh_token,
          clientId: conn.oauth_client_id,
          clientSecret: conn.oauth_client_secret,
          resource: conn.oauth_resource,
        });
        await this.prisma.mcp_connections.update({
          where: { id: conn.id },
          data: { access_token: this.enc(t.accessToken), refresh_token: this.enc(t.refreshToken ?? conn.refresh_token), expires_at: t.expiresAt, status: 'connected', last_error: null },
        });
        conn = { ...conn, access_token: t.accessToken, expires_at: t.expiresAt, status: 'connected' };
      } catch (e) {
        await this.prisma.mcp_connections.update({ where: { id: conn.id }, data: { status: 'expired', last_error: errMessage(e, 'Erro desconhecido na integração.') } });
        conn = { ...conn, status: 'expired' };
      }
    } else if (expiringSoon && !conn.refresh_token) {
      await this.prisma.mcp_connections.update({ where: { id: conn.id }, data: { status: 'expired' } });
      conn = { ...conn, status: 'expired' };
    }
    return conn;
  }

  // ------------------------------------------------------------------ callback OAuth (rota pública)

  /** Conclui o OAuth: troca o code, testa e grava os tokens cifrados. Devolve o que a página de retorno mostra. */
  async completeOAuth(code: string | null, state: string | null, oauthError: string | null): Promise<{ ok: boolean; message: string }> {
    if (oauthError) return { ok: false, message: 'O provedor recusou a autorização.' };
    if (!code || !state) return { ok: false, message: 'Retorno de autenticação incompleto.' };
    const conn = await this.prisma.mcp_connections.findFirst({ where: { oauth_state: state } });
    if (!conn || Date.now() - conn.updated_at.getTime() > OAUTH_TTL_MS) return { ok: false, message: 'Sessão de conexão não encontrada ou expirada.' };
    try {
      const tokens = await this.client.exchangeCode({
        tokenEndpoint: conn.oauth_token_endpoint!,
        code,
        codeVerifier: this.dec(conn.oauth_code_verifier)!,
        clientId: conn.oauth_client_id!,
        clientSecret: this.dec(conn.oauth_client_secret),
        redirectUri: conn.oauth_redirect_uri ?? this.redirectUri,
        resource: conn.oauth_resource,
      });
      const probe = await this.probe(conn.server_url, tokens.accessToken);
      await this.prisma.mcp_connections.update({
        where: { id: conn.id },
        data: {
          access_token: this.enc(tokens.accessToken),
          refresh_token: this.enc(tokens.refreshToken),
          expires_at: tokens.expiresAt,
          status: probe.status,
          tools: probe.tools as Prisma.InputJsonValue,
          last_error: probe.error,
          connected_at: probe.status === 'connected' ? new Date() : null,
          oauth_state: null,
          oauth_code_verifier: null,
        },
      });
      return { ok: probe.status === 'connected', message: probe.error ?? 'Integração conectada com sucesso.' };
    } catch (e) {
      this.logger.error(`[mcp-oauth] falha ao concluir autorização: ${e instanceof Error ? e.message : e}`);
      await this.prisma.mcp_connections.update({ where: { id: conn.id }, data: { status: 'error', last_error: errMessage(e, 'Erro desconhecido na integração.'), oauth_state: null, oauth_code_verifier: null } });
      return { ok: false, message: 'Não foi possível concluir a conexão. Tente novamente.' };
    }
  }
}
