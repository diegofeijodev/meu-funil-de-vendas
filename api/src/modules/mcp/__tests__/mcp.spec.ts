import { createHash } from 'node:crypto';
import { WorkspaceAccessService } from '../../access/access.service';
import { MemTable, memMembers, OWNER, status, STRANGER, VIEWER, MARKETING, ADMIN, WS_A, WS_B } from '../../media/__tests__/mem';
import { VaultService } from '../../vault/vault.service';
import { buildAuthorizationUrl, McpAuthRequiredError, McpClient, pickTool, pkcePair } from '../mcp-client';
import { oauthPage } from '../mcp.controller';
import { McpService } from '../mcp.service';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const SERVER = 'https://mcp.higgsfield.ai/mcp';

/** Servidor MCP falso (JSON-RPC por POST). */
function mcpServer(over: { tools?: any[]; call?: (name: string, args: any) => any; sse?: boolean; needAuth?: boolean; token?: string } = {}): { calls: { url: string; method: string; headers: any; body: any }[]; fetch: Handler } {
  const calls: { url: string; method: string; headers: any; body: any }[] = [];
  const reply = (id: unknown, result: unknown, sse = over.sse) =>
    sse ? new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream', 'Mcp-Session-Id': 'sess-1' } })
        : json({ jsonrpc: '2.0', id, result }, { headers: { 'content-type': 'application/json', 'Mcp-Session-Id': 'sess-1' } });
  return {
    calls,
    fetch: (url, init) => {
      const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method: init.method ?? 'GET', headers, body });
      if (over.needAuth || (over.token && headers['Authorization'] !== `Bearer ${over.token}`)) {
        return new Response('no', { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.higgsfield.ai/.well-known/oauth-protected-resource"' } });
      }
      if (body?.method === 'initialize') return reply(body.id, { protocolVersion: '2025-06-18', capabilities: {} });
      if (body?.method === 'notifications/initialized') return new Response('', { status: 202 });
      if (body?.method === 'tools/list') return reply(body.id, { tools: over.tools ?? [{ name: 'generate_image', description: 'Generate an image', inputSchema: { secret: 1 } }, { name: 'job_status' }] });
      if (body?.method === 'tools/call') return reply(body.id, over.call ? over.call(body.params.name, body.params.arguments) : { content: [{ type: 'text', text: 'ok' }] });
      return new Response('?', { status: 404 });
    },
  };
}

const clientFor = (h: Handler, env = 'test') => new McpClient(((u: string, i?: RequestInit) => Promise.resolve(h(u, i ?? {}))) as any, { NODE_ENV: env } as any);

