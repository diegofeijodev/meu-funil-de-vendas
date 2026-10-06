import { UserError } from '../../media/user-error';
import { WS_A, WS_B, OWNER, STRANGER, status } from '../../media/__tests__/mem';
import { ProviderResolverService } from '../../creative/provider-resolver.service';
import { PublishClaimLost } from '../ig-store.service';
import { igServices, igWorld, IgWorld, seedPost, uuid, ART } from './harness';

function setup() {
  const w: IgWorld = igWorld();
  const s = igServices(w);
  return { w, s, a: s.actions, gen: s.mediaGen };
}
const plan = (w: IgWorld, over: Record<string, unknown> = {}): any => {
  const p = { id: uuid(), workspace_id: WS_A, status: 'active', requires_approval: true, brand_id: null, auto_publish: false, ...over };
  w.t['ig_content_plans']!.rows.push(p);
  return p;
};
const idea = (w: IgWorld, over: Record<string, unknown> = {}) => seedPost(w, { status: 'idea', media: [], approved_at: null, creative_brief: { prompt: 'copo de chopp' }, ...over });

describe('generatePostAssets — imagem única (pipeline)', () => {
  it('direção de arte → pipeline (variações, crítico, composição) → mídia no post, aguardando aprovação', async () => {
    const { w, s, gen } = setup();
    const brand = { id: uuid(), workspace_id: WS_A, name: 'Zé', primary_color: '#c00', secondary_color: '#fff', visual_style: {} };
    w.t['brands']!.rows.push(brand);
    const p = plan(w, { brand_id: brand.id });
    const post = idea(w, { plan_id: p.id, hook: 'Gancho', cta: 'Peça', creative_brief: { prompt: 'copo de chopp', layout: 'titulo_topo', variations: 2, headline: 'Manchete' } });
    const r = await gen.generatePostAssets(WS_A, post.id, 'gemini', undefined);
    expect(r).toEqual({ ok: true, items: 1, provider: 'gemini' });
    expect(s.providers.resolve).toHaveBeenCalledWith(WS_A, 'gemini');
    const inp = s.pipeline.run.mock.calls[0][0];
    expect(inp).toMatchObject({ workspaceId: WS_A, aspectRatio: '1:1', targetFormat: 'ig_feed_square', variations: 2, layout: 'titulo_topo', igPostId: post.id, text: { title: 'Manchete', price: null, cta: 'Peça' } });
    expect(inp.brand.id).toBe(brand.id);
    expect(s.ai.json.mock.calls[0][1].prompt).toMatch(/BRIEFING/);
    expect(post.status).toBe('pending_approval'); // plano exige aprovação
    expect(post.media).toEqual([expect.objectContaining({ type: 'image', order: 0, width: 1080, height: 1080, ig_ready: true, issues: [] })]);
    expect(post.media[0].asset_id).toBeTruthy();
    expect(post.creative_brief).toMatchObject({ prompt: 'copo de chopp', visual_prompt: ART.prompt_final, art_direction: { prompt_final: ART.prompt_final }, variations: [expect.objectContaining({ winner: true })] });
    expect(post).toMatchObject({ last_error: null, ai_provider: 'gemini', failure_kind: null });
    expect(post.ai_generation_log.at(-1)).toMatchObject({ step: 'media', provider: 'gemini', items: 1, variations: 1, best_score: 40, cost: 3 });
  });

  it('automação "publish" dispensa aprovação (status ready); sem plano nem automação exige aprovação', async () => {
    const { w, gen } = setup();
    const auto = idea(w, { automation: 'publish' });
    await gen.generatePostAssets(WS_A, auto.id);
    expect(auto.status).toBe('ready');
    const manual = idea(w, {});
    await gen.generatePostAssets(WS_A, manual.id);
    expect(manual.status).toBe('pending_approval');
  });

  it('prompt editado pelo usuário vale sem nova chamada ao diretor de arte; com ajuste chama de novo', async () => {
    const { w, s, gen } = setup();
    const post = idea(w, { creative_brief: { prompt: 'x', art_direction: { ...ART }, visual_prompt_override: 'MEU PROMPT FINAL' } });
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.ai.json).not.toHaveBeenCalled();
    expect(s.pipeline.run.mock.calls[0][0].ad.prompt_final).toBe('MEU PROMPT FINAL');
    await gen.generatePostAssets(WS_A, post.id, 'auto', 'mais luz');
    expect(s.ai.json).toHaveBeenCalledTimes(1);
    expect(s.ai.json.mock.calls[0][1].prompt).toMatch(/AJUSTE PEDIDO \(aplique com prioridade\): mais luz/);
    expect(post.ai_generation_log.at(-1).instructions).toBe('mais luz');
  });

  it('prompt editado em INGLÊS (legado) não é reenviado ao gerador: o diretor de arte escreve de novo em português', async () => {
    const { w, s, gen } = setup();
    const post = idea(w, { creative_brief: { prompt: 'x', art_direction: { ...ART }, visual_prompt_override: 'A photorealistic glass of beer, natural lighting' } });
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.ai.json).toHaveBeenCalledTimes(1);
    expect(s.pipeline.run.mock.calls[0][0].ad.prompt_final).toBe(ART.prompt_final);
  });

  it('`variations` do post pode ser a LISTA de imagens anteriores (regeneração): vira o padrão 3, nunca NaN', async () => {
    const { w, s, gen } = setup();
    const post = idea(w, { creative_brief: { prompt: 'x', variations: [{ url: 'https://x/a.png', winner: true }] } });
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.pipeline.run.mock.calls[0][0].variations).toBe(3);
    const ok = idea(w, { creative_brief: { prompt: 'x', variations: 1 } });
    await gen.generatePostAssets(WS_A, ok.id);
    expect(s.pipeline.run.mock.calls[1][0].variations).toBe(1);
  });

  it('post em "needs_review" pode ter a mídia gerada (o claim aceita o status) e sai da revisão para a aprovação normal', async () => {
    const { w, gen } = setup();
    const post = idea(w, { status: 'needs_review', review_reason: 'Incoerência de data: "sextou" fora de sexta-feira.', review_score: 0 });
    const r = await gen.generatePostAssets(WS_A, post.id);
    expect(r.ok).toBe(true);
    expect(post.status).toBe('pending_approval');
  });

  it('automation "publish" + needs_review + mídia regenerada termina em pending_approval, mantém review_reason, sem approved_at e NUNCA é agendado', async () => {
    const { w, gen, s } = setup();
    const post = idea(w, { status: 'needs_review', automation: 'publish', review_reason: 'Checagem final: preço fora do cadastro.', scheduled_at: new Date(Date.now() + 3600e3) });
    const r = await gen.generatePostAssets(WS_A, post.id);
    expect(r.ok).toBe(true);
    expect(post.status).toBe('pending_approval');
    expect(post.review_reason).toBe('Checagem final: preço fora do cadastro.');
    expect(post.approved_at).toBeNull();
    expect(await s.publishing.scheduleAutomated(post.id)).toEqual({ skipped: 'pending_approval' });
    expect(w.t['publishing_jobs']!.rows.filter((j: any) => j.ig_post_id === post.id)).toHaveLength(0);
  });

  it('erro do provedor: post failed com a mensagem, log do passo e { ok:false, error }', async () => {
    const { w, s, gen } = setup();
    s.providers.resolve.mockRejectedValueOnce(Object.assign(new Error('x'), {}));
    const post = idea(w);
    const r = await gen.generatePostAssets(WS_A, post.id);
    expect(r).toEqual({ ok: false, error: 'x' });
    expect(post).toMatchObject({ status: 'failed', last_error: 'x', failure_kind: 'media' });
    expect(post.ai_generation_log.at(-1)).toMatchObject({ step: 'media', status: 'failed', error: 'x', provider: null });
  });

  it('post de outra empresa: 404 sem tocar em nada', async () => {
    const { w, s, gen } = setup();
    const post = idea(w);
    expect(await status(gen.generatePostAssets(WS_B, post.id))).toBe('404:Post não encontrado.');
    expect(post.status).toBe('idea');
    expect(s.providers.resolve).not.toHaveBeenCalled();
  });
});

