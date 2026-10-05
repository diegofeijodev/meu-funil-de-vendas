import { WorkspaceAccessService } from '../../access/access.service';
import { AiKeysService } from '../../ai/ai-keys.service';
import { OWNER, STRANGER, VIEWER, WS_A, memMembers, status } from '../../media/__tests__/mem';
import { AiDiagnosticsService } from '../ai-diagnostics.service';

const ENV = {
  NODE_ENV: 'test', AI_GATEWAY_URL: 'http://gw.test/v1', AI_GATEWAY_API_KEY: 'k', AI_MODEL_TEXT: 'gpt-4o',
  AI_MODEL_IMAGE_OPENAI: 'gpt-image-1', AI_MODEL_IMAGE_GEMINI: 'gemini-2.5-flash-image', AI_MODEL_VIDEO: 'veo-3.0-fast-generate-preview',
  AI_BYO_OPENAI_TEXT_MODEL: 'gpt-4o-mini', AI_BYO_GEMINI_TEXT_MODEL: 'gemini-flash-latest',
} as any;

interface World {
  openai?: string | null; gemini?: string | null;
  openaiModels?: string[]; geminiModels?: string[]; openaiStatus?: number; openaiBody?: string;
  canva?: { connected: boolean; name?: string | null } | 'erro'; mcp?: any; ping?: 'ok' | 'bad' | 'erro'; image?: 'ok' | 'erro';
  env?: any;
}

function setup(w: World = {}) {
  const keys = new AiKeysService({} as any, {} as any, (async () => new Response('{}')) as any, { NODE_ENV: 'test' } as any);
  (keys as any).get = async (_ws: string, v: string) => (v === 'openai' ? w.openai ?? null : w.gemini ?? null);
  const http = async (url: string) => {
    if (url.includes('api.openai.com')) {
      if (w.openaiStatus) return new Response(w.openaiBody ?? 'nope', { status: w.openaiStatus });
      return new Response(JSON.stringify({ data: (w.openaiModels ?? ['gpt-image-1', 'gpt-4o-mini', 'whisper-1']).map((id) => ({ id })) }));
    }
    return new Response(JSON.stringify({ models: (w.geminiModels ?? ['gemini-2.5-flash-image', 'veo-3.0-fast-generate-preview', 'gemini-flash-latest']).map((name) => ({ name: `models/${name}` })) }));
  };
  const ai: any = {
    model: (id?: string) => (id ? `m(${id})` : 'gpt-4o'),
    pingGateway: async () => { if (w.ping === 'erro') throw new Error('Gateway fora do ar'); return { model: 'gpt-4o', ok: w.ping !== 'bad' }; },
    image: async () => { if (w.image === 'erro') throw new Error('sem crédito'); return { bytes: Buffer.from('x') }; },
  };
  const canva: any = {
    status: async () => { if (w.canva === 'erro') throw new Error('cofre indisponível'); return w.canva ?? { connected: false }; },
    test: async () => ({ name: 'Ana' }),
  };
  const mcp: any = { getLiveConnection: async () => w.mcp ?? null };
  const svc = new AiDiagnosticsService(new WorkspaceAccessService({ workspace_members: memMembers } as any), keys, ai, canva, mcp, http as any, { ...ENV, ...w.env });
  return svc;
}

const by = (r: { checks: { name: string; ok: boolean | null; detail: string }[] }, name: string) => r.checks.find((c) => c.name.startsWith(name))!;

describe('AiDiagnosticsService — forma e autorização', () => {
  it('qualquer membro roda; estranho → 403 "Você não tem acesso a esta empresa."', async () => {
    expect(await status(setup().diagnose(VIEWER, WS_A, false))).toBe('ok');
    expect(await status(setup().diagnose(STRANGER, WS_A, false))).toBe('403:Você não tem acesso a esta empresa.');
  });

  it('devolve { checks:[{name, ok, detail}], at } e, sem nada conectado, os opcionais ficam ok=null', async () => {
    const r = await setup({ ping: 'ok' }).diagnose(OWNER, WS_A, false);
    expect(Object.keys(r).sort()).toEqual(['at', 'checks']);
    expect(new Date(r.at).toISOString()).toBe(r.at);
    expect(r.checks.map((c) => c.name)).toEqual(['IA do app (texto · gpt-4o)', 'Chave OpenAI', 'Chave Gemini', 'Canva', 'Higgsfield']);
    for (const c of r.checks) expect(Object.keys(c).sort()).toEqual(['detail', 'name', 'ok']);
    expect(r.checks.map((c) => c.ok)).toEqual([true, null, null, null, null]);
    expect(by(r, 'Canva').detail).toBe('Não conectado (opcional).');
  });
});

