import { createHash } from 'node:crypto';
jest.setTimeout(60_000);

import { WorkspaceAccessService } from '../../access/access.service';
import { AssetsService } from '../../media/assets.service';
import { mediaWorld, memMembers, sampleImage, status, ADMIN, MARKETING, OWNER, STRANGER, VIEWER, WS_A, WS_B } from '../../media/__tests__/mem';
import { CredentialStore } from '../../vault/credential-store';
import { VaultService } from '../../vault/vault.service';
import { CanvaService, CANVA_API } from '../canva.service';

class MemStore extends CredentialStore {
  rows = new Map<string, string>();
  private k = (ws: string | null, key: string) => `${ws ?? '*'}|${key}`;
  async read(ws: string | null, key: string) { const v = this.rows.get(this.k(ws, key)); return v === undefined ? null : { value: v, updated_at: new Date() }; }
  async upsert(ws: string | null, key: string, value: string) { this.rows.set(this.k(ws, key), value); }
  async delete(ws: string | null, key: string) { this.rows.delete(this.k(ws, key)); }
  async list() { return []; }
}

const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
type Call = { url: string; method: string; headers: Record<string, string>; body: any };

async function setup(inherit: Record<string, string> = {}) {
  const w = mediaWorld();
  const store = new MemStore();
  const vault = new VaultService(store, { CREDENTIALS_ENCRYPTION_KEY: 'k'.repeat(40), NODE_ENV: 'test' });
  const calls: Call[] = [];
  const routes: { match: (c: Call) => boolean; reply: (c: Call) => Response | Promise<Response> }[] = [];
  const png = new Uint8Array(await sampleImage(w.images, 64, 64, true));
  const http = async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    let body: any = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* form */ } }
    const call: Call = { url, method: init.method ?? 'GET', headers, body };
    calls.push(call);
    const r = routes.find((x) => x.match(call));
    if (r) return r.reply(call);
    if (url.startsWith('https://export.canva.test/')) return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response('{}', { status: 404 });
  };
  const keys: any = { inheritSource: async (ws: string) => inherit[ws] ?? null };
  const env = { PUBLIC_URL: 'http://api.test', APP_URL: 'http://web.test', NODE_ENV: 'test' } as any;
  const assets = new AssetsService(w.prisma, w.files, w.images, http as any, env);
  const svc = new CanvaService(w.prisma, new WorkspaceAccessService({ workspace_members: memMembers } as any), vault, keys, assets, http as any, env);
  svc.sleep = async () => undefined;
  const route = (match: (c: Call) => boolean, reply: (c: Call) => Response | Promise<Response>) => routes.unshift({ match, reply });
  const tokens = (over: Record<string, unknown> = {}) => JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_at: Date.now() + 3_600_000, name: 'Ana', email: 'ana@x.com', ...over });
  const connect = async (ws = WS_A, over: Record<string, unknown> = {}) => {
    await vault.set(ws, { CANVA_CLIENT_ID: 'abcd1234', CANVA_CLIENT_SECRET: 'sec', CANVA_TOKENS: tokens(over) });
  };
  return { w, svc, vault, store, calls, route, connect, tokens };
}

describe('CanvaService — app, status e autorização', () => {
  it('só dono/admin salva o app e conecta/desconecta; credenciais ficam CIFRADAS no cofre', async () => {
    const { svc, store, vault } = await setup();
    expect(await status(svc.saveApp(MARKETING, WS_A, 'abcd1234', 'segredo'))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(svc.oauthStart(VIEWER, WS_A))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(svc.disconnect(MARKETING, WS_A))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(svc.saveApp(STRANGER, WS_A, 'abcd1234', 'x'))).toBe('403:Você não tem acesso a esta empresa.');
    expect(await svc.saveApp(ADMIN, WS_A, ' abcd1234 ', ' segredo ')).toEqual({ ok: true });
    for (const v of store.rows.values()) expect(v).toMatch(/^enc:v2:/);
    expect(await vault.get(WS_A, 'CANVA_CLIENT_ID')).toBe('abcd1234');
    expect(await vault.get(WS_A, 'CANVA_CLIENT_SECRET')).toBe('segredo');
    // sem segredo novo, o antigo fica
    await svc.saveApp(OWNER, WS_A, 'novoid123', null);
    expect(await vault.get(WS_A, 'CANVA_CLIENT_ID')).toBe('novoid123');
    expect(await vault.get(WS_A, 'CANVA_CLIENT_SECRET')).toBe('segredo');
  });

  it('status: sem app; app salvo (dica do id); conectado; herdado da agência; credenciais globais valem como padrão', async () => {
    const s = await setup({ [WS_B]: WS_A });
    expect(await s.svc.status(VIEWER, WS_A)).toEqual({ appSaved: false, clientIdHint: null, connected: false, inherited: false, name: null, email: null });
    await s.svc.saveApp(OWNER, WS_A, 'abcd1234', 'sec');
    expect(await s.svc.status(VIEWER, WS_A)).toMatchObject({ appSaved: true, clientIdHint: 'abcd••••', connected: false });
    await s.vault.set(WS_A, { CANVA_TOKENS: s.tokens() });
    expect(await s.svc.status(VIEWER, WS_A)).toMatchObject({ connected: true, inherited: false, name: 'Ana', email: 'ana@x.com' });
    // WS_B herda a conexão de WS_A
    expect(await s.svc.status(STRANGER, WS_B)).toMatchObject({ connected: true, inherited: true, name: 'Ana' });
    // global
    const g = await setup();
    await g.vault.set(null, { CANVA_CLIENT_ID: 'global-id', CANVA_CLIENT_SECRET: 'gs' });
    expect(await g.svc.status(OWNER, WS_A)).toMatchObject({ appSaved: true, clientIdHint: 'glob••••' });
    expect(await status(g.svc.status(STRANGER, WS_A))).toBe('403:Você não tem acesso a esta empresa.');
  });
});

