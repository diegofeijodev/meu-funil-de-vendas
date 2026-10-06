import { webcrypto } from 'node:crypto';
import { decryptLegacy, isLegacyEncrypted, isOurEncrypted } from '../legacy-crypto';

/** Cifra exatamente como o protótipo (`src/lib/credentials.server.ts`): WebCrypto AES-GCM, chave = SHA-256 do segredo. */
async function encryptLikePrototype(value: string, secret: string): Promise<string> {
  const raw = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await webcrypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)));
  return `enc:v1:${Buffer.from(iv).toString('base64')}:${Buffer.from(ct).toString('base64')}`;
}

describe('decryptLegacy (enc:v1 do protótipo)', () => {
  it('decifra o que o protótipo cifrou, inclusive acentos', async () => {
    const v = await encryptLikePrototype('chave-secreta ção 123', 'segredo-do-lovable');
    expect(decryptLegacy(v, 'segredo-do-lovable')).toBe('chave-secreta ção 123');
  });

  it('chave errada lança (nunca devolve lixo)', async () => {
    const v = await encryptLikePrototype('x', 'certa');
    expect(() => decryptLegacy(v, 'errada')).toThrow();
  });

  it('formato errado lança', () => {
    expect(() => decryptLegacy('texto-puro', 's')).toThrow('fora do formato');
    expect(() => decryptLegacy('enc:v1:abc', 's')).toThrow('malformado');
    expect(() => decryptLegacy('enc:v1:AAAAAAAAAAAAAAAA:AAAA:extra', 's')).toThrow('malformado');
  });

  it('reconhece os prefixos', () => {
    expect(isLegacyEncrypted('enc:v1:a:b')).toBe(true);
    expect(isOurEncrypted('enc:v2:a:b:c')).toBe(true);
    expect(isLegacyEncrypted('enc:v2:a:b:c')).toBe(false);
  });
});
