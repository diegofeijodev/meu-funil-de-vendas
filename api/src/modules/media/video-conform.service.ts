import { Injectable } from '@nestjs/common';
import { AssetsService, MediaAsset } from './assets.service';
import { FfmpegService } from './ffmpeg.service';
import { TargetFormat } from './formats';
import { UserError } from './user-error';

/**
 * C6: vídeo fora do padrão do Instagram (ou com som quando o modo pede "sem áudio") é convertido pelo ffmpeg, reingerido na biblioteca
 * como filho do original e revalidado (`video-meta`). Se continuar fora do padrão, lança `UserError` com os problemas.
 */
@Injectable()
export class VideoConformService {
  constructor(
    private readonly assets: AssetsService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  async ensureIgReady(
    asset: MediaAsset,
    meta: { workspaceId: string; brandId: string | null; igPostId: string | null; title: string; provider: string },
    opts: { silent: boolean },
  ): Promise<MediaAsset> {
    const checks = ((asset.quality_report as { checks?: { audioCodec?: string | null } } | null)?.checks ?? {}) as { audioCodec?: string | null };
    if (asset.ig_ready && !(opts.silent && checks.audioCodec)) return asset;
    const { bytes } = await this.assets.readBytes(asset);
    const converted = await this.ffmpeg.conformForInstagram(bytes, { silent: opts.silent });
    const next = await this.assets.ingest({
      workspaceId: meta.workspaceId, kind: 'video', targetFormat: asset.target_format as TargetFormat, source: asset.source, bytes: converted, mime: 'video/mp4',
      title: meta.title, prompt: asset.prompt, provider: meta.provider, cost: 0, brandId: meta.brandId, igPostId: meta.igPostId, parentId: asset.id,
    });
    if (!next.ig_ready) {
      const issues = ((next.quality_report as { issues?: string[] } | null)?.issues ?? []).join(' ');
      throw new UserError(`Vídeo fora do padrão do Instagram mesmo depois da conversão: ${issues || 'validação falhou.'}`);
    }
    return next;
  }
}