describe('generatePostAssets — carrossel e vídeo', () => {
  it('carrossel: uma imagem por slide (briefs do plano), na ordem; sem pipeline', async () => {
    const { w, s, gen } = setup();
    const post = idea(w, { format: 'feed_carousel', creative_brief: { prompt: 'base', slides: ['s1', 's2', 's3'], compose: false } });
    const r = await gen.generatePostAssets(WS_A, post.id);
    expect(r).toEqual({ ok: true, items: 3, provider: 'gemini' });
    expect(s.pipeline.run).not.toHaveBeenCalled();
    expect(s.provider.generateImage).toHaveBeenCalledTimes(3);
    expect(s.provider.generateImage.mock.calls.map((c: any) => c[0].finalPrompt.match(/imagem \d de 3 do carrossel/)?.[0])).toEqual(['imagem 1 de 3 do carrossel', 'imagem 2 de 3 do carrossel', 'imagem 3 de 3 do carrossel']);
    expect(s.provider.generateImage.mock.calls[0][0].aspectRatio).toBe('4:5');
    expect(post.media.map((m: any) => m.order)).toEqual([0, 1, 2]);
    expect(post.creative_brief.art_directions).toHaveLength(3);
    expect(s.assets.ingest.mock.calls[0][0]).toMatchObject({ targetFormat: 'ig_feed_portrait', igPostId: post.id, workspaceId: WS_A });
  });

  it('Reels: vídeo do provedor + capa/legendas guardadas no item; sem referências de imagem', async () => {
    const { w, s, gen } = setup();
    const post = idea(w, { format: 'reel', hook: 'Gancho' });
    expect(await gen.generatePostAssets(WS_A, post.id)).toMatchObject({ ok: true, items: 1 });
    expect(s.provider.generateVideo).toHaveBeenCalledTimes(1);
    expect(s.provider.generateVideo.mock.calls[0][0]).toMatchObject({ aspectRatio: '9:16', kind: 'video' });
    expect(s.pipeline.run).not.toHaveBeenCalled();
    expect(post.media[0]).toMatchObject({ type: 'video', duration: 8, cover_url: 'https://cdn.test/cover.jpg', captions_srt: 'https://cdn.test/c.srt' });
    expect(s.extras.build.mock.calls[0][0]).toMatchObject({ workspaceId: WS_A, withCover: true, aspectRatio: '9:16', headline: 'Gancho' });
  });

  it('vídeo assíncrono: guarda pending_job (no post), mantém "generating"; o poller conclui', async () => {
    const { w, s, gen } = setup();
    s.provider.generateVideo.mockResolvedValueOnce({ status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: 'veo:abc', cost: 6 });
    const post = idea(w, { format: 'reel', automation: 'publish' });
    expect(await gen.generatePostAssets(WS_A, post.id)).toEqual({ ok: true, items: 0, provider: 'gemini', pending: true });
    expect(post.status).toBe('generating');
    expect(post.creative_brief.pending_job).toMatchObject({ provider: 'gemini', jobId: 'veo:abc', index: 0, cost: 0, media: [], video: { attempt: 1, best: null, scores: [] } });

    // ainda gerando
    expect(await gen.pollPendingMedia()).toEqual([{ post: post.id, status: 'generating' }]);
    expect(s.provider.getGenerationStatus).toHaveBeenCalledWith('veo:abc');
    // pronto
    s.provider.getGenerationStatus.mockResolvedValueOnce({ status: 'ready', assetUrl: 'https://provider.test/v.mp4', thumbnailUrl: null, externalJobId: 'veo:abc', cost: 6 });
    expect(await gen.pollPendingMedia()).toEqual([{ post: post.id, status: 'ready' }]);
    expect(post.creative_brief.pending_job).toBeUndefined();
    expect(post.media).toHaveLength(1);
    expect(post.media[0]).toMatchObject({ type: 'video', order: 0 });
    expect(post).toMatchObject({ status: 'ready', last_error: 'Conecte o Instagram para publicar.' }); // sem conta: pronto, sem job simulado
    expect(w.t['publishing_jobs']!.rows).toHaveLength(0);
    expect(post.ai_generation_log.at(-1)).toMatchObject({ step: 'media', items: 1, cost: 6 });
  });

  it('poller: falha do provedor → failed; mais de 1 h → failed; só consulta posts "generating" com pending_job', async () => {
    const { w, s, gen } = setup();
    const mk = (started: number) => idea(w, { format: 'reel', status: 'generating', creative_brief: { pending_job: { provider: 'gemini', jobId: 'veo:z', index: 0, prompts: ['p'], media: [], cost: 0, started_at: new Date(Date.now() - started).toISOString() } } });
    const failing = mk(1000);
    const timeout = mk(61 * 60e3);
    const noJob = idea(w, { status: 'generating', creative_brief: {}, lease_until: new Date(Date.now() + 60e3) }); // geração síncrona viva (lease)
    s.provider.getGenerationStatus.mockImplementation(async (id: string) => ({ status: id === 'veo:z' && failing.status === 'generating' ? 'failed' : 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 }));
    const out = await gen.pollPendingMedia();
    expect(out).toEqual(expect.arrayContaining([{ post: failing.id, status: 'failed', error: 'O provedor informou falha na geração da mídia.' }]));
    expect(failing).toMatchObject({ status: 'failed', last_error: 'O provedor informou falha na geração da mídia.', failure_kind: 'media' });
    expect(failing.creative_brief.pending_job).toBeUndefined();
    expect(noJob.status).toBe('generating');
    void timeout;
  });

  it('poller: passou de 1 hora sem concluir = failed', async () => {
    const { w, gen } = setup();
    const post = idea(w, { format: 'reel', status: 'generating', creative_brief: { pending_job: { provider: 'gemini', jobId: 'veo:y', index: 0, prompts: ['p'], media: [], cost: 0, started_at: new Date(Date.now() - 61 * 60e3).toISOString() } } });
    expect(await gen.pollPendingMedia()).toEqual([{ post: post.id, status: 'failed', error: 'O provedor não concluiu a mídia em 1 hora.' }]);
    expect(post.status).toBe('failed');
  });
});

