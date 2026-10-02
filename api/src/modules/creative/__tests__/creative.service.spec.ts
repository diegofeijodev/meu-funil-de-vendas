import JSZip from 'jszip';
jest.setTimeout(180_000);

import { AiError } from '../../ai/ai-error';
import { ADMIN, MARKETING, OWNER, sampleMp4, status, STRANGER, VIEWER, WS_A, WS_B } from '../../media/__tests__/mem';
import { buildCaptions } from '../video-extras.service';
import { ART, creativeWorld, CreativeWorld, SCORE } from './world';

const dto = (extra: Record<string, unknown> = {}) => ({ workspaceId: WS_A, title: 'Chopp gelado', type: 'static_image', aspectRatio: '1:1', targetFormat: 'other', variations: 2, provider: 'auto', ...extra }) as any;

async function seed(w: CreativeWorld) {
  const brand = await w.t['brands']!.create({ data: { workspace_id: WS_A, name: 'Bar do Zé', segment: 'Bar', primary_color: '#c0392b', secondary_color: '#222222', visual_style: {} } });
  const campaign = await w.t['campaigns']!.create({ data: { workspace_id: WS_A, brand_id: brand.id, name: 'Black Friday', offer_product: 'Chopp' } });
  return { brand, campaign };
}

describe('generate — imagem dirigida', () => {
  it('variações → crítico → vencedora vira o criativo; tudo registrado (job, criativo, versão, biblioteca, atividade)', async () => {
    const w = await creativeWorld();
    const { brand, campaign } = await seed(w);
    const scores = [SCORE(30, 'ok'), SCORE(45, 'ótima')];
    w.ai.vision.mockImplementation(async () => scores.shift() ?? SCORE(10));
    const r = await w.svc.generate(MARKETING, dto({ campaignId: campaign.id, brandId: brand.id, prompt: 'copo suado' }));
    expect(r.status).toBe('ready');
    expect([r.provider, r.sandbox, r.error]).toEqual(['gemini', false, null]);
    expect(r.variations).toHaveLength(2);
    expect(r.variations.filter((v) => v.winner)).toHaveLength(1);
    expect(r.variations.find((v) => v.winner)!.score!.total).toBe(45);
    expect(r.artDirection.prompt_final).toBe(ART.prompt_final);

    const job = w.t['creative_generation_jobs']!.rows[0]!;
    expect([job.status, job.provider, job.created_by, job.campaign_id, job.brand_id]).toEqual(['ready', 'gemini', MARKETING, campaign.id, brand.id]);
    expect(job.final_prompt).toContain('No text, letters or logos anywhere in the image.');
    expect(job.final_prompt).toContain('Avoid: blurry');
    expect(job.provider_log).toBe('Usado: Gemini (Google)');
    const cr = w.t['creatives']!.rows[0]!;
    expect([cr.status, cr.title, cr.version, cr.provider, cr.campaign_id, Number(cr.real_cost)]).toEqual(['ready', 'Chopp gelado', 1, 'gemini', campaign.id, 2]);
    expect(r.creativeId).toBe(cr.id);
    expect(cr.preview_url).toBe(r.assetUrl);
    expect(w.t['creative_versions']!.rows).toEqual([expect.objectContaining({ creative_id: cr.id, version: 1 })]);
    // as 2 variações (e a final, que aqui é a própria vencedora) apontam para o criativo, com o relatório de qualidade
    const assets = w.t['media_assets']!.rows;
    expect(assets).toHaveLength(2);
    expect(assets.every((a) => a.creative_id === cr.id && a.source === 'gemini')).toBe(true);
    expect(assets.map((a) => (a.quality_report as any).winner).sort()).toEqual([false, true]);
    expect(assets.every((a) => (a.quality_report as any).version === 'clean' && (a.quality_report as any).variation_group)).toBe(true);
    expect(w.logs).toEqual([[WS_A, MARKETING, 'creative.generated', 'creative', { creative_id: cr.id, provider: 'gemini' }]]);
    // o provedor foi chamado 2x (variações) com o mesmo prompt final
    expect(w.provider.image).toHaveBeenCalledTimes(2);
    w.cleanup();
  });

  it('nota abaixo de 28/50 → uma nova rodada com o motivo do crítico no ajuste; a melhor das 3 vence', async () => {
    const w = await creativeWorld();
    await seed(w);
    const scores = [SCORE(20, 'produto sumiu'), SCORE(22, 'ruim'), SCORE(41, 'melhorou')];
    w.ai.vision.mockImplementation(async () => scores.shift() ?? SCORE(1));
    const r = await w.svc.generate(OWNER, dto());
    expect(r.variations).toHaveLength(3);
    expect(r.variations.find((v) => v.winner)!.score!.total).toBe(41);
    const artCalls = w.ai.json.mock.calls.filter((c) => c[1].name === 'art_direction');
    expect(artCalls).toHaveLength(2);
    expect(artCalls[1]![1].prompt).toContain('AJUSTE PEDIDO (aplique com prioridade): Corrija este problema apontado pelo crítico: ruim');
    expect(w.provider.image).toHaveBeenCalledTimes(3);
    w.cleanup();
  });

  it('layout com texto: gera a versão final composta como filha da vencedora; logo da marca entra no canto', async () => {
    const w = await creativeWorld();
    const { brand } = await seed(w);
    await w.prisma.brands.update({ where: { id: brand.id }, data: { visual_style: { posicao_logo: 'bottom_right', paleta_hex: ['#e11d48'] } } });
    const key = w.files.newUploadKey('brands', WS_A, 'png');
    await w.files.put('creative-assets', key, w.png);
    await w.t['brand_assets']!.create({ data: { workspace_id: WS_A, brand_id: brand.id, kind: 'logo', name: 'logo.png', storage_path: key } });
    const r = await w.svc.generate(OWNER, dto({ brandId: brand.id, layout: 'titulo_topo', headline: 'Chopp em dobro', variations: 1 }));
    expect(r.status).toBe('ready');
    const assets = w.t['media_assets']!.rows;
    expect(assets).toHaveLength(2); // limpa + final
    const clean = assets.find((a) => /\(limpa\)$/.test(a.title))!;
    const fin = assets.find((a) => a.title === 'Chopp gelado')!;
    expect(fin.parent_id).toBe(clean.id);
    expect((fin.quality_report as any)).toMatchObject({ version: 'final', layout: 'titulo_topo', winner: true });
    expect(r.assetUrl).toBe(fin.url);
    expect(r.variations).toHaveLength(1); // só as variações limpas
    expect(w.t['creatives']!.rows[0]!.preview_url).toBe(fin.url);
    w.cleanup();
  });

  it('fotos de referência da marca vão ao provedor (bytes ≤1024 px + URLs) e o diretor de arte sabe que há foto do produto', async () => {
    const w = await creativeWorld();
    const { brand } = await seed(w);
    const key = w.files.newUploadKey('brands', WS_A, 'png');
    await w.files.put('creative-assets', key, w.png);
    await w.t['brand_assets']!.create({ data: { workspace_id: WS_A, brand_id: brand.id, kind: 'photo', tag: 'produto', name: 'chopp.png', url: 'https://x/chopp.png', storage_path: key } });
    await w.svc.generate(OWNER, dto({ brandId: brand.id, variations: 1 }));
    const call = w.provider.image.mock.calls[0]![0] as any;
    expect(call.referenceImages).toHaveLength(1);
    expect(call.referenceImages[0].mime).toBe('image/jpeg');
    expect(call.referenceUrls).toEqual(['https://x/chopp.png']);
    expect(w.ai.json.mock.calls[0]![1].prompt).toContain('use the product exactly as in the reference images');
    // referência de OUTRO workspace (storage_path alheio) é ignorada
    const other = w.files.newUploadKey('brands', WS_B, 'png');
    await w.files.put('creative-assets', other, w.png);
    await w.t['brand_assets']!.create({ data: { workspace_id: WS_A, brand_id: brand.id, kind: 'reference', name: 'alheia.png', storage_path: other } });
    w.provider.image.mockClear();
    await w.svc.generate(OWNER, dto({ brandId: brand.id, variations: 1 }));
    expect((w.provider.image.mock.calls[0]![0] as any).referenceImages).toHaveLength(1);
    w.cleanup();
  });

  it('estratégia aprovada da campanha entra no briefing (ângulo escolhido)', async () => {
    const w = await creativeWorld();
    const { campaign } = await seed(w);
    w.strategy.current = { big_idea: 'Chopp que ninguém esquece', mensagem_principal: 'm', angulos_detalhados: [{ nome: 'Promo', gancho: 'Leve 2', mensagem: 'x' }], objecoes: [], briefing_criativo: { direcao_visual: 'close no copo suado', cta: 'Peça já' } };
    await w.svc.generate(OWNER, dto({ campaignId: campaign.id, variations: 1, angle: 'Promo' }));
    const prompt = w.ai.json.mock.calls[0]![1].prompt as string;
    expect(prompt).toContain('CONCEITO DA ESTRATÉGIA');
    expect(prompt).toContain('close no copo suado');
    expect(prompt).toContain('Leve 2');
    expect(w.t['creatives']!.rows[0]!.angle).toBe('Promo');
    w.cleanup();
  });

  it('autorização: viewer e estranho não geram; campanha/marca de outro workspace → 404 (sem gastar crédito)', async () => {
    const w = await creativeWorld();
    const { campaign } = await seed(w);
    const otherBrand = await w.t['brands']!.create({ data: { workspace_id: WS_B, name: 'Alheia' } });
    const otherCamp = await w.t['campaigns']!.create({ data: { workspace_id: WS_B, brand_id: otherBrand.id, name: 'X' } });
    expect(await status(w.svc.generate(VIEWER, dto()))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.svc.generate(STRANGER, dto()))).toBe('403:Você não tem acesso a esta empresa.');
    expect(await status(w.svc.preview(VIEWER, dto()))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.svc.generate(OWNER, dto({ campaignId: otherCamp.id })))).toBe('404:Campanha não encontrada.');
    expect(await status(w.svc.generate(OWNER, dto({ brandId: otherBrand.id })))).toBe('404:Marca não encontrada.');
    expect(await status(w.svc.generate(OWNER, dto({ campaignId: campaign.id, brandId: otherBrand.id })))).toBe('404:Marca não encontrada.');
    expect(w.ai.json).not.toHaveBeenCalled();
    expect(w.t['creative_generation_jobs']!.rows).toHaveLength(0);
    w.cleanup();
  });

  it('erro do provedor volta em `error` (status failed) e o job fica failed; erro desconhecido vira mensagem genérica', async () => {
    const w = await creativeWorld();
    await seed(w);
    w.provider.image.mockRejectedValue(new AiError('Créditos de IA esgotados. Adicione créditos para continuar.'));
    const r = await w.svc.generate(ADMIN, dto({ variations: 1 }));
    expect([r.status, r.error, r.creativeId, r.variations]).toEqual(['failed', 'Créditos de IA esgotados. Adicione créditos para continuar.', null, []]);
    const job = w.t['creative_generation_jobs']!.rows[0]!;
    expect([job.status, job.error_message, !!job.completed_at]).toEqual(['failed', 'Créditos de IA esgotados. Adicione créditos para continuar.', true]);
    expect(w.t['creatives']!.rows).toHaveLength(0);
    expect(w.logs).toEqual([]); // sem `creative.generated`
    w.provider.image.mockRejectedValue(new Error('ECONNRESET 10.0.0.5:5432 segredo'));
    const r2 = await w.svc.generate(ADMIN, dto({ variations: 1 }));
    expect(r2.status).toBe('failed');
    expect(r2.error).toBe('Não foi possível gerar este criativo. Tente novamente.');
    w.cleanup();
  });

  it('previewVisualPrompt: só o diretor de arte (sem job); com prompt editado e sem ajuste, nem chama o LLM', async () => {
    const w = await creativeWorld();
    await seed(w);
    const r = await w.svc.preview(MARKETING, dto({ provider: 'chatgpt' }));
    expect(r.artDirection.prompt_final).toBe(ART.prompt_final);
    expect(w.ai.json).toHaveBeenCalledTimes(1);
    expect(w.ai.json.mock.calls[0]![1].prompt).toContain('Provedor de destino: chatgpt');
    expect(w.t['creative_generation_jobs']!.rows).toHaveLength(0);
    const edited = await w.svc.preview(MARKETING, dto({ visualPrompt: 'meu prompt editado', artDirection: { ...ART } }));
    expect(edited.artDirection.prompt_final).toBe('meu prompt editado');
    expect(w.ai.json).toHaveBeenCalledTimes(1);
    const adjusted = await w.svc.preview(MARKETING, dto({ visualPrompt: 'meu prompt editado', artDirection: { ...ART }, adjust: 'mais close' }));
    expect(adjusted.artDirection.prompt_final).toBe(ART.prompt_final);
    expect(w.ai.json.mock.calls[1]![1].prompt).toContain('PROMPT ANTERIOR: meu prompt editado');
    expect(w.ai.json.mock.calls[1]![1].prompt).toContain('AJUSTE PEDIDO (aplique com prioridade): mais close');
    w.cleanup();
  });
});

