import { validateEnv } from '../../../common/config/env.validation';
import { AiKeysService } from '../ai-keys.service';
import { AiService } from '../ai.service';
import { AiFetch } from '../ai.types';

const WS = '11111111-1111-4111-8111-111111111111';
const env = validateEnv({ DATABASE_URL: 'x', JWT_SECRET: 'test-secret-with-16+chars', NODE_ENV: 'test', AI_GATEWAY_URL: 'https://gw.test/v1', AI_GATEWAY_API_KEY: 'gw-key' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } };

function setup(keys: { openai?: string; gemini?: string }, handlers: [string, () => Response][]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const http: AiFetch = async (url, init) => {
    calls.push({ url, init });
    const h = handlers.find(([f]) => url.includes(f));
    if (!h) throw new Error(`fetch não esperado: ${url}`);
    return h[1]();
  };
  const keySvc = { get: async (_w: string, v: 'openai' | 'gemini') => keys[v] ?? null } as unknown as AiKeysService;
  return { ai: new AiService(keySvc, http, env), calls };
}
const openai = (c: string) => ['api.openai.com', () => json({ choices: [{ message: { content: c } }] })] as [string, () => Response];
const gemini = (c: string) => ['generativelanguage', () => json({ candidates: [{ content: { parts: [{ text: c }] } }] })] as [string, () => Response];
const gateway = (c: string) => ['gw.test', () => json({ choices: [{ message: { content: c } }] })] as [string, () => Response];

describe('AiService.jsonWithEngine (Copy Engine)', () => {
  it('auto: OpenAI própria primeiro, prompt SEM o sufixo "Devolva SOMENTE JSON…" e rótulo do motor', async () => {
    const { ai, calls } = setup({ openai: 'sk', gemini: 'gk' }, [openai('{"a":"o"}')]);
    const r = await ai.jsonWithEngine(WS, { prompt: 'PROMPT', schema, name: 'copy' });
    expect(r).toEqual({ content: { a: 'o' }, engine: 'Sua conta OpenAI' });
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.messages[0].content).toBe('PROMPT');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('chatgpt ignora a chave Gemini; gemini ignora a OpenAI', async () => {
    const a = setup({ openai: 'sk', gemini: 'gk' }, [openai('{"a":"o"}'), gemini('{"a":"g"}')]);
    expect((await a.ai.jsonWithEngine(WS, { prompt: 'P', schema, name: 'copy', engine: 'chatgpt' })).engine).toBe('Sua conta OpenAI');
    const b = setup({ openai: 'sk', gemini: 'gk' }, [openai('{"a":"o"}'), gemini('{"a":"g"}')]);
    const r = await b.ai.jsonWithEngine(WS, { prompt: 'P', schema, name: 'copy', engine: 'gemini' });
    expect(r).toEqual({ content: { a: 'g' }, engine: 'Sua conta Gemini' });
    expect(b.calls.every((c) => !c.url.includes('openai'))).toBe(true);
  });

  it('OpenAI falha → cai na Gemini (auto); as duas falham → gateway com rótulo "sua chave falhou"', async () => {
    const a = setup({ openai: 'sk', gemini: 'gk' }, [['api.openai.com', () => json({}, 429)], gemini('{"a":"g"}')]);
    expect((await a.ai.jsonWithEngine(WS, { prompt: 'P', schema, name: 'copy' })).engine).toBe('Sua conta Gemini');
    const b = setup({ openai: 'sk', gemini: 'gk' }, [['api.openai.com', () => json({}, 429)], ['generativelanguage', () => json({}, 500)], gateway('{"a":"gw"}')]);
    expect(await b.ai.jsonWithEngine(WS, { prompt: 'P', schema, name: 'copy' })).toEqual({ content: { a: 'gw' }, engine: 'IA do app (sua chave falhou)' });
  });

  it('sem chaves próprias: gateway com json_schema estrito e rótulo "IA do app"; sem gateway → AI_NOT_CONFIGURED', async () => {
    const a = setup({}, [gateway('{"a":"gw"}')]);
    expect(await a.ai.jsonWithEngine(WS, { prompt: 'P', schema, name: 'copy' })).toEqual({ content: { a: 'gw' }, engine: 'IA do app' });
    const body = JSON.parse(String(a.calls[0]!.init!.body));
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'copy', strict: true, schema } });
    const bare = new AiService({ get: async () => null } as any, async () => json({}), validateEnv({ DATABASE_URL: 'x', JWT_SECRET: 'test-secret-with-16+chars', NODE_ENV: 'test' }));
    await expect(bare.jsonWithEngine(WS, { prompt: 'P', schema, name: 'copy' })).rejects.toThrow('IA do app não configurada.');
  });

  it('só o motor escolhido sem chave → direto ao gateway (rótulo "IA do app")', async () => {
    const { ai } = setup({ openai: 'sk' }, [openai('{"a":"o"}'), gateway('{"a":"gw"}')]);
    expect((await ai.jsonWithEngine(WS, { prompt: 'P', schema, name: 'copy', engine: 'gemini' })).engine).toBe('IA do app');
  });
});
