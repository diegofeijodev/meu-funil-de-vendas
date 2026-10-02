import { ADMIN, MARKETING, OWNER, STRANGER, VIEWER, WS_A, WS_B, status } from '../../media/__tests__/mem';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';
import { MetaError } from '../meta-graph';

const msgOf = (e: any) => (e?.getResponse ? e.getResponse().message : e?.message);
const IG = 'ig-user-1';

function setup() {
  const w: IgWorld = igWorld();
  const s = igServices(w);
  return { w, s, a: s.actions };
}
const connected = (w: IgWorld) => w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, ig_user_id: IG, status: 'connected', username: 'loja' });

describe('autorização (substitui o RLS: viewer só lê, empresa alheia não vaza)', () => {
  it('viewer não executa nenhuma ação que escreve ou gasta crédito', async () => {
    const { w, s, a } = setup();
    const post = seedPost(w);
    const calls: [string, Promise<unknown>][] = [
      ['connect', a.connect(VIEWER, WS_A)],
      ['options', a.listOptions(VIEWER, WS_A)],
      ['sync', a.syncHistory(VIEWER, WS_A)],
      ['disconnect', a.disconnect(VIEWER, WS_A)],
      ['calendar', a.generateContentCalendar(VIEWER, WS_A, uuid())],
      ['pillars', a.suggestPillars(VIEWER, WS_A, {})],
      ['caption', a.regenerateCaption(VIEWER, WS_A, post.id, undefined)],
      ['assets', a.generatePostAssets(VIEWER, WS_A, post.id)],
      ['upload', a.uploadPostMedia(VIEWER, WS_A, post.id, { filename: 'a.png', mimetype: 'image/png', bytes: Buffer.from('x') })],
      ['approve', a.approvePost(VIEWER, WS_A, post.id)],
      ['reject', a.rejectPost(VIEWER, WS_A, post.id, 'x')],
      ['schedule', a.schedulePost(VIEWER, WS_A, post.id, new Date().toISOString())],
      ['publish', a.publishInstagramPost(VIEWER, WS_A, post.id)],
      ['metrics', a.collectPostMetrics(VIEWER, WS_A, post.id)],
      ['insights', a.collectAccountInsightsNow(VIEWER, WS_A)],
      ['auto-approval', a.createAutoCalendar(VIEWER, { workspaceId: WS_A, startDate: '2030-01-01', endDate: '2030-01-02', weekdays: [1], times: ['10:00'], storyTimes: [], formats: ['feed_image'], mode: 'approval' } as any)],
    ];
    for (const [name, p] of calls) expect([name, await status(p)]).toEqual([name, '403:Seu perfil não tem permissão para esta ação.']);
    expect(s.provider.generateImage).not.toHaveBeenCalled();
    expect(s.ai.jsonWithEngine).not.toHaveBeenCalled();
    expect(post.status).toBe('approved');
  });

  it('marketing edita mas não conecta conta nem programa "publica sozinho"; owner/admin podem', async () => {
    const { w, a } = setup();
    const post = seedPost(w, { status: 'pending_approval', approved_at: null });
    expect(await status(a.approvePost(MARKETING, WS_A, post.id))).toBe('ok');
    expect(await status(a.connect(MARKETING, WS_A))).toBe('403:Seu perfil não tem permissão para esta ação.');
    const auto = (mode: string) => ({ workspaceId: WS_A, startDate: '2030-01-01', endDate: '2030-01-02', weekdays: [0, 1, 2, 3, 4, 5, 6], times: ['10:00'], storyTimes: [], formats: ['feed_image'], mode, planId: uuid() }) as any;
    expect(await status(a.createAutoCalendar(MARKETING, auto('publish')))).toBe('403:Seu perfil não tem permissão para esta ação.');
    // com aprovação o marketing passa da autorização (e cai na checagem do plano, que não existe: 404)
    expect(await status(a.createAutoCalendar(MARKETING, auto('approval')))).toBe('404:Plano de conteúdo não encontrado.');
    expect(await status(a.createAutoCalendar(ADMIN, auto('publish')))).toBe('404:Plano de conteúdo não encontrado.');
    expect(await status(a.createAutoCalendar(OWNER, { ...auto('publish'), times: [], storyTimes: [] }))).toBe('400:Informe ao menos um horário.');
  });

  it('quem é de outra empresa recebe 403 e nada é tocado; post de outra empresa = 404', async () => {
    const { w, a } = setup();
    const post = seedPost(w);
    expect(await status(a.approvePost(STRANGER, WS_A, post.id))).toBe('403:Você não tem acesso a esta empresa.');
    expect(await status(a.generatePostAssets(STRANGER, WS_A, post.id))).toBe('403:Você não tem acesso a esta empresa.');
    // dono da empresa B tentando agir no post da A pelo workspaceId da B
    expect(await status(a.approvePost(STRANGER, WS_B, post.id))).toBe('404:Post não encontrado.');
    expect(await status(a.rejectPost(STRANGER, WS_B, post.id, 'x'))).toBe('404:Post não encontrado.');
    expect(await status(a.schedulePost(STRANGER, WS_B, post.id, new Date().toISOString()))).toBe('404:Post não encontrado.');
    expect(await status(a.publishInstagramPost(STRANGER, WS_B, post.id))).toBe('404:Post não encontrado.');
    expect(await status(a.collectPostMetrics(STRANGER, WS_B, post.id))).toBe('404:Post não encontrado.');
    expect(await status(a.regenerateCaption(STRANGER, WS_B, post.id, undefined))).toBe('404:Post não encontrado.');
    expect(await status(a.generatePostAssets(STRANGER, WS_B, post.id))).toBe('404:Post não encontrado.');
    expect(post.status).toBe('approved');
    expect(post.last_error).toBeNull();
  });
});

