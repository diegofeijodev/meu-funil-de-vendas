import { status } from '../../media/__tests__/mem';
import { AdsProviderError } from '../ads-errors';
import { adsWorld, ADMIN, MARKETING, OWNER, STRANGER, uid, VIEWER, WS_A, WS_B } from './harness';

const json = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st });

describe('canais — credenciais e login', () => {
  it('saveApp: só owner|admin; só chaves do canal; descarta vazios; ids numéricos; "Nada para salvar."', async () => {
    const w = adsWorld();
    expect(await status(w.channels.saveApp(MARKETING, WS_A, 'google', { GOOGLE_ADS_CLIENT_ID: 'x' }))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.channels.saveApp(OWNER, WS_A, 'google', { TIKTOK_APP_ID: 'x', GOOGLE_ADS_CLIENT_ID: '  ' }))).toBe('400:Nada para salvar.');
    expect(await status(w.channels.saveApp(OWNER, WS_A, 'google', { GOOGLE_ADS_CUSTOMER_ID: '12/../34' }))).toBe('400:O ID da conta do Google Ads deve conter só números.');
    expect(await status(w.channels.saveApp(OWNER, WS_A, 'tiktok', { TIKTOK_ADVERTISER_ID: 'abc' }))).toBe('400:O ID da conta de anúncios do TikTok deve conter só números.');
    expect(await w.channels.saveApp(ADMIN, WS_A, 'google', { GOOGLE_ADS_CLIENT_ID: ' cid ', GOOGLE_ADS_CLIENT_SECRET: 'sec', GOOGLE_ADS_CUSTOMER_ID: '123-456-7890', TIKTOK_APP_ID: 'ignorada' })).toEqual({ ok: true });
    expect(await w.vault.get(WS_A, 'GOOGLE_ADS_CLIENT_ID')).toBe('cid');
    expect(await w.vault.get(WS_A, 'TIKTOK_APP_ID')).toBeNull();
    expect([...w.store.rows.values()].join('')).not.toContain('sec');
  });

  it('status: qualquer membro vê o que falta; estranho não', async () => {
    const w = adsWorld();
    expect(await w.channels.status(VIEWER, WS_A)).toEqual({
      google: ['ID do cliente OAuth', 'Chave secreta do cliente OAuth', 'Token de desenvolvedor', 'Login com Google', 'Conta do Google Ads'],
      tiktok: ['App ID', 'Secret do app', 'Login com TikTok', 'Conta de anúncios'],
    });
    expect(await status(w.channels.status(STRANGER, WS_A))).toBe('403:Você não tem acesso a esta empresa.');
  });

  it('loginUrl: exige credenciais salvas, gera state aleatório preso ao usuário e usa PUBLIC_URL (não o origin do cliente)', async () => {
    const w = adsWorld();
    expect(await status(w.channels.loginUrl(OWNER, WS_A, 'google'))).toBe('400:Salve o ID e a chave secreta do cliente OAuth primeiro.');
    expect(await status(w.channels.loginUrl(OWNER, WS_A, 'tiktok'))).toBe('400:Salve o App ID e o Secret do app do TikTok primeiro.');
    await w.vault.set(WS_A, { GOOGLE_ADS_CLIENT_ID: 'cid', GOOGLE_ADS_CLIENT_SECRET: 'sec', TIKTOK_APP_ID: 'tid', TIKTOK_APP_SECRET: 'tsec' });
    expect(await status(w.channels.loginUrl(MARKETING, WS_A, 'google'))).toBe('403:Seu perfil não tem permissão para esta ação.');
    const g = new URL((await w.channels.loginUrl(OWNER, WS_A, 'google')).url);
    expect(g.origin + g.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(g.searchParams.get('redirect_uri')).toBe('http://api.test/api/public/ads/oauth/google');
    expect(g.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/adwords');
    expect(g.searchParams.get('access_type')).toBe('offline');
    const st = g.searchParams.get('state')!;
    expect(st).not.toContain('.');
    expect(await w.states.consume('google', st)).toEqual({ workspaceId: WS_A, userId: OWNER });
    const t = new URL((await w.channels.loginUrl(ADMIN, WS_A, 'tiktok')).url);
    expect(t.searchParams.get('app_id')).toBe('tid');
    expect(t.searchParams.get('redirect_uri')).toBe('http://api.test/api/public/ads/oauth/tiktok');
  });

  it('retorno do login: state de uso único; só quem ainda é owner|admin conclui; grava o refresh token cifrado', async () => {
    const w = adsWorld();
    await w.vault.set(WS_A, { GOOGLE_ADS_CLIENT_ID: 'cid', GOOGLE_ADS_CLIENT_SECRET: 'sec' });
    const st = new URL((await w.channels.loginUrl(OWNER, WS_A, 'google')).url).searchParams.get('state')!;
    w.http.mockResolvedValueOnce(json({ refresh_token: 'REFRESH-1' }));
    await w.channels.finishLogin('google', 'codigo', st);
    expect(await w.vault.get(WS_A, 'GOOGLE_ADS_REFRESH_TOKEN')).toBe('REFRESH-1');
    expect([...w.store.rows.values()].join('')).not.toContain('REFRESH-1');
    const body = new URLSearchParams(String((w.http.mock.calls[0] as any)[1].body));
    expect(Object.fromEntries(body)).toMatchObject({ code: 'codigo', grant_type: 'authorization_code', redirect_uri: 'http://api.test/api/public/ads/oauth/google' });
    await expect(w.channels.finishLogin('google', 'codigo', st)).rejects.toThrow('Assinatura do retorno inválida.');   // já consumido
    await expect(w.channels.finishLogin('tiktok', 'c', st)).rejects.toThrow('Assinatura do retorno inválida.');
    // state emitido por um usuário que deixou de ser manager
    const st2 = await w.states.issue('google', WS_A, MARKETING);
    await expect(w.channels.finishLogin('google', 'c', st2)).rejects.toThrow('Só o dono ou um administrador conecta as contas de anúncios.');
    // state de um workspace que o usuário nunca gerenciou
    const st3 = await w.states.issue('google', WS_B, OWNER);
    await expect(w.channels.finishLogin('google', 'c', st3)).rejects.toThrow('Só o dono');
  });

  it('TikTok: troca o auth_code e guarda token e (se único) o advertiser id', async () => {
    const w = adsWorld();
    await w.vault.set(WS_A, { TIKTOK_APP_ID: 'tid', TIKTOK_APP_SECRET: 'tsec' });
    const st = new URL((await w.channels.loginUrl(OWNER, WS_A, 'tiktok')).url).searchParams.get('state')!;
    w.http.mockResolvedValueOnce(json({ code: 0, data: { access_token: 'TT-TOKEN', advertiser_ids: ['700123'] } }));
    await w.channels.finishLogin('tiktok', 'auth-code', st);
    expect(await w.vault.get(WS_A, 'TIKTOK_ACCESS_TOKEN')).toBe('TT-TOKEN');
    expect(await w.vault.get(WS_A, 'TIKTOK_ADVERTISER_ID')).toBe('700123');
    expect((w.http.mock.calls[0] as any)[0]).toBe('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/');
  });

  it('erro do provedor vira AdsProviderError/502 com a mensagem pt-BR', async () => {
    const w = adsWorld();
    await w.vault.set(WS_A, { GOOGLE_ADS_CLIENT_ID: 'cid', GOOGLE_ADS_CLIENT_SECRET: 'sec' });
    const st = await w.states.issue('google', WS_A, OWNER);
    w.http.mockResolvedValueOnce(json({ error_description: 'Bad Request' }, 400));
    await expect(w.channels.finishLogin('google', 'c', st)).rejects.toMatchObject({ status: 502, response: { message: 'Bad Request' } });
  });
});

describe('canais — Google Ads', () => {
  it('listCustomers/dailyResults: só ids numéricos entram em caminho e GAQL; custo em micros vira reais', async () => {
    const w = adsWorld();
    await w.vault.set(WS_A, { GOOGLE_ADS_CLIENT_ID: 'cid', GOOGLE_ADS_CLIENT_SECRET: 'sec', GOOGLE_ADS_DEVELOPER_TOKEN: 'dev', GOOGLE_ADS_REFRESH_TOKEN: 'rt', GOOGLE_ADS_CUSTOMER_ID: '123-456-7890', GOOGLE_ADS_LOGIN_CUSTOMER_ID: '999-888-7777' });
    w.http.mockImplementation(async (url: string, init: any) => {
      if (url.endsWith('/token')) return json({ access_token: 'AT' });
      if (url.endsWith(':listAccessibleCustomers')) return json({ resourceNames: ['customers/111', 'customers/../x', 'customers/222'] });
      if (url.includes('/customers/111/googleAds:search')) return json({ results: [{ customer: { descriptiveName: 'Loja', manager: true } }] });
      if (url.includes('/customers/222/googleAds:search')) return json({ error: { message: 'x' } }, 403);
      if (url.includes('/customers/1234567890/googleAds:search')) return json({ results: [{ campaign: { id: '5555', name: 'C' }, segments: { date: '2026-09-30' }, metrics: { costMicros: '12500000', impressions: '100', clicks: '5', conversions: 2, conversionsValue: 40 } }] });
      return json({}, 404);
    });
    const list = await w.google.listCustomers(WS_A);
    expect(list).toEqual([{ id: '111', name: 'Loja', manager: true }, { id: '222', name: '222', manager: false }]);
    const rows = await w.google.dailyResults(WS_A, ['5555', "1) OR 1=1 --", '7777'], 7);
    expect(rows).toEqual([{ externalCampaignId: '5555', name: 'C', date: '2026-09-30', spend: 12.5, impressions: 100, clicks: 5, conversions: 2, revenue: 40 }]);
    const search = w.http.mock.calls.map((c) => c as any).find((c) => c[0].includes('/customers/1234567890/googleAds:search'))!;
    const q = JSON.parse(search[1].body).query as string;
    expect(q).toContain('campaign.id IN (5555,7777)');
    expect(q).not.toContain('OR 1=1');
    expect(search[1].headers).toMatchObject({ Authorization: 'Bearer AT', 'developer-token': 'dev', 'login-customer-id': '9998887777' });
  });

  it('createSearchCampaign: tudo PAUSADO, Brasil/português, ≤30/≤90 caracteres, mínimo de títulos/descrições', async () => {
    const w = adsWorld();
    await w.vault.set(WS_A, { GOOGLE_ADS_CLIENT_ID: 'cid', GOOGLE_ADS_CLIENT_SECRET: 'sec', GOOGLE_ADS_DEVELOPER_TOKEN: 'dev', GOOGLE_ADS_REFRESH_TOKEN: 'rt', GOOGLE_ADS_CUSTOMER_ID: '1234567890' });
    const bodies: any[] = [];
    w.http.mockImplementation(async (url: string, init: any) => {
      if (url.endsWith('/token')) return json({ access_token: 'AT' });
      bodies.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith('campaignBudgets:mutate')) return json({ results: [{ resourceName: 'customers/1234567890/campaignBudgets/1' }] });
      if (url.endsWith('/campaigns:mutate')) return json({ results: [{ resourceName: 'customers/1234567890/campaigns/4242' }] });
      if (url.endsWith('adGroups:mutate')) return json({ results: [{ resourceName: 'customers/1234567890/adGroups/7' }] });
      return json({ results: [] });
    });
    const long = 'x'.repeat(50);
    const r = await w.google.createSearchCampaign(WS_A, { name: 'Camp', objective: 'leads', dailyBudget: 25, landingUrl: 'https://s.test', headlines: [long, 'a', 'b', 'a'], descriptions: [long + long, 'd2'], keywords: ['  Cerveja Gelada ', 'ab', 'cerveja gelada'] });
    expect(r.campaignId).toBe('4242');
    expect(r.steps.every((s) => s.status === 'done')).toBe(true);
    const camp = bodies.find((b) => b.url.endsWith('/campaigns:mutate'))!.body.operations[0].create;
    expect(camp).toMatchObject({ status: 'PAUSED', advertisingChannelType: 'SEARCH', maximizeConversions: {} });
    expect(bodies.find((b) => b.url.endsWith('campaignBudgets:mutate'))!.body.operations[0].create.amountMicros).toBe('25000000');
    const crit = bodies.find((b) => b.url.endsWith('campaignCriteria:mutate'))!.body.operations;
    expect(crit[0].create.location.geoTargetConstant).toBe('geoTargetConstants/2076');
    expect(crit[1].create.language.languageConstant).toBe('languageConstants/1014');
    expect(bodies.find((b) => b.url.endsWith('adGroupCriteria:mutate'))!.body.operations.map((o: any) => o.create.keyword.text)).toEqual(['cerveja gelada']);
    const ad = bodies.find((b) => b.url.endsWith('adGroupAds:mutate'))!.body.operations[0].create.ad.responsiveSearchAd;
    expect(ad.headlines.every((h: any) => h.text.length <= 30)).toBe(true);
    expect(ad.descriptions.every((d: any) => d.text.length <= 90)).toBe(true);
    await expect(w.google.createSearchCampaign(WS_A, { name: 'C', objective: 'leads', dailyBudget: 1, landingUrl: 'https://s.test', headlines: ['a'], descriptions: ['b'], keywords: [] })).rejects.toThrow(AdsProviderError);
  });

  it('conta com id inválido nunca vai para a URL', async () => {
    const w = adsWorld();
    await w.vault.set(WS_A, { GOOGLE_ADS_CLIENT_ID: 'cid', GOOGLE_ADS_CLIENT_SECRET: 'sec', GOOGLE_ADS_DEVELOPER_TOKEN: 'dev', GOOGLE_ADS_REFRESH_TOKEN: 'rt', GOOGLE_ADS_CUSTOMER_ID: '12/../34' });
    await expect(w.google.createSearchCampaign(WS_A, { name: 'C', objective: 'x', dailyBudget: 1, landingUrl: 'https://s', headlines: [], descriptions: [], keywords: [] })).rejects.toThrow('inválido');
    expect(w.http).not.toHaveBeenCalled();
  });
});

