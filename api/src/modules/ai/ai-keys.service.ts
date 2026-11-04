import { Injectable, Inject, Optional } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { overrideBase } from '../../common/config/test-overrides';
import { PrismaService } from '../../common/database/prisma.service';
import { VaultService } from '../vault/vault.service';
import { AI_FETCH, AiFetch, AiVendor } from './ai.types';
import { classifyVendorFailure, vendorMessage, VendorFailureKind } from './vendor-failure';

/** Chave BYO por workspace, guardada no cofre global com o id do workspace no nome (como no protótipo). */
export const aiKeySlot = (vendor: AiVendor, workspaceId: string) => `AI_${vendor.toUpperCase()}_KEY:${workspaceId}`;

/** Resultado do teste da chave. `kind` só vem na falha classificada pelo provedor (rede caída não tem `kind`). */
export type AiKeyTestResult = { ok: true } | { ok: false; error: string; kind?: VendorFailureKind };

/** Frases do teste da chave (contrato §27); pedidos demais e modelo indisponível usam as mesmas frases do `AiService`. */
export function keyTestMessage(vendor: AiVendor, kind: VendorFailureKind, d: { status: number; model: string }): string {
  switch (kind) {
    case 'refused':
      return 'Chave inválida ou sem permissão.';
    case 'noCredit':
      return vendor === 'openai' ? 'Conta sem créditos. Adicione saldo na OpenAI e teste de novo.' : 'Conta sem créditos. Adicione saldo no Google e teste de novo.';
    case 'rateLimited':
    case 'model':
      return vendorMessage(vendor, kind, d);
    // 400 que não é de chave, de saldo nem de modelo: o teste antigo (listagem de modelos) já tratava assim.
    case 'rejected':
      return d.status === 400 ? 'Chave inválida ou sem permissão.' : `O provedor respondeu ${d.status}.`;
    default:
      return `O provedor respondeu ${d.status}.`;
  }
}

/** Chaves de IA próprias do cliente (OpenAI / Gemini). Nunca saem do servidor. */
@Injectable()
export class AiKeysService {
  constructor(
    private readonly vault: VaultService,
    private readonly prisma: PrismaService,
    @Inject(AI_FETCH) private readonly http: AiFetch,
    @Optional() @Inject(ENV) private readonly env?: Pick<Env, 'NODE_ENV' | 'AI_OPENAI_BASE_URL' | 'AI_GEMINI_BASE_URL' | 'AI_BYO_OPENAI_TEXT_MODEL' | 'AI_BYO_GEMINI_TEXT_MODEL'>,
  ) {}

  /** Base da API do provedor da chave BYO. Os overrides (provedor falso de smoke) só valem com NODE_ENV=development|test. */
  baseUrl(vendor: AiVendor): string {
    const o = vendor === 'openai' ? this.env?.AI_OPENAI_BASE_URL : this.env?.AI_GEMINI_BASE_URL;
    return overrideBase(this.env, o, vendor === 'openai' ? 'https://api.openai.com/v1' : 'https://generativelanguage.googleapis.com/v1beta');
  }

  /** Empresa de onde esta herda as conexões de IA (1 nível; modelo "agência"). */
  async inheritSource(workspaceId: string): Promise<string | null> {
    const ws = await this.prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { ai_inherit_from: true } });
    const src = ws?.ai_inherit_from ?? null;
    return src && src !== workspaceId ? src : null;
  }

  /**
   * A chave que a empresa de fato usa e a empresa DONA dela: a própria, se ela tem a chave daquele provedor; senão a da agência
   * (`ai_inherit_from`). Por provedor: a empresa pode ter a própria OpenAI e herdar o Gemini.
   */
  async resolve(workspaceId: string, vendor: AiVendor): Promise<{ key: string; ownerId: string } | null> {
    const own = await this.vault.get(null, aiKeySlot(vendor, workspaceId));
    if (own) return { key: own, ownerId: workspaceId };
    const source = await this.inheritSource(workspaceId);
    const inherited = source ? await this.vault.get(null, aiKeySlot(vendor, source)) : null;
    return source && inherited ? { key: inherited, ownerId: source } : null;
  }

  async get(workspaceId: string, vendor: AiVendor): Promise<string | null> {
    return (await this.resolve(workspaceId, vendor))?.key ?? null;
  }

  async set(workspaceId: string, vendor: AiVendor, value: string | null): Promise<void> {
    if (!value) return this.vault.delete(null, aiKeySlot(vendor, workspaceId));
    await this.vault.set(null, { [aiKeySlot(vendor, workspaceId)]: value });
  }

  /**
   * Testa a chave com uma chamada REAL de custo desprezível (1 token de saída) no modelo de texto que a chave própria usa no app
   * (`AI_BYO_*_TEXT_MODEL`). A listagem de modelos, usada antes, responde 200 mesmo com a conta sem saldo. Só o status HTTP conta.
   */
  async test(vendor: AiVendor, key: string): Promise<AiKeyTestResult> {
    const model = vendor === 'openai' ? this.env?.AI_BYO_OPENAI_TEXT_MODEL : this.env?.AI_BYO_GEMINI_TEXT_MODEL;
    if (!model) return { ok: false, error: 'O modelo de texto da IA não está configurado no servidor.' };
    try {
      let res = vendor === 'openai' ? await this.openaiProbe(key, model, 'max_completion_tokens') : await this.geminiProbe(key, model);
      if (res.ok) return { ok: true };
      let body = await res.text().catch(() => '');
      // Modelo/gateway que ainda não conhece `max_completion_tokens` (o nome novo): repete com `max_tokens`.
      if (vendor === 'openai' && res.status === 400 && /max_completion_tokens/.test(body)) {
        res = await this.openaiProbe(key, model, 'max_tokens');
        if (res.ok) return { ok: true };
        body = await res.text().catch(() => '');
      }
      const kind = classifyVendorFailure(res.status, body);
      return { ok: false, kind, error: keyTestMessage(vendor, kind, { status: res.status, model }) };
    } catch {
      return { ok: false, error: 'Não foi possível falar com o provedor agora.' };
    }
  }

  private openaiProbe(key: string, model: string, limit: 'max_completion_tokens' | 'max_tokens'): Promise<Response> {
    return this.http(`${this.baseUrl('openai')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], [limit]: 1 }),
      signal: AbortSignal.timeout(30_000),
    });
  }

  private geminiProbe(key: string, model: string): Promise<Response> {
    return this.http(`${this.baseUrl('gemini')}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ok' }] }], generationConfig: { maxOutputTokens: 1 } }),
      signal: AbortSignal.timeout(30_000),
    });
  }
}
