import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AssetsService } from '../media/assets.service';
import { targetForIgFormat } from '../media/formats';
import { UserError } from '../media/user-error';
import { IgFormat } from './ig-types';
import { IgStore, errText } from './ig-store.service';
import { MetaGraphClient } from './meta-graph';
import { MetricsService } from './metrics.service';

export function formatFromMeta(mediaType?: string, product?: string): IgFormat {
  if (product === 'STORY') return mediaType === 'VIDEO' ? 'story_video' : 'story_image';
  if (mediaType === 'CAROUSEL_ALBUM') return 'feed_carousel';
  if (mediaType === 'VIDEO' || product === 'REELS') return 'reel';
  return 'feed_image';
}

/** Conta do Instagram: conectar/trocar, listar Páginas, desconectar e importar o histórico. */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly store: IgStore,
    private readonly graph: MetaGraphClient,
    private readonly metrics: MetricsService,
    private readonly assets: AssetsService,
  ) {}

  private get prisma() {
    return this.store.prisma;
  }

  async connectInstagramAccount(workspaceId: string, pageIdOverride?: string | null) {
    const r = await this.connectInner(workspaceId, pageIdOverride);
    if (r.ok) {
      // Importa o histórico recente logo após conectar (não bloqueia a conexão se falhar).
      await this.syncInstagramHistory(workspaceId).catch((e) => this.logger.error(`[ig-sync] ${errText(e)}`));
    }
    return r;
  }

  private async connectInner(workspaceId: string, pageIdOverride?: string | null): Promise<{ ok: true; username: string | null; igUserId: string } | { ok: false; error: string }> {
    const cfg = await this.graph.config(workspaceId);
    const pageId = pageIdOverride || cfg.pageId;
    try {
      if (!cfg.token) throw new Error('Salve as credenciais da Meta em Integrações antes de conectar o Instagram.');
      if (!pageId) throw new Error('ID da Página do Facebook não configurado.');
      const page = await this.graph.graph<{ instagram_business_account?: { id: string } }>(workspaceId, `/${pageId}`, { params: { fields: 'instagram_business_account' } });
      const igId = page.instagram_business_account?.id;
      if (!igId) throw new Error('Esta Página não tem uma conta profissional do Instagram vinculada.');
      const ig = await this.graph.graph<{ username?: string; profile_picture_url?: string }>(workspaceId, `/${igId}`, { params: { fields: 'username,profile_picture_url' } });
      const row = {
        ig_user_id: igId,
        username: ig.username ?? null,
        facebook_page_id: pageId,
        profile_picture_url: ig.profile_picture_url ?? null,
        status: 'connected',
        last_error: null,
        connected_at: new Date(),
      };
      await this.prisma.instagram_accounts.upsert({ where: { workspace_id: workspaceId }, create: { workspace_id: workspaceId, ...row }, update: row });
      return { ok: true, username: row.username, igUserId: igId };
    } catch (e) {
      await this.prisma.instagram_accounts.upsert({
        where: { workspace_id: workspaceId },
        create: { workspace_id: workspaceId, facebook_page_id: pageId, status: 'error', last_error: errText(e) },
        update: { facebook_page_id: pageId, status: 'error', last_error: errText(e) },
      });
      return { ok: false, error: errText(e) };
    }
  }

  /** Lista as Páginas acessíveis pelo token da Meta e o Instagram vinculado a cada uma. */
  async listInstagramOptions(workspaceId: string) {
    const cfg = await this.graph.config(workspaceId);
    if (!cfg.token) return { ok: false as const, error: 'Salve as credenciais da Meta em Integrações primeiro.', options: [] };
    try {
      const r = await this.graph.graph<{
        data?: { id: string; name: string; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }[];
      }>(workspaceId, '/me/accounts', { params: { fields: 'id,name,instagram_business_account{id,username,profile_picture_url}', limit: '100' } });
      const options = (r.data ?? []).map((p) => ({
        pageId: p.id,
        pageName: p.name,
        igUserId: p.instagram_business_account?.id ?? null,
        username: p.instagram_business_account?.username ?? null,
        picture: p.instagram_business_account?.profile_picture_url ?? null,
      }));
      return { ok: true as const, options };
    } catch (e) {
      return { ok: false as const, error: errText(e), options: [] };
    }
  }

  async disconnectInstagramAccount(workspaceId: string) {
    await this.prisma.instagram_accounts.deleteMany({ where: { workspace_id: workspaceId } });
    return { ok: true as const };
  }

  /** Importa os últimos 30 itens publicados na conta e coleta os insights de cada um. */
  async syncInstagramHistory(workspaceId: string) {
    const acc = await this.store.liveAccount(workspaceId);
    if (!acc) throw new UserError('Conecte uma conta do Instagram antes de importar o histórico.');
    const r = await this.graph.graph<{ data?: any[] }>(workspaceId, `/${acc.ig_user_id}/media`, {
      params: { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url', limit: '30' },
    });
    const items = (r.data ?? []).slice(0, 30);
    const existing = await this.prisma.ig_posts.findMany({
      where: { workspace_id: workspaceId, ig_media_id: { in: items.length ? items.map((i) => i.id) : ['-'] } },
      select: { id: true, ig_media_id: true },
    });
    const known = new Map(existing.map((e) => [e.ig_media_id as string, e.id]));
    const fresh = items.filter((i) => !known.has(i.id));
    let imported = 0;
    if (fresh.length) {
      const rows: Prisma.ig_postsCreateManyInput[] = fresh.map((i) => {
        const caption = String(i.caption ?? '');
        const hashtags = [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.slice(1)))].slice(0, 30);
        const video = i.media_type === 'VIDEO';
        const ts = i.timestamp ? new Date(i.timestamp) : new Date();
        return {
          workspace_id: workspaceId,
          format: formatFromMeta(i.media_type, i.media_product_type),
          status: 'published',
          source: 'instagram_import',
          ig_media_id: i.id,
          ig_permalink: i.permalink ?? null,
          published_at: isNaN(ts.getTime()) ? new Date() : ts,
          caption: caption.replace(/#[\p{L}\p{N}_]+/gu, '').trim().slice(0, 2200) || null,
          hashtags,
          theme: caption.split('\n')[0]?.slice(0, 120) || 'Post importado',
          media: [{ url: i.media_url ?? i.thumbnail_url ?? null, thumbnail_url: i.thumbnail_url ?? null, type: video ? 'video' : 'image', order: 0 }],
          creative_brief: { imported: true },
          metrics_collected: ['1h', '24h', '7d'],
        };
      });
      const ins = await this.prisma.ig_posts.createManyAndReturn({ data: rows, select: { id: true, ig_media_id: true } });
      for (const x of ins) known.set(x.ig_media_id as string, x.id);
      imported = ins.length;
      // Os posts antigos também entram na Biblioteca (o link do Instagram expira; o arquivo fica salvo).
      for (const i of fresh) {
        const url = i.media_url ?? i.thumbnail_url;
        if (!url) continue;
        try {
          const format = formatFromMeta(i.media_type, i.media_product_type);
          const video = i.media_type === 'VIDEO' && !!i.media_url;
          await this.assets.ingest({
            workspaceId,
            kind: video ? 'video' : 'image',
            targetFormat: targetForIgFormat(format),
            source: 'instagram',
            sourceUrl: url,
            title: String(i.caption ?? 'Post do Instagram').split('\n')[0]!.slice(0, 120) || 'Post do Instagram',
            prompt: null,
            provider: 'instagram',
            igPostId: known.get(i.id) ?? null,
            normalize: false,
            status: 'approved',
          });
        } catch (e) {
          this.logger.warn(`[ig-sync] mídia não foi para a biblioteca ${i.id}: ${errText(e)}`);
        }
      }
    }
    let metrics = 0;
    for (const id of known.values()) {
      try {
        await this.metrics.collectPostMetrics(id, 'import');
        metrics++;
      } catch (e) {
        this.logger.error(`[ig-sync] métricas ${id}: ${errText(e)}`);
      }
    }
    return { ok: true as const, imported, total: items.length, metrics };
  }
}