describe('canais — campanha externa (create/link/setStatus)', () => {
  it('link: editores; guarda só os dígitos; campanha de outra empresa = 404', async () => {
    const w = adsWorld();
    const c = w.seedCampaign();
    expect(await status(w.channels.link(VIEWER, c.id, 'google', '123'))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.channels.link(STRANGER, c.id, 'google', '123'))).toBe('404:Campanha não encontrada.');
    await w.channels.link(MARKETING, c.id, 'google', ' 123-456 ');
    expect(c.google_campaign_id).toBe('123456');
    await w.channels.link(MARKETING, c.id, 'tiktok', 'abc');
    expect(c.tiktok_campaign_id).toBeNull();
  });

  it('create (google): exige aprovada + destino; a IA escreve os ativos; grava google_campaign_id/PAUSED; recusa duplicar', async () => {
    const w = adsWorld();
    const draft = w.seedCampaign({ status: 'draft' });
    expect(await status(w.channels.create(OWNER, draft.id, 'google'))).toBe('400:A campanha precisa ser aprovada antes de ir para outros canais.');
    const nolp = w.seedCampaign({ landing_url: null });
    expect(await status(w.channels.create(OWNER, nolp.id, 'google'))).toBe('400:Preencha a página de destino da campanha.');
    const c = w.seedCampaign();
    w.ai.json.mockResolvedValue({ titulos: ['T1', 'T2', 'T3'], descricoes: ['D1', 'D2'], palavras_chave: ['chope'] });
    w.google.createSearchCampaign = jest.fn(async () => ({ campaignId: '4242', steps: [{ label: 'ok', status: 'done' as const, detail: '' }] }));
    const r = await w.channels.create(MARKETING, c.id, 'google');
    expect(r.campaignId).toBe('4242');
    expect(c).toMatchObject({ google_campaign_id: '4242', google_status: 'PAUSED' });
    expect((w.google.createSearchCampaign as jest.Mock).mock.calls[0]![1].landingUrl).toBe('https://site.test/lp?utm_source=google&utm_medium=cpc&utm_campaign=Campanha%20X');
    expect(w.ai.json.mock.calls[0]![1].name).toBe('google_search_assets');
    expect(await status(w.channels.create(MARKETING, c.id, 'google'))).toBe('400:Esta campanha já tem campanha ligada no Google Ads.');
  });

  it('create (tiktok): só vídeo aprovado; grava tiktok_campaign_id/DISABLE', async () => {
    const w = adsWorld();
    const c = w.seedCampaign();
    w.seedCreative(c.id, { preview_url: 'https://cdn.test/img.jpg' });
    expect(await status(w.channels.create(OWNER, c.id, 'tiktok'))).toBe('400:O TikTok só aceita vídeo: aprove pelo menos um criativo em vídeo desta campanha.');
    w.seedCreative(c.id, { title: 'Vídeo', preview_url: 'https://cdn.test/v.mp4?x=1', extras: { cover_url: 'https://cdn.test/cover.jpg' } });
    w.seedCreative(c.id, { title: 'Rascunho', preview_url: 'https://cdn.test/d.mp4', status: 'draft' });
    w.tiktok.createCampaign = jest.fn(async () => ({ campaignId: '700', adgroupId: '701', steps: [] }));
    await w.channels.create(OWNER, c.id, 'tiktok');
    expect(c).toMatchObject({ tiktok_campaign_id: '700', tiktok_status: 'DISABLE' });
    expect((w.tiktok.createCampaign as jest.Mock).mock.calls[0]![1].videos).toEqual([{ title: 'Vídeo', url: 'https://cdn.test/v.mp4?x=1', cover: 'https://cdn.test/cover.jpg' }]);
  });

  it('setStatus: ativar só owner|admin; pausar editores; espelha a coluna de status', async () => {
    const w = adsWorld();
    const c = w.seedCampaign({ google_campaign_id: '4242', tiktok_campaign_id: '700' });
    w.google.setStatus = jest.fn(async () => undefined);
    w.tiktok.setStatus = jest.fn(async () => undefined);
    expect(await status(w.channels.setStatus(MARKETING, c.id, 'google', true))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(w.google.setStatus).not.toHaveBeenCalled();
    await w.channels.setStatus(ADMIN, c.id, 'google', true);
    expect(w.google.setStatus).toHaveBeenCalledWith(WS_A, '4242', 'ENABLED');
    expect(c.google_status).toBe('ENABLED');
    await w.channels.setStatus(MARKETING, c.id, 'tiktok', false);
    expect(w.tiktok.setStatus).toHaveBeenCalledWith(WS_A, '700', 'DISABLE');
    expect(c.tiktok_status).toBe('DISABLE');
    const none = w.seedCampaign();
    expect(await status(w.channels.setStatus(OWNER, none.id, 'google', false))).toBe('400:Sem campanha no Google Ads.');
    expect(await status(w.channels.setStatus(OWNER, none.id, 'tiktok', false))).toBe('400:Sem campanha no TikTok Ads.');
  });
});

