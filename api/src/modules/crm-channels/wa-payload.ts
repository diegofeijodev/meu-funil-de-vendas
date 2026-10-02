import { OutgoingMessage } from './wa-providers';

export type InboundMessage = {
  externalId: string | null;
  from: string;
  waId?: string | null;
  profileName?: string | null;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'other';
  body: string | null;
  mediaUrl?: string | null;
  /** API oficial: id da mídia para baixar com o token. */
  mediaId?: string | null;
  mimeType?: string | null;
  referral?: { adId?: string | null; campaignName?: string | null; sourceUrl?: string | null } | null;
};
export type { OutgoingMessage };

type CloudValue = {
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: (Record<string, { caption?: string; id?: string; mime_type?: string } | undefined> & {
    id?: string; from?: string; type?: string; text?: { body?: string }; button?: { text?: string };
    referral?: { source_id?: string; headline?: string; source_url?: string };
  })[];
  statuses?: { id?: string; status?: string }[];
};

const ALLOWED = ['text', 'image', 'audio', 'video', 'document', 'sticker'] as const;
export const normalizeType = (type: string | undefined): InboundMessage['type'] => ((ALLOWED as readonly string[]).includes(type ?? '') ? (type as InboundMessage['type']) : 'other');

/** Payload da Cloud API (`entry[].changes[].value.messages/contacts/statuses`, com `referral` de anúncio click-to-WhatsApp). */
export function parseCloudPayload(payload: Record<string, unknown>): { inbound: InboundMessage[]; statuses: { id: string; status: string }[] } {
  const inbound: InboundMessage[] = [];
  const statuses: { id: string; status: string }[] = [];
  const entries = (payload['entry'] as { changes?: { value?: CloudValue }[] }[]) ?? [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const contact = value.contacts?.[0];
      for (const m of value.messages ?? []) {
        const media = m[m.type ?? ''];
        inbound.push({
          externalId: m.id ?? null,
          from: m.from ?? '',
          waId: contact?.wa_id ?? null,
          profileName: contact?.profile?.name ?? null,
          type: normalizeType(m.type),
          body: m.text?.body ?? m.button?.text ?? media?.caption ?? null,
          mediaUrl: null,
          mediaId: media?.id ?? null,
          mimeType: media?.mime_type ?? null,
          referral: m.referral ? { adId: m.referral.source_id ?? null, campaignName: m.referral.headline ?? null, sourceUrl: m.referral.source_url ?? null } : null,
        });
      }
      for (const s of value.statuses ?? []) if (s.id && s.status) statuses.push({ id: s.id, status: s.status });
    }
  }
  return { inbound, statuses };
}

/** Payload da Z-API / Evolution: mensagem única, formato do provedor em `data` ou na raiz; ignora as enviadas por nós (`fromMe`). */
export function parseUnofficialPayload(payload: Record<string, unknown>): InboundMessage[] {
  const raw = payload['data'];
  const data = (raw && typeof raw === 'object' ? raw : payload) as Record<string, unknown>;
  const key = data['key'] as Record<string, unknown> | undefined;
  const phone = String(data['phone'] ?? data['from'] ?? key?.['remoteJid'] ?? '').split('@')[0] ?? '';
  const text =
    (data['text'] as { message?: string } | undefined)?.message ??
    (data['message'] as { conversation?: string } | undefined)?.conversation ??
    (typeof data['body'] === 'string' ? (data['body'] as string) : null);
  const fromMe = Boolean(data['fromMe'] ?? key?.['fromMe']);
  if (!phone || fromMe) return [];
  return [
    {
      externalId: String(data['messageId'] ?? data['id'] ?? key?.['id'] ?? '') || null,
      from: phone,
      profileName: (data['senderName'] as string) ?? (data['pushName'] as string) ?? null,
      type: data['image'] ? 'image' : data['audio'] ? 'audio' : 'text',
      body: text ?? null,
      mediaUrl: ((data['image'] as { imageUrl?: string } | undefined)?.imageUrl ?? (data['audio'] as { audioUrl?: string } | undefined)?.audioUrl) || null,
      referral: null,
    },
  ];
}
