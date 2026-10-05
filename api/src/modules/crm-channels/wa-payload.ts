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
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!change || typeof change.value !== 'object' || !change.value) continue;
      const value = change.value;
      const contact = value.contacts?.[0];
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!m || typeof m !== 'object') continue;
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
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) if (s && s.id && s.status) statuses.push({ id: s.id, status: s.status });
    }
  }
  return { inbound, statuses };
}

/** Payload da Z-API / Evolution: só mensagem recebida de conversa individual (texto ou mídia). Recibos/status, grupos, enviadas por nós (`fromMe`) e eventos que não são `messages.upsert` são ignorados. */
export function parseUnofficialPayload(payload: Record<string, unknown>): InboundMessage[] {
  const raw = payload['data'];
  const data = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : payload) as Record<string, unknown>;
  const key = (data['key'] && typeof data['key'] === 'object' ? data['key'] : undefined) as Record<string, unknown> | undefined;

  // Evolution: só `messages.upsert`. Z-API: só `ReceivedCallback` (os outros tipos são recibos de entrega/leitura, presença, conexão).
  const event = payload['event'];
  if (typeof event === 'string' && !/^messages[._]upsert$/i.test(event)) return [];
  const zType = data['type'];
  if (typeof zType === 'string' && zType !== 'ReceivedCallback') return [];
  if (data['isGroup'] === true || payload['isGroup'] === true) return [];
  if (data['fromMe'] === true || key?.['fromMe'] === true || data['fromMe'] === 'true') return [];

  const jid = String(data['phone'] ?? data['from'] ?? key?.['remoteJid'] ?? '');
  if (jid.endsWith('@g.us')) return [];
  const phone = jid.split('@')[0] ?? '';
  const msg = (data['message'] && typeof data['message'] === 'object' ? data['message'] : {}) as Record<string, any>;
  const textOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const text =
    textOf((data['text'] as { message?: string } | undefined)?.message) ??
    textOf(msg['conversation']) ??
    textOf(msg['extendedTextMessage']?.text) ??
    textOf(data['body']);
  const media = (name: string, evo: string) => data[name] ?? msg[evo];
  const image = media('image', 'imageMessage');
  const audio = media('audio', 'audioMessage');
  const video = media('video', 'videoMessage');
  const document = media('document', 'documentMessage');
  const sticker = media('sticker', 'stickerMessage');
  const hasMedia = !!(image || audio || video || document || sticker);
  if (!phone || (!text && !hasMedia)) return [];
  const type: InboundMessage['type'] = image ? 'image' : audio ? 'audio' : video ? 'video' : document ? 'document' : sticker ? 'sticker' : 'text';
  return [
    {
      externalId: String(data['messageId'] ?? data['id'] ?? key?.['id'] ?? '') || null,
      from: phone,
      profileName: (data['senderName'] as string) ?? (data['pushName'] as string) ?? null,
      type,
      body: text,
      mediaUrl: ((data['image'] as { imageUrl?: string } | undefined)?.imageUrl ?? (data['audio'] as { audioUrl?: string } | undefined)?.audioUrl) || null,
      referral: null,
    },
  ];
}