describe('canais — TikTok', () => {
  it('createCampaign: campanha e grupo DESATIVADOS (Brasil, orçamento mínimo 50); sem identidade não cria anúncios', async () => {
    const w = adsWorld();
    await w.vault.set(WS_A, { TIKTOK_APP_ID: 'tid', TIKTOK_APP_SECRET: 'tsec', TIKTOK_ACCESS_TOKEN: 'tok', TIKTOK_ADVERTISER_ID: '700123' });
    const calls: any[] = [];
    w.http.mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.includes('/campaign/create/')) return json({ code: 0, data: { campaign_id: '800' } });
      if (url.includes('/adgroup/create/')) return json({ code: 0, data: { adgroup_id: '801' } });
      if (url.includes('/identity/get/')) return json({ code: 0, data: { identity_list: [] } });
      return json({ code: 0, data: {} });
    });
    const r = await w.tiktok.createCampaign(WS_A, { name: 'Camp', objective: 'leads', dailyBudget: 10, landingUrl: 'https://s', adText: 't', brandName: 'M', logoUrl: null, videos: [{ title: 'v', url: 'https://cdn.test/v.mp4', cover: null }] });
    expect(r.campaignId).toBe('800');
    const camp = JSON.parse(calls.find((c) => c.url.includes('/campaign/create/'))!.init.body);
    expect(camp).toMatchObject({ objective_type: 'LEAD_GENERATION', operation_status: 'DISABLE' });
    const grp = JSON.parse(calls.find((c) => c.url.includes('/adgroup/create/'))!.init.body);
    expect(grp).toMatchObject({ location_ids: ['3469034'], budget: 50, operation_status: 'DISABLE' });
    expect(calls.find((c) => c.init.headers['Access-Token'] !== 'tok' && !c.url.includes('oauth2'))).toBeUndefined();
    expect(r.steps.at(-1)).toMatchObject({ label: 'Anúncios', status: 'failed' });
    expect(calls.some((c) => c.url.includes('/ad/create/'))).toBe(false);
  });

  it('erro do TikTok traz mensagem e código; setStatus valida o id', async () => {
    const w = adsWorld();
    await w.vault.set(WS_A, { TIKTOK_APP_ID: 'tid', TIKTOK_APP_SECRET: 'tsec', TIKTOK_ACCESS_TOKEN: 'tok', TIKTOK_ADVERTISER_ID: '700123' });
    w.http.mockResolvedValueOnce(json({ code: 40100, message: 'Invalid token' }));
    await expect(w.tiktok.listAdvertisers(WS_A)).rejects.toThrow('TikTok: Invalid token (código 40100)');
    await expect(w.tiktok.setStatus(WS_A, '1/../2', 'ENABLE')).rejects.toThrow('inválido');
  });
});
