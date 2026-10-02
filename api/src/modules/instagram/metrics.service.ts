import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserError } from '../media/user-error';
import { IgFormat, PostRow } from './ig-types';
import { IgStore, errText } from './ig-store.service';
import { MetaGraphClient } from './meta-graph';

// Métricas atuais da Graph API (v22+): impressions/plays/exits foram descontinuadas; "views" substitui.
const METRICS: Record<IgFormat, string[]> = {
  reel: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'ig_reels_avg_watch_time'],
  feed_image: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'profile_visits'],
  feed_carousel: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
  story_image: ['views', 'reach', 'replies', 'shares', 'total_interactions', 'navigation'],
  story_video: ['views', 'reach', 'replies', 'shares', 'total_interactions', 'navigation'],
};
const ESSENTIAL: Record<'story' | 'post', string[]> = {
  story: ['views', 'reach', 'replies'],
  post: ['views', 'reach', 'likes', 'comments', 'saved', 'shares'],
};
const WINDOWS: [string, number][] = [['1h', 3600e3], ['24h', 24 * 3600e3], ['7d', 7 * 24 * 3600e3]];
// Stories somem em 24 h: coleta com 1 h e com 20 h (antes de expirar).
const STORY_WINDOWS: [string, number][] = [['1h', 3600e3], ['20h', 20 * 3600e3]];

