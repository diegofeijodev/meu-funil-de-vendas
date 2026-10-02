import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { MediaListQueryDto } from './media.dto';
import { notFound } from './user-error';

/** Termo da busca como a tela sanitiza (`[%,()]` viram espaço). */
export const sanitizeSearch = (t: string) => t.replace(/[%,()]/g, ' ').trim();

/** `.eq/.or/.neq/.contains/.gte` da tela, num `where` do Prisma (sempre com `workspace_id`). */
export function buildMediaWhere(workspaceId: string, q: MediaListQueryDto, now = Date.now()): Prisma.media_assetsWhereInput {
  const where: Prisma.media_assetsWhereInput = { workspace_id: workspaceId };
  const term = q.search ? sanitizeSearch(q.search) : '';
  if (term) where.OR = [{ title: { contains: term, mode: 'insensitive' } }, { prompt: { contains: term, mode: 'insensitive' } }];
  if (q.brand_id) where.brand_id = q.brand_id;
  if (q.campaign_id) where.campaign_id = q.campaign_id;
  if (q.kind) where.kind = q.kind;
  if (q.target_format) where.target_format = q.target_format;
  if (q.folder) where.folder = q.folder;
  if (q.source) where.source = q.source;
  if (q.status === 'active') where.status = { not: 'archived' };
  else if (q.status) where.status = q.status;
  if (q.tag) where.tags = { has: q.tag };
  if (q.period) where.created_at = { gte: new Date(now - q.period * 86_400_000) };
  return where;
}

export function mediaOrderBy(sort: MediaListQueryDto['sort']): Prisma.media_assetsOrderByWithRelationInput {
  switch (sort) {
    case 'old': return { created_at: 'asc' };
    case 'title': return { title: 'asc' };
    case 'size': return { size_bytes: { sort: 'desc', nulls: 'last' } };
    default: return { created_at: 'desc' };
  }
}

/** Leituras diretas da tela `/library` e do `MediaPicker` (antes `supabase.from("media_assets")` com RLS). */
@Injectable()
export class MediaQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** `select *, brands(name), campaigns(name)` com `count: exact` — devolve `{ rows, count }`. */
  async list(workspaceId: string, q: MediaListQueryDto) {
    const where = buildMediaWhere(workspaceId, q);
    const [rows, count] = await Promise.all([
      this.prisma.media_assets.findMany({
        where,
        orderBy: [mediaOrderBy(q.sort), { id: 'asc' }],
        take: q.limit ?? 60,
        include: { brand: { select: { name: true } }, campaign: { select: { name: true } } },
      }),
      this.prisma.media_assets.count({ where }),
    ]);
    return { rows: rows.map(({ brand, campaign, ...a }) => ({ ...a, brands: brand, campaigns: campaign })), count };
  }

  /** Facetas de tags/pastas: `select tags,folder` limit 5000 (a tela tira os únicos). */
  facets(workspaceId: string) {
    return this.prisma.media_assets.findMany({ where: { workspace_id: workspaceId }, select: { tags: true, folder: true }, take: 5000 });
  }

  /** `update({status|folder}).in('id', picked)` — só ids do workspace. */
  async bulkUpdate(workspaceId: string, ids: string[], patch: { status?: string; folder?: string | null }) {
    const data: Prisma.media_assetsUncheckedUpdateManyInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.folder !== undefined) data.folder = patch.folder?.trim() ? patch.folder.trim() : null;
    if (!Object.keys(data).length) return { updated: 0 };
    const r = await this.prisma.media_assets.updateMany({ where: { workspace_id: workspaceId, id: { in: ids } }, data });
    return { updated: r.count };
  }

  /** `update({tags}).eq('id', id)`. */
  async setTags(workspaceId: string, id: string, tags: string[]) {
    const a = await this.prisma.media_assets.findFirst({ where: { id, workspace_id: workspaceId }, select: { id: true } });
    if (!a) throw notFound('Mídia não encontrada.');
    const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    return this.prisma.media_assets.update({ where: { id }, data: { tags: clean } });
  }

  /** Aba "Textos" da biblioteca: `copies select id,version,status,angle,created_at,content,campaigns(name,brand_id)` limit 300. */
  async copies(workspaceId: string) {
    const rows = await this.prisma.copies.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      take: 300,
      select: { id: true, version: true, status: true, angle: true, created_at: true, content: true, campaign: { select: { name: true, brand_id: true } } },
    });
    return rows.map(({ campaign, ...c }) => ({ ...c, campaigns: campaign }));
  }
}
