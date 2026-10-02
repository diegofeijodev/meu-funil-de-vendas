import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MetaError } from '../../instagram/meta-graph';
import { status } from '../../media/__tests__/mem';
import { MetaSaveCredentialsDto } from '../ads.dto';
import { adsWorld, ADMIN, MARKETING, OWNER, respondPublish, STRANGER, uid, VIEWER, WS_A, WS_B } from './harness';

describe('MetaAdsService — autorização', () => {
  it('saveCredentials/saveApp/loginUrl/listAssets/saveAssets: só owner|admin (marketing, viewer e estranho não)', async () => {
    const w = adsWorld();
    const creds: any = { workspaceId: WS_A, appId: 'app123', appSecret: 'segredo-12345', systemUserToken: 'x'.repeat(30), adAccountId: 'act_1001', pageId: '2002' };
    for (const u of [MARKETING, VIEWER, STRANGER]) {
      expect(await status(w.meta.saveCredentials(u, creds))).toBe('403:Só o dono ou um administrador conecta a Meta.');
      expect(await status(w.meta.saveApp(u, WS_A, 'app123', 'segredo-12345'))).toBe('403:Só o dono ou um administrador conecta a Meta.');
      expect(await status(w.meta.loginUrl(u, WS_A))).toBe('403:Só o dono ou um administrador conecta a Meta.');
      expect(await status(w.meta.listAssets(u, WS_A))).toBe('403:Só o dono ou um administrador conecta a Meta.');
      expect(await status(w.meta.saveAssets(u, { workspaceId: WS_A, adAccountId: 'act_1', pageId: '2002' } as any))).toBe('403:Só o dono ou um administrador conecta a Meta.');
    }
    expect(w.store.rows.size).toBe(0);
    expect(await status(w.meta.saveCredentials(ADMIN, creds))).toBe('ok');
  });

  it('status/test/list/insights: qualquer membro; estranho recebe "sem acesso"', async () => {
    const w = adsWorld();
    for (const u of [OWNER, VIEWER]) expect(await status(w.meta.status(u, WS_A))).toBe('ok');
    expect(await status(w.meta.status(STRANGER, WS_A))).toBe('403:Você não tem acesso a esta área de trabalho.');
    expect(await status(w.meta.list(STRANGER, WS_A))).toBe('403:Você não tem acesso a esta área de trabalho.');
  });

  it('publish/setStatus: viewer não altera campanhas', async () => {
    const w = adsWorld();
    const c = w.seedCampaign();
    expect(await status(w.meta.publish(VIEWER, WS_A, c.id))).toBe('403:Seu perfil não pode alterar campanhas.');
    expect(await status(w.meta.setStatus(VIEWER, WS_A, c.id, 'PAUSED'))).toBe('403:Seu perfil não pode alterar campanhas.');
  });

  it('campanha de OUTRO workspace = "Campanha não encontrada." (404), nada vai à Meta', async () => {
    const w = adsWorld();
    const foreign = w.seedCampaign({ workspace_id: WS_B });
    expect(await status(w.meta.publish(OWNER, WS_A, foreign.id))).toBe('404:Campanha não encontrada.');
    expect(await status(w.meta.setStatus(OWNER, WS_A, foreign.id, 'PAUSED'))).toBe('400:Campanha ainda não publicada na Meta.');
    expect(await status(w.meta.insights(OWNER, { workspaceId: WS_A, since: '2026-01-01', until: '2026-01-31', campaignId: foreign.id }))).toBe('400:Esta campanha ainda não foi publicada na Meta.');
    expect(w.calls).toHaveLength(0);
  });
});

