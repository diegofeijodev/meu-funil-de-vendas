import { validateEnv } from '../../../common/config/env.validation';
import { AiKeysService } from '../ai-keys.service';
import { AiService, parseJsonLoose } from '../ai.service';
import { resolveModel } from '../model-map';
import { AiFetch } from '../ai.types';

const WS = '11111111-1111-4111-8111-111111111111';
const baseEnv = { DATABASE_URL: 'x', JWT_SECRET: 'test-secret-with-16+chars', NODE_ENV: 'test' };
const gwEnv = { ...baseEnv, AI_GATEWAY_URL: 'https://gw.test/v1', AI_GATEWAY_API_KEY: 'gw-key', AI_MODEL_TEXT: 'real-text-model' };

type Call = { url: string; init?: RequestInit };
/** Fetch falso: responde pelo primeiro handler cujo trecho de URL casa. Nenhuma rede. */
function fakeFetch(handlers: [string, (init?: RequestInit) => Response][]) {
  const calls: Call[] = [];
  const fn: AiFetch = async (url, init) => {
    calls.push({ url, init });
    const h = handlers.find(([frag]) => url.includes(frag));
    if (!h) throw new Error(`fetch não esperado: ${url}`);
    return h[1](init);
  };
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const chat = (content: string) => json({ choices: [{ message: { content } }] });

function setup(envVars: Record<string, string>, keys: { openai?: string; gemini?: string }, http: AiFetch) {
  const env = validateEnv(envVars);
  const keySvc = { get: async (_ws: string, v: 'openai' | 'gemini') => keys[v] ?? null } as unknown as AiKeysService;
  return new AiService(keySvc, http, env);
}
const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } };

describe('mapa de modelos', () => {
  const env = validateEnv({ ...baseEnv, AI_MODEL_TEXT: 'T', AI_MODEL_IMAGE_OPENAI: 'IO', AI_MODEL_IMAGE_GEMINI: 'IG', AI_MODEL_VIDEO: 'V', AI_MODEL_GEMINI_FLASH: 'GF', AI_MODEL_GEMINI_PRO: 'GP' });
  it('ids do protótipo viram os modelos do env', () => {
    expect(resolveModel(env, 'openai/gpt-6-astra')).toBe('T');
    expect(resolveModel(env, undefined)).toBe('T');
    expect(resolveModel(env, 'openai/gpt-image-2.5-sunburst')).toBe('IO');
    expect(resolveModel(env, 'google/gemini-3.1-flash-image')).toBe('IG');
    expect(resolveModel(env, 'google/veo-3.1-fast')).toBe('V');
    expect(resolveModel(env, 'google/gemini-3.1-flash')).toBe('GF');
    expect(resolveModel(env, 'google/gemini-3.1-pro')).toBe('GP');
    expect(resolveModel(env, 'meu-modelo-real')).toBe('meu-modelo-real');
  });
});

