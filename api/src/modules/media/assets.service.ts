import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { todaySp } from '../../common/time/dates';
import { FilesService } from '../files/files.service';
import { assertExternalUrl, EXTERNAL_FETCH, ExternalFetch } from './external-fetch';
import { aspectFor, TargetFormat, targetFromAspect } from './formats';
import { ImageService } from './image.service';
import { notFound, UserError } from './user-error';
import { readVideoMeta, validateImageForInstagram, validateVideoForInstagram } from './video-meta';

export const MEDIA_BUCKET = 'creative-assets';
/** Teto do que se baixa de um provedor/Canva para a biblioteca. */
export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const SOURCES = new Set(['higgsfield', 'chatgpt', 'gemini', 'upload', 'mock', 'canva', 'instagram']);

export interface IngestInput {
  workspaceId: string;
  kind: 'image' | 'video';
  targetFormat: TargetFormat;
  /** higgsfield | chatgpt | gemini | upload | mock | canva | instagram | other */
  source: string;
  bytes?: Uint8Array;
  sourceUrl?: string;
  mime?: string | null;
  title?: string;
  prompt?: string | null;
  provider?: string | null;
  cost?: number | null;
  brandId?: string | null;
  campaignId?: string | null;
  creativeId?: string | null;
  igPostId?: string | null;
  parentId?: string | null;
  /** Ângulo da estratégia que esta mídia testa. */
  angle?: string | null;
  createdBy?: string | null;
  status?: 'draft' | 'approved';
  /** Recorta para o tamanho exato (padrão true para imagens). */
  normalize?: boolean;
}

export type MediaAsset = Prisma.media_assetsGetPayload<object>;