describe('MetaAdsService — credenciais e status', () => {
  it('grava cifrado no cofre, limpa a expiração e informa o que falta', async () => {
    const w = adsWorld();
    w.graphClient.config.mockImplementation(async (ws: string) => ({ appId: await w.vault.get(ws, 'META_APP_ID'), appSecret: await w.vault.get(ws, 'META_APP_SECRET'), token: await w.vault.get(ws, 'META_SYSTEM_USER_TOKEN'), adAccountId: 'act_1', pageId: await w.vault.get(ws, 'META_PAGE_ID'), instagramId: null }));
    const r = await w.meta.saveCredentials(OWNER, { workspaceId: WS_A, appId: 'app123', appSecret: 'segredo-12345', systemUserToken: 'TOKEN-' + 'x'.repeat(30), adAccountId: 'act_1001', pageId: '2002', instagramId: '3003' } as any);
    expect(r).toEqual({ ok: true, configured: true, missing: [] });
    const raw = [...w.store.rows.values()].join('|');
    expect(raw).not.toContain('TOKEN-');
    expect(raw).not.toContain('segredo-12345');
    expect(await w.vault.get(WS_A, 'META_TOKEN_SOURCE')).toBe('system_user');
    expect(await w.vault.get(WS_A, 'META_INSTAGRAM_ACCOUNT_ID')).toBe('3003');
    const s = await w.meta.status(VIEWER, WS_A);
    expect(s).toEqual({ configured: true, missing: [], tokenExpiresAt: null, tokenSource: 'system_user' });
  });

  it('DTO: mensagens do protótipo e ids só com dígitos (entram em caminho da Graph)', async () => {
    const bad = plainToInstance(MetaSaveCredentialsDto, { workspaceId: WS_A, appId: ' a ', appSecret: 'curta', systemUserToken: 'x', adAccountId: 'abc', pageId: '12/../me' });
    const msgs = (await validate(bad)).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(msgs).toEqual(expect.arrayContaining(['Informe o ID do app.', 'Informe a chave secreta do app.', 'Informe o token do usuário do sistema.', 'Informe o ID da conta de anúncios (act_...).', 'O ID da Página deve conter só números.']));
    const ok = plainToInstance(MetaSaveCredentialsDto, { workspaceId: WS_A, appId: ' app123 ', appSecret: 'segredo-12345', systemUserToken: 'x'.repeat(25), adAccountId: '1001', pageId: '2002', instagramId: null });
    expect(await validate(ok)).toHaveLength(0);
    expect(ok.appId).toBe('app123');
  });

  it('id de conta/Página inválido no cofre nunca vira caminho da Graph', async () => {
    const w = adsWorld();
    w.cfg.adAccountId = 'act_1/../me';
    const t = await w.ops.testConnection(WS_A);
    expect(t.ok).toBe(false);
    expect(w.calls.filter((c) => c.path.includes('..'))).toHaveLength(0);
    await expect(w.ops.listStructure(WS_A)).rejects.toBeInstanceOf(MetaError);
    w.cfg.adAccountId = 'act_1001';
    w.cfg.pageId = '../me';
    expect((await w.ops.testConnection(WS_A)).ok).toBe(false);
  });

  it('metaAdsTest devolve o resumo da conta, Página e Instagram', async () => {
    const w = adsWorld();
    w.respond((path) => {
      if (path === '/me') return { id: '1', name: 'Fulano' };
      if (path === '/act_1001') return { name: 'Conta', account_status: 1, currency: 'BRL', timezone_name: 'America/Sao_Paulo' };
      if (path === '/2002') return { id: '2002', name: 'Página' };
      if (path === '/3003') return { username: 'insta' };
      return undefined;
    });
    const r: any = await w.meta.test(VIEWER, WS_A);
    expect(r).toMatchObject({ ok: true, user: 'Fulano', account: { id: 'act_1001', name: 'Conta', status: 'Ativa', currency: 'BRL' }, page: { name: 'Página' }, instagram: { username: 'insta' } });
  });

  it('metaAdsTest sem credenciais devolve ok:false (HTTP 200) com a mensagem do protótipo', async () => {
    const w = adsWorld();
    w.graphClient.config.mockResolvedValue({ appId: null, appSecret: null, token: null, adAccountId: null, pageId: null, instagramId: null });
    const r: any = await w.meta.test(OWNER, WS_A);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['META_APP_ID', 'META_APP_SECRET', 'META_SYSTEM_USER_TOKEN', 'META_AD_ACCOUNT_ID', 'META_PAGE_ID']);
    expect(r.error).toBe('Faltam credenciais: META_APP_ID, META_APP_SECRET, META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID, META_PAGE_ID. Preencha o formulário em Integrações.');
  });

  it('erro da Graph vira 502 com a mensagem pt-BR (list)', async () => {
    const w = adsWorld();
    w.respond(() => new MetaError('O token da Meta é inválido ou expirou.', 190));
    expect(await status(w.meta.list(OWNER, WS_A))).toBe('502:O token da Meta é inválido ou expirou.');
  });
});