describe('AiDiagnosticsService — cada verificação', () => {
  it('gateway não configurado / fora do ar / resposta estranha', async () => {
    const off = await setup({ env: { AI_GATEWAY_URL: undefined } }).diagnose(OWNER, WS_A, false);
    expect(by(off, 'IA do app')).toMatchObject({ name: 'IA do app (texto)', ok: false });
    expect(by(await setup({ ping: 'erro' }).diagnose(OWNER, WS_A, false), 'IA do app')).toMatchObject({ ok: false, detail: 'Gateway fora do ar' });
    expect(by(await setup({ ping: 'bad' }).diagnose(OWNER, WS_A, false), 'IA do app')).toMatchObject({ ok: false, detail: 'Resposta inesperada.' });
  });

  it('chave OpenAI: completa, sem modelos, recusada', async () => {
    expect(by(await setup({ openai: 'sk-x' }).diagnose(OWNER, WS_A, false), 'Chave OpenAI')).toMatchObject({ ok: true, detail: 'Válida, com gpt-image-1, gpt-4o-mini e whisper-1.' });
    const falta = by(await setup({ openai: 'sk-x', openaiModels: ['gpt-4o-mini'] }).diagnose(OWNER, WS_A, false), 'Chave OpenAI');
    expect(falta.ok).toBe(false);
    expect(falta.detail).toContain('sem acesso a: gpt-image-1, whisper-1');
    expect(by(await setup({ openai: 'sk-x', openaiStatus: 401 }).diagnose(OWNER, WS_A, false), 'Chave OpenAI')).toMatchObject({ ok: false, detail: 'OpenAI respondeu 401: nope' });
  });

  it('chave Gemini: ok se tem ao menos um dos modelos; lista o que falta', async () => {
    expect(by(await setup({ gemini: 'AIza' }).diagnose(OWNER, WS_A, false), 'Chave Gemini')).toMatchObject({ ok: true, detail: 'Válida, com imagem, vídeo Veo e texto.' });
    const parcial = by(await setup({ gemini: 'AIza', geminiModels: ['gemini-flash-latest-001'] }).diagnose(OWNER, WS_A, false), 'Chave Gemini');
    expect(parcial.ok).toBe(true);
    expect(parcial.detail).toContain('veo-3.0-fast-generate-preview (vídeo Veo)');
    expect(by(await setup({ gemini: 'AIza', geminiModels: [] }).diagnose(OWNER, WS_A, false), 'Chave Gemini').ok).toBe(false);
  });

  it('Canva conectado / com erro; Higgsfield completo / sem ferramentas / expirado', async () => {
    expect(by(await setup({ canva: { connected: true, name: 'Ana' } }).diagnose(OWNER, WS_A, false), 'Canva')).toMatchObject({ ok: true, detail: 'Conectado como Ana.' });
    expect(by(await setup({ canva: 'erro' }).diagnose(OWNER, WS_A, false), 'Canva')).toMatchObject({ ok: false, detail: 'cofre indisponível' });
    const tools = (names: string[]) => names.map((name) => ({ name }));
    expect(by(await setup({ mcp: { status: 'connected', tools: tools(['generate_image', 'generate_video', 'job_status']) } }).diagnose(OWNER, WS_A, false), 'Higgsfield')).toMatchObject({ ok: true, detail: 'Conectado (3 ferramentas).' });
    expect(by(await setup({ mcp: { status: 'connected', tools: tools(['generate_image']) } }).diagnose(OWNER, WS_A, false), 'Higgsfield')).toMatchObject({ ok: false, detail: 'Conectado, mas sem as ferramentas: generate_video, job_status.' });
    expect(by(await setup({ mcp: { status: 'expired', tools: [] } }).diagnose(OWNER, WS_A, false), 'Higgsfield')).toMatchObject({ ok: false, detail: 'Status: expired. Reconecte em Integrações.' });
  });

  it('withImage só acrescenta o teste de imagem quando pedido', async () => {
    const sem = await setup().diagnose(OWNER, WS_A, false);
    const com = await setup().diagnose(OWNER, WS_A, true);
    expect(com.checks.length).toBe(sem.checks.length + 1);
    expect(com.checks.at(-1)).toMatchObject({ name: 'Imagem com créditos do app (m(google/gemini-3.1-flash-image))', ok: true, detail: 'Imagem gerada.' });
    expect((await setup({ image: 'erro' }).diagnose(OWNER, WS_A, true)).checks.at(-1)).toMatchObject({ ok: false, detail: 'sem crédito' });
  });
});

describe('AiDiagnosticsService — chaves nunca vazam', () => {
  it('corpo de erro do provedor que ecoa a chave sai com ••••', async () => {
    const key = 'sk-proj-ABCDEF0123456789zzzz';
    const r = await setup({ openai: key, openaiStatus: 401, openaiBody: `Incorrect API key provided: ${key}. Bearer ${key} tried; enc=${encodeURIComponent(key)} sk-other-1234567890abcdef` }).diagnose(OWNER, WS_A, false);
    const d = by(r, 'Chave OpenAI').detail;
    expect(d).toContain('OpenAI respondeu 401');
    expect(d).not.toContain(key);
    expect(d).not.toContain('ABCDEF0123456789');
    expect(d).not.toContain('sk-other');
    expect(d).toContain('••••');
  });
});
