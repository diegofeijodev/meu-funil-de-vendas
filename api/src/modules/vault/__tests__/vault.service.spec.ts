import { CredentialStore } from '../credential-store';
import { DEV_ENCRYPTION_KEY, ENC_PREFIX, maskSecret, VaultService } from '../vault.service';

class MemoryStore extends CredentialStore {
  rows = new Map<string, { value: string; updated_at: Date }>();
  private k = (ws: string | null, key: string) => `${ws ?? 'NULL'}|${key}`;
  async read(ws: string | null, key: string) { return this.rows.get(this.k(ws, key)) ?? null; }
  async upsert(ws: string | null, key: string, value: string) { this.rows.set(this.k(ws, key), { value, updated_at: new Date() }); }
  async delete(ws: string | null, key: string) { this.rows.delete(this.k(ws, key)); }
  async list(ws: string | null) {
    return [...this.rows.entries()].filter(([k]) => k.startsWith(`${ws ?? 'NULL'}|`)).map(([k, v]) => ({ key: k.split('|')[1]!, ...v }));
  }
}
const WS = '11111111-1111-4111-8111-111111111111';
const mk = (store = new MemoryStore(), key = 'chave-mestra-1') => ({ store, vault: new VaultService(store, { CREDENTIALS_ENCRYPTION_KEY: key, NODE_ENV: 'production' }) });

describe('VaultService (AES-256-GCM + HKDF)', () => {
  it('round-trip: grava cifrado (nunca texto puro) e lê de volta', async () => {
    const { store, vault } = mk();
    await vault.set(WS, { META_APP_SECRET: 'segredo-super-secreto' });
    const raw = store.rows.get(`${WS}|META_APP_SECRET`)!.value;
    expect(raw.startsWith(ENC_PREFIX)).toBe(true);
    expect(raw).not.toContain('segredo-super-secreto');
    expect(await vault.get(WS, 'META_APP_SECRET')).toBe('segredo-super-secreto');
  });

  it('IV aleatório: o mesmo valor gera ciphertexts diferentes', () => {
    const { vault } = mk();
    expect(vault.encryptValue('x')).not.toBe(vault.encryptValue('x'));
  });

  it('chave errada → null (não lança), como o protótipo', async () => {
    const { store, vault } = mk();
    await vault.set(null, { K: 'valor' });
    const outra = new VaultService(store, { CREDENTIALS_ENCRYPTION_KEY: 'outra-chave-mestra', NODE_ENV: 'production' });
    expect(await outra.get(null, 'K')).toBeNull();
    expect(await vault.get(null, 'K')).toBe('valor');
  });

  it('ciphertext adulterado (tag GCM) → null', async () => {
    const { store, vault } = mk();
    await vault.set(null, { K: 'valor' });
    const row = store.rows.get('NULL|K')!;
    const parts = row.value.split(':');
    parts[3] = Buffer.from('lixo-lixo-lixo-1').toString('base64');
    row.value = parts.join(':');
    expect(await vault.get(null, 'K')).toBeNull();
  });

  it('valor legado em texto (sem prefixo) é lido como está; vazio → null', async () => {
    const { store, vault } = mk();
    await store.upsert(WS, 'LEGADO', '  abc123  ');
    expect(await vault.get(WS, 'LEGADO')).toBe('abc123');
    expect(await vault.get(WS, 'NAO_EXISTE')).toBeNull();
  });

  it('global (workspaceId null) e por workspace são espaços separados; delete remove só o alvo', async () => {
    const { vault } = mk();
    await vault.set(null, { CANVA_CLIENT_ID: 'global' });
    await vault.set(WS, { CANVA_CLIENT_ID: 'do-ws' });
    expect(await vault.get(null, 'CANVA_CLIENT_ID')).toBe('global');
    expect(await vault.get(WS, 'CANVA_CLIENT_ID')).toBe('do-ws');
    await vault.delete(WS, 'CANVA_CLIENT_ID');
    expect(await vault.get(WS, 'CANVA_CLIENT_ID')).toBeNull();
    expect(await vault.get(null, 'CANVA_CLIENT_ID')).toBe('global');
  });

  it('listMasked nunca devolve o valor inteiro', async () => {
    const { vault } = mk();
    await vault.set(WS, { A: 'abcdefghijkl', B: 'curto' });
    const list = await vault.listMasked(WS);
    expect(list.map((r) => [r.key, r.masked])).toEqual([['A', '••••ijkl'], ['B', '••••']]);
    expect(JSON.stringify(list)).not.toContain('abcdefghijkl');
    expect(maskSecret(null)).toBe('');
  });

  it('chave de dev SÓ com NODE_ENV development/test; NODE_ENV ausente ou production sem chave falha', () => {
    expect(() => new VaultService(new MemoryStore(), {})).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    expect(() => new VaultService(new MemoryStore(), { NODE_ENV: 'production' })).toThrow();
    expect(() => new VaultService(new MemoryStore(), { NODE_ENV: 'test' })).not.toThrow();
  });

  it('valor enc:v1: do protótipo é rejeitado (null), nunca tratado como texto', async () => {
    const { store, vault } = mk();
    await store.upsert(null, 'V1', 'enc:v1:abc:def');
    expect(await vault.get(null, 'V1')).toBeNull();
  });

  it('em produção exige a chave; em dev cai na chave de desenvolvimento', () => {
    expect(() => new VaultService(new MemoryStore(), { NODE_ENV: 'production' })).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    const dev = new VaultService(new MemoryStore(), { NODE_ENV: 'development' });
    const devExplicit = new VaultService(new MemoryStore(), { CREDENTIALS_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY, NODE_ENV: 'production' });
    expect(devExplicit.decryptValue(dev.encryptValue('ok'))).toBe('ok');
  });
});