describe('conta do Instagram', () => {
  it('connect: lê a Página e o IG, grava a conta conectada e importa o histórico em seguida', async () => {
    const { w, s, a } = setup();
    w.respond((path) => {
      if (path === '/page1') return { instagram_business_account: { id: IG } };
      if (path === `/${IG}`) return { username: 'loja', profile_picture_url: 'https://p/x.jpg' };
      if (path === `/${IG}/media`) return { data: [] };
    });
    const r = await a.connect(OWNER, WS_A);
    expect(r).toEqual({ ok: true, username: 'loja', igUserId: IG });
    expect(w.t['instagram_accounts']!.rows[0]).toMatchObject({ workspace_id: WS_A, ig_user_id: IG, username: 'loja', facebook_page_id: 'page1', status: 'connected', last_error: null });
    expect(w.calls.some((c) => c.path === `/${IG}/media`)).toBe(true);
    // reconectar com outra Página troca a conta (upsert por empresa)
    w.respond((path) => (path === '/page2' ? { instagram_business_account: { id: 'ig2' } } : path === '/ig2' ? { username: 'outra' } : undefined));
    await a.connect(OWNER, WS_A, 'page2');
    expect(w.t['instagram_accounts']!.rows).toHaveLength(1);
    expect(w.t['instagram_accounts']!.rows[0]).toMatchObject({ ig_user_id: 'ig2', username: 'outra', facebook_page_id: 'page2' });
    void s;
  });

  it('connect: erros viram { ok:false, error } (HTTP 200) e a conta fica em "error"', async () => {
    const { w, a } = setup();
    w.cfg.token = null as any;
    expect(await a.connect(OWNER, WS_A)).toEqual({ ok: false, error: 'Salve as credenciais da Meta em Integrações antes de conectar o Instagram.' });
    w.cfg.token = 'tok';
    w.cfg.pageId = null as any;
    expect((await a.connect(OWNER, WS_A) as any).error).toBe('ID da Página do Facebook não configurado.');
    w.cfg.pageId = 'page1';
    w.respond((path) => (path === '/page1' ? {} : undefined));
    expect((await a.connect(OWNER, WS_A) as any).error).toBe('Esta Página não tem uma conta profissional do Instagram vinculada.');
    expect(w.t['instagram_accounts']!.rows[0]).toMatchObject({ status: 'error', last_error: 'Esta Página não tem uma conta profissional do Instagram vinculada.' });
  });

  it('listOptions mapeia as Páginas; sem token devolve ok:false', async () => {
    const { w, a } = setup();
    w.respond((path, opts) => (path === '/me/accounts' ? (opts.params.limit === '100' ? { data: [{ id: 'p1', name: 'Loja', instagram_business_account: { id: 'i1', username: 'loja', profile_picture_url: 'u' } }, { id: 'p2', name: 'Sem IG' }] } : {}) : undefined));
    expect(await a.listOptions(OWNER, WS_A)).toEqual({
      ok: true,
      options: [{ pageId: 'p1', pageName: 'Loja', igUserId: 'i1', username: 'loja', picture: 'u' }, { pageId: 'p2', pageName: 'Sem IG', igUserId: null, username: null, picture: null }],
    });
    w.cfg.token = null as any;
    expect(await a.listOptions(OWNER, WS_A)).toEqual({ ok: false, error: 'Salve as credenciais da Meta em Integrações primeiro.', options: [] });
  });

  it('disconnect apaga só a conta da empresa', async () => {
    const { w, a } = setup();
    connected(w);
    w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_B, ig_user_id: 'x', status: 'connected' });
    expect(await a.disconnect(OWNER, WS_A)).toEqual({ ok: true });
    expect(w.t['instagram_accounts']!.rows.map((r) => r.workspace_id)).toEqual([WS_B]);
  });

  it('syncHistory: sem conta = 400; importa só o que falta, parseia hashtags/formato, guarda na biblioteca e coleta métricas', async () => {
    const { w, s, a } = setup();
    expect(await status(a.syncHistory(OWNER, WS_A))).toBe('400:Conecte uma conta do Instagram antes de importar o histórico.');
    connected(w);
    seedPost(w, { status: 'published', ig_media_id: 'm-old' });
    w.respond((path) => {
      if (path === `/${IG}/media`)
        return {
          data: [
            { id: 'm-old', caption: 'ja existe', media_type: 'IMAGE', timestamp: '2026-09-01T12:00:00+0000' },
            { id: 'm1', caption: 'Promoção do dia #chopp #Valinhos_SP\nlinha 2', media_type: 'IMAGE', permalink: 'https://ig/p/1', timestamp: '2026-09-02T12:00:00+0000', media_url: 'https://scontent/1.jpg' },
            { id: 'm2', caption: 'Reel #x', media_type: 'VIDEO', media_product_type: 'REELS', media_url: 'https://scontent/2.mp4', thumbnail_url: 'https://scontent/2.jpg' },
            { id: 'm3', caption: 'Story', media_type: 'IMAGE', media_product_type: 'STORY', thumbnail_url: 'https://scontent/3.jpg' },
            { id: 'm4', caption: 'Carrossel', media_type: 'CAROUSEL_ALBUM', media_url: 'https://scontent/4.jpg' },
          ],
        };
      if (/\/insights$/.test(path)) return { data: [{ name: 'reach', values: [{ value: 10 }] }, { name: 'views', values: [{ value: 30 }] }] };
    });
    const r = await a.syncHistory(OWNER, WS_A);
    expect(r).toEqual({ ok: true, imported: 4, total: 5, metrics: 5 });
    const rows = w.t['ig_posts']!.rows.filter((p) => p.source === 'instagram_import');
    expect(rows.map((p) => [p.ig_media_id, p.format])).toEqual([['m1', 'feed_image'], ['m2', 'reel'], ['m3', 'story_image'], ['m4', 'feed_carousel']]);
    expect(rows[0]).toMatchObject({ status: 'published', hashtags: ['chopp', 'Valinhos_SP'], caption: 'Promoção do dia  \nlinha 2', theme: 'Promoção do dia #chopp #Valinhos_SP', ig_permalink: 'https://ig/p/1', creative_brief: { imported: true }, workspace_id: WS_A });
    expect(rows[0].caption).not.toMatch(/#/);
    expect(rows[1].media[0]).toMatchObject({ type: 'video', url: 'https://scontent/2.mp4' });
    // biblioteca: arquivo guardado sem normalizar, status aprovado
    expect(s.assets.ingest).toHaveBeenCalledTimes(4);
    expect(s.assets.ingest.mock.calls[0][0]).toMatchObject({ source: 'instagram', normalize: false, status: 'approved', workspaceId: WS_A });
    expect(w.t['ig_post_metrics']!.rows).toHaveLength(5);
    expect(w.t['ig_post_metrics']!.rows[0]).toMatchObject({ reach: 10, impressions: 30, plays: 30, workspace_id: WS_A });
    // segunda importação: nada novo
    expect((await a.syncHistory(OWNER, WS_A) as any).imported).toBe(0);
  });
});

