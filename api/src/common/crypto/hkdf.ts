import { hkdfSync } from 'node:crypto';

/** Deriva uma chave de 32 bytes (HKDF-SHA256) de um segredo textual. */
export function deriveKey(secret: string, info: string, salt = 'meu-funil/v1'): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(salt, 'utf8'), Buffer.from(info, 'utf8'), 32));
}
