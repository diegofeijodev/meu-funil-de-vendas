import { AiError } from '../../ai/ai-error';
import { AiService } from '../../ai/ai.service';
import { isValidVideoJobId } from '../../ai/video-job-id';
import { createAiProvider } from '../providers/ai-creative.provider';
import { createHiggsfieldProvider, extractJobId, pickUrl } from '../providers/higgsfield.provider';
import { chainProviders, ProviderResolverService, providerLog } from '../provider-resolver.service';
import { GenerationRequest, GenerationResult, ServerCreativeProvider } from '../creative.types';
import { status } from '../../media/__tests__/mem';

const JOB = '3f2a9c1e-8b7d-4e6f-a1b2-c3d4e5f60718';
const req: GenerationRequest = { finalPrompt: 'copo de chopp', aspectRatio: '1:1', kind: 'image' };
const png = Buffer.from('89504e470d0a1a0a', 'hex');

describe('ids de job de vídeo (nunca consultar um id arbitrário)', () => {
  it('aceita só veo:<id> e gveo:[models/<m>/]operations/<id>', () => {
    for (const ok of ['veo:abc123', 'veo:A-b_c.9', 'gveo:models/veo-3.0-fast-generate-preview/operations/abc-1', 'gveo:operations/xyz']) expect(isValidVideoJobId(ok)).toBe(true);
    for (const bad of ['', 'veo:', 'foo:bar', 'veo:../x', 'veo:a/b', 'veo:a?x=1', 'veo:a#b', 'veo:a%2e', 'gveo:models/../operations/x', 'gveo:models/m/operations/../../x', 'gveo:/operations/x', 'gveo:models/m/other/x', 'veo:.hidden', 'http://evil/x', 42, null, undefined, 'veo:' + 'a'.repeat(300)]) {
      expect(isValidVideoJobId(bad as any)).toBe(false);
    }
  });

  it('AiService.videoStatus recusa id inválido SEM chamar o provedor', async () => {
    const http = jest.fn();
    const keys = { get: jest.fn() };
    const ai = new AiService(keys as any, http as any, { AI_GATEWAY_URL: 'https://gw.test/v1', AI_GATEWAY_API_KEY: 'k' } as any);
    expect(await ai.videoStatus('ws', '../../admin')).toEqual({ status: 'failed' });
    expect(await ai.videoStatus('ws', 'veo:../x')).toEqual({ status: 'failed' });
    expect(await ai.videoStatus('ws', 'gveo:models/../operations/x')).toEqual({ status: 'failed' });
    expect(http).not.toHaveBeenCalled();
    expect(keys.get).not.toHaveBeenCalled();
  });
});

describe('provedor de IA (ChatGPT/Gemini) por AiService', () => {
  const aiFake = () => ({
    image: jest.fn(async () => ({ bytes: png, mime: 'image/png', ext: 'png', cost: 1.5, note: 'ChatGPT (chave do workspace)' })),
    video: jest.fn(async () => ({ status: 'pending' as const, jobId: 'veo:job1', cost: 6, note: 'Vídeo pelo Veo do app, ainda gerando' })),
    videoStatus: jest.fn(async () => ({ status: 'ready' as const, bytes: png, mime: 'video/mp4', jobId: 'veo:job1', cost: 0, note: null })),
  });

  it('imagem: devolve os bytes, custo e nota; passa strict/appOnly e as referências', async () => {
    const ai = aiFake();
    const p = createAiProvider(ai as any, 'ws', 'openai', { hasOwnKey: true, strict: true, owns: async () => true });
    expect([p.id, p.label, p.sandbox]).toEqual(['chatgpt', 'ChatGPT (sua conta OpenAI)', false]);
    const refs = [{ bytes: png, mime: 'image/jpeg' }];
    const r = await p.generateImage({ ...req, referenceImages: refs });
    expect([r.status, r.bytes, r.mime, r.cost, r.note]).toEqual(['ready', png, 'image/png', 1.5, 'ChatGPT (chave do workspace)']);
    expect(ai.image).toHaveBeenCalledWith('ws', { prompt: 'copo de chopp', aspectRatio: '1:1', referenceImages: refs, vendor: 'openai', strict: true, appOnly: undefined });
    const app = createAiProvider(ai as any, 'ws', 'gemini', { hasOwnKey: false, appOnly: true, label: 'Créditos de IA do app', owns: async () => true });
    await app.generateImage(req);
    expect((ai.image.mock.calls.at(-1) as any)[1]).toMatchObject({ vendor: 'gemini', appOnly: true });
    expect(app.label).toBe('Créditos de IA do app');
  });

  it('ChatGPT não gera vídeo (mensagem do protótipo); Gemini devolve job pendente com o id veo:', async () => {
    const ai = aiFake();
    const chat = createAiProvider(ai as any, 'ws', 'openai', { hasOwnKey: false, owns: async () => true });
    const e = await chat.generateVideo({ ...req, kind: 'video' }).catch((x) => x);
    expect(e).toBeInstanceOf(AiError);
    expect(e.message).toBe('O ChatGPT não gera vídeos. Escolha Gemini ou Higgsfield para vídeo.');
    const gem = createAiProvider(ai as any, 'ws', 'gemini', { hasOwnKey: false, owns: async () => true });
    const r = await gem.generateVideo({ ...req, kind: 'video', maxWaitMs: 25_000 });
    expect([r.status, r.externalJobId, r.bytes]).toEqual(['generating', 'veo:job1', undefined]);
    expect((ai.video.mock.calls[0] as any)[1].maxWaitMs).toBe(25_000);
  });

  it('getGenerationStatus: formato inválido ou id que NÃO está num job do workspace → failed, sem consultar o provedor', async () => {
    const ai = aiFake();
    const owns = jest.fn(async (_ws: string, id: string) => id === 'veo:job1');
    const p = createAiProvider(ai as any, 'ws', 'gemini', { hasOwnKey: false, owns });
    for (const id of ['../../x', 'veo:../etc', 'veo:de-outro-workspace']) expect((await p.getGenerationStatus(id)).status).toBe('failed');
    expect(ai.videoStatus).not.toHaveBeenCalled();
    expect(owns).toHaveBeenCalledTimes(1); // formato inválido nem chega ao vínculo
    const ok = await p.getGenerationStatus('veo:job1');
    expect([ok.status, ok.bytes, ok.externalJobId]).toEqual(['ready', png, 'veo:job1']);
    ai.videoStatus.mockResolvedValueOnce({ status: 'pending', jobId: 'veo:job1', cost: 0, note: null } as any);
    expect((await p.getGenerationStatus('veo:job1')).status).toBe('generating');
    ai.videoStatus.mockResolvedValueOnce({ status: 'failed' } as any);
    expect((await p.getGenerationStatus('veo:job1')).status).toBe('failed');
  });
});

