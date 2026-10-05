import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { todaySp } from '../../common/time/dates';
import { AssetsService } from '../media/assets.service';
import { ImageService } from '../media/image.service';
import { UserError } from '../media/user-error';
import { composeCreative } from './compose';
import { ServerCreativeProvider } from './creative.types';
import { RefsService } from './refs.service';

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
const stamp = (sec: number, sep: '.' | ',') => `${pad(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)}${sep}${pad((sec % 1) * 1000, 3)}`;

/** Quebra o texto em blocos de até 6 palavras distribuídos ao longo do vídeo (.vtt e .srt). */
export function buildCaptions(text: string, durationSec: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 6) chunks.push(words.slice(i, i + 6).join(' '));
  if (!chunks.length) return { vtt: 'WEBVTT\n', srt: '' };
  const slot = durationSec / chunks.length;
  const cues = chunks.map((c, i) => ({ start: i * slot, end: Math.min(durationSec, (i + 1) * slot - 0.05), text: c }));
  const vtt = `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}`).join('\n\n')}\n`;
  const srt = `${cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}`).join('\n\n')}\n`;
  return { vtt, srt };
}

export type VideoExtrasInput = {
  workspaceId: string;
  brand: { id: string; primary_color?: string | null; secondary_color?: string | null } | null;
  provider: ServerCreativeProvider | null;
  visualPrompt: string;
  aspectRatio: string;
  durationSec: number;
  headline: string | null;
  cta: string | null;
  captionText: string | null;
  videoAssetId: string | null;
  campaignId: string | null;
  title: string;
  withCover: boolean;
};

/**
 * Acabamento do vídeo (sem transcodificar o MP4): capa (Reels/Stories) com logo, título e CTA aplicados por cima
 * — texto nunca gerado pela IA — e legendas em .vtt/.srt a partir da copy.
 */
@Injectable()
export class VideoExtrasService {
  private readonly logger = new Logger(VideoExtrasService.name);

  constructor(
    private readonly assets: AssetsService,
    private readonly refs: RefsService,
    private readonly images: ImageService,
  ) {}

  private storeText(workspaceId: string, name: string, content: string) {
    return this.assets.storeBytes(`media/${workspaceId}/${todaySp()}/${randomUUID()}-${name}`, Buffer.from(content, 'utf8'));
  }

  async build(inp: VideoExtrasInput) {
    const out: { cover_url?: string; cover_asset_id?: string; captions_vtt?: string; captions_srt?: string; errors?: string[] } = {};
    const errors: string[] = [];
    const caption = (inp.captionText || inp.headline || '').trim();
    if (caption) {
      try {
        const { vtt, srt } = buildCaptions(caption, inp.durationSec);
        out.captions_vtt = await this.storeText(inp.workspaceId, 'legendas.vtt', vtt);
        out.captions_srt = await this.storeText(inp.workspaceId, 'legendas.srt', srt);
      } catch (e) {
        errors.push(`legendas: ${e instanceof Error ? e.message : 'falhou'}`);
      }
    }
    if (inp.withCover && inp.provider) {
      try {
        const ratio = inp.aspectRatio === '16:9' ? '16:9' : '9:16';
        const still = await inp.provider.generateImage({
          finalPrompt: `${inp.visualPrompt}\nQuadro estático para a capa de um vídeo. Não inclua texto, letras nem logotipos.`,
          aspectRatio: ratio,
          kind: 'image',
        });
        let image: Uint8Array;
        if (still.bytes) image = new Uint8Array(still.bytes);
        else if (still.assetUrl) image = (await this.assets.download(still.assetUrl)).bytes;
        else throw new UserError('o provedor não devolveu a imagem da capa');
        const [font, logo] = await Promise.all([this.refs.loadFont(inp.workspaceId, inp.brand?.id), this.refs.loadLogo(inp.workspaceId, inp.brand?.id)]);
        const composed = await composeCreative(this.images, {
          image, aspectRatio: ratio, layout: inp.cta ? 'cta_rodape' : 'titulo_topo', title: inp.headline, cta: inp.cta, logo, font,
          primary: inp.brand?.primary_color ?? null, secondary: inp.brand?.secondary_color ?? null,
        });
        const asset = await this.assets.ingest({
          workspaceId: inp.workspaceId, kind: 'image', targetFormat: ratio === '16:9' ? 'other' : 'ig_story', source: inp.provider.id,
          bytes: composed, mime: 'image/jpeg', title: `${inp.title} (capa)`, provider: inp.provider.id, brandId: inp.brand?.id ?? null,
          campaignId: inp.campaignId, parentId: inp.videoAssetId, normalize: true,
        });
        out.cover_url = asset.url ?? undefined;
        out.cover_asset_id = asset.id;
      } catch (e) {
        this.logger.warn(`[video-extras] capa falhou: ${e instanceof Error ? e.message : e}`);
        errors.push(`capa: ${e instanceof Error ? e.message : 'falhou'}`);
      }
    }
    if (errors.length) out.errors = errors;
    return out;
  }
}