describe('MetaAdsService.publish', () => {
  it('só publica campanha aprovada, com destino, sem envio anterior e com criativo aprovado (mensagens do protótipo)', async () => {
    const w = adsWorld();
    const draft = w.seedCampaign({ status: 'draft' });
    expect(await status(w.meta.publish(OWNER, WS_A, draft.id))).toBe('400:A campanha precisa ser aprovada em Aprovações antes de ir para a Meta.');
    const done = w.seedCampaign({ meta_campaign_id: '777' });
    expect(await status(w.meta.publish(OWNER, WS_A, done.id))).toBe('400:Esta campanha já foi enviada para a Meta. Use Ativar/Pausar.');
    const nolp = w.seedCampaign({ landing_url: null });
    expect(await status(w.meta.publish(OWNER, WS_A, nolp.id))).toBe('400:Preencha a página de destino (URL) da campanha antes de publicar.');
    const nocr = w.seedCampaign();
    expect(await status(w.meta.publish(OWNER, WS_A, nocr.id))).toBe('400:Aprove pelo menos um criativo desta campanha antes de publicar.');
    expect(w.calls).toHaveLength(0);
  });

  it('caminho feliz (tráfego): tudo PAUSADO, UTM no destino, grava ids, job "done" e auditoria campaign.published', async () => {
    const w = adsWorld();
    respondPublish(w);
    const c = w.seedCampaign({ objective: 'traffic', budget_daily: 40 });
    const cr = w.seedCreative(c.id);
    w.t['copies']!.rows.push({ id: uid(), workspace_id: WS_A, campaign_id: c.id, version: 1, status: 'approved', content: { meta_ad: 'Texto principal', headline: 'Título da copy' } });
    const r = await w.meta.publish(MARKETING, WS_A, c.id);
    expect(r).toMatchObject({ campaignId: '9001', adsetIds: ['9101'], leadFormId: null });
    expect(Object.values(r.adMap)[0]).toMatchObject({ creativeId: cr.id, adsetId: '9101' });
    expect(r.steps.every((s) => s.status === 'done')).toBe(true);

    const post = (p: string) => w.calls.filter((x) => x.path.endsWith(p) && x.opts.method === 'POST');
    expect(post('/campaigns')[0]!.opts.params).toMatchObject({ objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: [] });
    expect(post('/adsets')[0]!.opts.params).toMatchObject({ status: 'PAUSED', daily_budget: 4000, optimization_goal: 'LINK_CLICKS', destination_type: 'WEBSITE', bid_strategy: 'LOWEST_COST_WITHOUT_CAP' });
    expect(post('/ads')[0]!.opts.params.status).toBe('PAUSED');
    const story = post('/adcreatives')[0]!.opts.params.object_story_spec;
    expect(story.link_data.link).toBe('https://site.test/lp?utm_source=meta&utm_medium=paid&utm_campaign=Campanha%20X');
    expect(story.link_data.message).toBe('Texto principal');
    expect(story.link_data.name).toBe('Título da copy');
    expect(story.page_id).toBe('2002');
    expect(story.instagram_user_id).toBe('3003');
    expect(w.calls.every((x) => x.ws === WS_A)).toBe(true);

    const row = w.t['campaigns']!.rows.find((x) => x.id === c.id)!;
    expect(row).toMatchObject({ meta_campaign_id: '9001', meta_adset_id: '9101', meta_adset_ids: ['9101'], meta_delivery_status: 'PAUSED', meta_lead_form_id: null });
    expect(row.meta_ad_ids).toHaveLength(1);
    expect(w.t['publishing_jobs']!.rows).toEqual([expect.objectContaining({ workspace_id: WS_A, campaign_id: c.id, target: 'meta', status: 'done', mode: 'live' })]);
    expect(w.activity.log).toHaveBeenCalledWith(WS_A, MARKETING, 'campaign.published', 'campaign', { campaign_id: c.id, mode: 'live' });
  });

  it('leads: cria o formulário instantâneo com o token da Página e usa a política de privacidade', async () => {
    const w = adsWorld();
    respondPublish(w);
    w.respond((path) => (path === '/2002' ? { access_token: 'page-token' } : undefined));
    const c = w.seedCampaign({ objective: 'leads', ads_config: { privacyUrl: 'https://site.test/privacidade', cta: 'SIGN_UP' } });
    w.seedCreative(c.id);
    const r = await w.meta.publish(OWNER, WS_A, c.id);
    expect(r.leadFormId).toBe('9400');
    const form = w.calls.find((x) => x.path === '/2002/leadgen_forms')!;
    expect(form.opts.token).toBe('page-token');
    expect(form.opts.params.privacy_policy.url).toBe('https://site.test/privacidade');
    const adset = w.calls.find((x) => x.path.endsWith('/adsets') && x.opts.method === 'POST')!;
    expect(adset.opts.params).toMatchObject({ optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD', promoted_object: { page_id: '2002' } });
  });

  it('falha total: registra publishing_job failed e devolve 502 com a mensagem; nada gravado na campanha', async () => {
    const w = adsWorld();
    w.respond((path, opts) => (path.endsWith('/campaigns') && opts.method === 'POST' ? new MetaError('A conta de anúncios está sem forma de pagamento válida.', 1487390) : undefined));
    const c = w.seedCampaign();
    w.seedCreative(c.id);
    expect(await status(w.meta.publish(OWNER, WS_A, c.id))).toBe('502:A conta de anúncios está sem forma de pagamento válida.');
    expect(w.t['publishing_jobs']!.rows[0]).toMatchObject({ status: 'failed', log: 'A conta de anúncios está sem forma de pagamento válida.' });
    expect(w.t['campaigns']!.rows.find((x) => x.id === c.id)!.meta_campaign_id).toBeNull();
    expect(w.activity.log).not.toHaveBeenCalled();
  });

  it('falha parcial: anúncio que falha vira step failed e o job fica "partial"', async () => {
    const w = adsWorld();
    respondPublish(w);
    w.respond((path, opts) => (path.endsWith('/adcreatives') && opts.params?.name === 'Ruim' ? new MetaError('A Meta recusou um dos dados enviados: x', 100) : undefined));
    const c = w.seedCampaign();
    w.seedCreative(c.id, { title: 'Bom' });
    w.seedCreative(c.id, { title: 'Ruim' });
    const r = await w.meta.publish(OWNER, WS_A, c.id);
    expect(r.steps.filter((s) => s.status === 'failed')).toHaveLength(1);
    expect(r.adIds).toHaveLength(1);
    expect(w.t['publishing_jobs']!.rows[0]!.status).toBe('partial');
  });

  it('clique duplo: a segunda publicação simultânea é recusada (nada duplicado na Meta)', async () => {
    const w = adsWorld();
    respondPublish(w);
    const c = w.seedCampaign();
    w.seedCreative(c.id);
    const orig = w.graphClient.graph.getMockImplementation()!;
    w.graphClient.graph.mockImplementation(async (...a: any[]) => { await new Promise((r) => setTimeout(r, 15)); return orig(...a); });
    const [a, b] = await Promise.allSettled([w.meta.publish(OWNER, WS_A, c.id), w.meta.publish(OWNER, WS_A, c.id)]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(w.calls.filter((x) => x.path.endsWith('/campaigns') && x.opts.method === 'POST')).toHaveLength(1);
  });

  it('per_angle: 1 conjunto por ângulo com verba igual; interesses via /search; imagem baixada pelo AssetsService (guardado)', async () => {
    const w = adsWorld();
    respondPublish(w);
    w.respond((path, opts) => (path === '/search' && opts.params.type === 'adinterest' ? { data: [{ id: '6003', name: 'Cerveja' }] } : undefined));
    w.strategist.currentStrategy.mockResolvedValue({ publicos_meta: [{ nome: 'Frio', tipo: 'frio', interesses: ['cerveja'] }], angulos_detalhados: [{ nome: 'A1', gancho: 'Gancho 1', mensagem: 'm' }, { nome: 'A2', gancho: 'Gancho 2', mensagem: 'm' }] });
    const c = w.seedCampaign({ budget_daily: 60, ads_config: { structure: 'per_angle' } });
    w.seedCreative(c.id, { title: 'c1', angle: 'A1' });
    w.seedCreative(c.id, { title: 'c2', angle: 'A2' });
    const r = await w.meta.publish(OWNER, WS_A, c.id);
    expect(r.adsetIds).toHaveLength(2);
    const sets = w.calls.filter((x) => x.path.endsWith('/adsets') && x.opts.method === 'POST');
    expect(sets.map((s) => s.opts.params.daily_budget)).toEqual([3000, 3000]);
    expect(sets[0]!.opts.params.targeting.flexible_spec).toEqual([{ interests: [{ id: '6003', name: 'Cerveja' }] }]);
    expect(w.assets.download).toHaveBeenCalledWith('https://cdn.test/a.jpg');
  });

  it('ids de público do cofre da campanha só entram se forem numéricos', async () => {
    const w = adsWorld();
    respondPublish(w);
    const c = w.seedCampaign({ ads_config: { customAudienceIds: ['123456', '../x'], excludeAudienceIds: ['654321', 'a b'] } });
    w.seedCreative(c.id);
    await w.meta.publish(OWNER, WS_A, c.id);
    const t = w.calls.find((x) => x.path.endsWith('/adsets') && x.opts.method === 'POST')!.opts.params.targeting;
    expect(t.custom_audiences).toEqual([{ id: '123456' }]);
    expect(t.excluded_custom_audiences).toEqual([{ id: '654321' }]);
  });
});

describe('MetaAdsService.setStatus', () => {
  const published = (w: ReturnType<typeof adsWorld>, over: Record<string, any> = {}) =>
    w.seedCampaign({ status: 'approved', meta_campaign_id: '9001', meta_adset_id: '9101', meta_adset_ids: ['9101'], meta_ad_ids: ['9301', '9302'], meta_delivery_status: 'PAUSED', ...over });

  it('ativar: só owner|admin (mensagem do guarda de entrega); marketing pode pausar', async () => {
    const w = adsWorld();
    const c = published(w);
    expect(await status(w.meta.setStatus(MARKETING, WS_A, c.id, 'ACTIVE'))).toBe('403:Só o dono ou um administrador pode ativar a veiculação (gastar verba).');
    expect(w.calls).toHaveLength(0);
    expect(await status(w.meta.setStatus(ADMIN, WS_A, c.id, 'ACTIVE'))).toBe('ok');
    expect(w.t['campaigns']!.rows.find((x) => x.id === c.id)).toMatchObject({ meta_delivery_status: 'ACTIVE', status: 'active' });
    expect(await status(w.meta.setStatus(MARKETING, WS_A, c.id, 'PAUSED'))).toBe('ok');
    expect(w.t['campaigns']!.rows.find((x) => x.id === c.id)).toMatchObject({ meta_delivery_status: 'PAUSED', status: 'approved' });
  });

  it('só ativa campanha aprovada e publicada', async () => {
    const w = adsWorld();
    const c = published(w, { status: 'pending_approval' });
    expect(await status(w.meta.setStatus(OWNER, WS_A, c.id, 'ACTIVE'))).toBe('400:Só é possível ativar depois da aprovação em Aprovações.');
    const n = w.seedCampaign();
    expect(await status(w.meta.setStatus(OWNER, WS_A, n.id, 'ACTIVE'))).toBe('400:Campanha ainda não publicada na Meta.');
    expect(w.calls).toHaveLength(0);
  });

  it('ao ativar, anúncios pausados pelo otimizador continuam pausados; campanha, conjuntos e anúncios recebem o status', async () => {
    const w = adsWorld();
    const c = published(w);
    w.t['ai_recommendations']!.rows.push({ id: uid(), workspace_id: WS_A, campaign_id: c.id, action: 'pause_ad', status: 'applied', payload: { adId: '9302' } });
    await w.meta.setStatus(OWNER, WS_A, c.id, 'ACTIVE');
    expect(w.calls.map((x) => x.path)).toEqual(['/9001', '/9101', '/9301']);
    expect(w.calls.every((x) => x.opts.params.status === 'ACTIVE')).toBe(true);
    w.calls.length = 0;
    await w.meta.setStatus(OWNER, WS_A, c.id, 'PAUSED');
    expect(w.calls.map((x) => x.path)).toEqual(['/9001', '/9101', '/9301', '/9302']);
  });
});

describe('MetaAdsService.insights', () => {
  it('sem campanha: conta inteira; com campanha: id da Meta; resumo calculado', async () => {
    const w = adsWorld();
    w.respond((path) => (path.endsWith('/insights') ? { data: [{ spend: '100', impressions: '1000', clicks: '50', ctr: '5', cpc: '2', actions: [{ action_type: 'lead', value: '10' }] }] } : undefined));
    const r = await w.meta.insights(VIEWER, { workspaceId: WS_A, since: '2026-09-01', until: '2026-09-30' });
    expect(r).toEqual({ spend: 100, impressions: 1000, clicks: 50, ctr: 5, cpc: 2, leads: 10, cpl: 10 });
    expect(w.calls[0]!.path).toBe('/act_1001/insights');
    const c = w.seedCampaign({ meta_campaign_id: '9001' });
    await w.meta.insights(VIEWER, { workspaceId: WS_A, since: '2026-09-01', until: '2026-09-30', campaignId: c.id });
    expect(w.calls[1]!.path).toBe('/9001/insights');
    expect(w.calls[1]!.opts.params.level).toBe('campaign');
  });
});