describe('Higgsfield pelo MCP', () => {
  const mcpFake = (script: (name: string, args: any) => any) => ({ callTool: jest.fn(async (_c: any, name: string, args: any) => script(name, args)) });
  const conn = { server_url: 'https://mcp.higgsfield.ai/mcp', access_token: 'tok' };
  const noSleep = async () => undefined;

  it('extrai id de job (UUID) e URL de mídia do texto da ferramenta', () => {
    expect(extractJobId(`{"id":"${JOB}"}`)).toBe(JOB);
    expect(extractJobId(`job ${JOB} started`)).toBe(JOB);
    expect(extractJobId('sem id')).toBeNull();
    expect(pickUrl('x https://cdn.h.ai/a/b.mp4?sig=1 y https://h.ai/page')).toBe('https://cdn.h.ai/a/b.mp4?sig=1');
    expect(pickUrl('https://h.ai/page')).toBeNull();
  });

  it('imagem: generate_image (gpt_image_2_5, 2k, até 4 refs por URL) → job_status até a URL → ready com custo 1.2', async () => {
    const mcp = mcpFake((name) => (name === 'generate_image' ? { text: `{"id":"${JOB}"}`, structured: null, mediaUrl: null } : { text: '{"status":"completed"}', structured: null, mediaUrl: 'https://cdn.h.ai/img.png' }));
    const p = createHiggsfieldProvider(mcp as any, conn, noSleep);
    const r = await p.generateImage({ ...req, referenceUrls: ['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4', 'https://a/5'] });
    expect([r.status, r.assetUrl, r.externalJobId, r.cost]).toEqual(['ready', 'https://cdn.h.ai/img.png', JOB, 1.2]);
    const gen = mcp.callTool.mock.calls[0]!;
    expect([gen[1], gen[2].params.model, gen[2].params.resolution, gen[2].params.aspect_ratio, gen[2].params.input_images]).toEqual(['generate_image', 'gpt_image_2_5', '2k', '1:1', ['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4']]);
    expect(mcp.callTool.mock.calls[1]![1]).toBe('job_status');
    expect(mcp.callTool.mock.calls[1]![2]).toEqual({ jobId: JOB, sync: true });
  });

  it('vídeo: kling2_6, 10 s, 1080p; proporção fora de 16:9/9:16/1:1 vira 9:16', async () => {
    const mcp = mcpFake((name) => (name === 'generate_video' ? { text: JOB, structured: null, mediaUrl: null } : { text: '{"status":"success"}', structured: null, mediaUrl: 'https://cdn.h.ai/v.mp4' }));
    const p = createHiggsfieldProvider(mcp as any, conn, noSleep);
    const r = await p.generateVideo({ ...req, kind: 'video', aspectRatio: '4:5' });
    expect([r.status, r.cost]).toEqual(['ready', 4.5]);
    const params = (mcp.callTool.mock.calls[0]![2] as any).params;
    expect([mcp.callTool.mock.calls[0]![1], params.model, params.duration, params.sound, params.resolution, params.aspect_ratio]).toEqual(['generate_video', 'kling2_6', 10, true, '1080p', '9:16']);
  });

  it('se o modelo recusa a resolução, repete sem ela', async () => {
    let n = 0;
    const mcp = mcpFake((name, args) => {
      if (name === 'generate_image') return ++n === 1 ? { text: 'invalid parameter resolution', structured: null, mediaUrl: null } : { text: JOB, structured: null, mediaUrl: null };
      return { text: '{"status":"completed"}', structured: null, mediaUrl: 'https://cdn.h.ai/i.png' };
    });
    const r = await createHiggsfieldProvider(mcp as any, conn, noSleep).generateImage(req);
    expect(r.status).toBe('ready');
    expect((mcp.callTool.mock.calls[1]![2] as any).params.resolution).toBeUndefined();
  });

  it('sem id de job → erro; status failed → erro com o motivo; prazo curto → generating com o id', async () => {
    const noId = createHiggsfieldProvider(mcpFake(() => ({ text: 'ok', structured: null, mediaUrl: null })) as any, conn, noSleep);
    expect(await status(noId.generateImage(req))).toBe('400:O Higgsfield não confirmou a geração.');
    const failing = createHiggsfieldProvider(mcpFake((n) => (n === 'job_status' ? { text: '{"status":"nsfw"}', structured: null, mediaUrl: null } : { text: JOB, structured: null, mediaUrl: null })) as any, conn, noSleep);
    expect(await status(failing.generateImage(req))).toBe('400:O Higgsfield não conseguiu gerar (nsfw).');
    const slow = createHiggsfieldProvider(mcpFake((n) => (n === 'job_status' ? { text: '{"status":"running"}', structured: null, mediaUrl: null } : { text: JOB, structured: null, mediaUrl: null })) as any, conn, async () => undefined);
    const r = await slow.generateImage({ ...req, maxWaitMs: 1 });
    expect([r.status, r.externalJobId]).toEqual(['generating', JOB]);
  });

  it('getGenerationStatus só aceita UUID (vira argumento de ferramenta MCP)', async () => {
    const mcp = mcpFake(() => ({ text: '{"status":"completed"}', structured: null, mediaUrl: 'https://cdn.h.ai/i.png' }));
    const p = createHiggsfieldProvider(mcp as any, conn, noSleep);
    expect((await p.getGenerationStatus('x"; drop')).status).toBe('failed');
    expect(mcp.callTool).not.toHaveBeenCalled();
    expect((await p.getGenerationStatus(JOB)).status).toBe('ready');
  });
});