describe('CanvaService — login OAuth (PKCE)', () => {
  it('início: precisa do app salvo; URL com PKCE S256, redirect da API e state do workspace; guarda state+verifier no cofre', async () => {
    const s = await setup();
    expect(await status(s.svc.oauthStart(OWNER, WS_A))).toBe('400:Salve o Client ID e o Client secret do app Canva antes de entrar.');
    await s.svc.saveApp(OWNER, WS_A, 'abcd1234', 'sec');
    const { authUrl } = await s.svc.oauthStart(OWNER, WS_A);
    const u = new URL(authUrl);
    expect(u.origin + u.pathname).toBe('https://www.canva.com/api/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'abcd1234', redirect_uri: 'http://api.test/api/public/canva/oauth/callback', code_challenge_method: 'S256',
      scope: 'asset:read asset:write design:content:read design:content:write design:meta:read profile:read',
    });
    expect(u.searchParams.get('state')!.startsWith(`${WS_A}.`)).toBe(true);
    const saved = JSON.parse((await s.vault.get(WS_A, 'CANVA_OAUTH'))!);
    expect(saved.state).toBe(u.searchParams.get('state'));
    expect(createHash('sha256').update(saved.verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')).toBe(u.searchParams.get('code_challenge'));
    expect(s.store.rows.get(`${WS_A}|CANVA_OAUTH`)).toMatch(/^enc:v2:/);
  });

  it('callback: valida o state, troca o code (Basic + verifier), grava tokens e perfil, apaga o state', async () => {
    const s = await setup();
    await s.svc.saveApp(OWNER, WS_A, 'abcd1234', 'sec');
    const state = new URL((await s.svc.oauthStart(OWNER, WS_A)).authUrl).searchParams.get('state')!;
    s.route((c) => c.url === `${CANVA_API}/oauth/token`, () => jsonRes({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 14400 }));
    s.route((c) => c.url === `${CANVA_API}/users/me/profile`, () => jsonRes({ profile: { display_name: 'Ana Souza', email: 'ana@x.com' } }));
    expect(await s.svc.finishOAuth(state, 'CODE')).toBe(WS_A);
    const tokenCall = s.calls.find((c) => c.url === `${CANVA_API}/oauth/token`)!;
    expect(tokenCall.headers['Authorization']).toBe(`Basic ${Buffer.from('abcd1234:sec').toString('base64')}`);
    const form = new URLSearchParams(tokenCall.body);
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: 'authorization_code', code: 'CODE', redirect_uri: 'http://api.test/api/public/canva/oauth/callback' });
    expect(form.get('code_verifier')!.length).toBeGreaterThan(40);
    const t = JSON.parse((await s.vault.get(WS_A, 'CANVA_TOKENS'))!);
    expect([t.access_token, t.refresh_token, t.name, t.email]).toEqual(['AT1', 'RT1', 'Ana Souza', 'ana@x.com']);
    expect(await s.vault.get(WS_A, 'CANVA_OAUTH')).toBeNull();
    // o state é de uso único
    expect(await status(s.svc.finishOAuth(state, 'CODE'))).toBe('400:Sessão de login expirada. Tente entrar de novo.');
  });

  it('callback: state mal formado, outro workspace, expirado, recusado pelo Canva', async () => {
    const s = await setup();
    await s.svc.saveApp(OWNER, WS_A, 'abcd1234', 'sec');
    expect(await status(s.svc.finishOAuth('lixo.xyz', 'c'))).toBe('400:Retorno do Canva inválido.');
    expect(await status(s.svc.finishOAuth(`${WS_A}.forjado`, 'c'))).toBe('400:Sessão de login expirada. Tente entrar de novo.');
    const state = new URL((await s.svc.oauthStart(OWNER, WS_A)).authUrl).searchParams.get('state')!;
    await s.vault.set(WS_A, { CANVA_OAUTH: JSON.stringify({ state, verifier: 'v', at: Date.now() - 21 * 60_000 }) });
    expect(await status(s.svc.finishOAuth(state, 'c'))).toBe('400:Sessão de login expirada. Tente entrar de novo.');
    const st2 = new URL((await s.svc.oauthStart(OWNER, WS_A)).authUrl).searchParams.get('state')!;
    s.route((c) => c.url === `${CANVA_API}/oauth/token`, () => jsonRes({ error_description: 'code expired' }, 400));
    expect(await status(s.svc.finishOAuth(st2, 'c'))).toBe('400:code expired');
    // state de WS_A não vale para WS_B (o prefixo manda no cofre consultado)
    expect(await status(s.svc.finishOAuth(`${WS_B}.${st2.split('.')[1]}`, 'c'))).toBe('400:Sessão de login expirada. Tente entrar de novo.');
  });

  it('backUrl devolve ao /integrations do web com ?canva=ok|error&msg=', async () => {
    const { svc } = await setup();
    expect(svc.backUrl('ok')).toBe('http://web.test/integrations?canva=ok');
    const u = new URL(svc.backUrl('error', 'x'.repeat(300)));
    expect([u.searchParams.get('canva'), u.searchParams.get('msg')!.length]).toEqual(['error', 200]);
  });
});

