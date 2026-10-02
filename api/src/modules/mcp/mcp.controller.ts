import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import type { FastifyReply } from 'fastify';
import { Inject } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { MCP_PROVIDERS, McpProvider, McpService } from './mcp.service';

export class McpConnectDto {
  @IsUUID() workspaceId!: string;
  @IsIn(MCP_PROVIDERS) provider!: McpProvider;
  @IsString() @MinLength(4) serverUrl!: string;
  @IsOptional() @IsString() accessToken?: string | null;
  @IsOptional() @IsString() label?: string | null;
}

export class McpOAuthStartDto {
  @IsUUID() workspaceId!: string;
  @IsIn(MCP_PROVIDERS) provider!: McpProvider;
  @IsString() @MinLength(4) serverUrl!: string;
  @IsOptional() @IsString() label?: string | null;
}

export class McpDisconnectDto {
  @IsUUID() workspaceId!: string;
  @IsIn(MCP_PROVIDERS) provider!: McpProvider;
}

export class McpRunDto {
  @IsUUID() workspaceId!: string;
  @IsIn(MCP_PROVIDERS) provider!: McpProvider;
  @IsOptional() @IsArray() @IsString({ each: true }) keywords?: string[];
  @IsOptional() @IsString() toolName?: string | null;
  @IsOptional() @IsObject() args?: Record<string, unknown>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Página de retorno do OAuth (mesmo HTML do protótipo; mensagem escapada e `postMessage` só para o origin do web). */
export function oauthPage(ok: boolean, message: string, appOrigin: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${ok ? 'Conectado' : 'Falha na conexão'}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0d12;color:#e8eaf0;display:grid;place-items:center;height:100vh;margin:0}
.card{max-width:420px;text-align:center;padding:32px;border:1px solid #232838;border-radius:16px;background:#11141c}</style></head>
<body><div class="card"><h1>${ok ? 'Integração conectada' : 'Não foi possível conectar'}</h1>
<p>${esc(message)}</p><p>Você já pode fechar esta janela.</p></div>
<script>try{window.opener&&window.opener.postMessage({type:"mcp-oauth",ok:${ok}},${JSON.stringify(appOrigin)});setTimeout(function(){window.close()},1200)}catch(e){}</script>
</body></html>`;
}

/** Server fns de `mcp.functions.ts`: `POST /v1/mcp/<nome-em-kebab>` (workspace no corpo). */
@ApiTags('MCP')
@ApiBearerAuth()
@Controller('v1/mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post('mcp-connect') @HttpCode(200)
  connect(@CurrentUser() u: AuthUser, @Body() d: McpConnectDto) {
    return this.mcp.connect(u.id, d);
  }

  @Post('mcp-o-auth-start') @HttpCode(200)
  oauthStart(@CurrentUser() u: AuthUser, @Body() d: McpOAuthStartDto) {
    return this.mcp.oauthStart(u.id, d);
  }

  @Post('mcp-disconnect') @HttpCode(200)
  disconnect(@CurrentUser() u: AuthUser, @Body() d: McpDisconnectDto) {
    return this.mcp.disconnect(u.id, d.workspaceId, d.provider);
  }

  @Post('mcp-run') @HttpCode(200)
  run(@CurrentUser() u: AuthUser, @Body() d: McpRunDto) {
    return this.mcp.run(u.id, { ...d, keywords: d.keywords ?? [], args: d.args ?? {} });
  }

  /** Status de um provedor em todas as empresas do usuário (cartão "Higgsfield" de Integrações). */
  @Get('status/:provider')
  status(@CurrentUser() u: AuthUser, @Param('provider') provider: string) {
    if (!(MCP_PROVIDERS as readonly string[]).includes(provider)) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Provedor inválido.' });
    return this.mcp.statusForUser(u.id, provider as McpProvider);
  }
}

/** `mcp_connections` do workspace sem os tokens (`fetchMcpConnections`). */
@ApiTags('MCP')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/mcp-connections')
export class McpConnectionsController {
  constructor(private readonly mcp: McpService) {}

  @Get()
  list(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.mcp.list(ws);
  }
}

/** `GET /api/public/mcp/callback` — retorno do login OAuth do servidor MCP (pública: o `state` aleatório é a credencial). */
@ApiTags('MCP')
@Controller('api/public/mcp')
export class McpCallbackController {
  constructor(
    private readonly mcp: McpService,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_URL'>,
  ) {}

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() reply: FastifyReply, @Req() _req: unknown) {
    const r = await this.mcp.completeOAuth(code ?? null, state ?? null, error ?? null);
    let origin = '*';
    try {
      origin = new URL(this.env.APP_URL).origin;
    } catch {
      /* APP_URL inválida: o próprio env.validation já a trata */
    }
    return reply.status(200).header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-store').send(oauthPage(r.ok, r.message, origin));
  }
}