describe('cadeia de provedores', () => {
  const mk = (id: string, behavior: () => Promise<GenerationResult>): ServerCreativeProvider => ({
    id, label: id.toUpperCase(), sandbox: false, generateImage: behavior, generateVideo: behavior,
    getGenerationStatus: async (x) => ({ status: 'failed', assetUrl: null, thumbnailUrl: null, externalJobId: x, cost: 0 }), getAsset: async () => null,
  });
  const ok = (note: string | null = null): GenerationResult => ({ status: 'ready', assetUrl: null, bytes: png, thumbnailUrl: null, externalJobId: null, cost: 0, note });

  it('avança para o próximo em QUALQUER erro, registra o log, lembra quem funcionou e não volta a quem falhou', async () => {
    let aCalls = 0;
    const a = mk('a', async () => { aCalls++; throw new Error('429 cota esgotada'); });
    const b = mk('b', async () => ok('B ok'));
    const chain = chainProviders([a, b]);
    expect(chain.id).toBe('a');
    await chain.generateImage(req);
    await chain.generateImage(req);
    expect(aCalls).toBe(1); // depois da 1ª falha, A saiu da lista
    expect(chain.id).toBe('b');
    expect(providerLog(chain)).toBe('A: 429 cota esgotada → tentando o próximo\nUsado: B ok');
  });

  it('o último provedor propaga o erro', async () => {
    const chain = chainProviders([mk('a', async () => { throw new AiError('Créditos de IA esgotados.'); }), mk('b', async () => { throw new AiError('Muitas solicitações agora.'); })]);
    expect(await status(chain.generateImage(req))).toBe('502:Muitas solicitações agora.');
    expect(providerLog(chain)).toContain('A: Créditos de IA esgotados. → tentando o próximo');
  });

  it('providerLog sem cadeia usa a nota do resultado ou o rótulo', () => {
    const p = mk('x', async () => ok());
    expect(providerLog(p)).toBe('Usado: X');
    expect(providerLog(p, ok('Gemini (chave do workspace)'))).toBe('Usado: Gemini (chave do workspace)');
  });
});

