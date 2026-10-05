import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorkspaceAccessGuard } from '../../access/workspace-access.guard';
import { ADMIN, MARKETING, OWNER, STRANGER, VIEWER, WS_A, WS_B, status } from '../../media/__tests__/mem';
import { InstagramResourcesController } from '../instagram-resources.controller';
import { InstagramController } from '../instagram.controller';
import {
  ApproveAutoStrategyDto, CreateAutoCalendarDto, CreateIgPlanDto, GenerateNextAutoMediaDto, PatchIgPostDto, PreviewAutoCalendarDto, RejectPostDto, SchedulePostDto, GenerateContentCalendarDto, GeneratePostAssetsDto,
} from '../instagram.dto';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';

function setup() {
  const w: IgWorld = igWorld();
  const s = igServices(w);
  return { w, s, r: s.resources };
}
const errs = async (cls: any, plain: unknown) => (await validate(plainToInstance(cls, plain) as object, { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property).sort();

describe('PATCH ig-posts (editor do post)', () => {
  it('salva legenda/hashtags/CTA/horário; horário null limpa; só o post do workspace', async () => {
    const { w, r } = setup();
    const p = seedPost(w, { scheduled_at: new Date() });
    await r.patchPost(WS_A, p.id, { caption: 'Nova', hashtags: ['a', 'b'], cta: 'Fale', scheduled_at: '2030-05-05T12:00:00-03:00' });
    expect(p).toMatchObject({ caption: 'Nova', hashtags: ['a', 'b'], cta: 'Fale' });
    expect(p.scheduled_at.toISOString()).toBe('2030-05-05T15:00:00.000Z');
    await r.patchPost(WS_A, p.id, { scheduled_at: null });
    expect(p.scheduled_at).toBeNull();
    expect(p.caption).toBe('Nova'); // campos não enviados ficam
    expect(await status(r.patchPost(WS_B, p.id, { caption: 'x' }))).toBe('404:Post não encontrado.');
  });

  it('creative_brief: o cliente não define nem apaga o pending_job (id do job no provedor é do servidor)', async () => {
    const { w, r } = setup();
    const p = seedPost(w, { status: 'generating', creative_brief: { prompt: 'a', pending_job: { jobId: 'veo:real', provider: 'gemini' } } });
    await r.patchPost(WS_A, p.id, { creative_brief: { prompt: 'b', layout: 'titulo_topo', visual_prompt_override: 'meu prompt', pending_job: { jobId: 'veo:forjado' } } });
    expect(p.creative_brief).toEqual({ prompt: 'b', layout: 'titulo_topo', visual_prompt_override: 'meu prompt', pending_job: { jobId: 'veo:real', provider: 'gemini' } });
    await r.patchPost(WS_A, p.id, { creative_brief: { prompt: 'c' } });
    expect(p.creative_brief.pending_job.jobId).toBe('veo:real'); // não pode "apagar"
    const free = seedPost(w, { creative_brief: { prompt: 'a' } });
    await r.patchPost(WS_A, free.id, { creative_brief: { prompt: 'z', pending_job: { jobId: 'veo:forjado' } } });
    expect(free.creative_brief).toEqual({ prompt: 'z' }); // nem criar
  });

  it('DTO: tamanhos, tipos e campos desconhecidos são recusados', async () => {
    expect(await errs(PatchIgPostDto, { caption: 'x', hashtags: ['a'], scheduled_at: '2030-05-05T12:00:00Z', creative_brief: {} })).toEqual([]);
    expect(await errs(PatchIgPostDto, { hashtags: Array.from({ length: 31 }, () => 'a') })).toEqual(['hashtags']);
    expect(await errs(PatchIgPostDto, { scheduled_at: '2030-05-05' })).toEqual(['scheduled_at']);
    expect(await errs(PatchIgPostDto, { status: 'published', media: [] })).toEqual(['media', 'status']); // status/media NÃO são editáveis aqui
    expect(await errs(PatchIgPostDto, { creative_brief: 'texto' })).toEqual(['creative_brief']);
  });
});

describe('planos de conteúdo (ig_content_plans)', () => {
  const body = (over: Record<string, unknown> = {}) => ({ name: 'Plano', brand_id: null, objective: 'Vender', tone_of_voice: 'leve', content_pillars: ['A', 'B'], posting_frequency: { feed_image: 2, feed_carousel: 1, feed: 3, reels: 2, stories: 5, extra: 99 }, preferred_times: ['09:00'], posting_days: [1, 3], hashtag_strategy: { notes: 'n', audience: 'a', lixo: 'x' }, cta_default: 'CTA', requires_approval: true, auto_publish: false, status: 'active', ...over }) as any;

  it('cria e edita só no workspace; limpa chaves desconhecidas; marca de outra empresa = 404', async () => {
    const { w, r } = setup();
    const brand = { id: uuid(), workspace_id: WS_A, name: 'B' };
    const alien = { id: uuid(), workspace_id: WS_B, name: 'X' };
    w.t['brands']!.rows.push(brand, alien);
    const plan = await r.createPlan(WS_A, body({ brand_id: brand.id }));
    expect(plan).toMatchObject({ workspace_id: WS_A, brand_id: brand.id, name: 'Plano', posting_frequency: { feed_image: 2, feed_carousel: 1, feed: 3, reels: 2, stories: 5 }, hashtag_strategy: { notes: 'n', audience: 'a' }, posting_days: [1, 3], status: 'active' });
    expect(await status(r.createPlan(WS_A, body({ brand_id: alien.id })))).toBe('404:Marca não encontrada.');
    await r.patchPlan(WS_A, plan.id, { status: 'paused', auto_publish: true });
    expect(w.t['ig_content_plans']!.rows[0]).toMatchObject({ status: 'paused', auto_publish: true, name: 'Plano' });
    expect(await status(r.patchPlan(WS_B, plan.id, { status: 'active' }))).toBe('404:Plano de conteúdo não encontrado.');
    expect(await status(r.patchPlan(WS_A, plan.id, { brand_id: alien.id }))).toBe('404:Marca não encontrada.');
    expect(await status(r.patchPlan(WS_A, plan.id, { name: 'ok' }))).toBe('ok');
  });

  it('lista mais novos primeiro; filtro de arquivados; DTO recusa status fora do CHECK', async () => {
    const { w, r } = setup();
    await r.createPlan(WS_A, body({ name: 'Velho' }));
    await r.createPlan(WS_A, body({ name: 'Novo' }));
    await r.createPlan(WS_B, body({ name: 'Alheio' }));
    expect((await r.listPlans(WS_A, false)).map((p) => p.name)).toEqual(['Novo', 'Velho']);
    expect((await r.listPlans(WS_A, true)).length).toBe(2);
    void w;
    expect(await errs(CreateIgPlanDto, body())).toEqual([]);
    expect(await errs(CreateIgPlanDto, body({ status: 'archived' }))).toEqual(['status']);
    expect(await errs(CreateIgPlanDto, body({ posting_days: [7] }))).toEqual(['posting_days']);
    expect(await errs(CreateIgPlanDto, body({ name: '' }))).toEqual(['name']);
    expect(await errs(CreateIgPlanDto, { ...body(), workspace_id: WS_B })).toEqual(['workspace_id']); // não aceita workspace_id do cliente
  });
});

describe('flags do plano exigem manage (publicar sem revisão)', () => {
  it('marketing edita o resto mas não auto_publish/requires_approval; owner e admin podem', async () => {
    const w = igWorld();
    const s = igServices(w);
    const ctrl = new InstagramResourcesController(s.resources, s.actions);
    const plan = await s.resources.createPlan(WS_A, { name: 'P' } as any);
    const msg = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus()}:${e.getResponse().message}`; } };
    const asMkt = { id: MARKETING } as any;
    expect(await msg(ctrl.patchPlan(asMkt, WS_A, plan.id, { auto_publish: true }))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await msg(ctrl.patchPlan(asMkt, WS_A, plan.id, { requires_approval: false }))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await msg(ctrl.createPlan(asMkt, WS_A, { name: 'x', auto_publish: true } as any))).toMatch(/^403:/);
    expect(await msg(ctrl.patchPlan(asMkt, WS_A, plan.id, { name: 'Novo nome' }))).toBe('ok');
    expect(await msg(ctrl.patchPlan({ id: OWNER } as any, WS_A, plan.id, { auto_publish: true, requires_approval: false }))).toBe('ok');
    expect(await msg(ctrl.patchPlan({ id: ADMIN } as any, WS_A, plan.id, { auto_publish: false }))).toBe('ok');
  });
  it('pageId só dígitos', async () => {
    const { ConnectInstagramDto } = await import('../instagram.dto');
    expect(await errs(ConnectInstagramDto, { workspaceId: uuid(), pageId: '123456' })).toEqual([]);
    expect(await errs(ConnectInstagramDto, { workspaceId: uuid(), pageId: '12/../me' })).toEqual(['pageId']);
  });
});

describe('leituras (todas escopadas no workspace)', () => {
  it('posts: por horário (sem data por último); contagem de aprovações; eventos/ métricas/ insights', async () => {
    const { w, r } = setup();
    const t = (d: number) => new Date(Date.UTC(2030, 0, d));
    seedPost(w, { scheduled_at: t(3), theme: 'c', status: 'pending_approval' });
    seedPost(w, { scheduled_at: null, theme: 'sem data', status: 'pending_approval' });
    seedPost(w, { scheduled_at: t(1), theme: 'a' });
    seedPost(w, { workspace_id: WS_B, theme: 'alheio', status: 'pending_approval' });
    seedPost(w, { scheduled_at: t(2), theme: 'revisão', status: 'needs_review' }); // posts em revisão também aparecem no selo
    expect((await r.listPosts(WS_A)).map((p) => p.theme)).toEqual(['a', 'revisão', 'c', 'sem data']);
    expect(await r.pendingCount(WS_A)).toEqual({ count: 3 });
    expect(await r.pendingCount(uuid())).toEqual({ count: 0 });
    for (let i = 0; i < 25; i++) w.t['ig_autopilot_events']!.rows.push({ id: uuid(), workspace_id: WS_A, kind: 'media', message: `e${i}`, created_at: new Date(2030, 0, 1, 0, i) });
    w.t['ig_autopilot_events']!.rows.push({ id: uuid(), workspace_id: WS_B, kind: 'media', message: 'alheio', created_at: new Date(2031, 0, 1) });
    const ev = await r.listEvents(WS_A);
    expect(ev).toHaveLength(20);
    expect(ev[0]!.message).toBe('e24');
    expect(await r.listEvents(WS_A, 5000)).toHaveLength(25);
    const post = seedPost(w, {});
    w.t['ig_post_metrics']!.rows.push({ id: uuid(), workspace_id: WS_A, post_id: post.id, reach: 1, collected_at: new Date(2030, 0, 1) }, { id: uuid(), workspace_id: WS_A, post_id: post.id, reach: 2, collected_at: new Date(2030, 0, 2) }, { id: uuid(), workspace_id: WS_B, post_id: uuid(), reach: 9, collected_at: new Date() });
    expect((await r.listMetrics(WS_A)).map((m) => m.reach)).toEqual([2, 1]);
    for (const d of ['2030-01-01', '2030-02-01', '2030-03-01']) w.t['ig_account_insights']!.rows.push({ id: uuid(), workspace_id: WS_A, date: new Date(`${d}T00:00:00Z`), reach: 1 });
    expect((await r.listAccountInsights(WS_A, '2030-02-01')).map((x) => x.date.toISOString().slice(0, 10))).toEqual(['2030-02-01', '2030-03-01']);
    expect(await r.listAccountInsights(WS_B)).toEqual([]);
  });

  it('conta: devolve a linha da empresa (sem tokens) ou nada', async () => {
    const { w, r } = setup();
    expect(await r.account(WS_A)).toBeNull();
    w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, status: 'connected', username: 'loja', ig_user_id: 'i' });
    expect(await r.account(WS_A)).toMatchObject({ username: 'loja' });
    expect(await r.account(WS_B)).toBeNull();
  });
});

describe('WorkspaceAccessGuard nas rotas de recurso (GET = read, escrita = write)', () => {
  const guard = (user: string, method: string, wsId: string = WS_A) => {
    const w = igWorld();
    const g = new WorkspaceAccessGuard(w.access, new Reflector());
    const req = { method, user: { id: user }, params: { workspaceId: wsId } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => () => undefined, getClass: () => InstagramResourcesController } as unknown as ExecutionContext;
    return g.canActivate(ctx);
  };
  it('viewer lê mas não escreve; marketing/admin/owner escrevem; estranho nunca', async () => {
    expect(await guard(VIEWER, 'GET')).toBe(true);
    await expect(guard(VIEWER, 'PATCH')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard(VIEWER, 'POST')).rejects.toBeInstanceOf(ForbiddenException);
    for (const u of [MARKETING, ADMIN, OWNER]) expect(await guard(u, 'PATCH')).toBe(true);
    await expect(guard(STRANGER, 'GET')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard(OWNER, 'GET', 'não-é-uuid')).rejects.toMatchObject({ status: 404 });
  });
});

describe('DTOs das ações (todo campo aceito tem validação)', () => {
  const auto = (over: Record<string, unknown> = {}) => ({ workspaceId: uuid(), startDate: '2030-01-01', endDate: '2030-01-07', weekdays: [1, 2], times: ['09:00'], storyTimes: [], formats: ['feed_image'], mode: 'approval', focus: 'Levar o público de Valinhos para almoçar o prato executivo durante a semana', ...over });

  it('createAutoCalendar', async () => {
    const FOCUS = 'Levar o público de Valinhos para almoçar o prato executivo durante a semana';
    expect(await errs(CreateAutoCalendarDto, auto())).toEqual([]);
    expect(await errs(CreateAutoCalendarDto, auto({ planId: null, brandId: null, campaignId: null, focus: FOCUS, recurring: true, asap: true }))).toEqual([]);
    // o objetivo do período é obrigatório (≥ 30 caracteres depois do trim, ≤ 1000) com a mensagem do protótipo
    const msg = async (over: Record<string, unknown>) => (await validate(plainToInstance(CreateAutoCalendarDto, auto(over)) as object)).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(await errs(CreateAutoCalendarDto, auto({ focus: undefined }))).toEqual(['focus']);
    expect(await errs(CreateAutoCalendarDto, auto({ focus: 'curto demais' }))).toEqual(['focus']);
    expect(await errs(CreateAutoCalendarDto, auto({ focus: `  ${'x'.repeat(29)}  ` }))).toEqual(['focus']);
    expect(await errs(CreateAutoCalendarDto, auto({ focus: `  ${'x'.repeat(30)}  ` }))).toEqual([]);
    expect(await msg({ focus: 'curto' })).toContain('Descreva o objetivo deste período (mínimo de 30 caracteres).');
    expect(await errs(CreateAutoCalendarDto, auto({ weekdays: [] }))).toEqual(['weekdays']); // criar exige ao menos um dia (min 1 do protótipo)
    expect(await errs(CreateAutoCalendarDto, auto({ weekdays: [7] }))).toEqual(['weekdays']);
    expect(await errs(CreateAutoCalendarDto, auto({ times: Array.from({ length: 9 }, () => '09:00') }))).toEqual(['times']);
    expect(await errs(CreateAutoCalendarDto, auto({ storyTimes: Array.from({ length: 11 }, () => '09:00') }))).toEqual(['storyTimes']);
    expect(await errs(CreateAutoCalendarDto, auto({ times: ['9h'] }))).toEqual(['times']);
    expect(await errs(CreateAutoCalendarDto, auto({ formats: [] }))).toEqual(['formats']);
    expect(await errs(CreateAutoCalendarDto, auto({ formats: ['gif'] }))).toEqual(['formats']);
    expect(await errs(CreateAutoCalendarDto, auto({ mode: 'auto' }))).toEqual(['mode']);
    expect(await errs(CreateAutoCalendarDto, auto({ startDate: '01/01/2030' }))).toEqual(['startDate']);
    expect(await errs(CreateAutoCalendarDto, auto({ focus: 'x'.repeat(1001) }))).toEqual(['focus']);
    expect(await errs(CreateAutoCalendarDto, auto({ workspaceId: 'x' }))).toEqual(['workspaceId']);
    expect(await errs(CreateAutoCalendarDto, auto({ createdBy: uuid() }))).toEqual(['createdBy']);
  });

  it('previewAutoCalendar (sem workspace) / generateNextAutoMedia / schedulePost / rejectPost / generateContentCalendar / generatePostAssets', async () => {
    const { workspaceId: _w, mode: _m, focus: _f, ...pv } = auto(); // a prévia não tem objetivo
    expect(await errs(PreviewAutoCalendarDto, pv)).toEqual([]);
    expect(await errs(PreviewAutoCalendarDto, { ...pv, weekdays: [] })).toEqual([]); // a prévia aceita vazio (0 horários)
    expect(await errs(PreviewAutoCalendarDto, { ...pv, mode: 'publish' })).toEqual(['mode']);
    expect(await errs(ApproveAutoStrategyDto, { runId: uuid() })).toEqual([]);
    expect(await errs(ApproveAutoStrategyDto, { runId: uuid(), editedText: null })).toEqual([]);
    expect(await errs(ApproveAutoStrategyDto, { runId: uuid(), editedText: 'x'.repeat(4000) })).toEqual([]);
    expect(await errs(ApproveAutoStrategyDto, { runId: uuid(), editedText: 'x'.repeat(4001) })).toEqual(['editedText']);
    expect(await errs(ApproveAutoStrategyDto, { runId: 'x' })).toEqual(['runId']);
    expect(await errs(ApproveAutoStrategyDto, { runId: uuid(), extra: 1 })).toEqual(['extra']);
    expect(await errs(GenerateNextAutoMediaDto, { runId: uuid(), withinHours: 72 })).toEqual([]);
    expect(await errs(GenerateNextAutoMediaDto, { runId: uuid(), withinHours: 0 })).toEqual(['withinHours']);
    expect(await errs(GenerateNextAutoMediaDto, { runId: uuid(), withinHours: 73 })).toEqual(['withinHours']);
    const ids = { workspaceId: uuid(), postId: uuid() };
    expect(await errs(SchedulePostDto, { ...ids, scheduledAt: '2030-01-01T10:00:00-03:00' })).toEqual([]);
    expect(await errs(SchedulePostDto, { ...ids, scheduledAt: '2030-01-01T10:00:00Z' })).toEqual([]);
    expect(await errs(SchedulePostDto, { ...ids, scheduledAt: '2030-01-01T10:00:00' })).toEqual(['scheduledAt']);
    expect(await errs(SchedulePostDto, { ...ids, scheduledAt: 'amanhã' })).toEqual(['scheduledAt']);
    expect(await errs(RejectPostDto, { ...ids, reason: '' })).toEqual(['reason']);
    expect(await errs(RejectPostDto, { ...ids, reason: 'x'.repeat(1001) })).toEqual(['reason']);
    expect(await errs(GenerateContentCalendarDto, { workspaceId: uuid(), planId: uuid(), weeks: 9 })).toEqual(['weeks']);
    expect(await errs(GenerateContentCalendarDto, { workspaceId: uuid(), planId: uuid(), weeks: 2, engine: 'claude' })).toEqual(['engine']);
    expect(await errs(GeneratePostAssetsDto, { ...ids, provider: 'auto', adjust: 'x'.repeat(301) })).toEqual(['adjust']);
    expect(await errs(GeneratePostAssetsDto, { ...ids, provider: 'midjourney' })).toEqual(['provider']);
  });

  it('as 23 ações (21 do protótipo + aprovar/refazer a estratégia) viram rotas POST /v1/instagram/<kebab>', () => {
    const paths = Reflect.ownKeys(InstagramController.prototype).filter((k) => k !== 'constructor').map((k) => Reflect.getMetadata('path', (InstagramController.prototype as any)[k]));
    expect(paths.sort()).toEqual([
      'approve-auto-strategy', 'approve-post', 'cancel-auto-calendar', 'collect-account-insights-now', 'collect-post-metrics', 'connect-instagram-account', 'create-auto-calendar', 'disconnect-instagram-account',
      'fill-auto-calendar', 'generate-content-calendar', 'generate-next-auto-media', 'generate-post-assets', 'list-instagram-options', 'preview-auto-calendar', 'publish-instagram-post',
      'redo-auto-strategy', 'regenerate-caption', 'regenerate-media', 'reject-post', 'schedule-post', 'suggest-pillars', 'sync-instagram-history', 'upload-post-media',
    ]);
  });
});
