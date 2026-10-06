import { createDecipheriv, createHash } from 'node:crypto';

/** Formato do protótipo (`src/lib/credentials.server.ts`): `enc:v1:<iv base64>:<cifrado+tag base64>`, AES-256-GCM, chave = SHA-256 do segredo. */
export const LEGACY_PREFIX = 'enc:v1:';
/** Formato do nosso cofre (`VaultService.encryptValue`). */
export const OUR_PREFIX = 'enc:v2:';

export const isLegacyEncrypted = (v: string): boolean => v.startsWith(LEGACY_PREFIX);
export const isOurEncrypted = (v: string): boolean => v.startsWith(OUR_PREFIX);

/** Decifra um valor `enc:v1` do protótipo. Lança se o formato estiver errado ou a chave não for a certa (a tag do GCM não confere). */
export function decryptLegacy(value: string, secret: string): string {
  if (!isLegacyEncrypted(value)) throw new Error('valor fora do formato enc:v1');
  const [ivB64, dataB64, extra] = value.slice(LEGACY_PREFIX.length).split(':');
  const iv = Buffer.from(ivB64 ?? '', 'base64');
  const data = Buffer.from(dataB64 ?? '', 'base64');
  if (extra !== undefined || iv.length !== 12 || data.length < 16) throw new Error('valor enc:v1 malformado');
  const key = createHash('sha256').update(secret, 'utf8').digest();
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
}