describe('conteúdo (IA)', () => {
  it('generateContentCalendar: cria ideias com brief, filtra dias do plano e nomeia o provedor', async () => {
    const { w, s, a } = setup();
    const plan = { id: uuid(), workspace_id: WS_A, posting_days: [1], cta_default: 'Peça já', content_pillars: ['A'], posting_frequency: {}, preferred_times: [], hashtag_strategy: {}, pillar_weights: {}, status: 'active', brand_id: null };
    w.t['ig_content_plans']!.rows.push(plan);
    s.aiJson['ig_calendar'] = () => ({
      posts: [
        { format: 'reel', scheduled_at: '2026-10-05T10:00:00-03:00', theme: 'T1', hook: 'H', caption: 'C', hashtags: '#a #b', cta: '', image_prompt: 'cena', slides: [] }, // segunda
        { format: 'xyz', scheduled_at: '2026-10-06T10:00:00-03:00', theme: 'T2', hook: 'H', caption: 'C', hashtags: [], cta: 'X', image_prompt: 'p', slides: [] }, // terça: fora do plano
        { format: 'feed_carousel', scheduled_at: 'lixo', theme: 'T3', hook: 'H', caption: 'C', hashtags: [], cta: 'X', image_prompt: 'p', slides: ['s1', 's2'] },
      ],
    });
    const r = await a.generateContentCalendar(OWNER, WS_A, plan.id, 2);
    expect(r).toEqual({ created: 2, provider: 'lovable_ai' });
    const rows = w.t['ig_posts']!.rows;
    expect(rows[0]).toMatchObject({ workspace_id: WS_A, plan_id: plan.id, format: 'reel', status: 'idea', theme: 'T1', hashtags: ['a', 'b'], cta: 'Peça já', creative_brief: { prompt: 'cena', slides: [], aspect_ratio: '9:16' }, ai_provider: 'lovable_ai' });
    expect(rows[1]).toMatchObject({ format: 'feed_carousel', scheduled_at: null, creative_brief: { slides: ['s1', 's2'], aspect_ratio: '4:5' } });
    expect(s.ai.jsonWithEngine.mock.calls[0][1].prompt).toMatch(/calendário de 2 semana\(s\)/);
  });

  it('generateContentCalendar: plano de outra empresa = 404; IA sem posts = 502', async () => {
    const { w, s, a } = setup();
    const other = { id: uuid(), workspace_id: WS_B, posting_days: [0, 1, 2, 3, 4, 5, 6], content_pillars: [], posting_frequency: {}, preferred_times: [], hashtag_strategy: {}, pillar_weights: {} };
    const mine = { ...other, id: uuid(), workspace_id: WS_A };
    w.t['ig_content_plans']!.rows.push(other, mine);
    expect(await status(a.generateContentCalendar(OWNER, WS_A, other.id))).toBe('404:Plano de conteúdo não encontrado.');
    s.aiJson['ig_calendar'] = () => ({ posts: [] });
    expect(await status(a.generateContentCalendar(OWNER, WS_A, mine.id))).toBe('502:A IA não devolveu posts.');
  });

  it('regenerateCaption reescreve legenda/hashtags/CTA e registra no log; sem conteúdo ruim', async () => {
    const { w, s, a } = setup();
    const p = seedPost(w, { caption: 'velha', cta: 'antigo' });
    s.aiJson['ig_caption'] = () => ({ caption: 'nova legenda', hashtags: ['x', '#y'], cta: 'novo' });
    expect(await a.regenerateCaption(MARKETING, WS_A, p.id, 'mais curto', 'gemini')).toEqual({ ok: true });
    expect(p).toMatchObject({ caption: 'nova legenda', hashtags: ['x', 'y'], cta: 'novo' });
    expect(p.ai_generation_log[0]).toMatchObject({ step: 'caption', provider: 'lovable_ai', instructions: 'mais curto' });
    const call = s.ai.jsonWithEngine.mock.calls[0][1];
    expect(call.engine).toBe('gemini');
    expect(call.prompt).toMatch(/Instruções: mais curto/);
  });

  it('suggestPillars devolve até 5; marca de outra empresa = 404', async () => {
    const { w, s, a } = setup();
    s.aiJson['ig_pillars'] = () => ({ pillars: ['1', '2', '3', '4', '5', '6', '7'] });
    expect(await a.suggestPillars(OWNER, WS_A, { objective: 'vender' })).toEqual({ pillars: ['1', '2', '3', '4', '5'] });
    const brand = { id: uuid(), workspace_id: WS_B, name: 'Alheia' };
    w.t['brands']!.rows.push(brand);
    expect(await status(a.suggestPillars(OWNER, WS_A, { brandId: brand.id }))).toBe('404:Marca não encontrada.');
    expect(JSON.stringify(s.ai.jsonWithEngine.mock.calls)).not.toMatch(/Alheia/);
  });
});

