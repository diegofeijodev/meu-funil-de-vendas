import { Injectable, Inject, Optional } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { VaultService } from '../vault/vault.service';
import { AI_FETCH, AiFetch, AiVendor } from './ai.types';

/** Chave BYO por workspace, guardada no cofre global com o id do workspace no nome (como no protótipo). */
export const aiKeySlot = (vendor: AiVendor, workspaceId: string) => `AI_${vendor.toUpperCase()}_KEY:${workspaceId}`;

/** Chaves de IA próprias do cliente (OpenAI / Gemini). Nunca saem do servidor. */
@Injectable()
export class AiKeysService {
  constructor(
    private readonly vault: VaultService,
    private readonly prisma: PrismaService,
    @Inject(AI_FETCH) private readonly http: AiFetch,
    @Optional() @Inject(ENV) private readonly env?: Pick<Env, 'NODE_ENV' | 'AI_OPENAI_BASE_URL' | 'AI_GEMINI_BASE_URL'>,
  ) {}

  /** Base da API do provedor da chave BYO. Os overrides (provedor falso de smoke) só valem fora de produção. */
  baseUrl(vendor: AiVendor): string {
    const o = vendor === 'openai' ? this.env?.AI_OPENAI_BASE_URL : this.env?.AI_GEMINI_BASE_URL;
    if (o && this.env?.NODE_ENV !== 'production') return o.replace(/\/$/, '');
    return vendor === 'openai' ? 'https://api.openai.com/v1' : 'https://generativelanguage.googleapis.com/v1beta';
  }

  /** Empresa de onde esta herda as conexões de IA (1 nível; modelo "agência"). */
  async inheritSource(workspaceId: string): Promise<string | null> {
    const ws = await this.prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { ai_inherit_from: true } });
    const src = ws?.ai_inherit_from ?? null;
    return src && src !== workspaceId ? src : null;
  }

  async get(workspaceId: string, vendor: AiVendor): Promise<string | null> {
    const own = await this.vault.get(null, aiKeySlot(vendor, workspaceId));
    if (own) return own;
    const source = await this.inheritSource(workspaceId);
    return source ? this.vault.get(null, aiKeySlot(vendor, source)) : null;
  }

  async set(workspaceId: string, vendor: AiVendor, value: string | null): Promise<void> {
    if (!value) return this.vault.delete(null, aiKeySlot(vendor, workspaceId));
    await this.vault.set(null, { [aiKeySlot(vendor, workspaceId)]: value });
  }

  /** Verifica a chave no provedor, com as mesmas mensagens do protótipo. */
  async test(vendor: AiVendor, key: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res =
        vendor === 'openai'
          ? await this.http(`${this.baseUrl('openai')}/models`, { headers: { Authorization: `Bearer ${key}` } })
          : await this.http(`${this.baseUrl('gemini')}/models?pageSize=1`, { headers: { 'x-goog-api-key': key } });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403 || res.status === 400) return { ok: false, error: 'Chave inválida ou sem permissão.' };
      if (res.status === 429) return { ok: false, error: 'Conta sem saldo/cota ou limite atingido.' };
      return { ok: false, error: `O provedor respondeu ${res.status}.` };
    } catch {
      return { ok: false, error: 'Não foi possível falar com o provedor agora.' };
    }
  }
}
