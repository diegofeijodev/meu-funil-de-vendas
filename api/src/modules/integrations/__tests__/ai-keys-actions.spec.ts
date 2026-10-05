import { WorkspaceAccessService } from '../../access/access.service';
import { AiKeysService, aiKeySlot } from '../../ai/ai-keys.service';
import { ADMIN, MARKETING, OWNER, STRANGER, VIEWER, WS_A, WS_B, memMembers, status } from '../../media/__tests__/mem';
import { CredentialStore } from '../../vault/credential-store';
import { VaultService } from '../../vault/vault.service';
import { AiKeysActionsService, ERR_NOT_MANAGER, ERR_NOT_MEMBER, keyHint } from '../ai-keys-actions.service';

class MemStore extends CredentialStore {
  rows = new Map<string, string>();
  private k = (ws: string | null, key: string) => `${ws ?? '*'}|${key}`;
  async read(ws: string | null, key: string) { const v = this.rows.get(this.k(ws, key)); return v === undefined ? null : { value: v, updated_at: new Date() }; }
  async upsert(ws: string | null, key: string, value: string) { this.rows.set(this.k(ws, key), value); }
  async delete(ws: string | null, key: string) { this.rows.delete(this.k(ws, key)); }
  async list() { return []; }
}

const GOOD = 'sk-test-0123456789abcdefghij-WXYZ';

function setup(opts: { inherit?: Record<string, string>; providerStatus?: number; env?: Record<string, unknown> } = {}) {
  const store = new MemStore();
  const vault = new VaultService(store, { CREDENTIALS_ENCRYPTION_KEY: 'k'.repeat(40), NODE_ENV: 'test' });
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const http = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    const bearer = (init.headers as Record<string, string>)['Authorization'];
    const status = opts.providerStatus ?? (bearer === `Bearer ${GOOD}` || (init.headers as any)['x-goog-api-key'] === GOOD ? 200 : 401);
    return new Response('{}', { status });
  };
  const prisma: any = { workspaces: { findUnique: async ({ where }: any) => ({ ai_inherit_from: opts.inherit?.[where.id] ?? null }) } };
  const keys = new AiKeysService(vault, prisma, http as any, { NODE_ENV: 'test', ...opts.env } as any);
  const svc = new AiKeysActionsService(new WorkspaceAccessService({ workspace_members: memMembers } as any), keys);
  return { svc, store, calls, keys };
}

describe('AiKeysActionsService — autorização', () => {
  it('quem não é membro não lê nem altera (403 com a mensagem do protótipo)', async () => {
    const { svc } = setup();
    expect(await status(svc.status(STRANGER, WS_A))).toBe(`403:${ERR_NOT_MEMBER}`);
    expect(await status(svc.test(STRANGER, WS_A, 'openai'))).toBe(`403:${ERR_NOT_MEMBER}`);
    expect(await status(svc.save(STRANGER, WS_A, 'openai', GOOD))).toBe(`403:${ERR_NOT_MEMBER}`);
    expect(await status(svc.remove(STRANGER, WS_A, 'openai'))).toBe(`403:${ERR_NOT_MEMBER}`);
  });

  it('viewer e marketing leem e testam, mas só owner/admin salvam ou removem', async () => {
    const { svc, store } = setup();
    for (const u of [VIEWER, MARKETING]) {
      expect(await status(svc.status(u, WS_A))).toBe('ok');
      expect(await status(svc.test(u, WS_A, 'gemini'))).toBe('ok');
      expect(await status(svc.save(u, WS_A, 'openai', GOOD))).toBe(`403:${ERR_NOT_MANAGER}`);
      expect(await status(svc.remove(u, WS_A, 'openai'))).toBe(`403:${ERR_NOT_MANAGER}`);
    }
    expect(store.rows.size).toBe(0);
    expect(await status(svc.save(ADMIN, WS_A, 'openai', GOOD))).toBe('ok');
  });

  it('a chave de uma empresa não aparece na outra', async () => {
    const { svc } = setup();
    await svc.save(OWNER, WS_A, 'openai', GOOD);
    expect((await svc.status(STRANGER, WS_B)).openai).toEqual({ connected: false, hint: null });
  });
});