/** Métricas dos posts, insights da conta e aprendizado com os melhores posts. */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    private readonly store: IgStore,
    private readonly graph: MetaGraphClient,
  ) {}

  private get prisma() {
    return this.store.prisma;
  }

  async collectPostMetrics(postId: string, label?: string, workspaceId?: string) {
    const post = await this.store.getPost(postId, workspaceId);
    if (!post.ig_media_id) throw new UserError('Post ainda não publicado.');
    if (String(post.ig_media_id).startsWith('sim_')) throw new UserError('Post antigo do modo simulado: não existe no Instagram.');
    const ws: string = post.workspace_id;
    const values: Record<string, number> = {};
    const story = String(post.format).startsWith('story');
    let raw: any;
    try {
      raw = await this.graph.graph(ws, `/${post.ig_media_id}/insights`, { params: { metric: METRICS[post.format as IgFormat].join(',') } });
    } catch {
      // Alguma métrica não vale para este tipo de mídia/conta: tenta o conjunto essencial.
      raw = await this.graph.graph(ws, `/${post.ig_media_id}/insights`, { params: { metric: ESSENTIAL[story ? 'story' : 'post'].join(',') } });
    }
    for (const m of raw?.data ?? []) {
      if (m.name === 'navigation') {
        // navigation vem quebrado por tipo (avançar, voltar, sair): guarda o total e cada parte.
        for (const b of m.total_value?.breakdowns?.[0]?.results ?? []) values[`navigation_${String(b.dimension_values?.[0] ?? '').toLowerCase()}`] = Number(b.value ?? 0);
        values['navigation'] = Number(m.total_value?.value ?? 0);
        continue;
      }
      values[m.name] = Number(m.values?.[0]?.value ?? m.total_value?.value ?? 0);
    }
    await this.prisma.ig_post_metrics.create({
      data: {
        workspace_id: ws,
        post_id: postId,
        reach: values['reach'] ?? null,
        impressions: values['views'] ?? null,
        likes: values['likes'] ?? null,
        comments: values['comments'] ?? (story ? (values['replies'] ?? null) : null),
        saves: values['saved'] ?? null,
        shares: values['shares'] ?? null,
        plays: values['views'] ?? null,
        profile_visits: values['profile_visits'] ?? null,
        raw: { label: label ?? 'manual', ...values, response: raw } as Prisma.InputJsonObject,
      },
    });
    if (label) await this.store.patchPost(postId, { metrics_collected: [...((post.metrics_collected as string[]) ?? []), label] });
    return { ok: true, values };
  }

  async collectDueMetrics() {
    const since = new Date(Date.now() - 8 * 24 * 3600e3);
    const posts = await this.prisma.ig_posts.findMany({
      where: { status: 'published', published_at: { gte: since } },
      select: { id: true, format: true, published_at: true, metrics_collected: true, ig_media_id: true },
      take: 200,
    });
    let done = 0;
    for (const p of posts) {
      if (String(p.ig_media_id ?? '').startsWith('sim_')) continue;
      const age = Date.now() - p.published_at!.getTime();
      const story = String(p.format).startsWith('story');
      if (story && age > 23.5 * 3600e3) continue;
      const collected = (p.metrics_collected as string[]) ?? [];
      const due = (story ? STORY_WINDOWS : WINDOWS).filter(([l, ms]) => age >= ms && !collected.includes(l)).pop();
      if (!due) continue;
      try {
        await this.collectPostMetrics(p.id, due[0]);
        done++;
      } catch (e) {
        this.logger.error(`[instagram] métricas falharam: ${errText(e)}`);
      }
    }
    return done;
  }

  /** Seguidores e métricas diárias da conta (últimos 30 dias), salvos em ig_account_insights. */
  async collectAccountInsights(workspaceId: string): Promise<{ days: number; followers: number | null } | { skipped: string }> {
    const acc = await this.store.liveAccount(workspaceId);
    if (!acc) return { skipped: 'sem conta conectada' };
    const ig = acc.ig_user_id as string;
    const profile = await this.graph.graph<{ followers_count?: number; follows_count?: number; media_count?: number; username?: string }>(workspaceId, `/${ig}`, {
      params: { fields: 'followers_count,follows_count,media_count,username' },
    });
    const until = Math.floor(Date.now() / 1000);
    const since = until - 29 * 86400;
    const daily: Record<string, Record<string, number>> = {};
    // reach e follower_count são séries diárias; views/profile_views/website_clicks vêm por dia com total_value.
    const series = await this.graph
      .graph<{ data?: any[] }>(workspaceId, `/${ig}/insights`, { params: { metric: 'reach,follower_count', period: 'day', since, until } })
      .catch(() => ({ data: [] as any[] }));
    for (const m of series.data ?? [])
      for (const v of m.values ?? []) {
        const d = String(v.end_time ?? '').slice(0, 10);
        if (!d) continue;
        daily[d] = { ...(daily[d] ?? {}), [m.name]: Number(v.value ?? 0) };
      }
    // Métricas de total por dia: 1 chamada por dia e métrica, então só os dias que ainda faltam (máx. 7).
    const have = await this.prisma.ig_account_insights.count({ where: { workspace_id: workspaceId } });
    const backDays = have > 0 ? 2 : 7;
    for (const metric of ['views', 'profile_views', 'website_clicks', 'accounts_engaged', 'total_interactions']) {
      for (let day = 0; day < backDays; day += 1) {
        const dSince = until - (backDays - day) * 86400;
        const r = await this.graph
          .graph<{ data?: any[] }>(workspaceId, `/${ig}/insights`, { params: { metric, period: 'day', metric_type: 'total_value', since: dSince, until: dSince + 86400 } })
          .catch(() => null);
        const val = r?.data?.[0]?.total_value?.value;
        if (val === undefined) {
          if (day === 0) break; // métrica indisponível nesta conta
          continue;
        }
        const d = new Date((dSince + 86400) * 1000).toISOString().slice(0, 10);
        daily[d] = { ...(daily[d] ?? {}), [metric]: Number(val) };
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    daily[today] = { ...(daily[today] ?? {}), followers_total: Number(profile.followers_count ?? 0) };
    const rows = Object.entries(daily).map(([date, v]) => ({
      date,
      followers_total: v['followers_total'] ?? null,
      new_followers: v['follower_count'] ?? null,
      reach: v['reach'] ?? null,
      views: v['views'] ?? null,
      profile_views: v['profile_views'] ?? null,
      website_clicks: v['website_clicks'] ?? null,
      accounts_engaged: v['accounts_engaged'] ?? null,
      interactions: v['total_interactions'] ?? null,
    }));
    for (const r of rows) {
      const date = new Date(`${r.date}T12:00:00Z`);
      const { date: _d, ...rest } = r;
      await this.prisma.ig_account_insights.upsert({
        where: { workspace_id_date: { workspace_id: workspaceId, date } },
        create: { workspace_id: workspaceId, date, ...rest },
        update: rest,
      });
    }
    return { days: rows.length, followers: profile.followers_count ?? null };
  }

  async collectAllAccountInsights() {
    const accounts = await this.prisma.instagram_accounts.findMany({ where: { status: 'connected' }, select: { workspace_id: true } });
    const out: { workspace: string; days?: number; error?: string }[] = [];
    for (const r of accounts) {
      try {
        const x = await this.collectAccountInsights(r.workspace_id);
        out.push({ workspace: r.workspace_id, days: (x as { days?: number }).days ?? 0 });
      } catch (e) {
        out.push({ workspace: r.workspace_id, error: errText(e) });
      }
    }
    return out;
  }

  /** Aprendizado: prompts dos posts no top 20% (alcance + salvamentos) viram exemplos da marca. */
  async learnFromTopPosts() {
    const rows = await this.prisma.ig_post_metrics.findMany({
      where: { collected_at: { gte: new Date(Date.now() - 60 * 864e5) } },
      select: { post_id: true, workspace_id: true, reach: true, saves: true },
      take: 5000,
    });
    const best = new Map<string, { ws: string; v: number }>();
    for (const r of rows) {
      const v = Number(r.reach ?? 0) + 5 * Number(r.saves ?? 0);
      if ((best.get(r.post_id)?.v ?? -1) < v) best.set(r.post_id, { ws: r.workspace_id, v });
    }
    const byWs = new Map<string, { id: string; v: number }[]>();
    for (const [id, b] of best) byWs.set(b.ws, [...(byWs.get(b.ws) ?? []), { id, v: b.v }]);
    let added = 0;
    for (const [ws, list] of byWs) {
      if (list.length < 5) continue;
      list.sort((a, b) => b.v - a.v);
      const top = list.slice(0, Math.max(1, Math.ceil(list.length * 0.2))).map((x) => x.id);
      const posts = await this.prisma.ig_posts.findMany({ where: { id: { in: top }, workspace_id: ws }, select: { id: true, plan_id: true, creative_brief: true } });
      for (const p of posts as PostRow[]) {
        const prompt = p.creative_brief?.art_direction?.prompt_final;
        if (!prompt || !p.plan_id) continue;
        const plan = await this.prisma.ig_content_plans.findFirst({ where: { id: p.plan_id, workspace_id: ws }, select: { brand_id: true } });
        if (!plan?.brand_id) continue;
        const brand = await this.prisma.brands.findFirst({ where: { id: plan.brand_id, workspace_id: ws }, select: { visual_style: true } });
        const vs = ((brand?.visual_style ?? {}) as { exemplos_prompt?: string[] }) ?? {};
        const ex = Array.isArray(vs.exemplos_prompt) ? vs.exemplos_prompt : [];
        if (ex.includes(prompt)) continue;
        await this.prisma.brands.update({ where: { id: plan.brand_id }, data: { visual_style: { ...vs, exemplos_prompt: [...ex, prompt].slice(-10) } as Prisma.InputJsonObject } });
        added++;
      }
    }
    return { added };
  }
}
