import { MetaError } from '../../instagram/meta-graph';
import { status } from '../../media/__tests__/mem';
import { AdsProviderError } from '../ads-errors';
import { MSG_CAMPAIGN_ENDED } from '../campaign-end.service';
import { IgCampaignService } from '../../instagram/ig-campaign.service';
import { IgStore } from '../../instagram/ig-store.service';
import { adsWorld, AdsWorld, ADMIN, MARKETING, OWNER, STRANGER, uid, VIEWER, WS_A, WS_B } from './harness';

/** Campanha publicada nos três canais (Meta com conjuntos/anúncios conhecidos, Google e TikTok). */
function published(w: AdsWorld, over: Record<string, unknown> = {}) {
  w.google.setStatus = jest.fn(async () => undefined);
  w.tiktok.setStatus = jest.fn(async () => undefined);
  return w.seedCampaign({
    status: 'active', meta_campaign_id: '9001', meta_adset_ids: ['9101', '9102'], meta_ad_ids: ['9301', '9302'], meta_delivery_status: 'ACTIVE',
    google_campaign_id: '4242', google_status: 'ENABLED', tiktok_campaign_id: '700', tiktok_status: 'ENABLE', ...over,
  });
}
const metaPaused = (w: AdsWorld) => w.calls.filter((c) => c.opts.method === 'POST' && c.opts.params?.status === 'PAUSED').map((c) => c.path);

/** Programação automática (com uma semana recorrente) e um plano "Criar plano no Instagram" desta campanha, com posts em vários estados. */
function instagram(w: AdsWorld, campaignId: string) {
  const run = { id: uid(), workspace_id: WS_A, campaign_id: campaignId, plan_id: uid(), status: 'active', recurring: true, parent_id: null };
  const week = { id: uid(), workspace_id: WS_A, campaign_id: null, plan_id: run.plan_id, status: 'active', recurring: true, parent_id: run.id };
  const plan = { id: uid(), workspace_id: WS_A, campaign_id: campaignId, status: 'active' };
  w.t['ig_auto_runs']!.rows.push(run, week);
  w.t['ig_content_plans']!.rows.push(plan);
  const post = (status: string, origin: Record<string, unknown>) => {
    const p: any = { id: uid(), workspace_id: WS_A, status, run_id: null, plan_id: null, ...origin };
    w.t['ig_posts']!.rows.push(p);
    return p;
  };
  const otherRun = { id: uid(), workspace_id: WS_A, campaign_id: null, plan_id: plan.id, status: 'active', recurring: true, parent_id: null };
  w.t['ig_auto_runs']!.rows.push(otherRun);
  const posts = {
    scheduled: post('scheduled', { run_id: run.id }),
    weekReady: post('ready', { run_id: week.id }),
    planApproved: post('approved', { plan_id: plan.id }),
    published: post('published', { plan_id: plan.id }),
    publishing: post('publishing', { run_id: run.id }),
    // Mesmo plano, mas de OUTRA programação (não desta campanha): fica.
    otherRunInPlan: post('scheduled', { plan_id: plan.id, run_id: otherRun.id }),
  };
  const job = (postId: string, st = 'pending') => {
    const j: any = { id: uid(), workspace_id: WS_A, channel: 'instagram_organic', ig_post_id: postId, status: st };
    w.t['publishing_jobs']!.rows.push(j);
    return j;
  };
  const jobs = { scheduled: job(posts.scheduled.id), done: job(posts.published.id, 'done') };
  // Outra campanha / outra empresa: nada disso pode ser tocado.
  const otherPlan = { id: uid(), workspace_id: WS_A, campaign_id: uid(), status: 'active' };
  w.t['ig_content_plans']!.rows.push(otherPlan);
  const foreign = post('scheduled', { plan_id: otherPlan.id });
  return { run, week, plan, otherRun, posts, jobs, otherPlan, foreign };
}

