import { Inject, Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { deriveKey } from '../../common/crypto/hkdf';
import { CredentialStore } from './credential-store';

/** Valores novos: `enc:v2:<iv>:<ciphertext>:<tag>` (base64). Texto sem o prefixo é legado e vale como está. */
export const ENC_PREFIX = 'enc:v2:';
/** Chave de desenvolvimento (NODE_ENV != production e sem CREDENTIALS_ENCRYPTION_KEY). */
export const DEV_ENCRYPTION_KEY = 'meu-funil-dev-credentials-key-not-for-production';

export interface MaskedCredential {
  key: string;
  masked: string;
  updated_at: Date;
}

/** Mostra só o final do segredo (nunca o valor inteiro). */
export function maskSecret(value: string | null): string {
  if (!value) return '';
  return value.length > 8 ? `••••${value.slice(-4)}` : '••••';
}

/**
 * Cofre de credenciais (somente servidor) — espelha `credentials.server.ts` do protótipo:
 * AES-256-GCM, chave derivada por HKDF de CREDENTIALS_ENCRYPTION_KEY. Nunca grava texto puro.
 * Falha ao decifrar (chave trocada) devolve null e registra no log, como no protótipo.
 */
@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  private readonly key: Buffer;

  constructor(
    private readonly store: CredentialStore,
    @Inject(ENV) env: { CREDENTIALS_ENCRYPTION_KEY?: string; NODE_ENV?: Env['NODE_ENV'] },
  ) {
    const secret = env.CREDENTIALS_ENCRYPTION_KEY || (env.NODE_ENV === 'development' || env.NODE_ENV === 'test' ? DEV_ENCRYPTION_KEY : '');
    if (!secret) throw new Error('CREDENTIALS_ENCRYPTION_KEY é obrigatória (a chave de dev só vale com NODE_ENV=development/test).');
    this.key = deriveKey(secret, 'vault-aes-256-gcm');
  }

  encryptValue(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${ENC_PREFIX}${iv.toString('base64')}:${ct.toString('base64')}:${cipher.getAuthTag().toString('base64')}`;
  }

  decryptValue(value: string | null | undefined): string | null {
    if (!value) return null;
    if (value.startsWith('enc:v1:')) {
      // Formato do protótipo (SHA-256): não é lido aqui e nunca vale como texto puro.
      this.logger.warn('[cofre] valor no formato legado enc:v1 ignorado.');
      return null;
    }
    if (!value.startsWith(ENC_PREFIX)) return value.trim() || null;
    const [iv, ct, tag] = value.slice(ENC_PREFIX.length).split(':');
    try {
      const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv ?? '', 'base64'), { authTagLength: 16 });
      d.setAuthTag(Buffer.from(tag ?? '', 'base64'));
      const pt = Buffer.concat([d.update(Buffer.from(ct ?? '', 'base64')), d.final()]).toString('utf8');
      return pt.trim() || null;
    } catch {
      this.logger.error('[cofre] não foi possível descriptografar (chave trocada?).');
      return null;
    }
  }

  /** Lê uma credencial (workspaceId null = global do app). */
  async get(workspaceId: string | null, name: string): Promise<string | null> {
    const row = await this.store.read(workspaceId, name);
    return this.decryptValue(row?.value ?? null);
  }

  async has(workspaceId: string | null, name: string): Promise<boolean> {
    return !!(await this.get(workspaceId, name));
  }

  /** Grava várias de uma vez (sempre cifradas). */
  async set(workspaceId: string | null, rows: Record<string, string>): Promise<void> {
    for (const [k, v] of Object.entries(rows)) await this.store.upsert(workspaceId, k, this.encryptValue(v));
  }

  async delete(workspaceId: string | null, name: string): Promise<void> {
    await this.store.delete(workspaceId, name);
  }

  /** Lista as chaves guardadas com o valor mascarado (o valor inteiro nunca sai do servidor). */
  async listMasked(workspaceId: string | null): Promise<MaskedCredential[]> {
    const rows = await this.store.list(workspaceId);
    return rows.map((r) => ({ key: r.key, masked: maskSecret(this.decryptValue(r.value)), updated_at: r.updated_at }));
  }
}