describe('parseJsonLoose (contrato do protótipo)', () => {
  it('extrai o {...} embrulhado em texto/markdown', () => {
    expect(parseJsonLoose('claro:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('sem JSON → erro amigável', () => {
    expect(() => parseJsonLoose('sem json')).toThrow('A IA não devolveu o formato esperado.');
  });
});

describe('AiService.json', () => {
  it('sem chave própria usa o gateway com json_schema estrito e o modelo mapeado', async () => {
    const f = fakeFetch([['gw.test/v1/chat/completions', () => chat('{"a":"oi"}')]]);
    const ai = setup(gwEnv, {}, f.fn);
    expect(await ai.json(WS, { prompt: 'P', schema, name: 'meu_schema' })).toEqual({ a: 'oi' });
    const body = JSON.parse(String(f.calls[0]!.init!.body));
    expect(body.model).toBe('real-text-model');
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'meu_schema', strict: true, schema } });
    expect((f.calls[0]!.init!.headers as any).Authorization).toBe('Bearer gw-key');
  });

  it('chave OpenAI própria tem prioridade e o gateway não é chamado', async () => {
    const f = fakeFetch([['api.openai.com/v1/chat/completions', () => chat('{"a":"byo"}')]]);
    const ai = setup(gwEnv, { openai: 'sk-cliente' }, f.fn);
    expect(await ai.json(WS, { prompt: 'P', schema, name: 'n' })).toEqual({ a: 'byo' });
    expect(f.calls).toHaveLength(1);
    expect((f.calls[0]!.init!.headers as any).Authorization).toBe('Bearer sk-cliente');
  });

  it('chave própria falha (401) → cai para Gemini próprio; falha também → gateway', async () => {
    const f = fakeFetch([
      ['api.openai.com', () => new Response('no', { status: 401 })],
      ['generativelanguage', () => new Response('no', { status: 429 })],
      ['gw.test', () => chat('{"a":"gw"}')],
    ]);
    const ai = setup(gwEnv, { openai: 'k1', gemini: 'k2' }, f.fn);
    expect(await ai.json(WS, { prompt: 'P', schema, name: 'n' })).toEqual({ a: 'gw' });
    expect(f.calls.map((c) => new URL(c.url).host)).toEqual(['api.openai.com', 'generativelanguage.googleapis.com', 'gw.test']);
  });

  it('sem chave própria e sem gateway → "IA do app não configurada." (502)', async () => {
    const ai = setup(baseEnv, {}, fakeFetch([]).fn);
    await expect(ai.json(WS, { prompt: 'P', schema, name: 'n' })).rejects.toMatchObject({ status: 502, response: { code: 'AI_NOT_CONFIGURED', message: 'IA do app não configurada.' } });
  });

  it('gateway 402/429 → mensagens do protótipo', async () => {
    for (const [status, msg] of [[402, 'Créditos de IA esgotados. Adicione créditos para continuar.'], [429, 'Muitas solicitações agora. Aguarde um instante e tente de novo.']] as const) {
      const ai = setup(gwEnv, {}, fakeFetch([['gw.test', () => new Response('x', { status })]]).fn);
      await expect(ai.json(WS, { prompt: 'P', schema, name: 'n' })).rejects.toMatchObject({ response: { message: msg } });
    }
  });

  it('visão: imagens vão como image_url (data URL) no gateway e a OpenAI própria é ignorada', async () => {
    const f = fakeFetch([['gw.test', () => chat('{"a":"viu"}')]]);
    const ai = setup(gwEnv, { openai: 'sk' }, f.fn);
    const out = await ai.vision(WS, { prompt: 'descreva', schema, name: 'v', images: [{ bytes: Buffer.from('IMG'), mime: 'image/png' }] });
    expect(out).toEqual({ a: 'viu' });
    const content = JSON.parse(String(f.calls[0]!.init!.body)).messages[0].content;
    expect(content[0]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from('IMG').toString('base64')}` } });
    expect(content[1]).toEqual({ type: 'text', text: 'descreva' });
  });
});

describe('AiService.image / video / text', () => {
  it('imagem ChatGPT pelo gateway (mapa de modelo + tamanho) devolve bytes e custo', async () => {
    const f = fakeFetch([['/images/generations', () => json({ data: [{ b64_json: Buffer.from('PNG').toString('base64') }] })]]);
    const ai = setup({ ...gwEnv, AI_MODEL_IMAGE_OPENAI: 'img-real' }, {}, f.fn);
    const r = await ai.image(WS, { prompt: 'gato', aspectRatio: '9:16', vendor: 'openai' });
    expect(r.bytes.toString()).toBe('PNG');
    expect(r).toMatchObject({ mime: 'image/png', ext: 'png', cost: 1.5 });
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toMatchObject({ model: 'img-real', size: '1024x1536' });
  });

  it('imagem com chave OpenAI do cliente: custo 0; strict não cai para o gateway', async () => {
    const f = fakeFetch([['api.openai.com/v1/images/generations', () => json({ data: [{ b64_json: Buffer.from('X').toString('base64') }] })]]);
    const ai = setup(gwEnv, { openai: 'sk' }, f.fn);
    expect((await ai.image(WS, { prompt: 'p', aspectRatio: '1:1', vendor: 'openai' })).cost).toBe(0);
    const bad = setup(gwEnv, { openai: 'sk' }, fakeFetch([['api.openai.com', () => new Response('x', { status: 401 })]]).fn);
    await expect(bad.image(WS, { prompt: 'p', aspectRatio: '1:1', vendor: 'openai', strict: true })).rejects.toMatchObject({ response: { message: 'Chave da OpenAI inválida ou sem permissão.' } });
  });

  it('imagem Gemini com chave do cliente lê inlineData', async () => {
    const f = fakeFetch([['generativelanguage', () => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: Buffer.from('JPG').toString('base64') } }] } }] })]]);
    const ai = setup(gwEnv, { gemini: 'gk' }, f.fn);
    const r = await ai.image(WS, { prompt: 'p', aspectRatio: '16:9', vendor: 'gemini' });
    expect(r).toMatchObject({ ext: 'jpg', mime: 'image/jpeg', cost: 0 });
    expect(r.bytes.toString()).toBe('JPG');
  });

  it('vídeo pelo gateway: cria job, consulta e baixa', async () => {
    let polls = 0;
    const f = fakeFetch([
      ['/videos/job1/content', () => new Response(Buffer.from('MP4'))],
      ['/videos/job1', () => json({ id: 'job1', status: ++polls > 0 ? 'completed' : 'queued' })],
      ['/videos', () => json({ id: 'job1', status: 'queued' })],
    ]);
    const ai = setup({ ...gwEnv, AI_MODEL_VIDEO: 'veo-real' }, {}, f.fn);
    const r = await ai.video(WS, { prompt: 'p', aspectRatio: '9:16' });
    expect(r).toMatchObject({ status: 'ready', mime: 'video/mp4', cost: 6 });
    expect(r.status === 'ready' && r.bytes.toString()).toBe('MP4');
    expect(JSON.parse(String(f.calls[0]!.init!.body)).model).toBe('veo-real');
  });

  it('texto livre pelo gateway', async () => {
    const f = fakeFetch([['gw.test', () => chat('olá')]]);
    expect(await setup(gwEnv, {}, f.fn).text(WS, { prompt: 'oi', system: 'sistema' })).toBe('olá');
    expect(JSON.parse(String(f.calls[0]!.init!.body)).messages[0].content).toBe('sistema\n\noi');
  });
});

describe('AiService.video — download do Gemini (SSRF / chave / teto)', () => {
  const op = (uri: string) => json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri } }] } } });
  /** Fluxo Veo: cria a operação, consulta (já pronta, com `uri`) e deixa o download por conta de `download`. */
  function veo(uri: string, download: (url: string, init?: RequestInit) => Response) {
    const calls: Call[] = [];
    const fn: AiFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes('predictLongRunning')) return json({ name: 'operations/op1' });
      if (url.endsWith('operations/op1')) return op(uri);
      return download(url, init);
    };
    return { calls, ai: setup(gwEnv, { gemini: 'gk' }, fn) };
  }
  const keyOf = (c: Call) => (c.init?.headers as Record<string, string> | undefined)?.['x-goog-api-key'];
  const run = (ai: AiService) => ai.video(WS, { prompt: 'p', aspectRatio: '9:16', strict: true });

  it('baixa o vídeo mandando a chave ao host original', async () => {
    const v = veo('https://files.googleapis.com/v1/v.mp4', () => new Response(Buffer.from('MP4')));
    const r = await run(v.ai);
    expect(r.status === 'ready' && r.bytes.toString()).toBe('MP4');
    const dl = v.calls.at(-1)!;
    expect(keyOf(dl)).toBe('gk');
    expect((dl.init as RequestInit).redirect).toBe('manual');
  });

  it('redirecionamento para IP privado é recusado', async () => {
    const v = veo('https://files.googleapis.com/v.mp4', () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }));
    await expect(run(v.ai)).rejects.toThrow(/rede interna/);
    expect(v.calls.some((c) => c.url.includes('169.254'))).toBe(false);
  });

  it('uri inicial interna é recusada sem chamar', async () => {
    const v = veo('http://10.0.0.5/v.mp4', () => new Response('x'));
    await expect(run(v.ai)).rejects.toThrow();
    expect(v.calls.some((c) => c.url.includes('10.0.0.5'))).toBe(false);
  });

  it('a chave NÃO é enviada depois de um redirecionamento para outro host', async () => {
    const v = veo('https://files.googleapis.com/v.mp4', (url) =>
      url.includes('files.googleapis.com') ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/v.mp4' } }) : new Response(Buffer.from('MP4')));
    const r = await run(v.ai);
    expect(r.status).toBe('ready');
    const hops = v.calls.filter((c) => c.url.includes('v.mp4'));
    expect(hops).toHaveLength(2);
    expect(keyOf(hops[0]!)).toBe('gk');
    expect(keyOf(hops[1]!)).toBeUndefined();
  });

  it('limita os saltos de redirecionamento', async () => {
    const v = veo('https://files.googleapis.com/v.mp4', () => new Response(null, { status: 302, headers: { location: 'https://files.googleapis.com/v.mp4' } }));
    await expect(run(v.ai)).rejects.toThrow(/vezes demais/);
    expect(v.calls.filter((c) => c.url.includes('v.mp4')).length).toBeGreaterThanOrEqual(5);
  });

  it('corpo acima do teto é abortado', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(40 * 1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ > 5) return c.close();
        c.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    let used = false;
    const v = veo('https://files.googleapis.com/v.mp4', () => {
      if (used) return new Response('x', { status: 500 });
      used = true;
      return new Response(body);
    });
    await expect(run(v.ai)).rejects.toThrow();
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(5);
  });
  it('bloqueio (SSRF) sem strict NÃO cai em silêncio no gateway pago; falha comum cai', async () => {
    const mk = (uri: string, download: () => Response) => {
      const calls: string[] = [];
      const fn: AiFetch = async (url) => {
        calls.push(url);
        if (url.includes('predictLongRunning')) return json({ name: 'operations/op1' });
        if (url.endsWith('operations/op1')) return op(uri);
        if (url.includes('gw.test')) return json({ id: 'job1', status: 'completed' });
        return download();
      };
      return { calls, ai: setup(gwEnv, { gemini: 'gk' }, fn) };
    };
    const blocked = mk('http://10.0.0.5/v.mp4', () => new Response('x'));
    await expect(blocked.ai.video(WS, { prompt: 'p', aspectRatio: '9:16' })).rejects.toThrow(/https|rede interna/);
    expect(blocked.calls.some((u) => u.includes('gw.test'))).toBe(false);
    const common = mk('https://files.googleapis.com/v.mp4', () => new Response('x', { status: 500 }));
    await common.ai.video(WS, { prompt: 'p', aspectRatio: '9:16' }).catch(() => undefined);
    expect(common.calls.some((u) => u.includes('gw.test'))).toBe(true);
  });

  it('em produção sem o fetch guardado o serviço nem sobe (fail-closed)', () => {
    const env = validateEnv({ ...gwEnv, NODE_ENV: 'production', CREDENTIALS_ENCRYPTION_KEY: 'a'.repeat(64), UNSUBSCRIBE_SECRET: 'u'.repeat(16) });
    const keys = { get: async () => null } as unknown as AiKeysService;
    expect(() => new AiService(keys, async () => json({}), env)).toThrow(/AI_GUARDED_FETCH/);
    expect(() => new AiService(keys, async () => json({}), env, async () => json({}))).not.toThrow();
  });
});
