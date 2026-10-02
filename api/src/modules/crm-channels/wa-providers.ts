import { ChannelHttp } from './channel-http';
import { UserFacingError } from './channel-errors';

export type OutgoingMessage = {
  to: string;
  kind: 'text' | 'image' | 'audio' | 'template';
  body?: string;
  mediaUrl?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
};
export type SendResult = { externalId: string | null };
export type WaTemplate = { name: string; language: string; category: string | null; status: string; body: string | null; variables: number };
export type WaIntegration = { workspace_id: string; provider: string; config: unknown };

/** Texto final de uma mensagem (template sem API oficial: corpo com {{1}}, {{2}}… preenchidos). */
export function templateText(message: OutgoingMessage): string {
  let text = message.body ?? '';
  (message.templateParams ?? []).forEach((v, i) => {
    text = text.split(`{{${i + 1}}}`).join(v);
  });
  return text;
}

const cfgOf = (i: WaIntegration) => (i.config ?? {}) as Record<string, unknown>;
const digits = (s: string) => s.replace(/\D/g, '');

/**
 * Provedores de WhatsApp (porte de `crm/whatsapp.server.ts`): API oficial (Cloud API), Z-API e Evolution. As bases da Z-API/Evolution
 * são digitadas pelo usuário: passam por `ChannelHttp.userBase` (https, nunca rede interna) e o `fetch` é o guardado (SSRF).
 */
export class WaProviders {
  constructor(
    private readonly http: ChannelHttp,
    private readonly secret: (workspaceId: string, name: string) => Promise<string | null>,
  ) {}

  async send(i: WaIntegration, m: OutgoingMessage): Promise<SendResult> {
    if (i.provider === 'whatsapp_cloud') return this.cloudSend(i, m);
    if (i.provider === 'zapi') return this.zapiSend(i, m);
    if (i.provider === 'evolution') return this.evolutionSend(i, m);
    throw new Error('Provedor de WhatsApp não suportado');
  }

  async listTemplates(i: WaIntegration): Promise<WaTemplate[]> {
    if (i.provider !== 'whatsapp_cloud') return [];
    const token = await this.secret(i.workspace_id, 'WHATSAPP_CLOUD_TOKEN');
    if (!token) throw new UserFacingError('Token do WhatsApp (WHATSAPP_CLOUD_TOKEN) não configurado');
    const wabaId = String(cfgOf(i)['waba_id'] ?? '');
    if (!/^\d{3,25}$/.test(wabaId)) throw new UserFacingError('waba_id não configurado');
    const res = await this.http.request(`${this.http.waCloudBase}/${wabaId}/message_templates?limit=100`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`WhatsApp Cloud API [${res.status}]: ${res.text}`);
    const json = JSON.parse(res.text || '{}') as { data?: { name: string; language: string; category?: string; status: string; components?: { type: string; text?: string }[] }[] };
    return (json.data ?? []).map((t) => {
      const body = t.components?.find((c) => c.type === 'BODY')?.text ?? null;
      return { name: t.name, language: t.language, category: t.category ?? null, status: t.status, body, variables: body ? (body.match(/\{\{\d+\}\}/g) ?? []).length : 0 };
    });
  }

  private async cloudSend(i: WaIntegration, message: OutgoingMessage): Promise<SendResult> {
    const token = await this.secret(i.workspace_id, 'WHATSAPP_CLOUD_TOKEN');
    if (!token) throw new Error('Token do WhatsApp (WHATSAPP_CLOUD_TOKEN) não configurado');
    const phoneNumberId = String(cfgOf(i)['phone_number_id'] ?? '');
    if (!/^\d{3,25}$/.test(phoneNumberId)) throw new Error('phone_number_id não configurado');
    const to = digits(message.to);
    let payload: Record<string, unknown>;
    if (message.kind === 'template') {
      payload = {
        messaging_product: 'whatsapp', to, type: 'template',
        template: {
          name: message.templateName,
          language: { code: message.templateLanguage ?? 'pt_BR' },
          ...(message.templateParams?.length ? { components: [{ type: 'body', parameters: message.templateParams.map((text) => ({ type: 'text', text })) }] } : {}),
        },
      };
    } else if (message.kind === 'text') {
      payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: message.body ?? '' } };
    } else {
      payload = { messaging_product: 'whatsapp', to, type: message.kind, [message.kind]: { link: message.mediaUrl } };
    }
    const res = await this.http.request(`${this.http.waCloudBase}/${phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WhatsApp Cloud API [${res.status}]: ${res.text}`);
    const json = JSON.parse(res.text || '{}') as { messages?: { id: string }[] };
    return { externalId: json.messages?.[0]?.id ?? null };
  }

  private async zapiSend(i: WaIntegration, message: OutgoingMessage): Promise<SendResult> {
    const token = await this.secret(i.workspace_id, 'ZAPI_TOKEN');
    if (!token) throw new Error('Client-Token da Z-API (ZAPI_TOKEN) não configurado');
    const base = this.http.userBase(cfgOf(i)['base_url'], 'URL base da instância');
    // Z-API não tem templates oficiais: template vira texto com o corpo já preenchido.
    const asText = message.kind === 'text' || message.kind === 'template';
    const path = asText ? 'send-text' : message.kind === 'image' ? 'send-image' : 'send-audio';
    const body = asText ? { phone: digits(message.to), message: templateText(message) } : { phone: digits(message.to), [message.kind]: message.mediaUrl, caption: message.body ?? '' };
    const res = await this.http.request(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Client-Token': token }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Z-API [${res.status}]: ${res.text}`);
    const json = (res.text ? JSON.parse(res.text) : {}) as { messageId?: string; id?: string };
    return { externalId: json.messageId ?? json.id ?? null };
  }

  private async evolutionSend(i: WaIntegration, message: OutgoingMessage): Promise<SendResult> {
    const key = await this.secret(i.workspace_id, 'EVOLUTION_API_KEY');
    if (!key) throw new Error('Chave da Evolution API (EVOLUTION_API_KEY) não configurada');
    const base = this.http.userBase(cfgOf(i)['base_url'], 'URL base da instância');
    const instance = String(cfgOf(i)['instance'] ?? '');
    if (!/^[\w.-]{1,100}$/.test(instance)) throw new Error('instance não configurada');
    const number = digits(message.to);
    const asText = message.kind === 'text' || message.kind === 'template';
    const path = asText ? `/message/sendText/${instance}` : `/message/sendMedia/${instance}`;
    const body = asText ? { number, text: templateText(message) } : { number, mediatype: message.kind, media: message.mediaUrl, caption: message.body ?? '' };
    const res = await this.http.request(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Evolution API [${res.status}]: ${res.text}`);
    const json = (res.text ? JSON.parse(res.text) : {}) as { key?: { id?: string } };
    return { externalId: json.key?.id ?? null };
  }
}