describe('ProviderResolverService', () => {
  function build(opts: { openai?: boolean; gemini?: boolean; higgs?: boolean; ownsJob?: boolean } = {}) {
    const ai = {
      image: jest.fn(async (_ws: string, r: any) => ({ bytes: png, mime: 'image/png', ext: 'png', cost: 1, note: null, ...r.__x })),
      video: jest.fn(), videoStatus: jest.fn(),
    };
    const keys = { get: jest.fn(async (_ws: string, v: string) => ((v === 'openai' && opts.openai) || (v === 'gemini' && opts.gemini) ? 'chave' : null)) };
    const mcp = {
      getLiveConnection: jest.fn(async () => (opts.higgs ? { status: 'connected', server_url: 'https://mcp.higgsfield.ai/mcp', access_token: 't' } : null)),
      callTool: jest.fn(),
    };
    const prisma = { creative_generation_jobs: { count: jest.fn(async () => (opts.ownsJob ? 1 : 0)) } };
    return { ai, keys, mcp, prisma, svc: new ProviderResolverService(prisma as any, ai as any, keys as any, mcp as any) };
  }

  it('higgsfield escolhido e não conectado → erro com a mensagem do protótipo', async () => {
    const { svc } = build();
    expect(await status(svc.resolve('ws', 'higgsfield'))).toBe('400:Higgsfield não está conectado nesta empresa. Conecte em Integrações.');
    expect((await build({ higgs: true }).svc.resolve('ws', 'higgsfield')).id).toBe('higgsfield');
  });

  it('chatgpt/gemini diretos: rótulo muda com a chave própria', async () => {
    expect((await build({ openai: true }).svc.resolve('ws', 'chatgpt')).label).toBe('ChatGPT (sua conta OpenAI)');
    expect((await build().svc.resolve('ws', 'chatgpt')).label).toBe('ChatGPT (OpenAI)');
    expect((await build({ gemini: true }).svc.resolve('ws', 'gemini')).label).toBe('Gemini (sua conta Google)');
  });

  it('automático sem conexões: créditos do app (gateway, ignorando chaves do workspace)', async () => {
    const { svc, ai } = build();
    const p = await svc.resolve('ws', 'auto');
    expect([p.id, p.label]).toEqual(['gemini', 'Créditos de IA do app']);
    await p.generateImage(req);
    expect((ai.image.mock.calls[0] as any)[1]).toMatchObject({ vendor: 'gemini', appOnly: true });
  });

  it('automático com tudo: OpenAI (estrita) → Gemini (estrita) → Higgsfield → app, nessa ordem', async () => {
    const { svc, ai, mcp } = build({ openai: true, gemini: true, higgs: true });
    const vendors: string[] = [];
    ai.image.mockImplementation(async (_ws: string, r: any) => { vendors.push(`${r.vendor}${r.appOnly ? '(app)' : ''}${r.strict ? '*' : ''}`); throw new AiError('sem crédito'); });
    mcp.callTool.mockImplementation(async () => { vendors.push('higgsfield'); throw new Error('fora do ar'); });
    const p = await svc.resolve('ws', 'auto');
    expect(await status(p.generateImage(req))).toBe('502:sem crédito'); // o app (último) também falha → propaga
    expect(vendors).toEqual(['openai*', 'gemini*', 'higgsfield', 'higgsfield', 'gemini(app)']); // Higgsfield tenta de novo sem a resolução, como no protótipo
    const log = providerLog(p);
    expect(log).toContain('ChatGPT (sua conta OpenAI): sem crédito → tentando o próximo');
    expect(log).toContain('Higgsfield (MCP):');
  });

  it('vínculo com o workspace: getGenerationStatus/getAsset de um id que não é de job do workspace → failed/null, sem tocar o provedor', async () => {
    const { svc, mcp } = build({ higgs: true, ownsJob: false });
    const p = await svc.resolve('ws', 'higgsfield');
    expect((await p.getGenerationStatus(JOB)).status).toBe('failed');
    expect(await p.getAsset(JOB)).toBeNull();
    expect(mcp.callTool).not.toHaveBeenCalled();
    const mine = build({ higgs: true, ownsJob: true });
    mine.mcp.callTool.mockResolvedValue({ text: '{"status":"completed"}', structured: null, mediaUrl: 'https://cdn.h.ai/v.mp4' } as never);
    const q = await mine.svc.resolve('ws', 'higgsfield');
    expect((await q.getGenerationStatus(JOB)).status).toBe('ready');
    expect(mine.prisma.creative_generation_jobs.count).toHaveBeenCalledWith({ where: { workspace_id: 'ws', external_job_id: JOB } });
  });
});