describe('CanvaService — API do Canva', () => {
  it('sem conexão → mensagem; token perto de expirar é renovado (refresh de uso único) e regravado', async () => {
    const s = await setup();
    expect(await status(s.svc.test(OWNER, WS_A))).toBe('400:Canva não está conectado nesta empresa. Entre com Canva em Integrações.');
    await s.connect(WS_A, { expires_at: Date.now() + 30_000 });
    s.route((c) => c.url === `${CANVA_API}/oauth/token`, () => jsonRes({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 14400 }));
    s.route((c) => c.url === `${CANVA_API}/users/me/profile`, (c) => jsonRes({ profile: { display_name: c.headers['Authorization'] === 'Bearer AT2' ? 'Ana' : 'sem renovar' } }));
    expect(await s.svc.test(VIEWER, WS_A)).toEqual({ name: 'Ana' });
    expect(new URLSearchParams(s.calls[0]!.body).get('grant_type')).toBe('refresh_token');
    const t = JSON.parse((await s.vault.get(WS_A, 'CANVA_TOKENS'))!);
    expect([t.access_token, t.refresh_token, t.name]).toEqual(['AT2', 'RT2', 'Ana']);
  });

  it('refresh recusado ou API devolvendo 401 desconecta e pede novo login; erro da API vira "Canva: …"', async () => {
    const s = await setup();
    await s.connect(WS_A, { expires_at: Date.now() + 1000 });
    s.route((c) => c.url === `${CANVA_API}/oauth/token`, () => jsonRes({ error: 'invalid_grant' }, 400));
    expect(await status(s.svc.test(OWNER, WS_A))).toBe('400:A conexão com o Canva expirou ou foi revogada. Entre com Canva de novo em Integrações.');
    expect(await s.vault.get(WS_A, 'CANVA_TOKENS')).toBeNull();
    await s.connect(WS_A);
    s.route((c) => c.url === `${CANVA_API}/users/me/profile`, () => jsonRes({ message: 'nope' }, 401));
    expect(await status(s.svc.test(OWNER, WS_A))).toBe('400:O Canva recusou o acesso (login revogado). Entre com Canva de novo em Integrações.');
    expect(await s.vault.get(WS_A, 'CANVA_TOKENS')).toBeNull();
    await s.connect(WS_A);
    s.route((c) => c.url === `${CANVA_API}/users/me/profile`, () => jsonRes({ message: 'Rate limited' }, 429));
    expect(await status(s.svc.test(OWNER, WS_A))).toBe('400:Canva: Rate limited');
  });

  it('desconectar apaga tokens e login em andamento', async () => {
    const s = await setup();
    await s.connect();
    await s.vault.set(WS_A, { CANVA_OAUTH: '{}' });
    expect(await s.svc.disconnect(OWNER, WS_A)).toEqual({ ok: true });
    expect([await s.vault.get(WS_A, 'CANVA_TOKENS'), await s.vault.get(WS_A, 'CANVA_OAUTH')]).toEqual([null, null]);
    expect(await s.vault.get(WS_A, 'CANVA_CLIENT_ID')).toBe('abcd1234'); // o app continua salvo
  });

  it('enviar mídia: viewer não; mídia de outro workspace → 404; baixa a mídia, sobe ao Canva e acompanha o job até o fim', async () => {
    const s = await setup();
    await s.connect();
    const img = await s.w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'other', source: 'upload', bytes: await sampleImage(s.w.images, 100, 100), title: 'Chopp gelado' });
    const foreign = await s.w.assets.ingest({ workspaceId: WS_B, kind: 'image', targetFormat: 'other', source: 'upload', bytes: await sampleImage(s.w.images, 50, 50), title: 'Alheia' });
    expect(await status(s.svc.sendAsset(VIEWER, WS_A, img.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(s.svc.sendAsset(OWNER, WS_A, foreign.id))).toBe('404:Mídia não encontrada.');
    let polls = 0;
    s.route((c) => c.url === `${CANVA_API}/asset-uploads` && c.method === 'POST', () => jsonRes({ job: { id: 'job1', status: 'in_progress' } }));
    s.route((c) => c.url === `${CANVA_API}/asset-uploads/job1`, () => jsonRes({ job: { id: 'job1', status: ++polls < 2 ? 'in_progress' : 'success', asset: { id: 'AST1' } } }));
    expect(await s.svc.sendAsset(MARKETING, WS_A, img.id)).toEqual({ assetId: 'AST1' });
    const up = s.calls.find((c) => c.url === `${CANVA_API}/asset-uploads` && c.method === 'POST')!;
    expect(up.headers['Content-Type']).toBe('application/octet-stream');
    expect(up.headers['Authorization']).toBe('Bearer AT');
    expect(JSON.parse(up.headers['Asset-Upload-Metadata'])).toEqual({ name_base64: Buffer.from('Chopp gelado').toString('base64') });
    expect(polls).toBe(2);
    // job que falha
    s.route((c) => c.url === `${CANVA_API}/asset-uploads/job1`, () => jsonRes({ job: { status: 'failed', error: { message: 'arquivo inválido' } } }));
    expect(await status(s.svc.sendAsset(MARKETING, WS_A, img.id))).toBe('400:Canva: arquivo inválido');
  });

  it('criar design a partir do briefing: tamanhos, título cortado em 250, asset opcional; devolve designId + editUrl', async () => {
    const s = await setup();
    await s.connect();
    s.route((c) => c.url === `${CANVA_API}/designs` && c.method === 'POST', () => jsonRes({ design: { id: 'D1', urls: { edit_url: 'https://www.canva.com/design/D1/edit' } } }));
    expect(await status(s.svc.createFromBrief(VIEWER, WS_A, { title: 'x' }))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await s.svc.createFromBrief(MARKETING, WS_A, { title: 'T'.repeat(300), size: 'story' })).toEqual({ designId: 'D1', editUrl: 'https://www.canva.com/design/D1/edit' });
    const body = s.calls.at(-1)!.body;
    expect([body.design_type, body.title.length, body.asset_id]).toEqual([{ type: 'custom', width: 1080, height: 1920 }, 250, undefined]);
    await s.svc.createFromBrief(MARKETING, WS_A, { title: 'Oi', size: 'landscape' });
    expect(s.calls.at(-1)!.body.design_type).toMatchObject({ width: 1200, height: 628 });
    await s.svc.createFromBrief(MARKETING, WS_A, { title: 'Oi' });
    expect(s.calls.at(-1)!.body.design_type).toMatchObject({ width: 1080, height: 1350 }); // padrão: portrait
    // com mídia
    const img = await s.w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'other', source: 'upload', bytes: await sampleImage(s.w.images, 80, 80), title: 'M' });
    s.route((c) => c.url === `${CANVA_API}/asset-uploads` && c.method === 'POST', () => jsonRes({ job: { id: 'j', status: 'success', asset: { id: 'AST9' } } }));
    await s.svc.createFromBrief(MARKETING, WS_A, { title: 'Com mídia', assetId: img.id });
    expect(s.calls.at(-1)!.body.asset_id).toBe('AST9');
    expect(s.calls.at(-1)!.body.title).toBe('Com mídia');
  });

  it('listar designs: ordena por relevância quando há busca; mapeia id/título/miniatura', async () => {
    const s = await setup();
    await s.connect();
    s.route((c) => c.url.startsWith(`${CANVA_API}/designs?`), () => jsonRes({ items: [{ id: 'A', title: 'Promo', thumbnail: { url: 'https://t/1.png' } }, { id: 'B' }] }));
    expect(await s.svc.listDesigns(VIEWER, WS_A, 'promo')).toEqual([{ id: 'A', title: 'Promo', thumbnail: 'https://t/1.png' }, { id: 'B', title: 'Sem título', thumbnail: null }]);
    expect(s.calls.at(-1)!.url).toBe(`${CANVA_API}/designs?ownership=any&sort_by=relevance&query=promo`);
    await s.svc.listDesigns(VIEWER, WS_A, null);
    expect(s.calls.at(-1)!.url).toBe(`${CANVA_API}/designs?ownership=any&sort_by=modified_descending`);
  });

  it('importar design: aceita link ou id, confere marca/campanha, exporta, baixa e grava na biblioteca (source canva)', async () => {
    const s = await setup();
    await s.connect();
    const brand = await s.w.t['brands']!.create({ data: { workspace_id: WS_A, name: 'Bar' } });
    const other = await s.w.t['brands']!.create({ data: { workspace_id: WS_B, name: 'Alheia' } });
    let polls = 0;
    s.route((c) => c.url === `${CANVA_API}/exports` && c.method === 'POST', () => jsonRes({ job: { id: 'E1', status: 'in_progress' } }));
    s.route((c) => c.url === `${CANVA_API}/exports/E1`, () => jsonRes({ job: { status: ++polls < 2 ? 'in_progress' : 'success', urls: ['https://export.canva.test/a.png', 'https://export.canva.test/b.png'] } }));
    expect(await status(s.svc.importDesign(VIEWER, WS_A, { designId: 'DAF1' }))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(s.svc.importDesign(OWNER, WS_A, { designId: '###' }))).toBe('400:Endereço ou id do design inválido.');
    expect(await status(s.svc.importDesign(OWNER, WS_A, { designId: 'DAF1', brandId: other.id }))).toBe('404:Marca não encontrada.');
    expect(await status(s.svc.importDesign(OWNER, WS_A, { designId: 'DAF1', campaignId: '00000000-0000-4000-8000-000000000001' }))).toBe('404:Campanha não encontrada.');
    const a = await s.svc.importDesign(MARKETING, WS_A, { designId: 'https://www.canva.com/design/DAFxyz_1-2/abc/edit', title: 'Promo', format: 'jpg', brandId: brand.id });
    expect(s.calls.find((c) => c.url === `${CANVA_API}/exports` && c.method === 'POST')!.body).toEqual({ design_id: 'DAFxyz_1-2', format: { type: 'jpg', quality: 92 } });
    const rows = s.w.t['media_assets']!.rows;
    expect(rows.map((r) => [r.title, r.source, r.provider, r.prompt, r.brand_id, r.created_by, r.target_format])).toEqual([
      ['Promo (1)', 'canva', 'canva', 'canva_design_id:DAFxyz_1-2', brand.id, MARKETING, 'other'],
      ['Promo (2)', 'canva', 'canva', 'canva_design_id:DAFxyz_1-2', brand.id, MARKETING, 'other'],
    ]);
    expect(a.id).toBe(rows[0]!.id);
    // export sem arquivos
    s.route((c) => c.url === `${CANVA_API}/exports/E1`, () => jsonRes({ job: { status: 'success', urls: [] } }));
    expect(await status(s.svc.importDesign(OWNER, WS_A, { designId: 'DAF2', format: 'mp4' }))).toBe('400:O Canva não devolveu o arquivo exportado.');
    expect(s.calls.filter((c) => c.url === `${CANVA_API}/exports` && c.method === 'POST').at(-1)!.body.format).toEqual({ type: 'mp4' });
  });

  it('o download do arquivo exportado só vai para https público (SSRF)', async () => {
    const s = await setup();
    await s.connect();
    s.route((c) => c.url === `${CANVA_API}/exports` && c.method === 'POST', () => jsonRes({ job: { status: 'success', urls: ['http://169.254.169.254/latest'] } }));
    expect(await status(s.svc.importDesign(OWNER, WS_A, { designId: 'DAF3' }))).toContain('400');
    expect(s.calls.some((c) => c.url.startsWith('http://169.254'))).toBe(false);
  });
});
