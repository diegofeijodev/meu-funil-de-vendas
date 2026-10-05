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
    expect(post.creative_brief.pending_job).toMatchObject({ provider: 'gemini', jobId: 'veo:abc', index: 0, cost: 0, media: [] });

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
