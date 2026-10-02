import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { todaySp } from '../../common/time/dates';
import { EDITORS, WorkspaceAccessService } from '../access/access.service';
import { FilesService } from '../files/files.service';
import { AssetsService, MEDIA_BUCKET } from './assets.service';
import { TARGET_FORMATS, TargetFormat } from './formats';
import { ImageService } from './image.service';
import { notFound, UserError } from './user-error';
import { readVideoMeta, validateImageForInstagram, validateVideoForInstagram } from './video-meta';

/** Teto de upload (o do `@fastify/multipart` registrado no `main.ts`). O protótipo aceitava 500 MB. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_BYTES = 250 * 1024 * 1024;

type Asset = Prisma.media_assetsGetPayload<{ include: { brand: { select: { name: true } } } }>;

const slug = (v: string) =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'midia';

function fileName(a: Asset, ext: string, i?: number) {
  const brand = slug(a.brand?.name ?? 'meu-funil');
  const fmt = slug((TARGET_FORMATS as Record<string, { short: string }>)[a.target_format]?.short ?? a.target_format ?? 'midia');
  const date = a.created_at.toISOString().slice(0, 10);
  return `${brand}_${fmt}_${date}${i != null ? `_${i + 1}` : ''}.${ext}`;
}

const extOf = (a: Asset) => (a.kind === 'video' ? (a.mime?.includes('quicktime') ? 'mov' : 'mp4') : a.mime?.includes('png') ? 'png' : 'jpg');

const IG_FROM_TARGET: Record<string, string> = { ig_feed_square: 'feed_image', ig_feed_portrait: 'feed_image', ig_story: 'story_image', ig_reel: 'reel' };

const isMock = (a: { provider: string | null; source: string; url: string | null }) =>
  a.provider === 'mock' || a.source === 'mock' || /picsum\.photos/i.test(a.url ?? '');

/**
 * Ações da Biblioteca de mídia (`media/export.functions.ts` + `media/manage.functions.ts` + `library.server.ts`).
 * Toda leitura/escrita é filtrada por `workspace_id` (o protótipo usava o service role + esse filtro).
 */