describe('vídeo assíncrono — job vinculado ao workspace', () => {
  it('passou do prazo: job fica generating com o id externo gravado NA LINHA do job; o poller conclui e cria o criativo, a mídia e as legendas', async () => {
    const w = await creativeWorld();
    const { brand } = await seed(w);
    const r = await w.svc.generate(OWNER, dto({ type: 'reels', aspectRatio: '9:16', targetFormat: 'ig_reel', brandId: brand.id, copyText: 'Chopp gelado todo dia no Bar do Zé venha conferir', useBrandImage: false }));
    expect([r.status, r.assetUrl, r.creativeId]).toEqual(['generating', null, null]);
    expect((w.provider.video.mock.calls[0]![0] as any).maxWaitMs).toBe(25_000);
    const job = w.t['creative_generation_jobs']!.rows[0]!;
    expect([job.status, job.external_job_id, job.workspace_id, job.type]).toEqual(['generating', 'veo:job1', WS_A, 'reels']);
    expect(job.options).toMatchObject({ coverWithLogo: false, captionText: 'Chopp gelado todo dia no Bar do Zé venha conferir', title: 'Chopp gelado', targetFormat: 'ig_reel' });

    // ainda gerando: nada muda
    expect(await w.svc.pollPendingCreatives()).toEqual([{ job: job.id, status: 'generating' }]);
    expect(w.provider.status).toHaveBeenCalledWith('veo:job1');
    // pronto
    w.provider.status.mockResolvedValue({ status: 'ready', assetUrl: null, bytes: sampleMp4(), mime: 'video/mp4', thumbnailUrl: null, externalJobId: 'veo:job1', cost: 6, note: null });
    expect(await w.svc.pollPendingCreatives()).toEqual([{ job: job.id, status: 'ready' }]);
    const done = w.t['creative_generation_jobs']!.rows[0]!;
    expect([done.status, !!done.creative_id, !!done.asset_url]).toEqual(['ready', true, true]);
    const cr = w.t['creatives']!.rows[0]!;
    expect([cr.status, cr.provider, cr.type, cr.title, cr.copy_text]).toEqual(['ready', 'gemini', 'reels', 'Chopp gelado', 'Chopp gelado todo dia no Bar do Zé venha conferir']);
    const asset = w.t['media_assets']!.rows[0]!;
    expect([asset.kind, asset.ig_ready, asset.creative_id, asset.target_format]).toEqual(['video', true, cr.id, 'ig_reel']);
    expect(cr.extras.captions_srt).toContain('/v1/files/creative-assets/');
    expect(cr.extras.captions_vtt).toBeTruthy();
    expect(cr.extras.cover_url).toBeUndefined();
    // já concluído: o poller não repete
    expect(await w.svc.pollPendingCreatives()).toEqual([]);
    w.cleanup();
  });

  it('o poller ignora o que não é job `generating` com id e falha o job quando o provedor falha, estoura 1 h ou o id é inválido (provedor nem é consultado)', async () => {
    const w = await creativeWorld();
    await seed(w);
    const mkJob = (extra: Record<string, unknown>) => w.t['creative_generation_jobs']!.create({ data: { workspace_id: WS_A, status: 'generating', provider: 'gemini', type: 'video', prompt: 'p', ...extra } });
    const failed = await mkJob({ external_job_id: 'veo:falhou' });
    const old = await mkJob({ external_job_id: 'veo:antigo', created_at: new Date(Date.now() - 61 * 60_000) });
    const evil = await mkJob({ external_job_id: '../../etc/passwd' });
    await mkJob({ status: 'ready', external_job_id: 'veo:pronto' });
    await mkJob({ external_job_id: null });
    w.provider.status.mockImplementation(async (id: string) => (id === 'veo:falhou' ? { status: 'failed', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 } : { status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 }));
    // o vínculo/validação de formato é do provedor real (ver providers.spec); aqui o provedor falso simula a recusa
    w.provider.status.mockImplementation(async (id: string) => {
      if (id.includes('..')) return { status: 'failed', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 };
      return id === 'veo:falhou' ? { status: 'failed', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 } : { status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 };
    });
    const out = await w.svc.pollPendingCreatives();
    expect(out).toEqual(expect.arrayContaining([{ job: failed.id, status: 'failed' }, { job: old.id, status: 'failed' }, { job: evil.id, status: 'failed' }]));
    expect(out).toHaveLength(3);
    const rows = w.t['creative_generation_jobs']!.rows;
    expect(rows.find((r) => r.id === old.id)!.error_message).toBe('Tempo esgotado no provedor.');
    expect(rows.find((r) => r.id === failed.id)!.error_message).toBe('O provedor informou falha na geração.');
    w.cleanup();
  });

  it('tipo "ugc"/"story" também é vídeo no poller (no protótipo a regex deixava ugc/story virarem imagem)', async () => {
    const w = await creativeWorld();
    await seed(w);
    const job = await w.t['creative_generation_jobs']!.create({ data: { workspace_id: WS_A, status: 'generating', provider: 'gemini', type: 'ugc', prompt: 'p', external_job_id: 'veo:j9', aspect_ratio: '9:16' } });
    w.provider.status.mockResolvedValue({ status: 'ready', assetUrl: null, bytes: sampleMp4(), mime: 'video/mp4', thumbnailUrl: null, externalJobId: 'veo:j9', cost: 0, note: null });
    expect(await w.svc.pollPendingCreatives()).toEqual([{ job: job.id, status: 'ready' }]);
    expect(w.t['media_assets']!.rows[0]!.kind).toBe('video');
    w.cleanup();
  });

  it('capa com logo/título/CTA: gera um still, compõe por cima e liga ao vídeo', async () => {
    const w = await creativeWorld();
    const { brand } = await seed(w);
    w.provider.video.mockResolvedValue({ status: 'ready', assetUrl: null, bytes: sampleMp4(), mime: 'video/mp4', thumbnailUrl: null, externalJobId: 'veo:ok', cost: 6, note: 'n' });
    const r = await w.svc.generate(OWNER, dto({ type: 'video', aspectRatio: '9:16', targetFormat: 'ig_reel', brandId: brand.id, useBrandImage: false, coverWithLogo: true, headline: 'Chopp em dobro', cta: 'Peça já', copyText: 'legenda curta' }));
    expect(r.status).toBe('ready');
    const cr = w.t['creatives']!.rows[0]!;
    expect(cr.extras.cover_url).toBeTruthy();
    expect(cr.extras.errors).toBeUndefined();
    const cover = w.t['media_assets']!.rows.find((a) => /\(capa\)$/.test(a.title))!;
    expect([cover.kind, cover.target_format, cover.parent_id]).toEqual(['image', 'ig_story', w.t['media_assets']!.rows.find((a) => a.kind === 'video')!.id]);
    w.cleanup();
  });
});

