import { Logger } from '@nestjs/common';
import { status } from '../../media/__tests__/mem';
import { adsWorld, AdsWorld, OWNER, respondPublish, uid, WS_A } from './harness';

/**
 * "Apagar empresa" no meio de uma chamada a um canal (contrato §31): a linha da campanha some (cascata) e o cofre da empresa também.
 * Quem estava LIGANDO pausa de volta com as credenciais lidas antes; quem estava CRIANDO (nasce pausado) só deixa o id externo no log.
 */
let errors: string[];
beforeEach(() => {
  errors = [];
  jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => void errors.push(String(m)));
});
afterEach(() => jest.restoreAllMocks());

const race = () => errors.filter((m) => m.startsWith('[workspace-delete-race] ')).map((m) => JSON.parse(m.replace('[workspace-delete-race] ', '')));

/** Simula o commit do "Apagar empresa": some a linha e o cofre (a próxima leitura de credenciais vem vazia). */
function deleteWorkspace(w: AdsWorld, campaignId: string) {
  const rows = w.t['campaigns']!.rows;
  rows.splice(rows.findIndex((r: any) => r.id === campaignId), 1);
  w.graphClient.config.mockImplementation(async () => ({ appId: null, appSecret: null, token: null, adAccountId: null, pageId: null, instagramId: null }));
}

const published = (w: AdsWorld, over: Record<string, unknown> = {}) =>
  w.seedCampaign({ status: 'approved', meta_campaign_id: '9001', meta_adset_ids: ['9101'], meta_ad_ids: ['9301'], meta_delivery_status: 'PAUSED', ...over });