/**
 * Entrada ÚNICA de toda mídia: baixa, padroniza, valida e salva no bucket `creative-assets`
 * (`media/<workspace>/<dia>/<uuid>.<ext>` + `_thumb.jpg`), registrando em `media_assets`.
 * Vídeo: só lê o cabeçalho MP4/MOV (sem transcodificar) e valida contra as regras do Instagram.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly images: ImageService,
    @Inject(EXTERNAL_FETCH) private readonly http: ExternalFetch,
    @Inject(ENV) private readonly env: Pick<Env, 'NODE_ENV'>,
  ) {}

  /** Grava e devolve a URL assinada de 5 anos (a que fica no banco). */
  async storeBytes(key: string, bytes: Uint8Array | Buffer): Promise<string> {
    await this.files.put(MEDIA_BUCKET, key, bytes);
    return this.files.signedUrl(MEDIA_BUCKET, key);
  }

  /** Grava e devolve uma URL de download de 10 min (`?dl=<nome>` força o download com esse nome). */
  async storeForDownload(key: string, bytes: Uint8Array | Buffer, name: string): Promise<string> {
    await this.files.put(MEDIA_BUCKET, key, bytes);
    return this.downloadUrl(key, name);
  }

  downloadUrl(key: string, name: string): string {
    return `${this.files.signedUrl(MEDIA_BUCKET, key, 600)}&dl=${encodeURIComponent(name)}`;
  }

  /** Baixa uma mídia: `data:`, URL assinada desta API (lê do disco, conferindo a assinatura) ou https externo. */
  async download(url: string): Promise<{ bytes: Uint8Array; mime: string | null }> {
    if (url.startsWith('data:')) {
      const comma = url.indexOf(',');
      const head = url.slice(0, comma);
      const payload = url.slice(comma + 1);
      const bytes = head.includes(';base64') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
      return { bytes: new Uint8Array(bytes), mime: /data:([^;,]+)/.exec(head)?.[1] ?? null };
    }
    const own = this.files.parseOwnUrl(url);
    if (own) {
      this.files.verify(own.bucket, own.key, own.exp ?? undefined, own.sig ?? undefined);
      const bytes = await this.files.read(own.bucket, own.key);
      return { bytes: new Uint8Array(bytes), mime: null };
    }
    const safe = assertExternalUrl(url, this.env.NODE_ENV !== 'production', 'endereço da mídia');
    const res = await this.http(safe, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new UserError(`Não foi possível baixar a mídia do provedor (HTTP ${res.status}).`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_DOWNLOAD_BYTES) throw new UserError('A mídia do provedor é grande demais.');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_DOWNLOAD_BYTES) throw new UserError('A mídia do provedor é grande demais.');
    return { bytes: buf, mime: res.headers.get('content-type') };
  }

  /** Bytes do arquivo de um asset (`storage_path` no disco; senão a `url`). */
  async readBytes(asset: { storage_path: string | null; url: string | null }): Promise<{ bytes: Uint8Array; mime: string | null }> {
    if (asset.storage_path) {
      try {
        return { bytes: new Uint8Array(await this.files.read(MEDIA_BUCKET, asset.storage_path)), mime: null };
      } catch {
        throw new UserError('Arquivo não encontrado no armazenamento.');
      }
    }
    if (!asset.url) throw new UserError('Mídia sem arquivo.');
    return this.download(asset.url);
  }

  guessTarget(aspect: string | null | undefined, video: boolean, explicit?: string | null): TargetFormat {
    return (explicit as TargetFormat) || targetFromAspect(aspect, video);
  }

  async ingest(input: IngestInput): Promise<MediaAsset> {
    let bytes = input.bytes;
    let mime = input.mime ?? null;
    if (!bytes) {
      if (!input.sourceUrl) throw new UserError('Mídia sem arquivo nem URL.');
      const d = await this.download(input.sourceUrl);
      bytes = d.bytes;
      mime = mime ?? d.mime;
    }
    const id = randomUUID();
    const base = `media/${input.workspaceId}/${todaySp()}/${id}`;
    const target = input.targetFormat;
    let row: Record<string, unknown>;

    if (input.kind === 'image') {
      let width: number;
      let height: number;
      let data: Uint8Array;
      let ext: string;
      let thumb: Uint8Array | null = null;
      if (input.normalize === false) {
        ({ width, height } = await this.images.size(bytes));
        data = bytes;
        ext = mime?.includes('png') ? 'png' : 'jpg';
        mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      } else {
        const n = await this.images.normalize(bytes, target);
        ({ width, height, ext } = n);
        data = n.bytes;
        mime = n.mime;
        thumb = n.thumb;
      }
      const url = await this.storeBytes(`${base}.${ext}`, data);
      const thumbUrl = thumb ? await this.storeBytes(`${base}_thumb.jpg`, thumb) : url;
      const report = validateImageForInstagram(width, height, target);
      row = {
        storage_path: `${base}.${ext}`,
        url,
        thumbnail_path: thumb ? `${base}_thumb.jpg` : null,
        thumbnail_url: thumbUrl,
        mime,
        width,
        height,
        size_bytes: data.length,
        aspect_ratio: aspectFor(target),
        ig_ready: report.ok,
        quality_report: report,
      };
    } else {
      const meta = readVideoMeta(bytes);
      const report = validateVideoForInstagram(meta, target);
      const ext = meta.container === 'qt' ? 'mov' : 'mp4';
      const ct = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
      const url = await this.storeBytes(`${base}.${ext}`, bytes);
      row = {
        storage_path: `${base}.${ext}`,
        url,
        thumbnail_url: null,
        mime: ct,
        width: meta.width,
        height: meta.height,
        duration_seconds: meta.duration,
        size_bytes: bytes.length,
        aspect_ratio: meta.width && meta.height ? (meta.width < meta.height ? '9:16' : meta.width === meta.height ? '1:1' : '16:9') : aspectFor(target),
        ig_ready: report.ok,
        quality_report: report,
      };
    }

    return this.prisma.media_assets.create({
      data: {
        id,
        workspace_id: input.workspaceId,
        brand_id: input.brandId ?? null,
        campaign_id: input.campaignId ?? null,
        creative_id: input.creativeId ?? null,
        ig_post_id: input.igPostId ?? null,
        parent_id: input.parentId ?? null,
        angle: input.angle ?? null,
        title: (input.title || 'Mídia').slice(0, 200),
        kind: input.kind,
        source: SOURCES.has(input.source) ? input.source : 'other',
        target_format: target,
        prompt: input.prompt ?? null,
        provider: input.provider ?? input.source,
        cost: input.cost ?? null,
        created_by: input.createdBy ?? null,
        status: input.status ?? 'draft',
        ...(row as object),
      } as Prisma.media_assetsUncheckedCreateInput,
    });
  }

  /** Reprocessa um asset de imagem para outro formato (sem IA — só corte/redimensionamento). O asset é conferido contra o workspace. */
  async reformat(workspaceId: string, assetId: string, target: TargetFormat, createdBy?: string | null): Promise<MediaAsset> {
    const asset = await this.prisma.media_assets.findFirst({ where: { id: assetId, workspace_id: workspaceId } });
    if (!asset) throw notFound('Mídia não encontrada.');
    if (asset.kind !== 'image') throw new UserError('Vídeos não são recortados no servidor. Gere um novo vídeo neste formato.');
    const src = await this.readBytes(asset);
    return this.ingest({
      workspaceId,
      kind: 'image',
      targetFormat: target,
      source: asset.source,
      bytes: src.bytes,
      mime: src.mime ?? asset.mime,
      title: asset.title,
      prompt: asset.prompt,
      provider: asset.provider,
      brandId: asset.brand_id,
      campaignId: asset.campaign_id,
      parentId: asset.id,
      createdBy: createdBy ?? null,
    });
  }
}
