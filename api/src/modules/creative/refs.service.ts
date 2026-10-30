import { Injectable, Logger, Optional } from '@nestjs/common';
import { StyleRefsService } from '../style-refs/style-refs.service';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../../common/database/prisma.service';
import { AiImageInput } from '../ai/ai.types';
import { FilesService } from '../files/files.service';
import { AssetsService } from '../media/assets.service';
import { ImageService } from '../media/image.service';
import { parseFont } from './compose';

export type BrandRef = AiImageInput & { id: string; tag: string | null; url: string; mime: string; name?: string | null };

const REF_KINDS = ['reference', 'photo'];
const DEFAULT_FONT_FILE = 'ArchivoBlack-Regular.ttf';

/** Pasta `assets/fonts` da API: funciona em `ts-node` (src/), em `dist/` e no contêiner (cwd = /app). */
function fontDirs(): string[] {
  return [
    path.resolve(process.cwd(), 'assets/fonts'),
    path.resolve(__dirname, '../../../assets/fonts'),
    path.resolve(__dirname, '../../../../assets/fonts'),
    path.resolve(__dirname, '../../../../../assets/fonts'),
  ];
}

let defaultFont: ArrayBuffer | null = null;

/** Archivo Black (OFL) vendorizada em `api/assets/fonts/` — o protótipo a baixava do GitHub a cada partida. */
export function loadDefaultFont(): ArrayBuffer {
  if (defaultFont) return defaultFont;
  for (const dir of fontDirs()) {
    const file = path.join(dir, DEFAULT_FONT_FILE);
    if (existsSync(file)) {
      const b = readFileSync(file);
      defaultFont = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      return defaultFont;
    }
  }
  throw new Error(`Fonte padrão não encontrada (${DEFAULT_FONT_FILE} em assets/fonts).`);
}

/** Arquivos da marca usados na geração: fotos de referência, logo e fonte. Sempre dentro do workspace. */
@Injectable()
export class RefsService {
  private readonly logger = new Logger(RefsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly assets: AssetsService,
    private readonly images: ImageService,
    @Optional() private readonly styleRefs?: StyleRefsService,
  ) {}

  /**
   * Notas de estilo das referências (Fatias 5/6) para o diretor de arte e o de vídeo — só TEXTO. As imagens de referência de
   * terceiros (Pinterest, envio) nunca passam por `loadBrandRefs`: ficam em `style_references`, fora do que vira pixel.
   */
  async loadStyleNotes(workspaceId: string, brandId: string | null | undefined, campaignId?: string | null): Promise<string | null> {
    if (!this.styleRefs || !brandId) return null;
    return this.styleRefs.loadStyleNotes(workspaceId, brandId, campaignId ?? null).catch(() => null);
  }

  /** Bytes de um arquivo de marca; `storage_path` só vale se for do workspace (`brands/<ws>/...`). */
  private async bytesOf(workspaceId: string, a: { storage_path: string | null; url: string | null }): Promise<Uint8Array> {
    if (a.storage_path) {
      if (!this.files.keyBelongsToWorkspace(a.storage_path, workspaceId)) throw new Error('arquivo de outro workspace');
      return new Uint8Array(await this.files.read('creative-assets', a.storage_path));
    }
    return (await this.assets.readBytes({ storage_path: null, url: a.url })).bytes;
  }

  /** Fotos de referência (produto primeiro), reduzidas a ≤1024 px JPEG. */
  async loadBrandRefs(workspaceId: string, brandId: string | null | undefined, opts: { max?: number; ids?: string[] } = {}): Promise<BrandRef[]> {
    if (!brandId) return [];
    const rows = await this.prisma.brand_assets.findMany({
      where: { brand_id: brandId, workspace_id: workspaceId, kind: { in: REF_KINDS }, ...(opts.ids?.length ? { id: { in: opts.ids } } : {}) },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: { id: true, tag: true, name: true, url: true, storage_path: true },
    });
    const usable = rows.filter((r) => !String(r.name ?? '').toLowerCase().endsWith('.pdf'));
    // Produto primeiro: é o que precisa ficar fiel.
    usable.sort((a, b) => Number(b.tag === 'produto') - Number(a.tag === 'produto'));
    const out: BrandRef[] = [];
    for (const r of usable.slice(0, opts.max ?? 4)) {
      try {
        const small = await this.images.shrink(await this.bytesOf(workspaceId, r), 1024);
        out.push({ ...small, id: r.id, tag: r.tag ?? null, url: r.url ?? '', name: r.name ?? null });
      } catch (e) {
        this.logger.warn(`[refs] referência ignorada ${r.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return out;
  }

  /**
   * Logo da marca (PNG/JPG/WEBP; SVG e PDF não entram na composição). Ordem: o `brand_assets` de logo mais recente; sem ele,
   * `brands.logo_url` — mas só quando é um arquivo NOSSO (URL assinada desta API, dentro da pasta deste workspace).
   */
  async loadLogo(workspaceId: string, brandId: string | null | undefined): Promise<Uint8Array | null> {
    if (!brandId) return null;
    const row = await this.prisma.brand_assets.findFirst({
      where: { brand_id: brandId, workspace_id: workspaceId, kind: 'logo' },
      orderBy: { created_at: 'desc' },
      select: { url: true, storage_path: true, name: true },
    });
    if (row) {
      if (/\.(svg|pdf)$/i.test(row.name ?? '')) return null;
      try {
        return await this.bytesOf(workspaceId, row);
      } catch {
        return null;
      }
    }
    const brand = await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: workspaceId }, select: { logo_url: true } });
    return this.ownFileBytes(workspaceId, brand?.logo_url ?? null);
  }

  /**
   * Bytes de uma URL assinada DESTA API (`<PUBLIC_URL>/v1/files/<bucket>/<chave>`) cujo arquivo é deste workspace, lidos direto do
   * disco pelo FilesService. URL externa (site do cliente, CDN, outro domínio) é ignorada de propósito: baixar um endereço
   * qualquer vindo do cadastro abriria SSRF, e quem quer a logo nos criativos a envia pelo upload.
   */
  private async ownFileBytes(workspaceId: string, url: string | null): Promise<Uint8Array | null> {
    const own = url ? this.files.parseOwnUrl(url) : null;
    if (!own || !this.files.keyBelongsToWorkspace(own.key, workspaceId) || /\.(svg|pdf)$/i.test(own.key)) return null;
    try {
      return new Uint8Array(await this.files.read(own.bucket, own.key));
    } catch {
      return null;
    }
  }

  /** Fonte .ttf/.otf enviada na marca (se o opentype a entender); senão Archivo Black (forte e legível em anúncios). */
  async loadFont(workspaceId: string, brandId: string | null | undefined): Promise<ArrayBuffer> {
    if (brandId) {
      const row = await this.prisma.brand_assets.findFirst({
        where: { brand_id: brandId, workspace_id: workspaceId, kind: 'font' },
        orderBy: { created_at: 'desc' },
        select: { url: true, storage_path: true },
      });
      if (row) {
        try {
          const b = await this.bytesOf(workspaceId, row);
          const buf = b.slice().buffer as ArrayBuffer;
          parseFont(buf); // valida: fonte quebrada cai para a padrão em vez de falhar a geração
          return buf;
        } catch (e) {
          this.logger.warn(`[font] fonte da marca ignorada: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    return loadDefaultFont();
  }
}
