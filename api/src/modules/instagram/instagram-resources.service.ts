import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound, UserError } from '../media/user-error';
import { AutoCalendarService } from './auto-calendar.service';
import { CreateIgPlanDto, PatchIgPlanDto, PatchIgPostDto } from './instagram.dto';
import { IgStore } from './ig-store.service';

const FREQ_KEYS = ['feed_image', 'feed_carousel', 'feed', 'reels', 'stories'] as const;

/** Só as chaves conhecidas, como inteiros 0..100 (o formulário do plano manda números). */
function cleanFrequency(v: Record<string, unknown> | undefined): Prisma.InputJsonObject | undefined {
  if (!v) return undefined;
  const out: Record<string, number> = {};
  for (const k of FREQ_KEYS) {
    if (v[k] === undefined) continue;
    const n = Number(v[k]);
    if (!Number.isFinite(n)) throw new UserError('Frequência inválida.');
    out[k] = Math.max(0, Math.min(100, Math.round(n)));
  }
  return out;
}

function cleanHashtagStrategy(v: Record<string, unknown> | undefined): Prisma.InputJsonObject | undefined {
  if (!v) return undefined;
  const str = (x: unknown) => (typeof x === 'string' ? x.slice(0, 2000) : '');
  return { notes: str(v['notes']), audience: str(v['audience']) };
}

/** Leituras/escritas diretas das telas do Instagram (antes `supabase.from(...)` com RLS). Tudo escopado no workspace. */
@Injectable()
export class InstagramResourcesService {
  constructor(
    private readonly store: IgStore,
    private readonly auto: AutoCalendarService,
  ) {}

  private get prisma() {
    return this.store.prisma;
  }

  account(workspaceId: string) {
    return this.prisma.instagram_accounts.findUnique({ where: { workspace_id: workspaceId } });
  }

  listPosts(workspaceId: string) {
    return this.prisma.ig_posts.findMany({ where: { workspace_id: workspaceId }, orderBy: [{ scheduled_at: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }] });
  }

  /** Selo do menu: aguardando aprovação + em revisão humana. O `needs_review` do modo "publish" fica de fora: a IA o reescreve sozinha. */
  async pendingCount(workspaceId: string) {
    return {
      count: await this.prisma.ig_posts.count({
        where: { workspace_id: workspaceId, OR: [{ status: 'pending_approval' }, { status: 'needs_review', OR: [{ automation: null }, { automation: 'approval' }] }] },
      }),
    };
  }

  /** `update({caption, hashtags, cta, scheduled_at})` e `update({creative_brief})` do editor do post. */
  async patchPost(workspaceId: string, id: string, dto: PatchIgPostDto) {
    const post = await this.store.getPost(id, workspaceId);
    const data: Prisma.ig_postsUpdateInput = {};
    if (dto.caption !== undefined) data.caption = dto.caption;
    if (dto.hashtags !== undefined) data.hashtags = dto.hashtags;
    if (dto.cta !== undefined) data.cta = dto.cta;
    if (dto.scheduled_at !== undefined) data.scheduled_at = dto.scheduled_at ? new Date(dto.scheduled_at) : null;
    if (dto.creative_brief !== undefined) {
      // `pending_job` é estado do servidor (id do job no provedor): o cliente não define nem apaga.
      const { pending_job: _ignored, ...brief } = dto.creative_brief as Record<string, unknown>;
      const current = (post.creative_brief ?? {}) as Record<string, unknown>;
      data.creative_brief = { ...brief, ...(current['pending_job'] ? { pending_job: current['pending_job'] } : {}) } as Prisma.InputJsonObject;
    }
    return this.prisma.ig_posts.update({ where: { id }, data });
  }

  listMetrics(workspaceId: string) {
    return this.prisma.ig_post_metrics.findMany({ where: { workspace_id: workspaceId }, orderBy: { collected_at: 'desc' } });
  }

  listPlans(workspaceId: string, excludeArchived: boolean) {
    return this.prisma.ig_content_plans.findMany({
      where: { workspace_id: workspaceId, ...(excludeArchived ? { status: { not: 'archived' } } : {}) },
      orderBy: { created_at: 'desc' },
    });
  }

  private async assertBrand(workspaceId: string, brandId: string | null | undefined) {
    if (!brandId) return;
    const b = await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: workspaceId }, select: { id: true } });
    if (!b) throw notFound('Marca não encontrada.');
  }

  async createPlan(workspaceId: string, dto: CreateIgPlanDto) {
    await this.assertBrand(workspaceId, dto.brand_id);
    return this.prisma.ig_content_plans.create({
      data: {
        workspace_id: workspaceId,
        name: dto.name,
        brand_id: dto.brand_id ?? null,
        objective: dto.objective ?? null,
        tone_of_voice: dto.tone_of_voice ?? null,
        ...(dto.content_pillars ? { content_pillars: dto.content_pillars } : {}),
        ...(dto.posting_frequency ? { posting_frequency: cleanFrequency(dto.posting_frequency) } : {}),
        ...(dto.preferred_times ? { preferred_times: dto.preferred_times } : {}),
        ...(dto.posting_days ? { posting_days: dto.posting_days } : {}),
        ...(dto.hashtag_strategy ? { hashtag_strategy: cleanHashtagStrategy(dto.hashtag_strategy) } : {}),
        cta_default: dto.cta_default ?? null,
        ...(dto.requires_approval !== undefined ? { requires_approval: dto.requires_approval } : {}),
        ...(dto.auto_publish !== undefined ? { auto_publish: dto.auto_publish } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    });
  }

  async patchPlan(workspaceId: string, id: string, dto: PatchIgPlanDto) {
    const plan = await this.prisma.ig_content_plans.findFirst({ where: { id, workspace_id: workspaceId }, select: { id: true } });
    if (!plan) throw notFound('Plano de conteúdo não encontrado.');
    if (dto.brand_id !== undefined) await this.assertBrand(workspaceId, dto.brand_id);
    const data: Prisma.ig_content_plansUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.brand_id !== undefined) data.brand_id = dto.brand_id;
    if (dto.objective !== undefined) data.objective = dto.objective;
    if (dto.tone_of_voice !== undefined) data.tone_of_voice = dto.tone_of_voice;
    if (dto.content_pillars !== undefined) data.content_pillars = dto.content_pillars;
    if (dto.posting_frequency !== undefined) data.posting_frequency = cleanFrequency(dto.posting_frequency);
    if (dto.preferred_times !== undefined) data.preferred_times = dto.preferred_times;
    if (dto.posting_days !== undefined) data.posting_days = dto.posting_days;
    if (dto.hashtag_strategy !== undefined) data.hashtag_strategy = cleanHashtagStrategy(dto.hashtag_strategy);
    if (dto.cta_default !== undefined) data.cta_default = dto.cta_default;
    if (dto.requires_approval !== undefined) data.requires_approval = dto.requires_approval;
    if (dto.auto_publish !== undefined) data.auto_publish = dto.auto_publish;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.ig_content_plans.update({ where: { id }, data });
  }

  listEvents(workspaceId: string, limit = 20) {
    return this.prisma.ig_autopilot_events.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'desc' }, take: Math.min(limit, 100) });
  }

  autoRuns(workspaceId: string) {
    return this.auto.summary(workspaceId);
  }

  listAccountInsights(workspaceId: string, since?: string) {
    return this.prisma.ig_account_insights.findMany({
      where: { workspace_id: workspaceId, ...(since ? { date: { gte: new Date(`${since}T00:00:00Z`) } } : {}) },
      orderBy: { date: 'asc' },
    });
  }
}
