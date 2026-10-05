import { UnauthorizedException } from '@nestjs/common';
import { CronAuthService } from '../../scheduler/cron-auth.service';
import { SchedulerService } from '../../scheduler/scheduler.service';
import { AdsCronService } from '../ads-cron.service';
import { AdsPublicController } from '../ads-public.controller';
import { AdsResourcesController } from '../ads.controller';
import { adsWorld, ADMIN, MARKETING, OWNER, uid, WS_A } from './harness';

const json = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st });
const reply = () => {
  const r: any = { code: 0, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.code = c; return r; };
  r.header = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.send = () => r;
  return r;
};

describe('OAuth da Meta (retorno)', () => {
  const setup = () => {
    const w = adsWorld();
    const ctl = new AdsPublicController(w.oauth, w.channels, null as any, null as any);
    return { w, ctl };
  };
  const loc = (r: any) => new URL(r.headers.Location);

  it('buildLoginUrl: state aleatório preso ao usuário, redirect_uri = PUBLIC_URL, 14 escopos', async () => {
    const { w } = setup();
    const url = new URL(await w.oauth.buildLoginUrl(WS_A, OWNER));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v24.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('app123');
    expect(url.searchParams.get('redirect_uri')).toBe('http://api.test/api/public/meta/oauth/callback');
    expect(url.searchParams.get('scope')!.split(',')).toHaveLength(14);
    const st = url.searchParams.get('state')!;
    expect(st).not.toContain('.');
    expect(await w.states.consume('meta', st)).toEqual({ workspaceId: WS_A, userId: OWNER });
  });

  it('sem app salvo: "Salve primeiro o ID e a chave secreta do app da Meta." (e nenhum state é criado)', async () => {
    const { w } = setup();
    w.graphClient.config.mockResolvedValue({ appId: null, appSecret: null, token: null });
    await expect(w.oauth.buildLoginUrl(WS_A, OWNER)).rejects.toThrow('Salve primeiro o ID e a chave secreta do app da Meta.');
    expect(w.t['oauth_states']!.rows).toHaveLength(0);
  });

  it('callback feliz: troca code → token curto → longo, grava cifrado com a expiração e redireciona com ?meta=conectado', async () => {
    const { w, ctl } = setup();
    const st = new URL(await w.oauth.buildLoginUrl(WS_A, ADMIN)).searchParams.get('state')!;
    w.http.mockResolvedValueOnce(json({ access_token: 'SHORT' })).mockResolvedValueOnce(json({ access_token: 'LONG-TOKEN', expires_in: 5184000 }));
    const r = reply();
    await ctl.metaCallback('codigo-x', st, undefined, undefined, r);
    expect(r.code).toBe(302);
    expect(loc(r).origin + loc(r).pathname).toBe('http://web.test/integrations');
    expect(loc(r).searchParams.get('meta')).toBe('conectado');
    expect(await w.vault.get(WS_A, 'META_SYSTEM_USER_TOKEN')).toBe('LONG-TOKEN');
    expect(await w.vault.get(WS_A, 'META_TOKEN_SOURCE')).toBe('facebook_login');
    const exp = new Date((await w.vault.get(WS_A, 'META_TOKEN_EXPIRES_AT'))!).getTime();
    expect(exp).toBeGreaterThan(Date.now() + 59 * 86400e3);
    expect([...w.store.rows.values()].join('')).not.toContain('LONG-TOKEN');
    const [a, b] = w.http.mock.calls.map((c) => new URL(c[0]));
    expect(a.searchParams.get('code')).toBe('codigo-x');
    expect(a.searchParams.get('redirect_uri')).toBe('http://api.test/api/public/meta/oauth/callback');
    expect(b.searchParams.get('grant_type')).toBe('fb_exchange_token');
    expect(b.searchParams.get('fb_exchange_token')).toBe('SHORT');
  });

  it('state repetido, desconhecido ou forjado = ?meta_erro (nada gravado); Host/origin do pedido não influenciam o destino', async () => {
    const { w, ctl } = setup();
    const st = new URL(await w.oauth.buildLoginUrl(WS_A, OWNER)).searchParams.get('state')!;
    w.http.mockResolvedValueOnce(json({ access_token: 'S' })).mockResolvedValueOnce(json({ access_token: 'L' }));
    await ctl.metaCallback('c', st, undefined, undefined, reply());
    const again = reply();
    await ctl.metaCallback('c', st, undefined, undefined, again);
    expect(loc(again).searchParams.get('meta_erro')).toBe('Assinatura do retorno inválida.');
    const forged = reply();
    await ctl.metaCallback('c', 'eyJ3IjoiMSJ9.assinatura', undefined, undefined, forged);
    expect(loc(forged).searchParams.get('meta_erro')).toBe('Assinatura do retorno inválida.');
    expect(loc(forged).origin).toBe('http://web.test');
    expect(w.http).toHaveBeenCalledTimes(2);
  });

  it('state de quem não é mais owner|admin é recusado; erro/retorno incompleto do Facebook vira ?meta_erro', async () => {
    const { w, ctl } = setup();
    const st = await w.states.issue('meta', WS_A, MARKETING);
    const r = reply();
    await ctl.metaCallback('c', st, undefined, undefined, r);
    expect(loc(r).searchParams.get('meta_erro')).toBe('Só o dono ou um administrador conecta a Meta.');
    expect(w.http).not.toHaveBeenCalled();
    const e = reply();
    await ctl.metaCallback(undefined, undefined, 'access_denied', 'Usuário negou', e);
    expect(loc(e).searchParams.get('meta_erro')).toBe('Usuário negou');
    const i = reply();
    await ctl.metaCallback(undefined, 'x', undefined, undefined, i);
    expect(loc(i).searchParams.get('meta_erro')).toBe('retorno_incompleto');
  });

  it('o Facebook recusa a troca: mensagem da Meta vai para ?meta_erro', async () => {
    const { w, ctl } = setup();
    const st = await w.states.issue('meta', WS_A, OWNER);
    w.http.mockResolvedValueOnce(json({ error: { message: 'Código inválido' } }, 400));
    const r = reply();
    await ctl.metaCallback('c', st, undefined, undefined, r);
    expect(loc(r).searchParams.get('meta_erro')).toBe('Código inválido');
  });

  it('listAssets / saveAssets / saveApp / tokenInfo', async () => {
    const { w } = setup();
    w.respond((path) => (path === '/me/adaccounts' ? { data: [{ id: 'act_1', name: 'Conta', account_status: 1, currency: 'BRL' }] } : path === '/me/accounts' ? { data: [{ id: '22', name: 'Pág', instagram_business_account: { id: '33', username: 'ig' } }, { id: '23', name: 'Sem IG' }] } : undefined));
    expect(await w.oauth.listAssets(WS_A)).toEqual({
      adAccounts: [{ id: 'act_1', name: 'Conta', active: true, currency: 'BRL' }],
      pages: [{ id: '22', name: 'Pág', instagramId: '33', instagramUsername: 'ig' }, { id: '23', name: 'Sem IG', instagramId: null, instagramUsername: null }],
    });
    await w.oauth.saveAssets(WS_A, { adAccountId: 'act_1', pageId: '22', instagramId: '33' });
    await w.oauth.saveApp(WS_A, 'app9999', 'segredo-1234');
    expect(await w.vault.get(WS_A, 'META_PAGE_ID')).toBe('22');
    expect(await w.vault.get(WS_A, 'META_APP_SECRET')).toBe('segredo-1234');
    expect(await w.oauth.tokenInfo(WS_A)).toEqual({ expiresAt: null, source: 'system_user' });
  });
});