describe('aprovação, reprovação e agenda', () => {
  it('approvePost: exige mídia; aprova; plano no piloto agenda sozinho para o horário previsto', async () => {
    const { w, a } = setup();
    expect(await status(a.approvePost(OWNER, WS_A, seedPost(w, { media: [], status: 'pending_approval' }).id))).toBe('400:Gere a mídia antes de aprovar.');
    connected(w);
    const plan = { id: uuid(), workspace_id: WS_A, auto_publish: true, status: 'active', requires_approval: true };
    w.t['ig_content_plans']!.rows.push(plan);
    const when = new Date(Date.now() + 5 * 3600e3);
    const p = seedPost(w, { status: 'pending_approval', approved_at: null, plan_id: plan.id, scheduled_at: when });
    expect(await a.approvePost(OWNER, WS_A, p.id)).toEqual({ ok: true });
    expect(p).toMatchObject({ status: 'scheduled', rejection_reason: null });
    expect(p.approved_at).toBeInstanceOf(Date);
    expect(w.t['publishing_jobs']!.rows[0]).toMatchObject({ ig_post_id: p.id, status: 'pending', run_at: when });
    expect(w.t['ig_autopilot_events']!.rows.map((e) => e.kind)).toEqual(['approval', 'schedule']);
  });

  it('approvePost num plano sem piloto só aprova (não agenda)', async () => {
    const { w, a } = setup();
    const plan = { id: uuid(), workspace_id: WS_A, auto_publish: false, status: 'active', requires_approval: true };
    w.t['ig_content_plans']!.rows.push(plan);
    const p = seedPost(w, { status: 'pending_approval', approved_at: null, plan_id: plan.id, scheduled_at: new Date(Date.now() + 3600e3) });
    await a.approvePost(OWNER, WS_A, p.id);
    expect(p.status).toBe('approved');
    expect(w.t['publishing_jobs']!.rows).toHaveLength(0);
  });

  it('rejectPost cancela com o motivo', async () => {
    const { w, a } = setup();
    const p = seedPost(w, { status: 'pending_approval' });
    expect(await a.rejectPost(OWNER, WS_A, p.id, 'Texto errado')).toEqual({ ok: true });
    expect(p).toMatchObject({ status: 'cancelled', rejection_reason: 'Texto errado' });
  });

  it('publishInstagramPost: falha vira { ok:false, sandbox:false, error } e o post fica failed', async () => {
    const { w, a } = setup();
    const p = seedPost(w);
    const r = await a.publishInstagramPost(OWNER, WS_A, p.id); // sem conta conectada
    expect(r).toMatchObject({ ok: false, sandbox: false });
    expect((r as any).error).toMatch(/Nenhuma conta do Instagram conectada/);
    expect(p).toMatchObject({ status: 'failed' });
    expect(p.last_error).toBe((r as any).error);
  });
});

