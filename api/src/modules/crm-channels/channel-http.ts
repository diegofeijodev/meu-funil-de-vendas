import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { overrideBase } from '../../common/config/test-overrides';
import { assertExternalUrl, EXTERNAL_FETCH, ExternalFetch } from '../media/external-fetch';
import { VaultService } from '../vault/vault.service';

export type ChannelResponse = { status: number; ok: boolean; text: string };

/**
 * Única porta de rede dos canais do CRM (WhatsApp, Resend, Cal.com, mídia recebida). Tudo passa por `EXTERNAL_FETCH` (DNS
 * verificado e fixado: rede interna recusada). Endereços digitados pelo usuário (Z-API/Evolution `base_url`) ainda são validados
 * antes (https; localhost só fora de produção) e redirecionamentos NUNCA são seguidos (3xx vira erro).
 * Hosts oficiais (Resend, Cal.com, Cloud API) têm substituto só com NODE_ENV=development|test (`RESEND_API_URL`, `CALCOM_API_URL`,
 * `META_GRAPH_BASE_URL`) para o smoke/browser-check usarem provedores falsos.
 */
@Injectable()
export class ChannelHttp {
  readonly allowLocal: boolean;

  constructor(
    @Inject(EXTERNAL_FETCH) private readonly http: ExternalFetch,
    @Inject(ENV) private readonly env: Pick<Env, 'NODE_ENV' | 'META_GRAPH_BASE_URL' | 'RESEND_API_URL' | 'CALCOM_API_URL'>,
  ) {
    this.allowLocal = env.NODE_ENV !== 'production';
  }

  private override(value: string | undefined, fallback: string): string {
    return overrideBase(this.env, value, fallback);
  }

  get resendBase() {
    return this.override(this.env.RESEND_API_URL, 'https://api.resend.com');
  }

  get calBase() {
    return this.override(this.env.CALCOM_API_URL, 'https://api.cal.com/v2');
  }

  get waCloudBase() {
    return this.override(this.env.META_GRAPH_BASE_URL, 'https://graph.facebook.com/v21.0');
  }

  /** Endereço digitado pelo usuário: https (ou localhost em dev), nunca rede interna. Devolve sem barra final. */
  userBase(raw: unknown, what = 'URL base'): string {
    return assertExternalUrl(String(raw ?? '').trim(), this.allowLocal, what).replace(/\/$/, '');
  }

  async request(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<ChannelResponse> {
    const res = await this.http(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400) return { status: res.status, ok: false, text: 'redirecionamento bloqueado' };
    return { status: res.status, ok: res.ok, text: await res.text() };
  }

  /** Baixa bytes (mídia recebida) com teto de tamanho. */
  async bytes(url: string, headers: Record<string, string> = {}, maxBytes = 25 * 1024 * 1024): Promise<{ bytes: Buffer; mime: string }> {
    const res = await this.http(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Não foi possível baixar a mídia (HTTP ${res.status}).`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error('Mídia grande demais.');
    }
    // Sem content-length confiável: lê em pedaços e aborta ao passar do teto (nunca carrega o corpo inteiro).
    const chunks: Buffer[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error('Mídia grande demais.');
        }
        chunks.push(Buffer.from(value));
      }
    }
    const buf = Buffer.concat(chunks);
    return { bytes: buf, mime: (res.headers.get('content-type') ?? '').split(';')[0] || 'application/octet-stream' };
  }
}

export const CHANNEL_SECRETS = ['WHATSAPP_CLOUD_TOKEN', 'ZAPI_TOKEN', 'EVOLUTION_API_KEY', 'RESEND_API_KEY', 'CALCOM_API_KEY', 'WHATSAPP_WEBHOOK_SECRET'] as const;
export type ChannelSecretKey = (typeof CHANNEL_SECRETS)[number];

/** `workspaceSecret` do protótipo: cofre da empresa, depois o global do servidor (cofre global e ambiente). */
@Injectable()
export class ChannelSecrets {
  constructor(
    private readonly vault: VaultService,
    @Inject(ENV) private readonly env: Record<string, unknown>,
  ) {}

  private fromEnv(name: string): string | null {
    const v = this.env[name];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  async get(workspaceId: string, name: string): Promise<string | null> {
    return (await this.vault.get(workspaceId, name)) ?? (await this.vault.get(null, name)) ?? this.fromEnv(name);
  }

  /** `empresa` (salva nesta empresa) · `servidor` (global) · `faltando`. O valor nunca sai daqui. */
  async source(workspaceId: string, name: string): Promise<'empresa' | 'servidor' | 'faltando'> {
    if (await this.vault.has(workspaceId, name)) return 'empresa';
    if ((await this.vault.has(null, name)) || this.fromEnv(name)) return 'servidor';
    return 'faltando';
  }
}