describe('AiKeysActionsService — só a dica sai, o segredo fica no cofre', () => {
  it('salva cifrado no slot AI_<VENDOR>_KEY:<ws> e o status devolve só ••••últimos4', async () => {
    const { svc, store } = setup();
    expect(await svc.save(OWNER, WS_A, 'openai', GOOD)).toEqual({ ok: true, error: null });
    const raw = store.rows.get(`*|${aiKeySlot('openai', WS_A)}`)!;
    expect(raw.startsWith('enc:v2:')).toBe(true);
    expect(raw).not.toContain(GOOD);
    const st = await svc.status(VIEWER, WS_A);
    expect(st).toEqual({ openai: { connected: true, hint: '••••WXYZ' }, gemini: { connected: false, hint: null } });
    expect(JSON.stringify(st)).not.toContain(GOOD);
    expect(keyHint(GOOD)).toBe('••••WXYZ');
  });

  it('chave recusada pelo provedor: { ok:false, error } e nada é gravado', async () => {
    const { svc, store } = setup();
    expect(await svc.save(OWNER, WS_A, 'openai', 'sk-ruim-0123456789abcdefghij')).toEqual({ ok: false, error: 'Chave inválida ou sem permissão.' });
    expect(store.rows.size).toBe(0);
  });

  it('429 vira "sem saldo/cota"; 500 e rede caída têm mensagens próprias', async () => {
    expect((await setup({ providerStatus: 429 }).svc.save(OWNER, WS_A, 'gemini', GOOD)).error).toBe('Conta sem saldo/cota ou limite atingido.');
    expect((await setup({ providerStatus: 503 }).svc.save(OWNER, WS_A, 'gemini', GOOD)).error).toBe('O provedor respondeu 503.');
    const { keys } = setup();
    (keys as any).http = async () => { throw new Error('boom'); };
    expect(await keys.test('openai', GOOD)).toEqual({ ok: false, error: 'Não foi possível falar com o provedor agora.' });
  });

  it('test: sem chave → "Nenhuma chave salva."; com chave → resultado do provedor', async () => {
    const { svc } = setup();
    expect(await svc.test(VIEWER, WS_A, 'openai')).toEqual({ ok: false, error: 'Nenhuma chave salva.' });
    await svc.save(OWNER, WS_A, 'openai', GOOD);
    expect(await svc.test(VIEWER, WS_A, 'openai')).toEqual({ ok: true });
  });

  it('remove apaga só a chave própria; depois o status volta a desconectado', async () => {
    const { svc, store } = setup();
    await svc.save(OWNER, WS_A, 'openai', GOOD);
    expect(await svc.remove(OWNER, WS_A, 'openai')).toEqual({ ok: true });
    expect(store.rows.size).toBe(0);
    expect((await svc.status(OWNER, WS_A)).openai.connected).toBe(false);
  });

  it('herança: a empresa filha mostra a dica da chave da agência', async () => {
    const { svc } = setup({ inherit: { [WS_B]: WS_A } });
    await svc.save(OWNER, WS_A, 'openai', GOOD);
    expect((await svc.status(STRANGER, WS_B)).openai).toEqual({ connected: true, hint: '••••WXYZ' });
  });
});

describe('AiKeysService.baseUrl — provedor falso só fora de produção', () => {
  it('padrão são os provedores reais; override vale em dev/test e é ignorado em produção', () => {
    expect(setup().keys.baseUrl('openai')).toBe('https://api.openai.com/v1');
    expect(setup().keys.baseUrl('gemini')).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(setup({ env: { AI_OPENAI_BASE_URL: 'http://127.0.0.1:3099/v1/' } }).keys.baseUrl('openai')).toBe('http://127.0.0.1:3099/v1');
    expect(setup({ env: { NODE_ENV: 'production', AI_OPENAI_BASE_URL: 'http://x/v1' } }).keys.baseUrl('openai')).toBe('https://api.openai.com/v1');
    // lista de permissão: NODE_ENV ausente/desconhecido também ignora o override
    expect(setup({ env: { NODE_ENV: undefined, AI_OPENAI_BASE_URL: 'http://x/v1' } }).keys.baseUrl('openai')).toBe('https://api.openai.com/v1');
    expect(setup({ env: { NODE_ENV: 'staging', AI_GEMINI_BASE_URL: 'http://x/v1beta' } }).keys.baseUrl('gemini')).toBe('https://generativelanguage.googleapis.com/v1beta');
  });
});
