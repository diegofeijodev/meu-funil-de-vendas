import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AI_FETCH, AiFetch } from '../ai/ai.types';
import { AiKeysService } from '../ai/ai-keys.service';
import { AiService } from '../ai/ai.service';
import { FilesService } from '../files/files.service';
import { ChannelHttp } from './channel-http';

const BUCKET = 'creative-assets';
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/aac': 'aac', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
};
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Mídia recebida no CRM (porte de `crm/media-understanding.server.ts`): baixa, guarda no armazenamento do app e transforma em texto
 * para o SDR — transcrição de áudio (Gemini ou Whisper da empresa) e descrição de imagem (visão do `AiService`).
 */
@Injectable()
export class MediaUnderstandingService {
  constructor(
    private readonly http: ChannelHttp,
    private readonly files: FilesService,
    private readonly ai: AiService,
    private readonly keys: AiKeysService,
    @Inject(AI_FETCH) private readonly aiHttp: AiFetch,
  ) {}

  /** Guarda a mídia do CRM no armazenamento do app (`crm/{ws}/{data}/{uuid}.{ext}`) e devolve um link assinado de 1 ano. */
  async store(workspaceId: string, bytes: Uint8Array, mime: string): Promise<string> {
    const key = `crm/${workspaceId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${EXT[mime] ?? 'bin'}`;
    await this.files.put(BUCKET, key, bytes);
    return this.files.signedUrl(BUCKET, key, 60 * 60 * 24 * 365);
  }

  /** API oficial do WhatsApp: a mídia chega como id; troca por URL temporária e baixa com o token. */
  async downloadCloudMedia(token: string, mediaId: string): Promise<{ bytes: Buffer; mime: string }> {
    const meta = await this.http.request(`${this.http.waCloudBase}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meta.ok) throw new Error(`WhatsApp não liberou a mídia (HTTP ${meta.status}).`);
    const info = JSON.parse(meta.text || '{}') as { url?: string; mime_type?: string };
    if (!info.url) throw new Error('WhatsApp não devolveu o link da mídia.');
    const file = await this.http.bytes(info.url, { Authorization: `Bearer ${token}` });
    return { bytes: file.bytes, mime: info.mime_type?.split(';')[0] || file.mime };
  }

  private async transcribe(workspaceId: string, bytes: Uint8Array, mime: string): Promise<string | null> {
    const b64 = Buffer.from(bytes).toString('base64');
    const gemini = await this.keys.get(workspaceId, 'gemini');
    if (gemini) {
      const res = await this.aiHttp(`${GEMINI}/models/gemini-flash-latest:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': gemini, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: 'Transcreva este áudio em português do Brasil. Devolva só o texto falado.' }] }] }),
        signal: AbortSignal.timeout(120_000),
      }).catch(() => null);
      if (res?.ok) {
        const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const t = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
        if (t) return t;
      }
    }
    const openai = await this.keys.get(workspaceId, 'openai');
    if (openai) {
      const fd = new FormData();
      fd.append('model', 'whisper-1');
      fd.append('language', 'pt');
      fd.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), `audio.${EXT[mime] ?? 'ogg'}`);
      const res = await this.aiHttp('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${openai}` }, body: fd, signal: AbortSignal.timeout(120_000) }).catch(() => null);
      if (res?.ok) {
        const j = (await res.json()) as { text?: string };
        if (j.text?.trim()) return j.text.trim();
      }
    }
    return null;
  }

  private async describeImage(workspaceId: string, bytes: Uint8Array, mime: string): Promise<string | null> {
    const r = await this.ai.vision<{ descricao?: string }>(workspaceId, {
      prompt: 'Um cliente enviou esta imagem no atendimento. Descreva em 1 a 2 frases, em português, o que ela mostra e qualquer texto visível (ex.: print de produto, comprovante, foto de ambiente).',
      schema: { type: 'object', additionalProperties: false, required: ['descricao'], properties: { descricao: { type: 'string' } } },
      name: 'image_description',
      images: [{ bytes, mime }],
    });
    return r.descricao?.trim() || null;
  }

  /** Texto que o SDR recebe no lugar de um áudio ou imagem. */
  async describe(workspaceId: string, source: string | { bytes: Uint8Array; mime: string }, type: 'audio' | 'image'): Promise<string> {
    const file = typeof source === 'string' ? await this.http.bytes(source) : source;
    if (type === 'audio') {
      const t = await this.transcribe(workspaceId, file.bytes, file.mime).catch(() => null);
      return t ? `[Áudio do lead, transcrito] ${t}` : '[O lead enviou um áudio que não pôde ser transcrito. Peça gentilmente que escreva a mensagem.]';
    }
    const d = await this.describeImage(workspaceId, file.bytes, file.mime).catch(() => null);
    return d ? `[O lead enviou uma imagem] ${d}` : '[O lead enviou uma imagem.]';
  }
}