describe('McpClient — JSON-RPC (Streamable HTTP)', () => {
  it('abre sessão (initialize + initialized), manda o token e o Mcp-Session-Id, e lista só nome/descrição', async () => {
    const s = mcpServer({ token: 'segredo' });
    const tools = await clientFor(s.fetch).listTools(SERVER, 'segredo');
    expect(tools).toEqual([{ name: 'generate_image', description: 'Generate an image' }, { name: 'job_status', description: undefined }]);
    expect(s.calls.map((c) => c.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    expect(s.calls[0]!.body.params).toMatchObject({ protocolVersion: '2025-06-18', clientInfo: { name: 'ai-marketing-os', version: '1.0.0' } });
    expect(s.calls[0]!.headers['Authorization']).toBe('Bearer segredo');
    expect(s.calls[2]!.headers['Mcp-Session-Id']).toBe('sess-1');
  });

  it('aceita resposta em SSE', async () => {
    const tools = await clientFor(mcpServer({ sse: true }).fetch).listTools(SERVER, null);
    expect(tools.map((t) => t.name)).toEqual(['generate_image', 'job_status']);
  });

  it('401/403 → McpAuthRequiredError com o resource_metadata do WWW-Authenticate', async () => {
    const e = await clientFor(mcpServer({ needAuth: true }).fetch).listTools(SERVER, null).catch((x) => x);
    expect(e).toBeInstanceOf(McpAuthRequiredError);
    expect(e.message).toBe('O servidor MCP exige autenticação.');
    expect(e.resourceMetadataUrl).toBe('https://mcp.higgsfield.ai/.well-known/oauth-protected-resource');
  });

  it('erro HTTP e erro JSON-RPC viram mensagens; resposta que não é JSON também', async () => {
    const c500 = clientFor(() => new Response('boom', { status: 500 }));
    expect(await status(c500.listTools(SERVER, null))).toBe('400:Servidor MCP respondeu 500: boom');
    const rpcErr = clientFor((_u, i) => json({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }));
    expect(await status(rpcErr.listTools(SERVER, null))).toBe('400:Method not found');
    const junk = clientFor(() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await status(junk.listTools(SERVER, null))).toBe('400:O servidor MCP devolveu uma resposta inválida.');
  });

  it('callTool: texto, imagem base64 → data URL, resource http, structuredContent e URL no texto; isError lança', async () => {
    const run = (call: any) => clientFor(mcpServer({ call }).fetch).callTool(SERVER, 't', 'x', { a: 1 });
    expect(await run(() => ({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }))).toEqual({ text: 'a\nb', mediaUrl: null, structured: null });
    expect((await run(() => ({ content: [{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] }))).mediaUrl).toBe('data:image/jpeg;base64,AAAA');
    expect((await run(() => ({ content: [{ type: 'video', data: 'https://cdn/x.mp4' }] }))).mediaUrl).toBe('https://cdn/x.mp4');
    expect((await run(() => ({ content: [{ type: 'resource', resource: { uri: 'https://cdn/r.png' } }] }))).mediaUrl).toBe('https://cdn/r.png');
    const st = await run(() => ({ content: [], structuredContent: { result: { url: 'https://cdn/s.png' } } }));
    expect([st.mediaUrl, st.structured]).toEqual(['https://cdn/s.png', '{"result":{"url":"https://cdn/s.png"}}']);
    expect((await run(() => ({ content: [{ type: 'text', text: 'veja https://cdn/t.webp ok' }] }))).mediaUrl).toBe('https://cdn/t.webp');
    expect(await status(run(() => ({ isError: true, content: [{ type: 'text', text: 'sem crédito' }] })))).toBe('400:sem crédito');
    expect(await status(run(() => ({ isError: true, content: [] })))).toBe('400:A ferramenta x retornou erro.');
    const s = mcpServer({ call: () => ({ content: [] }) });
    await clientFor(s.fetch).callTool(SERVER, 't', 'generate_image', { prompt: 'p' });
    expect(s.calls.at(-1)!.body).toMatchObject({ method: 'tools/call', params: { name: 'generate_image', arguments: { prompt: 'p' } } });
  });

  it('pickTool: pela palavra-chave na ordem dada, senão a primeira', () => {
    const tools = [{ name: 'a', description: 'faz coisas' }, { name: 'generate_video', description: 'cria vídeo' }, { name: 'generate_image' }];
    expect(pickTool(tools, ['image'])!.name).toBe('generate_image');
    expect(pickTool(tools, ['vídeo', 'image'])!.name).toBe('generate_video');
    expect(pickTool(tools, ['nada'])!.name).toBe('a');
    expect(pickTool([], ['x'])).toBeNull();
  });
});

describe('McpClient — segurança de rede e redirecionamentos', () => {
  it('mensagens do protótipo: endereço inválido e http; em produção localhost/rede interna não valem', async () => {
    const c = clientFor(mcpServer().fetch, 'production');
    expect(await status(c.listTools('não é url', null))).toBe('400:Endereço do servidor MCP inválido.');
    expect(await status(c.listTools('http://mcp.example.com/x', null))).toBe('400:Use um endereço https:// para o servidor MCP.');
    expect(await status(c.listTools('https://localhost/mcp', null))).toContain('rede interna');
    expect(await status(c.listTools('https://169.254.169.254/latest', null))).toContain('rede interna');
    expect(await status(c.listTools('https://10.0.0.7/mcp', null))).toContain('rede interna');
    // fora de produção, localhost vale (desenvolvimento)
    const dev = mcpServer();
    expect((await clientFor(dev.fetch, 'development').listTools('http://localhost:9000/mcp', null)).length).toBe(2);
  });

  it('segue redirecionamentos: 307 preserva POST+corpo, troca de origem tira o Authorization; 303 vira GET; destino inseguro e excesso de saltos falham', async () => {
    const seen: { url: string; method: string; auth?: string; body: boolean }[] = [];
    const h: Handler = (url, init) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      seen.push({ url, method: init.method!, auth: headers['Authorization'], body: !!init.body });
      if (url === 'https://a.example.com/mcp') return new Response(null, { status: 307, headers: { location: 'https://b.example.org/mcp' } });
      return json({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    };
    await clientFor(h).listTools('https://a.example.com/mcp', 'tok');
    expect(seen[0]).toMatchObject({ url: 'https://a.example.com/mcp', method: 'POST', auth: 'Bearer tok', body: true });
    expect(seen[1]).toMatchObject({ url: 'https://b.example.org/mcp', method: 'POST', auth: undefined, body: true });

    const seen303: string[] = [];
    await clientFor((url, init) => {
      seen303.push(`${init.method} ${url}`);
      return url.endsWith('/old') ? new Response(null, { status: 303, headers: { location: '/new' } }) : json({ jsonrpc: '2.0', id: 1, result: {} });
    }).listTools('https://a.example.com/old', null).catch(() => undefined);
    expect(seen303[1]).toBe('GET https://a.example.com/new');

    const toHttp = clientFor(() => new Response(null, { status: 302, headers: { location: 'http://evil.example.com/x' } }), 'production');
    expect(await status(toHttp.listTools('https://a.example.com/mcp', null))).toBe('400:O servidor MCP redirecionou para um endereço não seguro.');
    const toInternal = clientFor(() => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/x' } }), 'production');
    expect(await status(toInternal.listTools('https://a.example.com/mcp', null))).toBe('400:O servidor MCP redirecionou para um endereço não seguro.');
    const loop = clientFor(() => new Response(null, { status: 302, headers: { location: 'https://a.example.com/loop' } }));
    expect(await status(loop.listTools('https://a.example.com/mcp', null))).toBe('400:O servidor MCP redirecionou vezes demais.');
  });
});

describe('McpClient — OAuth 2.1 + PKCE', () => {
  const AS = 'https://auth.higgsfield.ai';
  const oauthFetch = (over: { prm?: any; meta?: any; noMeta?: boolean } = {}): { calls: string[]; fetch: Handler } => {
    const calls: string[] = [];
    return {
      calls,
      fetch: (url, init) => {
        calls.push(`${init.method} ${url}`);
        if (url.includes('/.well-known/oauth-protected-resource')) return json(over.prm ?? { resource: SERVER, authorization_servers: [AS], scopes_supported: ['read', 'write'] });
        if (url === `${AS}/.well-known/oauth-authorization-server` && !over.noMeta) return json(over.meta ?? { authorization_endpoint: `${AS}/authorize`, token_endpoint: `${AS}/token`, registration_endpoint: `${AS}/register`, scopes_supported: ['offline_access'] });
        if (url === `${AS}/register`) return json({ client_id: 'cid', client_secret: 'csec' });
        if (url === `${AS}/token`) return json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
        return new Response('nf', { status: 404 });
      },
    };
  };

  it('descobre o servidor de autorização (RFC 9728 + 8414) e monta o escopo com offline_access', async () => {
    const o = oauthFetch();
    const d = await clientFor(o.fetch).discoverAuthServer(SERVER);
    expect(d.metadata.token_endpoint).toBe(`${AS}/token`);
    expect(d.resource).toBe(SERVER);
    expect(d.scope).toBe('read write offline_access');
    expect(o.calls[0]).toBe('GET https://mcp.higgsfield.ai/.well-known/oauth-protected-resource/mcp');
  });

  it('sem metadados → mensagem do protótipo', async () => {
    expect(await status(clientFor(oauthFetch({ noMeta: true }).fetch).discoverAuthServer(SERVER))).toBe('400:Não foi possível descobrir o servidor de autenticação (OAuth) deste MCP.');
  });

  it('registra o cliente (client_name "Meu Funil", sem autenticação de cliente) e troca/renova tokens', async () => {
    let regBody: any;
    let tokenForm: URLSearchParams | undefined;
    let tokenAuth: string | undefined;
    const c = clientFor(async (url, init) => {
      if (url === `${AS}/register`) { regBody = JSON.parse(String(init.body)); return json({ client_id: 'cid', client_secret: 'csec' }); }
      tokenForm = new URLSearchParams(String(init.body));
      tokenAuth = (init.headers as any)['Authorization'];
      return json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    });
    expect(await c.registerClient(`${AS}/register`, 'http://api.test/api/public/mcp/callback')).toEqual({ clientId: 'cid', clientSecret: 'csec' });
    expect(regBody).toMatchObject({ client_name: 'Meu Funil', redirect_uris: ['http://api.test/api/public/mcp/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] });
    const t = await c.exchangeCode({ tokenEndpoint: `${AS}/token`, code: 'CODE', codeVerifier: 'VER', clientId: 'cid', clientSecret: 'csec', redirectUri: 'http://api.test/cb', resource: SERVER });
    expect([t.accessToken, t.refreshToken]).toEqual(['AT', 'RT']);
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_500_000);
    expect(Object.fromEntries(tokenForm!)).toEqual({ grant_type: 'authorization_code', code: 'CODE', code_verifier: 'VER', client_id: 'cid', redirect_uri: 'http://api.test/cb', resource: SERVER });
    expect(tokenAuth).toBe(`Basic ${Buffer.from('cid:csec').toString('base64')}`);
    await c.refreshAccessToken({ tokenEndpoint: `${AS}/token`, refreshToken: 'RT', clientId: 'cid' });
    expect(Object.fromEntries(tokenForm!)).toEqual({ grant_type: 'refresh_token', refresh_token: 'RT', client_id: 'cid' });
    expect(tokenAuth).toBeUndefined();
    // erros
    expect(await status(clientFor(() => new Response('{}', { status: 400 })).registerClient(`${AS}/register`, 'x'))).toBe('400:Falha no registro do aplicativo OAuth (400).');
    expect(await status(clientFor(() => new Response('bad', { status: 400 })).exchangeCode({ tokenEndpoint: `${AS}/token`, code: 'c', codeVerifier: 'v', clientId: 'c', redirectUri: 'r' }))).toBe('400:Falha ao obter o token (400): bad');
    // endpoint de token na rede interna é barrado em produção (vem de metadado remoto)
    expect(await status(clientFor(() => json({}), 'production').exchangeCode({ tokenEndpoint: 'https://169.254.169.254/token', code: 'c', codeVerifier: 'v', clientId: 'c', redirectUri: 'r' }))).toContain('rede interna');
  });

  it('PKCE S256 e URL de autorização', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    const u = new URL(buildAuthorizationUrl({ authorizationEndpoint: `${AS}/authorize`, clientId: 'cid', redirectUri: 'http://api.test/cb', state: 'S', challenge, scope: 'read', resource: SERVER }));
    expect(Object.fromEntries(u.searchParams)).toEqual({ response_type: 'code', client_id: 'cid', redirect_uri: 'http://api.test/cb', state: 'S', code_challenge: challenge, code_challenge_method: 'S256', scope: 'read', resource: SERVER });
  });
});

describe('McpService — conexões com token cifrado', () => {
  const ENV = { PUBLIC_URL: 'http://api.test', APP_URL: 'http://web.test', NODE_ENV: 'test' } as any;
  const vault = new VaultService({} as any, { CREDENTIALS_ENCRYPTION_KEY: 'k'.repeat(40), NODE_ENV: 'test' });

  function setup(fetchImpl: Handler = mcpServer().fetch, inherit: Record<string, string> = {}) {
    const conns = new MemTable(() => ({ status: 'disconnected', tools: [], label: null, access_token: null, refresh_token: null }));
    const prisma: any = { mcp_connections: conns, workspace_members: memMembers };
    const client = new McpClient(((u: string, i?: RequestInit) => Promise.resolve(fetchImpl(u, i ?? {}))) as any, ENV);
    const keys: any = { inheritSource: async (ws: string) => inherit[ws] ?? null };
    const svc = new McpService(prisma, new WorkspaceAccessService(prisma), vault, keys, client, ENV);
    return { svc, conns, client };
  }

  it('só dono/admin conecta; estranho não é membro; mensagens do protótipo', async () => {
    const { svc } = setup();
    const d = { workspaceId: WS_A, provider: 'higgsfield' as const, serverUrl: SERVER };
    expect(await status(svc.connect(MARKETING, d))).toBe('403:Só o dono ou um administrador conecta contas.');
    expect(await status(svc.connect(VIEWER, d))).toBe('403:Só o dono ou um administrador conecta contas.');
    expect(await status(svc.connect(STRANGER, d))).toBe('403:Você não tem acesso a este workspace.');
    expect(await status(svc.oauthStart(MARKETING, d))).toBe('403:Só o dono ou um administrador conecta contas.');
    expect(await status(svc.disconnect(MARKETING, WS_A, 'higgsfield'))).toBe('403:Só o dono ou um administrador conecta contas.');
    expect(await status(svc.connect(ADMIN, d))).toBe('ok');
  });

  it('conectar com chave manual: testa, grava status/ferramentas e guarda o token CIFRADO (nunca em texto puro)', async () => {
    const { svc, conns } = setup(mcpServer({ token: 'chave-manual' }).fetch);
    const r = await svc.connect(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: SERVER, accessToken: '  chave-manual  ', label: 'Minha conta' });
    expect(r).toEqual({ status: 'connected', tools: [{ name: 'generate_image', description: 'Generate an image' }, { name: 'job_status', description: null }], error: null, needsAuth: false });
    expect(conns.rows).toHaveLength(1);
    const row = conns.rows[0]!;
    expect([row.status, row.label, row.server_url, !!row.connected_at]).toEqual(['connected', 'Minha conta', SERVER, true]);
    expect(row.access_token).toMatch(/^enc:v2:/);
    expect(JSON.stringify(row)).not.toContain('chave-manual');
    expect(vault.decryptValue(row.access_token)).toBe('chave-manual');
    // reconectar sem token reaproveita o guardado (e continua uma linha só)
    expect((await svc.connect(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: SERVER })).status).toBe('connected');
    expect(conns.rows).toHaveLength(1);
  });

  it('trocar o endereço do servidor NÃO reaproveita o token guardado (nem o envia ao servidor novo) e limpa o OAuth antigo', async () => {
    const seen: (string | undefined)[] = [];
    const base = mcpServer({ token: 'chave-manual' });
    const s = setup((u, i) => { seen.push(((i.headers ?? {}) as any)['Authorization']); return base.fetch(u, i); });
    await s.svc.connect(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: SERVER, accessToken: 'chave-manual' });
    s.conns.rows[0]!.refresh_token = vault.encryptValue('RT');
    s.conns.rows[0]!.oauth_client_id = 'cid';
    seen.length = 0;
    const r = await s.svc.connect(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: 'https://outro.example.com/mcp' });
    expect(seen.every((a) => a === undefined)).toBe(true);
    expect(s.conns.rows[0]).toMatchObject({ access_token: null, refresh_token: null, oauth_client_id: null, server_url: 'https://outro.example.com/mcp' });
    expect(r.status).toBe('error');
    // com token novo digitado vale normalmente
    expect((await s.svc.connect(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: SERVER, accessToken: 'chave-manual' })).status).toBe('connected');
  });

  it('servidor que pede login → status error + needsAuth; erro de rede vira mensagem', async () => {
    const { svc, conns } = setup(mcpServer({ needAuth: true }).fetch);
    const r = await svc.connect(OWNER, { workspaceId: WS_A, provider: 'meta', serverUrl: SERVER });
    expect([r.status, r.needsAuth, r.error, r.tools]).toEqual(['error', true, 'O servidor MCP exige autenticação.', []]);
    expect(conns.rows[0]).toMatchObject({ status: 'error', last_error: 'O servidor MCP exige autenticação.', connected_at: null });
    const bad = await setup().svc.connect(OWNER, { workspaceId: WS_A, provider: 'canva', serverUrl: 'http://x.example.com/mcp' });
    expect([bad.status, bad.error]).toEqual(['error', 'Use um endereço https:// para o servidor MCP.']);
  });

  it('listar nunca devolve colunas de token; status por usuário só dos workspaces dele', async () => {
    const { svc, conns } = setup();
    await svc.connect(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: SERVER, accessToken: 'tok' });
    await conns.create({ data: { workspace_id: WS_B, provider: 'higgsfield', server_url: SERVER, status: 'connected' } });
    const list = await svc.list(WS_A);
    expect(Object.keys(list[0]!).sort()).toEqual(['connected_at', 'expires_at', 'id', 'label', 'last_error', 'provider', 'server_url', 'status', 'tools']);
    expect(await svc.statusForUser(OWNER, 'higgsfield')).toEqual([expect.objectContaining({ workspace_id: WS_A, status: 'connected' })]);
    expect(await svc.statusForUser(STRANGER, 'higgsfield')).toEqual([expect.objectContaining({ workspace_id: WS_B })]);
  });

  describe('login OAuth', () => {
    const AS = 'https://auth.higgsfield.ai';
    const oauth = (over: { noReg?: boolean; tokenFails?: boolean; tools401?: boolean } = {}): Handler => {
      const mcp = mcpServer({ token: 'AT' });
      return (url, init) => {
        if (url.includes('/.well-known/oauth-protected-resource')) return json({ resource: SERVER, authorization_servers: [AS] });
        if (url === `${AS}/.well-known/oauth-authorization-server`) return json({ authorization_endpoint: `${AS}/authorize`, token_endpoint: `${AS}/token`, ...(over.noReg ? {} : { registration_endpoint: `${AS}/register` }) });
        if (url === `${AS}/register`) return json({ client_id: 'cid', client_secret: 'csec' });
        if (url === `${AS}/token`) return over.tokenFails ? new Response('invalid_grant', { status: 400 }) : json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
        return mcp.fetch(url, init);
      };
    };

    it('início: URL com PKCE, redirect_uri da API, e segredos (verifier, client secret) cifrados no banco', async () => {
      const { svc, conns } = setup(oauth());
      const { authUrl } = await svc.oauthStart(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: SERVER, label: 'HF' });
      const u = new URL(authUrl);
      expect(u.origin + u.pathname).toBe(`${AS}/authorize`);
      expect(u.searchParams.get('redirect_uri')).toBe('http://api.test/api/public/mcp/callback');
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      const row = conns.rows[0]!;
      expect([row.status, row.oauth_client_id, row.oauth_redirect_uri, row.oauth_state, row.oauth_resource]).toEqual(['connecting', 'cid', 'http://api.test/api/public/mcp/callback', u.searchParams.get('state'), SERVER]);
      expect(row.oauth_code_verifier).toMatch(/^enc:v2:/);
      expect(row.oauth_client_secret).toMatch(/^enc:v2:/);
      const verifier = vault.decryptValue(row.oauth_code_verifier)!;
      expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
      expect(JSON.stringify(row)).not.toContain(verifier);
      expect(JSON.stringify(row)).not.toContain('csec');
    });

    it('servidor sem registro automático → mensagem do protótipo (e nada é gravado)', async () => {
      const { svc, conns } = setup(oauth({ noReg: true }));
      expect(await status(svc.oauthStart(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: SERVER }))).toBe('400:Este servidor MCP não aceita registro automático de aplicativo. Informe uma chave de acesso manualmente.');
      expect(conns.rows).toHaveLength(0);
    });

    it('callback: troca o code, testa as ferramentas, grava tokens cifrados e apaga state/verifier', async () => {
      const { svc, conns } = setup(oauth());
      const { authUrl } = await svc.oauthStart(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: SERVER });
      const state = new URL(authUrl).searchParams.get('state')!;
      expect(await svc.completeOAuth('CODE', state, null)).toEqual({ ok: true, message: 'Integração conectada com sucesso.' });
      const row = conns.rows[0]!;
      expect([row.status, row.oauth_state, row.oauth_code_verifier, !!row.expires_at, row.tools.length]).toEqual(['connected', null, null, true, 2]);
      expect(row.access_token).toMatch(/^enc:v2:/);
      expect(row.refresh_token).toMatch(/^enc:v2:/);
      expect(vault.decryptValue(row.access_token)).toBe('AT');
      expect(vault.decryptValue(row.refresh_token)).toBe('RT');
      // o state é de uso único
      expect((await svc.completeOAuth('CODE', state, null)).message).toBe('Sessão de conexão não encontrada ou expirada.');
    });

    it('callback: erro do provedor, retorno incompleto, state desconhecido/expirado e troca recusada', async () => {
      const { svc, conns } = setup(oauth());
      expect(await svc.completeOAuth(null, 'x', 'access_denied')).toEqual({ ok: false, message: 'O provedor recusou a autorização.' });
      expect(await svc.completeOAuth(null, 'x', null)).toEqual({ ok: false, message: 'Retorno de autenticação incompleto.' });
      expect(await svc.completeOAuth('c', null, null)).toEqual({ ok: false, message: 'Retorno de autenticação incompleto.' });
      expect(await svc.completeOAuth('c', 'inexistente', null)).toEqual({ ok: false, message: 'Sessão de conexão não encontrada ou expirada.' });
      const { authUrl } = await svc.oauthStart(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: SERVER });
      const state = new URL(authUrl).searchParams.get('state')!;
      conns.rows[0]!.updated_at = new Date(Date.now() - 31 * 60_000);
      expect((await svc.completeOAuth('c', state, null)).message).toBe('Sessão de conexão não encontrada ou expirada.');
      conns.rows[0]!.updated_at = new Date();
      const failing = setup(oauth({ tokenFails: true }));
      const s2 = new URL((await failing.svc.oauthStart(OWNER, { workspaceId: WS_A, provider: 'higgsfield', serverUrl: SERVER })).authUrl).searchParams.get('state')!;
      expect(await failing.svc.completeOAuth('c', s2, null)).toEqual({ ok: false, message: 'Não foi possível concluir a conexão. Tente novamente.' });
      expect(failing.conns.rows[0]).toMatchObject({ status: 'error', oauth_state: null, oauth_code_verifier: null });
    });

    it('página de retorno: mensagem escapada e postMessage só para a origem do web', () => {
      const html = oauthPage(false, '<img src=x onerror=alert(1)>', 'http://web.test');
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain('postMessage({type:"mcp-oauth",ok:false},"http://web.test")');
      expect(oauthPage(true, 'ok', 'http://web.test')).toContain('Integração conectada');
    });
  });

  describe('conexão viva e execução', () => {
    async function connected(extra: Record<string, unknown> = {}, over: ReturnType<typeof setup> = setup(mcpServer({ token: 'AT' }).fetch)) {
      await over.conns.create({
        data: { workspace_id: WS_A, provider: 'higgsfield', server_url: SERVER, status: 'connected', tools: [{ name: 'generate_image', description: 'img' }, { name: 'job_status' }],
          access_token: vault.encryptValue('AT'), refresh_token: vault.encryptValue('RT'), expires_at: new Date(Date.now() + 3_600_000), oauth_client_id: 'cid', oauth_token_endpoint: 'https://auth.higgsfield.ai/token', oauth_resource: SERVER, ...extra },
      });
      return over;
    }

    it('devolve a conexão com os tokens decifrados (uso interno)', async () => {
      const { svc } = await connected();
      const c = await svc.getLiveConnection(WS_A, 'higgsfield');
      expect([c!.status, c!.access_token, c!.refresh_token, c!.tools.length]).toEqual(['connected', 'AT', 'RT', 2]);
      expect(await svc.getLiveConnection(WS_A, 'meta')).toBeNull();
    });

    it('token perto de expirar: renova com o refresh_token e grava cifrado; falha → expired; sem refresh → expired', async () => {
      let refreshOk = true;
      const h: Handler = (url, init) => (url.endsWith('/token') ? (refreshOk ? json({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }) : new Response('x', { status: 400 })) : mcpServer().fetch(url, init));
      const s = await connected({ expires_at: new Date(Date.now() + 10_000) }, setup(h));
      const c = await s.svc.getLiveConnection(WS_A, 'higgsfield');
      expect([c!.status, c!.access_token]).toEqual(['connected', 'AT2']);
      expect(vault.decryptValue(s.conns.rows[0]!.access_token)).toBe('AT2');
      expect(vault.decryptValue(s.conns.rows[0]!.refresh_token)).toBe('RT2');
      refreshOk = false;
      s.conns.rows[0]!.expires_at = new Date(Date.now() + 1000);
      expect((await s.svc.getLiveConnection(WS_A, 'higgsfield'))!.status).toBe('expired');
      expect(s.conns.rows[0]!.status).toBe('expired');
      const noRefresh = await connected({ expires_at: new Date(Date.now() + 1000), refresh_token: null }, setup());
      expect((await noRefresh.svc.getLiveConnection(WS_A, 'higgsfield'))!.status).toBe('expired');
    });

    it('sem conexão própria ativa usa a da empresa-agência (herança), 1 nível', async () => {
      const s = setup(mcpServer({ token: 'AT' }).fetch, { [WS_B]: WS_A });
      await connected({}, s);
      const c = await s.svc.getLiveConnection(WS_B, 'higgsfield');
      expect([c!.workspace_id, c!.status]).toEqual([WS_A, 'connected']);
      const none = setup(mcpServer().fetch);
      expect(await none.svc.getLiveConnection(WS_B, 'higgsfield')).toBeNull();
    });

    it('mcpRun: viewer não executa; sem conexão → mensagem; escolhe a ferramenta por nome ou palavra-chave e usa o token decifrado', async () => {
      const server = mcpServer({ token: 'AT', call: () => ({ content: [{ type: 'text', text: 'feito https://cdn/x.png' }] }) });
      const s = await connected({}, setup(server.fetch));
      expect(await status(s.svc.run(VIEWER, { workspaceId: WS_A, provider: 'higgsfield', keywords: [], args: {} }))).toBe('403:Seu perfil não tem permissão para esta ação.');
      expect(await status(s.svc.run(OWNER, { workspaceId: WS_A, provider: 'meta', keywords: [], args: {} }))).toBe('400:Nenhuma conexão MCP ativa para este provedor.');
      const byKw = await s.svc.run(MARKETING, { workspaceId: WS_A, provider: 'higgsfield', keywords: ['image'], args: { prompt: 'p' } });
      expect(byKw).toEqual({ tool: 'generate_image', text: 'feito https://cdn/x.png', mediaUrl: 'https://cdn/x.png', structured: null });
      const byName = await s.svc.run(MARKETING, { workspaceId: WS_A, provider: 'higgsfield', keywords: [], toolName: 'job_status', args: { jobId: '1' } });
      expect(byName.tool).toBe('job_status');
      expect(server.calls.at(-1)!.headers['Authorization']).toBe('Bearer AT');
      const empty = await connected({ tools: [] }, setup());
      expect(await status(empty.svc.run(OWNER, { workspaceId: WS_A, provider: 'higgsfield', keywords: ['x'], args: {} }))).toBe('400:O servidor MCP não expôs nenhuma ferramenta utilizável.');
    });

    it('desconectar apaga a linha (token junto)', async () => {
      const s = await connected();
      expect(await s.svc.disconnect(OWNER, WS_A, 'higgsfield')).toEqual({ ok: true });
      expect(s.conns.rows).toHaveLength(0);
    });
  });
});