describe('corrida "Apagar empresa" × ligar/criar no canal', () => {
  it('Meta: empresa apagada enquanto ligava → pausa de volta com as credenciais lidas ANTES, 404 e id externo no log', async () => {
    const w = adsWorld();
    const c = published(w);
    w.respond((path, opts) => {
      if (path === '/9001' && opts.params?.status === 'ACTIVE') deleteWorkspace(w, c.id);
      return undefined;
    });
    expect(await status(w.meta.setStatus(OWNER, WS_A, c.id, 'ACTIVE'))).toBe('404:Campanha não encontrada.');
    const pauses = w.calls.filter((x) => x.opts.method === 'POST' && x.opts.params?.status === 'PAUSED');
    expect(pauses.map((x) => x.path)).toEqual(['/9001', '/9101', '/9301']);
    expect(pauses.every((x) => x.opts.config?.token === 'tok')).toBe(true); // o cofre já estava vazio: usou o que leu antes
    expect(race()).toEqual([{ channel: 'meta', action: 'activate', workspace_id: WS_A, campaign_id: c.id, external_id: '9001', outcome: 'paused' }]);
  });

  it('Meta: pausa de compensação que falha fica no log como pause_failed (para pausar à mão)', async () => {
    const w = adsWorld();
    const c = published(w);
    w.respond((path, opts) => {
      if (path === '/9001' && opts.params?.status === 'ACTIVE') deleteWorkspace(w, c.id);
      if (opts.params?.status === 'PAUSED') return new Error('Meta fora do ar');
      return undefined;
    });
    expect(await status(w.meta.setStatus(OWNER, WS_A, c.id, 'ACTIVE'))).toBe('404:Campanha não encontrada.');
    expect(race()).toEqual([expect.objectContaining({ channel: 'meta', outcome: 'pause_failed', external_id: '9001', detail: 'Meta fora do ar' })]);
  });

  it('Meta: anúncio ligado pelo otimizador e recomendação sumiu com a empresa → pausa o anúncio e registra', async () => {
    const w = adsWorld();
    const c = published(w, { status: 'active', meta_delivery_status: 'ACTIVE' });
    const rec: any = { id: uid(), workspace_id: WS_A, campaign_id: c.id, action: 'activate_ad', title: 't', reason: 'r', status: 'pending', source: 'ai', payload: { executable: true, adId: '9301' }, created_at: new Date() };
    w.t['ai_recommendations']!.rows.push(rec);
    w.respond((path, opts) => {
      if (path === '/9301' && opts.params?.status === 'ACTIVE') {
        const rows = w.t['ai_recommendations']!.rows;
        rows.splice(rows.indexOf(rec), 1);
        deleteWorkspace(w, c.id);
      }
      return undefined;
    });
    expect(await status(w.adsOps.decide(OWNER, rec.id, 'apply'))).toBe('404:Recomendação não encontrada.');
    const pause = w.calls.find((x) => x.path === '/9301' && x.opts.params?.status === 'PAUSED');
    expect(pause?.opts.config?.token).toBe('tok');
    expect(race()).toEqual([expect.objectContaining({ channel: 'meta', action: 'activate_ad', external_id: '9301', outcome: 'paused' })]);
  });

  it('Meta: empresa apagada durante a publicação → nasce pausada na Meta, 404 e o id da campanha criada no log', async () => {
    const w = adsWorld();
    respondPublish(w);
    const c = w.seedCampaign({ objective: 'traffic', budget_daily: 40 });
    w.seedCreative(c.id);
    w.respond((path, opts) => {
      if (path.endsWith('/campaigns') && opts.method === 'POST') deleteWorkspace(w, c.id);
      return undefined;
    });
    expect(await status(w.meta.publish(OWNER, WS_A, c.id))).toBe('404:Campanha não encontrada.');
    expect(race()).toEqual([{ channel: 'meta', action: 'create', workspace_id: WS_A, campaign_id: c.id, external_id: '9001', outcome: 'created_paused' }]);
  });

  it('Google: empresa apagada enquanto ligava → pausa com as credenciais lidas antes; TikTok idem', async () => {
    const w = adsWorld();
    const g = w.seedCampaign({ status: 'approved', google_campaign_id: '4242', google_status: 'PAUSED' });
    w.google.setStatus = jest.fn(async (_ws: string, _id: string, st: string) => {
      if (st === 'ENABLED') deleteWorkspace(w, g.id);
    });
    expect(await status(w.channels.setStatus(OWNER, g.id, 'google', true))).toBe('404:Campanha não encontrada.');
    const calls = (w.google.setStatus as jest.Mock).mock.calls;
    expect(calls.map((x) => x[2])).toEqual(['ENABLED', 'PAUSED']);
    expect(calls[1][3]).toBe(calls[0][3]);
    expect(calls[1][3]).toEqual(expect.objectContaining({ refreshToken: null }));

    const t = w.seedCampaign({ status: 'approved', tiktok_campaign_id: '700', tiktok_status: 'DISABLE' });
    w.tiktok.setStatus = jest.fn(async (_ws: string, _id: string, st: string) => {
      if (st === 'ENABLE') deleteWorkspace(w, t.id);
      else throw new Error('TikTok fora do ar');
    });
    expect(await status(w.channels.setStatus(OWNER, t.id, 'tiktok', true))).toBe('404:Campanha não encontrada.');
    expect(race()).toEqual([
      { channel: 'google', action: 'activate', workspace_id: WS_A, campaign_id: g.id, external_id: '4242', outcome: 'paused' },
      { channel: 'tiktok', action: 'activate', workspace_id: WS_A, campaign_id: t.id, external_id: '700', outcome: 'pause_failed', detail: 'TikTok fora do ar' },
    ]);
  });

  it('Google: empresa apagada durante a criação → nasce pausada, 404 e o id externo no log (nada de 500)', async () => {
    const w = adsWorld();
    const c = w.seedCampaign();
    w.ai.json.mockResolvedValue({ titulos: ['T1', 'T2', 'T3'], descricoes: ['D1', 'D2'], palavras_chave: ['chope'] });
    w.google.createSearchCampaign = jest.fn(async () => {
      deleteWorkspace(w, c.id);
      return { campaignId: '4343', steps: [] };
    });
    expect(await status(w.channels.create(OWNER, c.id, 'google'))).toBe('404:Campanha não encontrada.');
    expect(race()).toEqual([{ channel: 'google', action: 'create', workspace_id: WS_A, campaign_id: c.id, external_id: '4343', outcome: 'created_paused' }]);
  });
});