describe('OAuth de Google/TikTok (retorno público)', () => {
  const loc = (r: any) => new URL(r.headers.Location);
  it('canal inválido, erro do provedor, retorno incompleto, sucesso e state reutilizado', async () => {
    const w = adsWorld();
    const ctl = new AdsPublicController(w.oauth, w.channels, null as any, null as any);
    await w.vault.set(WS_A, { GOOGLE_ADS_CLIENT_ID: 'cid', GOOGLE_ADS_CLIENT_SECRET: 'sec' });
    const call = async (ch: string, q: Record<string, string>) => { const r = reply(); await ctl.adsCallback(ch, q, r); return loc(r).searchParams; };
    expect((await call('facebook', {})).get('ads_erro')).toBe('canal_invalido');
    expect((await call('google', { error: 'access_denied' })).get('ads_erro')).toBe('access_denied');
    expect((await call('google', { state: 'x' })).get('ads_erro')).toBe('retorno_incompleto');
    expect((await call('tiktok', { code: 'so-google-usa-code', state: 'x' })).get('ads_erro')).toBe('retorno_incompleto');   // TikTok usa auth_code
    const st = new URL((await w.channels.loginUrl(OWNER, WS_A, 'google')).url).searchParams.get('state')!;
    w.http.mockResolvedValueOnce(json({ refresh_token: 'RT' }));
    expect((await call('google', { code: 'c', state: st })).get('ads')).toBe('google');
    expect((await call('google', { code: 'c', state: st })).get('ads_erro')).toBe('Assinatura do retorno inválida.');
    expect((await call('google', { code: 'c', state: 'a'.repeat(43) })).get('ads_erro')).toBe('Assinatura do retorno inválida.');
  });
});