describe('retry, nova versão e pacote CapCut', () => {
  it('retry: job de outro workspace/inexistente → 404 "Job de geração não encontrado."; viewer → 403; refaz com o prompt final guardado', async () => {
    const w = await creativeWorld();
    await seed(w);
    const job = await w.t['creative_generation_jobs']!.create({ data: { workspace_id: WS_A, status: 'failed', provider: 'gemini', type: 'static_image', prompt: 'p', final_prompt: 'prompt final guardado', aspect_ratio: '1:1', error_message: 'x' } });
    expect(await status(w.svc.retry(STRANGER, job.id))).toBe('404:Job de geração não encontrado.');
    expect(await status(w.svc.retry(OWNER, '00000000-0000-4000-8000-000000000009'))).toBe('404:Job de geração não encontrado.');
    expect(await status(w.svc.retry(VIEWER, job.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
    const r = await w.svc.retry(MARKETING, job.id);
    expect([r.status, r.jobId]).toEqual(['ready', job.id]);
    expect((w.provider.image.mock.calls[0]![0] as any).finalPrompt).toBe('prompt final guardado');
    const row = w.t['creative_generation_jobs']!.rows[0]!;
    expect([row.status, row.error_message]).toEqual(['ready', null]);
    expect(w.t['creatives']!.rows).toHaveLength(1);
    w.cleanup();
  });

  it('nova versão: mesmo criativo, versão+1, histórico em creative_versions e prompt com a instrução de variação', async () => {
    const w = await creativeWorld();
    await seed(w);
    const cr = await w.t['creatives']!.create({ data: { workspace_id: WS_A, title: 'Chopp', type: 'static_image', prompt: 'p', final_prompt: 'prompt base', aspect_ratio: '1:1', provider: 'gemini', version: 1, status: 'approved' } });
    const foreign = await w.t['creatives']!.create({ data: { workspace_id: WS_B, title: 'Alheio' } });
    expect(await status(w.svc.newVersion(OWNER, foreign.id))).toBe('404:Criativo não encontrado.');
    expect(await status(w.svc.newVersion(VIEWER, cr.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
    const r = await w.svc.newVersion(OWNER, cr.id);
    expect([r.status, r.creativeId]).toEqual(['ready', cr.id]);
    expect((w.provider.image.mock.calls[0]![0] as any).finalPrompt).toBe('prompt base\nNova variação (versão 2): mude composição, enquadramento e cena, mantendo a identidade da marca.');
    const row = w.t['creatives']!.rows.find((c) => c.id === cr.id)!;
    expect([row.version, row.status, !!row.preview_url]).toEqual([2, 'ready', true]);
    expect(w.t['creative_versions']!.rows).toEqual([expect.objectContaining({ creative_id: cr.id, version: 2 })]);
    w.cleanup();
  });

  it('pacote CapCut: vídeo + legendas + capa + LEIA-ME com o roteiro; baixa só do que é do próprio sistema', async () => {
    const w = await creativeWorld();
    const { campaign } = await seed(w);
    await w.t['copies']!.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: 1, content: { headline: 'Chopp em dobro', cta: 'Peça já', reels: 'Cena 1: copo suado' } } });
    const put = async (ext: string, bytes: Buffer | Uint8Array) => { const k = w.files.newUploadKey('media', WS_A, ext); await w.files.put('creative-assets', k, bytes); return w.files.signedUrl('creative-assets', k); };
    const cr = await w.t['creatives']!.create({
      data: { workspace_id: WS_A, campaign_id: campaign.id, title: 'Reel do chopp', preview_url: await put('mp4', sampleMp4()), extras: { captions_srt: await put('srt', Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nOi\n')), cover_url: await put('jpg', w.png) } },
    });
    expect(await status(w.svc.capcutPackage(STRANGER, cr.id))).toBe('404:Criativo não encontrado.');
    const r = await w.svc.capcutPackage(VIEWER, cr.id); // qualquer membro
    const key = decodeURIComponent(new URL(r.url).pathname.replace('/v1/files/creative-assets/', ''));
    expect(key.startsWith(`exports/${WS_A}/`)).toBe(true);
    expect(r.url).toContain('dl=pacote-capcut.zip');
    const zip = await JSZip.loadAsync(await w.files.read('creative-assets', key));
    expect(Object.keys(zip.files).sort()).toEqual(['LEIA-ME.txt', 'capa.jpg', 'legendas.srt', 'video.mp4']);
    const readme = await zip.file('LEIA-ME.txt')!.async('string');
    expect(readme).toContain('Criativo: Reel do chopp');
    expect(readme).toContain('Título: Chopp em dobro');
    expect(readme).toContain('Roteiro do Reels:\nCena 1: copo suado');
    expect(readme).toContain('Importe video.mp4');
    // sem arquivo
    const empty = await w.t['creatives']!.create({ data: { workspace_id: WS_A, title: 'Vazio' } });
    expect(await status(w.svc.capcutPackage(OWNER, empty.id))).toBe('400:Este criativo ainda não tem arquivo.');
    // link de arquivo adulterado → mensagem do protótipo-like, sem vazar nada
    const bad = await w.t['creatives']!.create({ data: { workspace_id: WS_A, title: 'Ruim', preview_url: (await put('jpg', w.png)).replace(/sig=([0-9a-f])/, (_m, c) => `sig=${c === '0' ? '1' : '0'}`) } });
    expect(await status(w.svc.capcutPackage(OWNER, bad.id))).toContain('400:Falha ao baixar');
    w.cleanup();
  });

  it('legendas: blocos de 6 palavras distribuídos pela duração (.vtt e .srt)', () => {
    const { vtt, srt } = buildCaptions('um dois três quatro cinco seis sete oito nove dez onze doze treze', 8);
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:02.616\num dois três quatro cinco seis')).toBe(true);
    expect(srt.startsWith('1\n00:00:00,000 --> 00:00:02,616\num dois três quatro cinco seis')).toBe(true);
    expect(srt.split('\n\n')).toHaveLength(3);
    expect(buildCaptions('', 8)).toEqual({ vtt: 'WEBVTT\n', srt: '' });
  });
});

describe('recursos do Studio (leituras/escritas diretas)', () => {
  it('lista criativos com campaigns(name); status só no workspace, com atividade; jobs em ordem; brief 404 em campanha alheia', async () => {
    const w = await creativeWorld();
    const { campaign } = await seed(w);
    const cr = await w.t['creatives']!.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, title: 'C1' } });
    const foreign = await w.t['creatives']!.create({ data: { workspace_id: WS_B, title: 'Alheio' } });
    const list = await w.res.listCreatives(WS_A);
    expect(list).toHaveLength(1);
    expect((list[0] as any).campaigns).toEqual({ name: 'Black Friday' });
    expect(await status(w.res.setStatus(OWNER, WS_A, foreign.id, 'approved'))).toBe('404:Criativo não encontrado.');
    expect((await w.res.setStatus(OWNER, WS_A, cr.id, 'approved')).status).toBe('approved');
    expect(w.logs.at(-1)).toEqual([WS_A, OWNER, 'creative.approved', 'creative', { creative_id: cr.id }]);
    for (let i = 0; i < 15; i++) await w.t['creative_generation_jobs']!.create({ data: { workspace_id: WS_A } });
    await w.t['creative_generation_jobs']!.create({ data: { workspace_id: WS_B } });
    expect(await w.res.listJobs(WS_A)).toHaveLength(12);
    expect(await w.res.listJobs(WS_A, 5)).toHaveLength(5);
    for (let v = 1; v <= 12; v++) await w.t['copies']!.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: v } });
    const brief = await w.res.campaignBrief(WS_A, campaign.id);
    expect(brief.copies).toHaveLength(10);
    expect(brief.copies[0]!.version).toBe(12);
    const otherBrand = await w.t['brands']!.create({ data: { workspace_id: WS_B, name: 'B' } });
    const otherCamp = await w.t['campaigns']!.create({ data: { workspace_id: WS_B, brand_id: otherBrand.id, name: 'X' } });
    expect(await status(w.res.campaignBrief(WS_A, otherCamp.id))).toBe('404:Campanha não encontrada.');
    w.cleanup();
  });
});