describe('CampaignEndService.end — encerrar campanha que já está no ar', () => {
  it('pausa Meta (campanha + conjuntos + anúncios), Google e TikTok; cancela os posts não publicados; marca "finished"; registra atividade', async () => {
    const w = adsWorld();
    const c = published(w);
    const ig = instagram(w, c.id);
    const r = await w.ending.end(OWNER, WS_A, c.id);
    expect(r).toMatchObject({ ok: true, status: 'finished', alreadyEnded: false, instagram: { cancelledPosts: 3, cancelledJobs: 1, publishingNow: 1 } });
    expect(r.channels).toEqual([
      { channel: 'meta', ok: true, message: 'Anúncios pausados na Meta.' },
      { channel: 'google', ok: true, message: 'Anúncios pausados no Google Ads.' },
      { channel: 'tiktok', ok: true, message: 'Anúncios pausados no TikTok Ads.' },
      { channel: 'instagram', ok: true, message: '3 posts agendados do Instagram foram cancelados. 1 post do Instagram já estava sendo publicado e vai sair normalmente.' },
    ]);
    expect(metaPaused(w)).toEqual(['/9001', '/9101', '/9102', '/9301', '/9302']);
    expect(w.google.setStatus).toHaveBeenCalledWith(WS_A, '4242', 'PAUSED');
    expect(w.tiktok.setStatus).toHaveBeenCalledWith(WS_A, '700', 'DISABLE');
    expect(c).toMatchObject({ status: 'finished', meta_delivery_status: 'PAUSED', google_status: 'PAUSED', tiktok_status: 'DISABLE' });
    // Instagram: programação + semana canceladas (sem recorrência), plano ativo pausado, posts não publicados cancelados.
    expect([ig.run, ig.week].map((x) => [x.status, x.recurring])).toEqual([['cancelled', false], ['cancelled', false]]);
    expect(ig.plan.status).toBe('paused');
    expect([ig.posts.scheduled, ig.posts.weekReady, ig.posts.planApproved].map((p) => p.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(ig.posts.published.status).toBe('published');
    expect(ig.posts.publishing.status).toBe('publishing');
    expect(ig.jobs.scheduled.status).toBe('cancelled');
    expect(ig.jobs.done.status).toBe('done');
    expect(ig.otherPlan.status).toBe('active');
    expect(ig.foreign.status).toBe('scheduled');
    expect(ig.posts.otherRunInPlan.status).toBe('scheduled');
    expect(ig.otherRun.status).toBe('active');
    // Evento no painel do Instagram, por plano, com o motivo (como cancelar uma programação).
    const events = w.t['ig_autopilot_events']!.rows.filter((e) => e.kind === 'guardrail');
    expect(events.map((e) => [e.plan_id, e.message]).sort()).toEqual([
      [ig.plan.id, 'Campanha encerrada: 1 post retirado da fila.'],
      [ig.run.plan_id, 'Campanha encerrada: 2 posts retirados da fila.'],
    ].sort());
    expect(w.activity.log).toHaveBeenCalledWith(WS_A, OWNER, 'campaign.ended', 'campaign', expect.objectContaining({ campaign_id: c.id, already_ended: false, ig_posts_cancelled: 3 }));
  });

  it('critério único (contagem do detalhe = cancelamento): semanas recorrentes entram, posts de outra programação no mesmo plano não', async () => {
    const w = adsWorld();
    const c = published(w);
    const ig = instagram(w, c.id);
    const svc = new IgCampaignService(new IgStore(w.prisma));
    expect(await svc.pendingForCampaign(WS_A, c.id)).toEqual({ linked: true, pending: 3, publishingNow: 1 });
    expect(await svc.pendingForCampaign(WS_A, uid())).toEqual({ linked: false, pending: 0, publishingNow: 0 });
    const r = await svc.cancelForCampaign(WS_A, c.id);
    expect(r.cancelledPosts).toBe(3);
    expect(ig.posts.otherRunInPlan.status).toBe('scheduled');
    expect(await svc.pendingForCampaign(WS_A, c.id)).toEqual({ linked: true, pending: 0, publishingNow: 1 });
  });

  it('pendências: recomendações da IA pendentes viram dispensadas e pedidos de aprovação pendentes são cancelados', async () => {
    const w = adsWorld();
    const c = published(w);
    const rec = { id: uid(), workspace_id: WS_A, campaign_id: c.id, status: 'pending', action: 'increase_budget', payload: {} };
    const applied = { id: uid(), workspace_id: WS_A, campaign_id: c.id, status: 'applied', action: 'pause_ad', payload: {} };
    w.t['ai_recommendations']!.rows.push(rec, applied);
    const req = { id: uid(), workspace_id: WS_A, campaign_id: c.id, entity_type: 'campaign', status: 'pending' };
    const other = { id: uid(), workspace_id: WS_A, campaign_id: uid(), entity_type: 'campaign', status: 'pending' };
    w.t['approval_requests']!.rows.push(req, other);
    await w.ending.end(OWNER, WS_A, c.id);
    expect([rec.status, applied.status]).toEqual(['dismissed', 'applied']);
    expect(req).toMatchObject({ status: 'cancelled', decided_by: OWNER });
    expect(other.status).toBe('pending');
  });

  it('falha num canal não impede os outros: resultado por canal e a coluna do canal que falhou não muda', async () => {
    const w = adsWorld();
    const c = published(w);
    w.respond((path) => (path === '/9001' ? new MetaError('A Meta respondeu com erro: fora do ar') : undefined));
    w.google.setStatus = jest.fn(async () => { throw new AdsProviderError('Google Ads: conta suspensa'); });
    w.tiktok.setStatus = jest.fn(async () => { throw new Error('bug interno com detalhe sensível'); });
    const r = await w.ending.end(ADMIN, WS_A, c.id);
    expect(r.channels).toEqual([
      { channel: 'meta', ok: false, message: 'Não foi possível pausar na Meta: A Meta respondeu com erro: fora do ar' },
      { channel: 'google', ok: false, message: 'Não foi possível pausar no Google Ads: Google Ads: conta suspensa' },
      { channel: 'tiktok', ok: false, message: 'Não foi possível pausar no TikTok Ads: erro inesperado. Tente de novo em instantes.' },
    ]);
    expect(c).toMatchObject({ status: 'finished', meta_delivery_status: 'ACTIVE', google_status: 'ENABLED', tiktok_status: 'ENABLE' });
  });

  it('idempotente: encerrar de novo não quebra, repete as pausas (útil se um canal falhou) e diz que já estava encerrada', async () => {
    const w = adsWorld();
    const c = published(w, { google_campaign_id: null, tiktok_campaign_id: null });
    const ig = instagram(w, c.id);
    await w.ending.end(OWNER, WS_A, c.id);
    const again = await w.ending.end(OWNER, WS_A, c.id);
    expect(again).toMatchObject({ ok: true, status: 'finished', alreadyEnded: true, instagram: { cancelledPosts: 0, cancelledJobs: 0, publishingNow: 1 } });
    expect(again.channels.map((x) => [x.channel, x.ok])).toEqual([['meta', true], ['instagram', true]]);
    // Sem "0 posts": só o que já está saindo; e nenhum evento novo de "0 retirados".
    expect(again.channels[1]!.message).toBe('1 post do Instagram já estava sendo publicado e vai sair normalmente.');
    expect(w.t['ig_autopilot_events']!.rows.filter((e) => /0 posts? retirad/.test(e.message))).toHaveLength(0);
    expect(c.status).toBe('finished');
    expect(ig.posts.published.status).toBe('published');
  });

  it('campanha só em rascunho (nunca publicada): sem canais, só fica encerrada', async () => {
    const w = adsWorld();
    const c = w.seedCampaign({ status: 'draft' });
    const r = await w.ending.end(OWNER, WS_A, c.id);
    expect(r.channels).toEqual([]);
    expect(c.status).toBe('finished');
    expect(w.calls).toHaveLength(0);
  });

  it('permissão manage: marketing/viewer 403, estranho 403; campanha de outra empresa = 404 sem tocar em nada', async () => {
    const w = adsWorld();
    const c = published(w);
    expect(await status(w.ending.end(MARKETING, WS_A, c.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.ending.end(VIEWER, WS_A, c.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.ending.end(STRANGER, WS_A, c.id))).toBe('403:Você não tem acesso a esta empresa.');
    const other = published(w, { workspace_id: WS_B });
    expect(await status(w.ending.end(OWNER, WS_A, other.id))).toBe('404:Campanha não encontrada.');
    expect(other.status).toBe('active');
    expect(c.status).toBe('active');
    expect(w.calls).toHaveLength(0);
  });
});

describe('campanha encerrada não volta ao ar pelos botões', () => {
  it('Meta: publicar e ativar → "Campanha encerrada."; pausar continua possível', async () => {
    const w = adsWorld();
    const fresh = w.seedCampaign({ status: 'finished' });
    w.seedCreative(fresh.id);
    expect(await status(w.meta.publish(OWNER, WS_A, fresh.id))).toBe(`400:${MSG_CAMPAIGN_ENDED}`);
    const live = published(w, { status: 'finished', meta_delivery_status: 'PAUSED' });
    expect(await status(w.meta.setStatus(OWNER, WS_A, live.id, 'ACTIVE'))).toBe(`400:${MSG_CAMPAIGN_ENDED}`);
    expect(await status(w.meta.setStatus(OWNER, WS_A, live.id, 'PAUSED'))).toBe('ok');
    expect(live.status).toBe('finished');
  });

  it('Google/TikTok: criar e ativar → "Campanha encerrada."; pausar continua possível', async () => {
    const w = adsWorld();
    const fresh = w.seedCampaign({ status: 'finished' });
    expect(await status(w.channels.create(OWNER, fresh.id, 'google'))).toBe(`400:${MSG_CAMPAIGN_ENDED}`);
    const live = published(w, { status: 'finished' });
    expect(await status(w.channels.setStatus(OWNER, live.id, 'google', true))).toBe(`400:${MSG_CAMPAIGN_ENDED}`);
    expect(await status(w.channels.setStatus(OWNER, live.id, 'tiktok', true))).toBe(`400:${MSG_CAMPAIGN_ENDED}`);
    expect(await status(w.channels.setStatus(OWNER, live.id, 'google', false))).toBe('ok');
  });

  it('regras automáticas: na encerrada só PAUSAM (nunca aumentam verba); recomendação que não é pausa é recusada', async () => {
    const w = adsWorld();
    const c = published(w, { status: 'finished', automation_rules: { enabled: true, scaleBelowCpl: 50 } });
    const scale = jest.spyOn(w.ops, 'setAdsetBudget');
    await w.adsOps.runAllRules();
    expect(scale).not.toHaveBeenCalled();
    const rec = { id: uid(), workspace_id: WS_A, campaign_id: c.id, status: 'pending', action: 'increase_budget', payload: { adsetId: '9101', newDailyBudget: 99 } };
    w.t['ai_recommendations']!.rows.push(rec);
    expect(await status(w.adsOps.applyRecommendation(rec.id, OWNER))).toBe(`400:${MSG_CAMPAIGN_ENDED}`);
    expect(rec.status).toBe('pending');
  });

  it('corrida: encerrada enquanto a Meta/Google ativava → pausa de novo e "Campanha encerrada."; a campanha não volta a ativa', async () => {
    const w = adsWorld();
    const c = published(w, { status: 'approved', meta_delivery_status: 'PAUSED', google_status: 'PAUSED' });
    // A Meta "ativa" e, no meio, alguém encerra a campanha.
    w.respond((path, opts) => {
      if (path === '/9001' && opts.params?.status === 'ACTIVE') c.status = 'finished';
      return undefined;
    });
    expect(await status(w.meta.setStatus(OWNER, WS_A, c.id, 'ACTIVE'))).toBe(`400:${MSG_CAMPAIGN_ENDED}`);
    expect(c).toMatchObject({ status: 'finished', meta_delivery_status: 'PAUSED' });
    expect(metaPaused(w)).toContain('/9001');
    // Google: idem.
    const g = published(w, { status: 'approved', google_status: 'PAUSED' });
    w.google.setStatus = jest.fn(async (_ws: string, _id: string, st: string) => { if (st === 'ENABLED') g.status = 'finished'; });
    expect(await status(w.channels.setStatus(OWNER, g.id, 'google', true))).toBe(`400:${MSG_CAMPAIGN_ENDED}`);
    expect(w.google.setStatus).toHaveBeenLastCalledWith(WS_A, '4242', 'PAUSED');
    expect(g).toMatchObject({ status: 'finished', google_status: 'PAUSED' });
  });
});