describe('cron do gestor de tráfego', () => {
  it('rota: sem segredo = 401; com CRM_CRON_SECRET ou cron_tokens.ads = ok; heartbeat ads-sync / ads-rules; erro grava heartbeat de erro', async () => {
    const w = adsWorld();
    const auth = new CronAuthService(w.prisma, { CRM_CRON_SECRET: 'segredo-cron' } as any);
    const cron: any = { run: jest.fn(async (t?: string) => ({ sync: [], ...(t === 'rules' ? { rules: [] } : {}) })) };
    cron.runExclusive = jest.fn(async (t?: string) => ({ value: await cron.run(t) }));
    const ctl = new AdsPublicController(w.oauth, w.channels, cron, auth);
    await expect(ctl.cronAds(undefined, {})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl.cronAds('errado', {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(cron.run).not.toHaveBeenCalled();
    expect(await ctl.cronAds('segredo-cron', {})).toEqual({ sync: [] });
    expect(await ctl.cronAds('segredo-cron', { task: 'rules' })).toEqual({ sync: [], rules: [] });
    w.t['cron_tokens']!.rows.push({ name: 'ads', token: 'token-do-banco' }, { name: 'instagram', token: 'outro' });
    expect(await ctl.cronAds('token-do-banco', { task: 'sync' })).toEqual({ sync: [] });
    await expect(ctl.cronAds('outro', {})).rejects.toBeInstanceOf(UnauthorizedException);   // token de outra rota não vale
    const hb = Object.fromEntries(w.t['cron_heartbeats']!.rows.map((r) => [r.name, r.last_status]));
    expect(hb).toEqual({ 'ads-sync': 'ok', 'ads-rules': 'ok' });
    cron.run.mockRejectedValueOnce(new Error('boom'));
    await expect(ctl.cronAds('segredo-cron', {})).rejects.toThrow('boom');
    expect(w.t['cron_heartbeats']!.rows.find((r) => r.name === 'ads-sync')).toMatchObject({ last_status: 'error', last_detail: 'boom' });
  });

  it('rota: se o job já está rodando, 200 { skipped } sem executar nem gravar heartbeat', async () => {
    const w = adsWorld();
    const auth = new CronAuthService(w.prisma, { CRM_CRON_SECRET: 'segredo-cron' } as any);
    const ops: any = { recoverStaleApplying: jest.fn(async () => 0), syncAllInsights: jest.fn(async () => []), runAllRules: jest.fn(async () => []) };
    const sched = new SchedulerService({} as any, w.prisma, { SCHEDULER_ENABLED: false } as any);
    const svc = new AdsCronService(sched, ops);
    svc.onModuleInit();
    const ctl = new AdsPublicController(w.oauth, w.channels, svc, auth);
    let release!: () => void;
    ops.syncAllInsights.mockImplementationOnce(() => new Promise((r) => (release = () => r([]))));
    const first = ctl.cronAds('segredo-cron', { task: 'rules' });
    await new Promise((r) => setImmediate(r));
    expect(await ctl.cronAds('segredo-cron', { task: 'rules' })).toEqual({ skipped: 'em execução' });
    expect(await ctl.cronAds('segredo-cron', {})).toEqual({ skipped: 'em execução' }); // sync ocupa o mesmo job
    release();
    await first;
    expect(ops.syncAllInsights).toHaveBeenCalledTimes(1);
  });

  it('serviço: sync sempre; rules só com task=rules; registra os 2 jobs do agendador com os horários do db.md', async () => {
    const w = adsWorld();
    const ops: any = { recoverStaleApplying: jest.fn(async () => 0), syncAllInsights: jest.fn(async () => [{ workspace: WS_A, rows: 3 }]), runAllRules: jest.fn(async () => [{ campaign: uid(), actions: [] }]) };
    const sched = new SchedulerService({} as any, w.prisma, { SCHEDULER_ENABLED: false } as any);
    const svc = new AdsCronService(sched, ops);
    expect(await svc.run()).toEqual({ sync: [{ workspace: WS_A, rows: 3 }] });
    expect(ops.runAllRules).not.toHaveBeenCalled();
    expect((await svc.run('rules')).rules).toHaveLength(1);
    svc.onModuleInit();
    expect(sched.list()).toEqual([
      { name: 'ads-insights-3h', cron: '17 */3 * * *', running: false },
      { name: 'ads-rules-daily', cron: '40 12 * * *', running: false },
    ]);
    ops.runAllRules.mockClear();
    await sched.run('ads-insights-3h');
    expect(ops.runAllRules).not.toHaveBeenCalled();
    await sched.run('ads-rules-daily');
    expect(ops.runAllRules).toHaveBeenCalled();
    expect(w.t['cron_heartbeats']!.rows.map((r) => r.name).sort()).toEqual(['ads-rules', 'ads-sync']);
  });
});

describe('leituras de Performance e Insights', () => {
  it('ai-recommendations devolve o embed `campaigns(name)` e limita a 200; performance sem demo, ordenada por data', async () => {
    const calls: any[] = [];
    const prisma: any = {
      ai_recommendations: { findMany: async (a: any) => { calls.push(a); return [{ id: '1', campaign: { name: 'Camp' }, title: 't' }, { id: '2', campaign: null }]; } },
      performance_daily: { findMany: async (a: any) => { calls.push(a); return []; } },
    };
    const ctl = new AdsResourcesController(prisma, { recoverStaleApplying: async () => 0 } as any);
    const rows = await ctl.recommendations(WS_A);
    expect(rows).toEqual([{ id: '1', title: 't', campaigns: { name: 'Camp' } }, { id: '2', campaigns: null }]);
    expect(calls[0]).toMatchObject({ where: { workspace_id: WS_A }, take: 200, orderBy: { created_at: 'desc' } });
    await ctl.performance(WS_A);
    expect(calls[1]).toMatchObject({ where: { workspace_id: WS_A, source: { not: 'demo' } } });
  });
});