describe('métricas e insights', () => {
  it('collectPostMetrics: exige post publicado; grava a linha; cai para o conjunto essencial se a Meta recusar uma métrica', async () => {
    const { w, a } = setup();
    expect(await status(a.collectPostMetrics(OWNER, WS_A, seedPost(w).id))).toBe('400:Post ainda não publicado.');
    expect(await status(a.collectPostMetrics(OWNER, WS_A, seedPost(w, { ig_media_id: 'sim_1' }).id))).toBe('400:Post antigo do modo simulado: não existe no Instagram.');
    const p = seedPost(w, { status: 'published', ig_media_id: 'media1', format: 'reel' });
    const asked: string[] = [];
    w.respond((path, opts) => {
      if (path !== '/media1/insights') return undefined;
      asked.push(opts.params.metric);
      if (asked.length === 1) return new MetaError('A Meta recusou um dos dados enviados: metric ig_reels_avg_watch_time');
      return { data: [{ name: 'reach', values: [{ value: 7 }] }, { name: 'saved', values: [{ value: 2 }] }, { name: 'views', total_value: { value: 40 } }, { name: 'comments', values: [{ value: 1 }] }] };
    });
    const r = await a.collectPostMetrics(OWNER, WS_A, p.id);
    expect(asked[0]).toContain('ig_reels_avg_watch_time');
    expect(asked[1]).toBe('views,reach,likes,comments,saved,shares');
    expect(r).toEqual({ ok: true, values: { reach: 7, saved: 2, views: 40, comments: 1 } });
    expect(w.t['ig_post_metrics']!.rows[0]).toMatchObject({ post_id: p.id, workspace_id: WS_A, reach: 7, saves: 2, impressions: 40, plays: 40, comments: 1, likes: null });
    expect(w.t['ig_post_metrics']!.rows[0].raw).toMatchObject({ label: 'manual', reach: 7 });
  });

  it('story: navegação por tipo e respostas contam como comentários', async () => {
    const { w, s } = setup();
    const p = seedPost(w, { status: 'published', ig_media_id: 'st1', format: 'story_image' });
    w.respond((path) => (path === '/st1/insights' ? { data: [{ name: 'replies', values: [{ value: 3 }] }, { name: 'navigation', total_value: { value: 9, breakdowns: [{ results: [{ dimension_values: ['TAP_FORWARD'], value: 5 }, { dimension_values: ['TAP_EXIT'], value: 4 }] }] } }] } : undefined));
    const r = await s.metrics.collectPostMetrics(p.id, '1h');
    expect(r.values).toEqual({ replies: 3, navigation_tap_forward: 5, navigation_tap_exit: 4, navigation: 9 });
    expect(w.t['ig_post_metrics']!.rows[0].comments).toBe(3);
    expect(p.metrics_collected).toEqual(['1h']);
  });

  it('collectDueMetrics: coleta a janela devida (1h/24h/7d; stories 1h/20h) uma vez só', async () => {
    const { w, s } = setup();
    w.respond((path) => (/\/insights$/.test(path) ? { data: [{ name: 'reach', values: [{ value: 1 }] }] } : undefined));
    const h = (n: number) => new Date(Date.now() - n * 3600e3);
    const young = seedPost(w, { status: 'published', ig_media_id: 'a', published_at: h(0.5) });
    const day = seedPost(w, { status: 'published', ig_media_id: 'b', published_at: h(25), metrics_collected: ['1h'] });
    const old = seedPost(w, { status: 'published', ig_media_id: 'c', published_at: h(24 * 9) });
    const story = seedPost(w, { status: 'published', ig_media_id: 'd', format: 'story_image', published_at: h(21) });
    const expired = seedPost(w, { status: 'published', ig_media_id: 'e', format: 'story_image', published_at: h(23.9) });
    const sim = seedPost(w, { status: 'published', ig_media_id: 'sim_9', published_at: h(30) });
    expect(await s.metrics.collectDueMetrics()).toBe(2);
    expect(day.metrics_collected).toEqual(['1h', '24h']);
    expect(story.metrics_collected).toEqual(['20h']);
    for (const p of [young, old, expired, sim]) expect(p.metrics_collected).toEqual([]);
    // a janela de 1 h do story ficou para trás (só a mais recente é coletada por execução): a próxima a completa, como o protótipo
    expect(await s.metrics.collectDueMetrics()).toBe(1);
    expect(story.metrics_collected).toEqual(['20h', '1h']);
    expect(await s.metrics.collectDueMetrics()).toBe(0);
  });

  it('collectAccountInsightsNow: sem conta devolve { skipped }; com conta grava os dias (upsert por empresa+data)', async () => {
    const { w, a } = setup();
    expect(await a.collectAccountInsightsNow(OWNER, WS_A)).toEqual({ skipped: 'sem conta conectada' });
    connected(w);
    w.respond((path, opts) => {
      if (path === `/${IG}`) return { followers_count: 1234 };
      if (path === `/${IG}/insights` && opts.params.metric === 'reach,follower_count')
        return { data: [{ name: 'reach', values: [{ end_time: '2026-10-01T07:00:00+0000', value: 50 }] }, { name: 'follower_count', values: [{ end_time: '2026-10-01T07:00:00+0000', value: 3 }] }] };
      if (path === `/${IG}/insights` && opts.params.metric_type === 'total_value') return { data: [{ total_value: { value: 11 } }] };
    });
    const r = (await a.collectAccountInsightsNow(OWNER, WS_A)) as { days: number; followers: number };
    expect(r.followers).toBe(1234);
    const rows = w.t['ig_account_insights']!.rows;
    expect(rows.length).toBe(r.days);
    expect(rows.find((x) => x.date.toISOString().startsWith('2026-10-01'))).toMatchObject({ reach: 50, new_followers: 3, workspace_id: WS_A });
    expect(rows.some((x) => x.followers_total === 1234)).toBe(true);
    const before = rows.length;
    await a.collectAccountInsightsNow(OWNER, WS_A);
    expect(w.t['ig_account_insights']!.rows.length).toBeGreaterThanOrEqual(before);
    expect(new Set(w.t['ig_account_insights']!.rows.map((x) => x.date.toISOString())).size).toBe(w.t['ig_account_insights']!.rows.length);
  });
});

describe('previewAutoCalendar (puro, sem empresa)', () => {
  it('devolve os horários ou { ok:false, error } sem lançar', () => {
    const { a } = setup();
    const ok = a.previewAutoCalendar({ startDate: '2099-01-01', endDate: '2099-01-03', weekdays: [0, 1, 2, 3, 4, 5, 6], times: ['09:00'], storyTimes: ['18:00'], formats: ['feed_image'] } as any);
    expect(ok).toMatchObject({ ok: true, total: 6, skipped: 0 });
    expect((ok as any).first).toBe('2099-01-01T12:00:00.000Z');
    expect((ok as any).slots).toHaveLength(6);
    const bad = a.previewAutoCalendar({ startDate: '2099-01-03', endDate: '2099-01-01', weekdays: [1], times: ['09:00'], storyTimes: [], formats: ['feed_image'] } as any);
    expect(bad).toEqual({ ok: false, error: 'A data final precisa ser igual ou depois da inicial (e não pode estar no passado).' });
  });
});