describe('claim atômico da geração', () => {
  it('duas gerações simultâneas do mesmo post: só uma roda; post já "generating" ou publicado é recusado sem virar failed', async () => {
    const { w, s, gen } = setup();
    const post = idea(w, {});
    const [a, b] = await Promise.all([gen.generatePostAssets(WS_A, post.id), gen.generatePostAssets(WS_A, post.id)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(s.pipeline.run).toHaveBeenCalledTimes(1);
    const busy = idea(w, { status: 'generating' });
    expect((await gen.generatePostAssets(WS_A, busy.id)).ok).toBe(false);
    expect(busy.status).toBe('generating');
    const pub = seedPost(w, { status: 'published' });
    expect((await gen.generatePostAssets(WS_A, pub.id)).ok).toBe(false);
    expect(pub.status).toBe('published');
  });
  it('poller: dois ciclos concorrentes não concluem o mesmo job duas vezes', async () => {
    const { w, s, gen } = setup();
    const post = idea(w, { updated_at: new Date(Date.now() - 60e3), format: 'reel', status: 'generating', creative_brief: { pending_job: { provider: 'gemini', jobId: 'veo:r', index: 0, prompts: ['p'], media: [], cost: 0, started_at: new Date().toISOString() } } });
    s.provider.getGenerationStatus.mockResolvedValue({ status: 'ready', assetUrl: 'https://provider.test/v.mp4', thumbnailUrl: null, externalJobId: 'veo:r', cost: 6 });
    await Promise.all([gen.pollPendingMedia(), gen.pollPendingMedia()]);
    expect(s.assets.ingest.mock.calls.filter((c: any) => c[0].kind === 'video').length).toBe(1);
    expect(post.media).toHaveLength(1);
  });
});

describe('lease do poller e varredor de geração', () => {
  const pending = (id: string) => ({ pending_job: { provider: 'gemini', jobId: id, index: 0, prompts: ['p'], media: [], cost: 0, started_at: new Date().toISOString() } });
  const READY = (id: string) => ({ status: 'ready', assetUrl: 'https://provider.test/v.mp4', thumbnailUrl: null, externalJobId: id, cost: 6 });

  it('ciclo que começa enquanto outro ainda ingere (vídeo longo) não conclui o job de novo', async () => {
    const { w, s, gen } = setup();
    const post = idea(w, { format: 'reel', status: 'generating', creative_brief: pending('veo:l') });
    s.provider.getGenerationStatus.mockResolvedValue(READY('veo:l'));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inIngest = new Promise<void>((r) => (entered = r));
    const base = s.assets.ingest.getMockImplementation()!;
    s.assets.ingest.mockImplementationOnce(async (i: any) => { entered(); await gate; return base(i); });
    const first = gen.pollPendingMedia(); // pega o lease e fica preso na ingestão
    await inIngest; // sinal determinístico: a ingestão começou
    expect(post.lease_until).toBeInstanceOf(Date);
    expect(await gen.pollPendingMedia()).toEqual([]); // 2º ciclo: lease vivo, nada a fazer
    release();
    await first;
    expect(s.assets.ingest.mock.calls.filter((c: any) => c[0].kind === 'video')).toHaveLength(1);
    expect(post.media).toHaveLength(1);
    expect(post.lease_until).toBeNull(); // solto no finally
  });

  it('snapshot velho: ciclo A lê o post, B avança o job (slide 1) e solta; A assume o lease e NÃO reprocessa o job antigo nem sobrescreve', async () => {
    const { w, s, gen } = setup();
    const post = idea(w, { format: 'feed_carousel', status: 'generating', creative_brief: { pending_job: { provider: 'gemini', jobId: 'veo:s0', index: 0, prompts: ['p0', 'p1'], media: [], cost: 0, started_at: new Date().toISOString() } } });
    const newBrief = { pending_job: { provider: 'gemini', jobId: 'veo:s1', index: 1, prompts: ['p0', 'p1'], media: [{ url: 'https://cdn.test/s0.jpg', order: 0 }], cost: 6, started_at: new Date().toISOString() } };
    // A leu o post (snapshot com s0) e, antes de claimar, B ingeriu o slide 0 e iniciou o slide 1; o lease está livre de novo.
    const tbl = w.t['ig_posts']!;
    const realFind = tbl.findMany.bind(tbl);
    tbl.findMany = (async (a: any) => {
      const rows = await realFind(a);
      if (a?.take === 20) { post.creative_brief = newBrief; post.media = [{ url: 'https://cdn.test/s0.jpg', order: 0 }]; }
      return rows;
    }) as any;
    s.provider.getGenerationStatus.mockResolvedValue(READY('veo:s0'));
    expect(await gen.pollPendingMedia()).toEqual([]);
    expect(s.provider.getGenerationStatus).not.toHaveBeenCalled();
    expect(s.assets.ingest).not.toHaveBeenCalled();
    expect(post.creative_brief).toEqual(newBrief); // intacto
    expect(post.media).toHaveLength(1);
    expect(post.lease_until).toBeNull(); // lease solto
  });

  it('lease vencido (ciclo anterior morreu) é reassumido; lease vivo não', async () => {
    const { w, s, gen } = setup();
    const dead = idea(w, { format: 'reel', status: 'generating', creative_brief: pending('veo:d'), lease_until: new Date(Date.now() - 1000) });
    const live = idea(w, { format: 'reel', status: 'generating', creative_brief: pending('veo:v'), lease_until: new Date(Date.now() + 5 * 60e3) });
    s.provider.getGenerationStatus.mockImplementation(async (id: string) => READY(id));
    const out = await gen.pollPendingMedia();
    expect(out).toEqual([{ post: dead.id, status: 'ready' }]);
    expect(live.status).toBe('generating');
    expect(s.provider.getGenerationStatus).not.toHaveBeenCalledWith('veo:v');
  });

  it('geração síncrona solta o lease no fim (sucesso, falha e pendente)', async () => {
    const { w, s, gen } = setup();
    const ok = idea(w, {});
    await gen.generatePostAssets(WS_A, ok.id);
    expect(ok.lease_until).toBeNull();
    s.provider.generateVideo.mockResolvedValueOnce({ status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: 'veo:q', cost: 0 });
    const vid = idea(w, { format: 'reel' });
    await gen.generatePostAssets(WS_A, vid.id);
    expect(vid.status).toBe('generating');
    expect(vid.lease_until).toBeNull();
  });

  it('lease perdido no meio da geração (PublishClaimLost): NÃO marca failed nem mexe em last_error — o post é do outro processo; erro comum continua falhando', async () => {
    const { w, s, gen } = setup();
    const lost = idea(w, { last_error: null });
    s.pipeline.run.mockRejectedValueOnce(new PublishClaimLost('O trabalho neste post foi assumido por outro processo (lease vencido).'));
    const r = await gen.generatePostAssets(WS_A, lost.id);
    expect(r).toMatchObject({ ok: false });
    expect(lost.status).not.toBe('failed');
    expect(lost.last_error).toBeNull();
    expect(lost.ai_generation_log ?? []).toEqual([]);
    const normal = idea(w, {});
    s.pipeline.run.mockRejectedValueOnce(new Error('provedor caiu'));
    expect(await gen.generatePostAssets(WS_A, normal.id)).toMatchObject({ ok: false });
    expect(normal.status).toBe('failed');
    expect(normal.last_error).toMatch(/provedor caiu/);
  });

  it('varredor: "generating" sem pending_job e sem lease vivo volta a failed com aviso; vivo e com pending_job não são tocados', async () => {
    const { w, gen } = setup();
    const dead = idea(w, { status: 'generating', creative_brief: {}, lease_until: new Date(Date.now() - 31 * 60e3) });
    const legacy = idea(w, { status: 'generating', creative_brief: {} }); // sem lease algum
    const live = idea(w, { status: 'generating', creative_brief: {}, lease_until: new Date(Date.now() + 20 * 60e3) });
    const withJob = idea(w, { format: 'reel', status: 'generating', creative_brief: pending('veo:j'), lease_until: null });
    expect((await gen.sweepStaleGenerating()).sort()).toEqual([dead.id, legacy.id].sort());
    expect(dead).toMatchObject({ status: 'failed', last_error: 'Geração da mídia interrompida — tente gerar de novo.', lease_until: null, failure_kind: 'media' });
    expect(legacy.status).toBe('failed');
    expect(live.status).toBe('generating');
    expect(withJob.status).toBe('generating');
    expect(w.t['ig_autopilot_events']!.rows.filter((e) => e.post_id === dead.id)).toHaveLength(1);
    // e o post recuperado pode ser gerado de novo
    expect((await gen.generatePostAssets(WS_A, dead.id)).ok).toBe(true);
  });

  it('o ciclo do poller também varre (cron queue)', async () => {
    const { w, gen } = setup();
    const dead = idea(w, { status: 'generating', creative_brief: {}, lease_until: new Date(Date.now() - 1000) });
    await gen.pollPendingMedia();
    expect(dead.status).toBe('failed');
  });
});

describe('uploadPostMedia (a própria mídia)', () => {
  const file = (mimetype: string, size = 10, filename = 'foto.final.png') => ({ filename, mimetype, bytes: Buffer.alloc(size, 1) });

  it('imagem/vídeo entram na biblioteca; carrossel acrescenta, os demais substituem; idea/failed → aguardando aprovação', async () => {
    const { w, s, a } = setup();
    const single = idea(w, {});
    expect(await a.uploadPostMedia(OWNER, WS_A, single.id, file('image/png'))).toEqual({ ok: true });
    expect(single.status).toBe('pending_approval');
    expect(single.media).toHaveLength(1);
    expect(s.assets.ingest.mock.calls[0][0]).toMatchObject({ source: 'upload', provider: 'upload', title: 'foto.final', igPostId: single.id, kind: 'image' });
    await a.uploadPostMedia(OWNER, WS_A, single.id, file('image/jpeg'));
    expect(single.media).toHaveLength(1); // substitui
    const car = idea(w, { format: 'feed_carousel', status: 'failed' });
    await a.uploadPostMedia(OWNER, WS_A, car.id, file('image/png'));
    await a.uploadPostMedia(OWNER, WS_A, car.id, file('video/mp4', 10, 'v.mp4'));
    expect(car.media.map((m: any) => [m.order, m.type])).toEqual([[0, 'image'], [1, 'video']]);
    const approved = seedPost(w, {});
    await a.uploadPostMedia(OWNER, WS_A, approved.id, file('image/png'));
    expect(approved.status).toBe('approved'); // não volta a "aguardando" quando já estava aprovado
    expect(single.ai_generation_log.at(-1)).toMatchObject({ step: 'upload', file: 'foto.final.png' });
  });

  it('mensagens do protótipo: tipo inválido e acima de 100 MB; post de outra empresa 404', async () => {
    const { w, a } = setup();
    const post = idea(w, {});
    expect(await status(a.uploadPostMedia(OWNER, WS_A, post.id, file('application/pdf')))).toBe('400:Envie uma imagem ou um vídeo MP4.');
    expect(await status(a.uploadPostMedia(OWNER, WS_A, post.id, file('image/png', 100 * 1024 * 1024 + 1)))).toBe('400:Arquivo acima de 100 MB.');
    expect(await status(a.uploadPostMedia(STRANGER, WS_B, post.id, file('image/png')))).toBe('404:Post não encontrado.');
    expect(post.media).toEqual([]);
  });
});

describe('ProviderResolverService.owns (id de job só chega ao provedor se estiver gravado neste workspace)', () => {
  it('aceita o job de vídeo gravado em ig_posts.creative_brief.pending_job do MESMO workspace; recusa outro workspace e post que não está gerando', async () => {
    const w = igWorld();
    w.t['creative_generation_jobs'] = { count: async () => 0 } as any;
    const prisma = { creative_generation_jobs: { count: async () => 0 }, ig_posts: w.t['ig_posts'] } as any;
    const resolver = new ProviderResolverService(prisma, {} as any, {} as any, {} as any);
    seedPost(w, { status: 'generating', creative_brief: { pending_job: { jobId: 'veo:mine' } } });
    expect(await resolver.owns(WS_A, 'veo:mine')).toBe(true);
    expect(await resolver.owns(WS_B, 'veo:mine')).toBe(false);
    expect(await resolver.owns(WS_A, 'veo:other')).toBe(false);
    seedPost(w, { status: 'published', creative_brief: { pending_job: { jobId: 'veo:done' } } });
    expect(await resolver.owns(WS_A, 'veo:done')).toBe(false);
  });
});

describe('B — contexto completo na direção de arte, foto do produto primeiro e headline na arte', () => {
  const ctxWorld = () => {
    const { w, s, gen } = setup();
    const brand = { id: uuid(), workspace_id: WS_A, name: 'Zé', visual_style: {} };
    w.t['brands']!.rows.push(brand);
    const p = plan(w, { brand_id: brand.id, objective: 'objetivo do plano' });
    const prod = { id: uuid(), workspace_id: WS_A, brand_id: brand.id, name: 'Chope Pilsen', description: 'claro e gelado', price: '12.90' };
    w.t['products']!.rows.push(prod);
    w.t['personas']!.rows.push({ id: uuid(), workspace_id: WS_A, brand_id: brand.id, name: 'Ana', pains: 'sem tempo', desires: 'relaxar' });
    const r = { id: uuid(), workspace_id: WS_A, plan_id: p.id, focus: 'Lotar o happy hour de sexta', campaign_id: null, strategy: { mensagem_central: 'O melhor chope da cidade', publico_foco: 'adultos de Valinhos', proibicoes: ['falar de preço baixo'] } };
    w.t['ig_auto_runs']!.rows.push(r);
    return { w, s, gen, p, prod, r };
  };

  it('a direção de arte recebe produto, pilar, persona, funil, objetivo/mensagem/público da estratégia e as proibições (também no negativo)', async () => {
    const { w, s, gen, p, prod, r } = ctxWorld();
    const post = idea(w, { plan_id: p.id, run_id: r.id, product_id: prod.id, persona: 'Ana', pillar: 'Bastidores', funnel_stage: 'conversao', scheduled_at: new Date('2099-01-02T21:00:00Z') });
    await gen.generatePostAssets(WS_A, post.id);
    const prompt = s.ai.json.mock.calls[0][1].prompt as string;
    expect(prompt).toContain('CONTEXTO DO POST (traduza em cena visual concreta');
    for (const t of ['"nome":"Chope Pilsen"', '"preco":12.9', '"pilar":"Bastidores"', '"dores":"sem tempo"', 'conversão — produto em destaque', '"objetivo_do_periodo":"Lotar o happy hour de sexta"', '"mensagem_central":"O melhor chope da cidade"', 'sexta-feira, 02/01/2099 (verão)']) {
      expect(prompt).toContain(t);
    }
    expect(prompt).toContain('PROIBIDO NA CENA (estratégia do período): falar de preço baixo.');
    expect(prompt).toContain('"produtos":[{"nome":"Chope Pilsen","descricao":"claro e gelado"}]');
    expect(s.pipeline.run.mock.calls[0][0].ad.negative).toContain('falar de preço baixo');
  });

  it('produto de OUTRA empresa não entra no contexto (nem na arte)', async () => {
    const { w, s, gen, p } = ctxWorld();
    const alien = { id: uuid(), workspace_id: WS_B, brand_id: uuid(), name: 'Produto Alheio', description: null, price: 1 };
    w.t['products']!.rows.push(alien);
    const post = idea(w, { plan_id: p.id, product_id: alien.id });
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.ai.json.mock.calls[0][1].prompt).not.toContain('Produto Alheio');
  });

  it('fotos de referência: a do produto do post vai primeiro (nome do arquivo), depois as demais na ordem da marca', async () => {
    const { w, s, gen, p, prod } = ctxWorld();
    const ref = (id: string, tag: string, name: string) => ({ id, tag, name, url: `https://cdn.test/${name}`, bytes: new Uint8Array([1]), mime: 'image/jpeg' });
    s.refs.loadBrandRefs.mockResolvedValueOnce([ref('a', 'produto', 'outro-produto.jpg'), ref('b', 'ambiente', 'bar.jpg'), ref('c', 'produto', 'Chope-Pilsen.png')]);
    const post = idea(w, { plan_id: p.id, product_id: prod.id });
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.pipeline.run.mock.calls[0][0].refs.map((r: any) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('headline na arte: feed e story de imagem com headline usam "titulo_topo" (título = headline); sem headline, "limpo"; o layout do editor vale', async () => {
    const { w, s, gen } = setup();
    const withHead = idea(w, { creative_brief: { prompt: 'x', headline: 'Chope em dobro' } });
    const story = idea(w, { format: 'story_image', creative_brief: { prompt: 'x', headline: 'Hoje tem' } });
    const noHead = idea(w, { creative_brief: { prompt: 'x' } });
    const chosen = idea(w, { creative_brief: { prompt: 'x', headline: 'H', layout: 'cta_rodape' } });
    for (const p of [withHead, story, noHead, chosen]) await gen.generatePostAssets(WS_A, p.id);
    expect(s.pipeline.run.mock.calls.map((c: any) => [c[0].layout, c[0].text.title])).toEqual([['titulo_topo', 'Chope em dobro'], ['titulo_topo', 'Hoje tem'], ['limpo', null], ['cta_rodape', 'H']]);
  });
});

describe('carrossel: fio visual único e nota do crítico por slide', () => {
  const carousel = (w: IgWorld, over: Record<string, unknown> = {}) => idea(w, { format: 'feed_carousel', creative_brief: { prompt: 'base', slides: ['s1', 's2', 's3'], compose: false }, ...over });

  it('o 1º slide define o fio visual (paleta, estilo, luz): vai no briefing dos demais e no texto final de todos', async () => {
    const { w, s, gen } = setup();
    const post = carousel(w);
    await gen.generatePostAssets(WS_A, post.id);
    const prompts = s.ai.json.mock.calls.map((c: any) => c[1].prompt as string);
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).not.toContain('FIO VISUAL DO CARROSSEL');
    expect(prompts.slice(1).every((p: string) => p.includes('FIO VISUAL DO CARROSSEL') && p.includes('"paleta":["#fff"]'))).toBe(true);
    expect(s.provider.generateImage.mock.calls.every((c: any) => c[0].finalPrompt.includes('Fio visual do carrossel (igual em todos os slides): paleta #fff; estilo fotográfico foto; luz l.'))).toBe(true);
    expect(post.creative_brief.visual_thread).toEqual({ paleta: ['#fff'], estilo_fotografico: 'foto', luz: 'l' });
  });

  it('slide abaixo de 28/50 é refeito 1× com o motivo do crítico; fica o de maior nota; notas no item e no log', async () => {
    const { w, s, gen } = setup();
    const low = { produto: 3, fidelidade: 3, composicao: 3, defeitos: 3, paleta: 3, motivo: 'produto cortado' };
    const high = { produto: 9, fidelidade: 9, composicao: 9, defeitos: 9, paleta: 9, motivo: 'ótimo' };
    s.ai.vision.mockResolvedValueOnce(low).mockResolvedValueOnce(high);
    const post = carousel(w);
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.provider.generateImage).toHaveBeenCalledTimes(4); // 3 slides + 1 refação do 1º
    const rebuild = s.ai.json.mock.calls.map((c: any) => c[1].prompt as string).find((p: string) => p.includes('AJUSTE PEDIDO'));
    expect(rebuild).toContain('AJUSTE PEDIDO (aplique com prioridade): Corrija: produto cortado');
    expect(post.media.map((m: any) => m.score)).toEqual([45, 40, 40]);
    expect(post.ai_generation_log.at(-1).slide_scores).toEqual([
      { slide: 1, total: 45, motivo: 'ótimo', retried: true },
      { slide: 2, total: 40, motivo: 'ok', retried: false },
      { slide: 3, total: 40, motivo: 'ok', retried: false },
    ]);
  });

  it('crítico fora do ar não bloqueia o carrossel (sem nota, sem refação)', async () => {
    const { w, s, gen } = setup();
    s.ai.vision.mockRejectedValue(new Error('visão indisponível'));
    const post = carousel(w);
    expect(await gen.generatePostAssets(WS_A, post.id)).toEqual({ ok: true, items: 3, provider: 'gemini' });
    expect(s.provider.generateImage).toHaveBeenCalledTimes(3);
    expect(post.media.map((m: any) => m.score)).toEqual([null, null, null]);
  });

  it('o aviso do gateway sem referência fica no log de geração do post', async () => {
    const { w, s, gen } = setup();
    s.provider.generateImage.mockResolvedValue({ status: 'ready', assetUrl: null, bytes: Buffer.from('89504e470d0a1a0a', 'hex'), mime: 'image/png', thumbnailUrl: null, externalJobId: null, cost: 1, note: 'Gateway sem suporte a referência; gerado sem foto da marca.' });
    const post = carousel(w);
    await gen.generatePostAssets(WS_A, post.id);
    expect(post.ai_generation_log.at(-1).notes).toEqual(['Gateway sem suporte a referência; gerado sem foto da marca.']);
  });
});

describe('vídeo (Reels/Story): roteiro detalhado, primeiro quadro, áudio, nota de qualidade e conversão', () => {
  const reel = (w: IgWorld, over: Record<string, unknown> = {}) => idea(w, { format: 'reel', hook: 'Gancho', theme: 'Happy hour', cta: 'Reserve', creative_brief: { prompt: 'chope sendo servido' }, ...over });
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const videoAssets = (w: IgWorld) => w.t['media_assets']!.rows.filter((x) => x.kind === 'video');
  const score = (total: number, motivo = 'm') => ({ roteiro: 0, marca: 0, tecnica: 0, produto: 0, scroll: 0, total, motivo });
  const dirPrompts = (s: any) => s.ai.json.mock.calls.filter((c: any) => c[1].name === 'video_direction').map((c: any) => c[1].prompt as string);

  it('roteiro estruturado → texto final pt-BR (250–450 palavras) enviado ao provedor; tomadas, áudio, nota e capa no post', async () => {
    const { w, s, gen } = setup();
    const post = reel(w);
    expect(await gen.generatePostAssets(WS_A, post.id)).toEqual({ ok: true, items: 1, provider: 'gemini' });
    expect(dirPrompts(s)[0]).toContain('cobrindo de 0 a 8 s SEM buracos');
    const req = s.provider.generateVideo.mock.calls[0][0];
    expect(req).toMatchObject({ aspectRatio: '9:16', kind: 'video', maxWaitMs: 25_000, audio: true });
    expect(req.referenceImages).toBeUndefined();
    expect(req.finalPrompt).toContain('Roteiro por tomada:');
    expect(words(req.finalPrompt)).toBeGreaterThanOrEqual(250);
    expect(words(req.finalPrompt)).toBeLessThanOrEqual(450);
    const vd = post.creative_brief.video_direction;
    expect(vd).toMatchObject({ prompt: req.finalPrompt, audio: { modo: 'ambiente_trilha', instrucoes: '' }, first_frame_ref: null, scores: [{ attempt: 1, total: 40, motivo: 'bom' }], winner_attempt: 1 });
    expect(vd.direction.tomadas[0].inicio_s).toBe(0);
    expect(vd.direction.tomadas.at(-1).fim_s).toBe(8);
    expect(post.creative_brief.visual_prompt).toBe(req.finalPrompt);
    expect(post.media[0]).toMatchObject({ type: 'video', duration: 8, ig_ready: true, cover_url: 'https://cdn.test/cover.jpg' });
    expect(post.ai_generation_log.at(-1)).toMatchObject({ step: 'media', items: 1, video_scores: [{ attempt: 1, total: 40 }], regenerated: false, winner_attempt: 1 });
    expect(s.extras.build.mock.calls[0][0]).toMatchObject({
      visualPrompt: 'copo de chope gelado com colarinho cremoso. balcão de madeira de um bar aconchegante. Luz: luz quente de fim de tarde. Estilo: comercial realista. Paleta: #c0392b, #f5deb3',
      durationSec: 8,
    });
    expect(s.conform.ensureIgReady.mock.calls[0][2]).toEqual({ silent: false });
  });

  it('primeiro quadro: a foto do produto do post, encaixada em 9:16, vai como referência; o roteiro sabe que começa da foto', async () => {
    const { w, s, gen } = setup();
    const brand = { id: uuid(), workspace_id: WS_A, name: 'Zé', visual_style: {} };
    w.t['brands']!.rows.push(brand);
    const p = plan(w, { brand_id: brand.id });
    const prod = { id: uuid(), workspace_id: WS_A, brand_id: brand.id, name: 'Chope Pilsen', description: null, price: null };
    w.t['products']!.rows.push(prod);
    const photo = new Uint8Array([9, 9]);
    s.refs.loadBrandRefs.mockResolvedValueOnce([
      { id: 'amb', tag: 'ambiente', name: 'bar.jpg', url: 'https://cdn.test/bar.jpg', bytes: new Uint8Array([1]), mime: 'image/jpeg' },
      { id: 'prod', tag: 'produto', name: 'chope-pilsen.png', url: 'https://cdn.test/chope.png', bytes: photo, mime: 'image/jpeg' },
    ]);
    const post = reel(w, { plan_id: p.id, product_id: prod.id });
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.images.padToAspect).toHaveBeenCalledWith(photo, 720, 1280);
    const req = s.provider.generateVideo.mock.calls[0][0];
    expect(req.referenceImages).toEqual([{ bytes: photo, mime: 'image/jpeg' }]);
    expect(req.referenceUrls).toEqual(['https://cdn.test/chope.png']);
    expect(post.creative_brief.video_direction.first_frame_ref).toBe('prod');
    expect(dirPrompts(s)[0]).toContain('O vídeo COMEÇA a partir da foto real enviada');
    expect(req.finalPrompt).toContain('Comece exatamente a partir da imagem de referência enviada');
  });

  it('áudio: o do post sobrepõe o da execução; "sem áudio" desliga o áudio no provedor e pede conversão silenciosa; valor inválido no post cai no da execução', async () => {
    const { w, s, gen } = setup();
    const p = plan(w);
    const r = { id: uuid(), workspace_id: WS_A, plan_id: p.id, video_audio: { modo: 'narracao', instrucoes: 'voz calma' } };
    w.t['ig_auto_runs']!.rows.push(r);
    const mute = reel(w, { plan_id: p.id, run_id: r.id, creative_brief: { prompt: 'x', audio: { modo: 'sem_audio' } } });
    await gen.generatePostAssets(WS_A, mute.id);
    expect(s.provider.generateVideo.mock.calls[0][0].audio).toBe(false);
    expect(s.conform.ensureIgReady.mock.calls[0][2]).toEqual({ silent: true });
    expect(dirPrompts(s)[0]).toContain('ÁUDIO (modo "sem_audio")');
    const bogus = reel(w, { plan_id: p.id, run_id: r.id, creative_brief: { prompt: 'x', audio: { modo: 'karaoke', instrucoes: 'y'.repeat(5000) } } });
    await gen.generatePostAssets(WS_A, bogus.id);
    expect(s.provider.generateVideo.mock.calls[1][0].audio).toBe(true);
    expect(bogus.creative_brief.video_direction.audio).toEqual({ modo: 'narracao', instrucoes: 'voz calma' });
  });

  it('nota abaixo de 28: refaz 1 vez com o motivo do crítico no roteiro; fica o de maior nota; evento video_regenerated', async () => {
    const { w, s, gen } = setup();
    s.quality.score.mockResolvedValueOnce(score(20, 'O produto quase não aparece')).mockResolvedValueOnce(score(42, 'ótimo'));
    const post = reel(w);
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.provider.generateVideo).toHaveBeenCalledTimes(2);
    const dirs = dirPrompts(s);
    expect(dirs).toHaveLength(2);
    expect(dirs[1]).toContain('O CRÍTICO REPROVOU O VÍDEO ANTERIOR (corrija isto com prioridade): «O produto quase não aparece»');
    expect(dirs[1]).toContain('ROTEIRO ANTERIOR (refaça melhorando):');
    const [, second] = videoAssets(w);
    expect(post.media[0].asset_id).toBe(second!.id);
    expect(post.creative_brief.video_direction).toMatchObject({ scores: [{ attempt: 1, total: 20 }, { attempt: 2, total: 42 }], winner_attempt: 2 });
    expect(w.t['ig_autopilot_events']!.rows.find((e) => e.kind === 'video_regenerated')).toMatchObject({ level: 'warn', message: 'Vídeo refeito: nota 20/50, abaixo de 28 (O produto quase não aparece).' });
    expect(post.ai_generation_log.at(-1)).toMatchObject({ regenerated: true, winner_attempt: 2 });
  });

  it('a refação saiu pior: fica o primeiro vídeo (e o roteiro dele)', async () => {
    const { w, s, gen } = setup();
    s.quality.score.mockResolvedValueOnce(score(25)).mockResolvedValueOnce(score(10));
    const post = reel(w);
    await gen.generatePostAssets(WS_A, post.id);
    const [first] = videoAssets(w);
    expect(post.media[0].asset_id).toBe(first!.id);
    expect(post.creative_brief.video_direction.winner_attempt).toBe(1);
    expect(post.creative_brief.video_direction.prompt).toBe(s.provider.generateVideo.mock.calls[0][0].finalPrompt);
  });

  it('Review Focus #4 — crítico fora do ar: segue com o vídeo e registra; refação que falha: fica o primeiro (nunca failed)', async () => {
    const { w, s, gen } = setup();
    s.quality.score.mockRejectedValueOnce(new Error('visão indisponível'));
    const a = reel(w);
    expect(await gen.generatePostAssets(WS_A, a.id)).toMatchObject({ ok: true, items: 1 });
    expect(a.status).toBe('pending_approval');
    expect(a.creative_brief.video_direction.scores).toEqual([{ attempt: 1, total: null, motivo: null, error: 'crítico indisponível: visão indisponível' }]);
    expect(s.provider.generateVideo).toHaveBeenCalledTimes(1);
    s.quality.score.mockResolvedValueOnce(score(12, 'deformado'));
    s.provider.generateVideo
      .mockResolvedValueOnce({ status: 'ready', assetUrl: 'https://provider.test/v.mp4', thumbnailUrl: null, externalJobId: null, cost: 6 })
      .mockRejectedValueOnce(new Error('Veo fora do ar'));
    const b = reel(w);
    expect(await gen.generatePostAssets(WS_A, b.id)).toMatchObject({ ok: true, items: 1 });
    expect(b.media).toHaveLength(1);
    expect(b.creative_brief.video_direction.scores).toEqual([{ attempt: 1, total: 12, motivo: 'deformado' }, { attempt: 2, total: null, motivo: null, error: 'Veo fora do ar' }]);
    expect(b.ai_generation_log.at(-1)).toMatchObject({ regen_error: 'Veo fora do ar', winner_attempt: 1 });
    expect(b.status).not.toBe('failed');
  });

  it('vídeo que continua fora do padrão depois da conversão: o post falha como mídia (failure_kind "media")', async () => {
    const { w, s, gen } = setup();
    s.conform.ensureIgReady.mockRejectedValueOnce(new UserError('Vídeo fora do padrão do Instagram mesmo depois da conversão: Largura de 640px; o mínimo é 720px.'));
    const post = reel(w);
    expect(await gen.generatePostAssets(WS_A, post.id)).toEqual({ ok: false, error: 'Vídeo fora do padrão do Instagram mesmo depois da conversão: Largura de 640px; o mínimo é 720px.' });
    expect(post).toMatchObject({ status: 'failed', failure_kind: 'media' });
  });

  it('assíncrono: pending_job guarda o estado do vídeo; o poller conclui com crítico, refação (também assíncrona) e capa', async () => {
    const { w, s, gen } = setup();
    const pend = (id: string) => ({ status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 6 });
    const done = (id: string) => ({ status: 'ready', assetUrl: `https://provider.test/${id}.mp4`, thumbnailUrl: null, externalJobId: id, cost: 0 });
    s.provider.generateVideo.mockResolvedValueOnce(pend('veo:a1')).mockResolvedValueOnce(pend('veo:a2'));
    s.quality.score.mockResolvedValueOnce(score(15, 'gancho fraco')).mockResolvedValueOnce(score(38, 'bom'));
    const post = reel(w, { automation: 'publish' });
    expect(await gen.generatePostAssets(WS_A, post.id)).toEqual({ ok: true, items: 0, provider: 'gemini', pending: true });
    expect(post.creative_brief.pending_job).toMatchObject({ jobId: 'veo:a1', video: { attempt: 1, best: null, scores: [] } });
    s.provider.getGenerationStatus.mockResolvedValueOnce(done('veo:a1'));
    expect(await gen.pollPendingMedia()).toEqual([{ post: post.id, status: 'generating' }]); // 1º pronto, nota 15 → refação pendente
    expect(post.creative_brief.pending_job).toMatchObject({ jobId: 'veo:a2', video: { attempt: 2, best: { attempt: 1, score: 15 }, scores: [{ attempt: 1, total: 15 }] } });
    expect(post.status).toBe('generating');
    s.provider.getGenerationStatus.mockResolvedValueOnce(done('veo:a2'));
    expect(await gen.pollPendingMedia()).toEqual([{ post: post.id, status: 'ready' }]);
    expect(post.creative_brief.pending_job).toBeUndefined();
    expect(post.creative_brief.video_direction).toMatchObject({ winner_attempt: 2, scores: [{ attempt: 1, total: 15 }, { attempt: 2, total: 38 }] });
    expect(post.media[0]).toMatchObject({ type: 'video', cover_url: 'https://cdn.test/cover.jpg' });
    expect(post).toMatchObject({ status: 'ready', last_error: 'Conecte o Instagram para publicar.' });
  });

  it('Review Focus #4 — assíncrono: a refação falhou ou não terminou em 1 h — fica o primeiro vídeo', async () => {
    const { w, s, gen } = setup();
    const best = { item: { url: 'https://cdn.test/1.mp4', type: 'video', order: 0, asset_id: 'a1', duration: 8, ig_ready: true, issues: [] }, score: 20, attempt: 1, prompt: 'roteiro 1', direction: null };
    const mk = (age: number) =>
      idea(w, {
        format: 'reel', status: 'generating',
        creative_brief: {
          video_direction: { prompt: 'roteiro 2', direction: null, audio: { modo: 'ambiente_trilha', instrucoes: '' }, first_frame_ref: null },
          pending_job: { provider: 'gemini', jobId: `veo:r${age}`, index: 0, prompts: ['roteiro 2'], media: [], cost: 6, started_at: new Date(Date.now() - age).toISOString(), video: { attempt: 2, best, scores: [{ attempt: 1, total: 20, motivo: 'm' }] } },
        },
      });
    const failing = mk(1000);
    const stale = mk(61 * 60e3);
    s.provider.getGenerationStatus.mockImplementation(async (id: string) => ({ status: id === 'veo:r1000' ? 'failed' : 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 }));
    expect(await gen.pollPendingMedia()).toEqual(expect.arrayContaining([{ post: failing.id, status: 'ready' }, { post: stale.id, status: 'ready' }]));
    for (const p of [failing, stale]) {
      expect(p.status).toBe('pending_approval');
      expect(p.media[0].asset_id).toBe('a1');
      expect(p.creative_brief.video_direction).toMatchObject({ winner_attempt: 1, prompt: 'roteiro 1' });
      expect(p.creative_brief.video_direction.scores[1]).toMatchObject({ attempt: 2, total: null });
      expect(p.creative_brief.pending_job).toBeUndefined();
    }
  });

  it('roteiro editado no editor (visual_prompt_override) vai direto ao provedor, sem o diretor; com ajuste, o diretor refaz com o pedido delimitado', async () => {
    const { w, s, gen } = setup();
    const post = reel(w, { creative_brief: { prompt: 'x', visual_prompt_override: 'MEU ROTEIRO: o chope é servido.' } });
    await gen.generatePostAssets(WS_A, post.id);
    expect(dirPrompts(s)).toHaveLength(0);
    expect(s.provider.generateVideo.mock.calls[0][0].finalPrompt).toBe('MEU ROTEIRO: o chope é servido.');
    await gen.generatePostAssets(WS_A, post.id, 'auto', 'mais close no copo');
    expect(dirPrompts(s)[0]).toContain('AJUSTE PEDIDO PELO CLIENTE (aplique com prioridade): «mais close no copo»');
  });

  it('capa e legendas usam a duração real do vídeo', async () => {
    const { w, s, gen } = setup();
    const base = s.assets.ingest.getMockImplementation()!;
    s.assets.ingest.mockImplementation(async (i: any) => ({ ...(await base(i)), ...(i.kind === 'video' ? { duration_seconds: 10 } : {}) }));
    const post = reel(w);
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.extras.build.mock.calls[0][0].durationSec).toBe(10);
    expect(post.media[0].duration).toBe(10);
  });

  it('upload de vídeo fora do padrão é convertido; se a conversão falhar, fica o original com os avisos', async () => {
    const { w, s, a } = setup();
    const post = reel(w);
    const base = s.assets.ingest.getMockImplementation()!;
    s.assets.ingest.mockImplementationOnce(async (i: any) => ({ ...(await base(i)), ig_ready: false, quality_report: { issues: ['Largura de 640px; o mínimo é 720px.'] } }));
    s.conform.ensureIgReady.mockImplementationOnce(async (asset: any) => ({ ...asset, id: 'convertido', ig_ready: true, quality_report: { issues: [] } }));
    await a.uploadPostMedia(OWNER, WS_A, post.id, { filename: 'v.mp4', mimetype: 'video/mp4', bytes: Buffer.alloc(10, 1) });
    expect(post.media[0]).toMatchObject({ asset_id: 'convertido', ig_ready: true });
    expect(s.conform.ensureIgReady.mock.calls[0][2]).toEqual({ silent: false });
    s.assets.ingest.mockImplementationOnce(async (i: any) => ({ ...(await base(i)), ig_ready: false, quality_report: { issues: ['Codec mpeg4'] } }));
    s.conform.ensureIgReady.mockRejectedValueOnce(new Error('ffmpeg falhou (código 1)'));
    await a.uploadPostMedia(OWNER, WS_A, post.id, { filename: 'v2.mp4', mimetype: 'video/mp4', bytes: Buffer.alloc(10, 1) });
    expect(post.media[0]).toMatchObject({ ig_ready: false, issues: ['Codec mpeg4'] });
  });
});