@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly assets: AssetsService,
    private readonly images: ImageService,
    private readonly files: FilesService,
  ) {}

  /** `requireMember` de `export.functions.ts` (mensagens próprias dessas funções). */
  private async member(userId: string, workspaceId: string, edit = false): Promise<void> {
    const role = await this.access.roleOf(userId, workspaceId);
    if (!role) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem acesso a esta área de trabalho.' });
    if (edit && !EDITORS.includes(role)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Seu papel não permite esta ação.' });
  }

  private async loadAssets(workspaceId: string, ids: string[]): Promise<Asset[]> {
    const rows = await this.prisma.media_assets.findMany({
      where: { workspace_id: workspaceId, id: { in: ids } },
      include: { brand: { select: { name: true } } },
    });
    return ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as Asset[];
  }

  // ------------------------------------------------------------------ downloads e exportações

  async downloadAsset(userId: string, workspaceId: string, assetId: string, format: 'original' | 'png' | 'jpg' = 'original') {
    await this.member(userId, workspaceId);
    const [a] = await this.loadAssets(workspaceId, [assetId]);
    if (!a) throw notFound('Mídia não encontrada.');
    if (a.kind === 'video' || format === 'original') {
      const name = fileName(a, extOf(a));
      if (a.storage_path) return { url: this.assets.downloadUrl(a.storage_path, name), name };
      const { bytes } = await this.assets.readBytes(a);
      const url = await this.assets.storeForDownload(`exports/${workspaceId}/${randomUUID()}_${name}`, bytes, name);
      return { url, name };
    }
    const { bytes } = await this.assets.readBytes(a);
    const out = await this.images.convert(bytes, format);
    const name = fileName(a, format);
    return { url: await this.assets.storeForDownload(`exports/${workspaceId}/${randomUUID()}_${name}`, out, name), name };
  }

  async exportZip(userId: string, workspaceId: string, ids: string[]) {
    await this.member(userId, workspaceId);
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    let total = 0;
    const list = await this.loadAssets(workspaceId, ids);
    for (const [i, a] of list.entries()) {
      const { bytes } = await this.assets.readBytes(a);
      total += bytes.length;
      if (total > MAX_ZIP_BYTES) throw new UserError('Seleção grande demais para um ZIP (limite de 250 MB). Selecione menos itens.');
      zip.file(fileName(a, extOf(a), i), bytes);
    }
    const data = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    const name = `biblioteca_${todaySp()}.zip`;
    return { url: await this.assets.storeForDownload(`exports/${workspaceId}/${randomUUID()}_${name}`, data, name), name, count: list.length };
  }

  async exportPdf(userId: string, workspaceId: string, ids: string[], layout: 'one_per_page' | 'contact_sheet') {
    await this.member(userId, workspaceId);
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const list = await this.loadAssets(workspaceId, ids);
    const safe = (t: string) => t.replace(/[^\x20-\x7E -ÿ]/g, '').slice(0, 90);

    const imageFor = async (a: Asset) => {
      if (a.kind === 'video') return null;
      const src = a.thumbnail_path && layout === 'contact_sheet' ? { storage_path: a.thumbnail_path, url: null } : a;
      const { bytes } = await this.assets.readBytes(src);
      return pdf.embedJpg(await this.images.convert(bytes, 'jpg'));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const videoBox = (page: any, x: number, y: number, w: number, h: number) => {
      page.drawRectangle({ x, y, width: w, height: h, color: rgb(0.03, 0.11, 0.22) });
      const label = 'VIDEO';
      const size = Math.max(10, Math.min(w, h) / 8);
      page.drawText(label, { x: x + w / 2 - bold.widthOfTextAtSize(label, size) / 2, y: y + h / 2 - size / 2, size, font: bold, color: rgb(0.07, 0.74, 0.65) });
    };

    if (layout === 'one_per_page') {
      for (const a of list) {
        const img = await imageFor(a);
        const w = a.width ?? 1080;
        const h = a.height ?? 1080;
        // 1 px = 0,75 pt (96 dpi) → página no tamanho real da peça.
        const page = pdf.addPage([w * 0.75, h * 0.75]);
        if (img) page.drawImage(img, { x: 0, y: 0, width: w * 0.75, height: h * 0.75 });
        else videoBox(page, 0, 0, w * 0.75, h * 0.75);
      }
    } else {
      const [PW, PH] = [595.28, 841.89];
      const cols = 2;
      const rows = 3;
      const margin = 36;
      const cellW = (PW - margin * 2 - 18) / cols;
      const cellH = (PH - margin * 2 - 30 - 18 * (rows - 1)) / rows;
      for (let i = 0; i < list.length; i += cols * rows) {
        const page = pdf.addPage([PW, PH]);
        page.drawText('Biblioteca de mídia · Meu Funil', { x: margin, y: PH - margin - 12, size: 12, font: bold });
        for (let j = 0; j < cols * rows && i + j < list.length; j++) {
          const a = list[i + j]!;
          const c = j % cols;
          const r = Math.floor(j / cols);
          const x = margin + c * (cellW + 18);
          const top = PH - margin - 30 - r * (cellH + 18);
          const boxH = cellH - 40;
          const ratio = (a.width ?? 1) / (a.height ?? 1);
          let iw = cellW;
          let ih = iw / ratio;
          if (ih > boxH) {
            ih = boxH;
            iw = ih * ratio;
          }
          const ix = x + (cellW - iw) / 2;
          const iy = top - ih;
          const img = await imageFor(a);
          if (img) page.drawImage(img, { x: ix, y: iy, width: iw, height: ih });
          else videoBox(page, ix, iy, iw, ih);
          const fmt = (TARGET_FORMATS as Record<string, { short: string }>)[a.target_format]?.short ?? 'Outro';
          page.drawText(safe(a.title ?? 'Mídia'), { x, y: top - boxH - 14, size: 9, font: bold });
          page.drawText(safe(`${fmt} · ${a.width ?? '?'}x${a.height ?? '?'}${a.duration_seconds ? ` · ${Number(a.duration_seconds)}s` : ''}`), {
            x, y: top - boxH - 26, size: 8, font, color: rgb(0.35, 0.4, 0.5),
          });
          if (a.prompt) page.drawText(safe(a.prompt), { x, y: top - boxH - 37, size: 7, font, color: rgb(0.45, 0.5, 0.6) });
        }
      }
    }
    const bytes = await pdf.save();
    const name = `biblioteca_${layout === 'one_per_page' ? 'impressao' : 'folha-de-contato'}_${todaySp()}.pdf`;
    return { url: await this.assets.storeForDownload(`exports/${workspaceId}/${randomUUID()}_${name}`, bytes, name), name };
  }

  // ------------------------------------------------------------------ envio e reformatação

  async upload(
    userId: string,
    workspaceId: string,
    file: { filename: string; mimetype: string; bytes: Buffer },
    opts: { target: TargetFormat; brandId?: string | null; campaignId?: string | null },
  ) {
    await this.member(userId, workspaceId, true);
    const video = file.mimetype.startsWith('video/');
    if (!video && !file.mimetype.startsWith('image/')) throw new UserError(`${file.filename}: envie imagem ou vídeo.`);
    if (file.bytes.length > MAX_UPLOAD_BYTES) throw new UserError(`${file.filename}: arquivo maior que 100 MB.`);
    if (opts.brandId && !(await this.prisma.brands.findFirst({ where: { id: opts.brandId, workspace_id: workspaceId }, select: { id: true } }))) {
      throw notFound('Marca não encontrada.');
    }
    if (opts.campaignId && !(await this.prisma.campaigns.findFirst({ where: { id: opts.campaignId, workspace_id: workspaceId }, select: { id: true } }))) {
      throw notFound('Campanha não encontrada.');
    }
    const a = await this.assets.ingest({
      workspaceId,
      kind: video ? 'video' : 'image',
      targetFormat: opts.target,
      source: 'upload',
      bytes: new Uint8Array(file.bytes),
      mime: file.mimetype,
      title: file.filename.replace(/\.[^.]+$/, ''),
      createdBy: userId,
      brandId: opts.brandId ?? null,
      campaignId: opts.campaignId ?? null,
    });
    return { id: a.id, igReady: a.ig_ready, issues: ((a.quality_report as { issues?: string[] } | null)?.issues ?? []) as string[] };
  }

  async reformat(userId: string, workspaceId: string, assetId: string, targets: TargetFormat[]) {
    await this.member(userId, workspaceId, true);
    const [a] = await this.loadAssets(workspaceId, [assetId]);
    if (!a) throw notFound('Mídia não encontrada.');
    const out: string[] = [];
    for (const t of targets) out.push((await this.assets.reformat(workspaceId, assetId, t, userId)).id);
    return { ids: out };
  }

  // ------------------------------------------------------------------ usar a mídia

  /** Cria um post rascunho no Instagram com as mídias escolhidas. */
  async useInInstagram(userId: string, workspaceId: string, ids: string[]) {
    await this.member(userId, workspaceId, true);
    const list = await this.loadAssets(workspaceId, ids);
    if (!list.length) throw new UserError('Selecione ao menos uma mídia.');
    const first = list[0]!;
    let format =
      first.kind === 'video' ? (first.target_format === 'ig_story' ? 'story_video' : 'reel') : (IG_FROM_TARGET[first.target_format] ?? 'feed_image');
    if (list.length > 1) format = 'feed_carousel';
    const media = list.slice(0, 10).map((a, i) => ({
      url: a.url, type: a.kind, order: i, width: a.width, height: a.height,
      duration: a.duration_seconds == null ? null : Number(a.duration_seconds), asset_id: a.id, ig_ready: a.ig_ready,
    }));
    const post = await this.prisma.ig_posts.create({
      data: { workspace_id: workspaceId, format, status: 'idea', theme: first.title, media, creative_brief: { from_library: ids } },
      select: { id: true },
    });
    await this.prisma.media_assets.updateMany({ where: { workspace_id: workspaceId, id: { in: list.map((a) => a.id) } }, data: { ig_post_id: post.id } });
    return { postId: post.id, format };
  }

  /** Cria criativos aprovados na campanha a partir das mídias. */
  async useInCampaign(userId: string, workspaceId: string, ids: string[], campaignId: string) {
    await this.member(userId, workspaceId, true);
    const camp = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: workspaceId }, select: { id: true, brand_id: true } });
    if (!camp) throw notFound('Campanha não encontrada.');
    const list = await this.loadAssets(workspaceId, ids);
    let n = 0;
    for (const a of list) {
      const cr = await this.prisma.creatives.create({
        data: {
          workspace_id: workspaceId, campaign_id: campaignId, brand_id: a.brand_id ?? camp.brand_id, title: a.title,
          type: a.kind === 'video' ? 'video' : 'static_image', aspect_ratio: a.aspect_ratio, prompt: a.prompt, status: 'approved',
          provider: a.provider ?? a.source, preview_url: a.url, thumbnail_url: a.thumbnail_url, version: 1,
        },
        select: { id: true },
      });
      await this.prisma.media_assets.update({ where: { id: a.id }, data: { campaign_id: campaignId, creative_id: cr.id, status: 'approved' } });
      n++;
    }
    return { count: n };
  }

  /** Anexa mídia(s) da biblioteca a um post do Instagram (substitui a mídia atual). */
  async attachToPost(userId: string, workspaceId: string, postId: string, ids: string[]) {
    await this.member(userId, workspaceId, true);
    const post = await this.prisma.ig_posts.findFirst({ where: { id: postId, workspace_id: workspaceId }, select: { id: true, format: true } });
    if (!post) throw new UserError('Post não encontrado.');
    const list = await this.loadAssets(workspaceId, ids);
    const badOnes = list.filter((a) => !a.ig_ready);
    if (badOnes.length) {
      const issues = ((badOnes[0]!.quality_report as { issues?: string[] } | null)?.issues ?? []).join(' ');
      throw new UserError(`Mídia não está pronta para o Instagram: ${issues || 'sem validação.'}`);
    }
    const media = list.slice(0, post.format === 'feed_carousel' ? 10 : 1).map((a, i) => ({
      url: a.url, type: a.kind, order: i, width: a.width, height: a.height,
      duration: a.duration_seconds == null ? null : Number(a.duration_seconds), asset_id: a.id, ig_ready: a.ig_ready,
    }));
    await this.prisma.ig_posts.update({ where: { id: postId }, data: { media } });
    await this.prisma.media_assets.updateMany({ where: { workspace_id: workspaceId, id: { in: list.map((a) => a.id) } }, data: { ig_post_id: postId } });
    return { ok: true, items: media.length };
  }

  /** Baixa o arquivo, recalcula medidas, refaz a validação do Instagram e regrava a miniatura. */
  async revalidate(userId: string, workspaceId: string, ids: string[]) {
    await this.member(userId, workspaceId, true);
    const rows = await this.prisma.media_assets.findMany({ where: { workspace_id: workspaceId, id: { in: ids } } });
    const results: { id: string; ok: boolean; archived?: boolean; error?: string }[] = [];
    for (const a of rows) {
      try {
        if (isMock(a)) {
          await this.prisma.media_assets.update({ where: { id: a.id }, data: { status: 'archived', ig_ready: false } });
          results.push({ id: a.id, ok: false, archived: true });
          continue;
        }
        const { bytes } = await this.assets.readBytes(a);
        const target = (a.target_format ?? 'other') as TargetFormat;
        const stamp = new Date().toISOString();
        const patch: Prisma.media_assetsUncheckedUpdateInput = { size_bytes: bytes.length };
        let igReady = false;
        if (a.kind === 'video') {
          const meta = readVideoMeta(bytes);
          const report = validateVideoForInstagram(meta, target);
          igReady = report.ok;
          Object.assign(patch, { width: meta.width, height: meta.height, duration_seconds: meta.duration, ig_ready: report.ok, quality_report: { ...report, revalidated_at: stamp } });
        } else {
          const { width, height } = await this.images.size(bytes);
          const report = validateImageForInstagram(width, height, target);
          igReady = report.ok;
          const thumbPath = `${(a.storage_path ?? `media/${a.workspace_id}/${a.id}`).replace(/\.[^./]+$/, '')}_thumb.jpg`;
          const thumbUrl = await this.assets.storeBytes(thumbPath, await this.images.thumb(bytes));
          Object.assign(patch, { width, height, ig_ready: report.ok, quality_report: { ...report, revalidated_at: stamp }, thumbnail_path: thumbPath, thumbnail_url: thumbUrl });
        }
        await this.prisma.media_assets.update({ where: { id: a.id }, data: patch });
        results.push({ id: a.id, ok: igReady });
      } catch (e) {
        results.push({ id: a.id, ok: false, error: e instanceof Error ? e.message : 'falhou' });
      }
    }
    return {
      total: results.length,
      ready: results.filter((r) => r.ok).length,
      archived: results.filter((r) => r.archived).length,
      failed: results.filter((r) => r.error).length,
      results,
    };
  }

  // ------------------------------------------------------------------ gestão (manage.functions.ts)

  /** Exclui de verdade (arquivo + registro). Versões filhas ficam soltas, não somem. */
  async deleteAssets(userId: string, workspaceId: string, ids: string[]) {
    await this.access.require(userId, workspaceId, 'write');
    const rows = await this.prisma.media_assets.findMany({
      where: { workspace_id: workspaceId, id: { in: ids } },
      select: { id: true, storage_path: true, thumbnail_path: true },
    });
    if (!rows.length) return { deleted: 0 };
    for (const p of rows.flatMap((r) => [r.storage_path, r.thumbnail_path]).filter(Boolean) as string[]) {
      await this.files.delete(MEDIA_BUCKET, p).catch(() => undefined);
    }
    const rowIds = rows.map((r) => r.id);
    await this.prisma.media_assets.updateMany({ where: { workspace_id: workspaceId, parent_id: { in: rowIds } }, data: { parent_id: null } });
    await this.prisma.media_assets.deleteMany({ where: { workspace_id: workspaceId, id: { in: rowIds } } });
    return { deleted: rows.length };
  }

  /** Renomeia (ou remove, com "to" vazio) uma tag em todas as mídias da empresa. */
  async renameTag(userId: string, workspaceId: string, from: string, to: string) {
    await this.access.require(userId, workspaceId, 'write');
    const rows = await this.prisma.media_assets.findMany({ where: { workspace_id: workspaceId, tags: { has: from } }, select: { id: true, tags: true } });
    const next = to.trim();
    for (const r of rows) {
      const tags = [...new Set(r.tags.map((t) => (t === from ? next : t)).filter(Boolean))];
      await this.prisma.media_assets.update({ where: { id: r.id }, data: { tags } });
    }
    return { updated: rows.length };
  }

  /** Renomeia uma pasta (ou desfaz, com "to" vazio) em todas as mídias da empresa. */
  async renameFolder(userId: string, workspaceId: string, from: string, to: string) {
    await this.access.require(userId, workspaceId, 'write');
    const r = await this.prisma.media_assets.updateMany({ where: { workspace_id: workspaceId, folder: from }, data: { folder: to.trim() || null } });
    return { updated: r.count };
  }

  /** Resultados da mídia nos anúncios (pelo criativo ligado a ela). */
  async adResults(userId: string, workspaceId: string, creativeId: string) {
    await this.access.require(userId, workspaceId, 'read');
    const rows = await this.prisma.performance_daily.findMany({
      where: { workspace_id: workspaceId, source: { not: 'demo' }, creative_id: creativeId },
      select: { spend: true, impressions: true, clicks: true, leads: true, conversions: true, revenue: true, campaign: { select: { name: true } } },
    });
    const t = { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0, revenue: 0 };
    const names = new Set<string>();
    for (const r of rows) {
      t.spend += Number(r.spend);
      t.impressions += Number(r.impressions);
      t.clicks += Number(r.clicks);
      t.leads += Number(r.leads);
      t.conversions += Number(r.conversions);
      t.revenue += Number(r.revenue);
      if (r.campaign?.name) names.add(r.campaign.name);
    }
    return { ...t, campaigns: [...names], days: rows.length };
  }
}
