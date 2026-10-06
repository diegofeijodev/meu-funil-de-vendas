import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

const str = z.string().nullish().transform((v) => v ?? null);
const nullNum = z.coerce.number().nullish().transform((v) => v ?? null);

/** Linha de `instagram_accounts` (`select *`; nunca traz token — ele vive no cofre). */
const account = z
  .object({
    id: z.string(),
    workspace_id: z.string(),
    ig_user_id: str,
    username: str,
    facebook_page_id: str,
    profile_picture_url: str,
    status: z.string(),
    last_error: str,
    connected_at: str,
  })
  .passthrough();
export type IgAccountRow = z.infer<typeof account>;

/** Linha de `ig_posts` (`select *`): os jsonb (`creative_brief`, `media`, `ai_generation_log`) ficam soltos como no protótipo. */
const post = z
  .object({
    id: z.string(),
    workspace_id: z.string(),
    plan_id: str,
    format: z.string(),
    status: z.string(),
    scheduled_at: str,
    published_at: str,
    theme: str,
    hook: str,
    caption: str,
    hashtags: z.array(z.string()).nullish().transform((v) => v ?? []),
    cta: str,
    creative_brief: z.any().transform((v) => v ?? {}),
    media: z.array(z.object({ url: z.string().nullable(), type: z.string(), order: z.coerce.number() }).passthrough()).nullish().transform((v) => v ?? []),
    ig_media_id: str,
    ig_permalink: str,
    ai_provider: str,
    ai_generation_log: z.array(z.any()).nullish().transform((v) => v ?? []),
    last_error: str,
    created_at: z.string(),
    run_id: str,
    automation: str,
    // Programação com estratégia (05/10/2026): ligação do post ao objetivo + revisão (`needs_review`).
    objective_link: str,
    pillar: str,
    persona: str,
    product_id: str,
    funnel_stage: str,
    review_reason: str,
    review_score: nullNum,
    review_attempts: nullNum,
    failure_kind: str,
  })
  .passthrough();

const metric = z
  .object({
    post_id: z.string(),
    collected_at: z.string(),
    reach: nullNum,
    impressions: nullNum,
    likes: nullNum,
    comments: nullNum,
    saves: nullNum,
    shares: nullNum,
    plays: nullNum,
    profile_visits: nullNum,
  })
  .passthrough();

const plan = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    auto_publish: z.boolean(),
    requires_approval: z.boolean(),
    brand_id: str,
    created_at: z.string().optional(),
  })
  .passthrough();

const event = z.object({ id: z.string(), kind: z.string(), level: z.string(), message: z.string(), created_at: z.string() }).passthrough();

const run = z
  .object({
    id: z.string(),
    status: z.string(),
    created_at: z.string(),
    start_date: z.string(),
    end_date: z.string(),
    mode: z.string(),
    recurring: z.boolean(),
    filled: z.coerce.number(),
    slots: z.array(z.any()).nullish().transform((v) => v ?? []),
    last_error: str,
    // Estratégia do período (jsonb solto, como no protótipo): pending → review → approved.
    strategy: z.any().nullish().transform((v) => v ?? null),
    strategy_status: z.string().default("pending"),
    paused_reason: str,
    weeks: z.coerce.number(),
    counts: z.object({
      total: z.number(), media: z.number(), waiting: z.number(), scheduled: z.number(), published: z.number(), failed: z.number(), review: z.number().default(0),
      // Painel do período (produção automática).
      produced: z.number().default(0), producing: z.number().default(0), queued: z.number().default(0), rewriting: z.number().default(0), skipped: z.number().default(0),
    }),
    skipped_posts: z.array(z.object({ id: z.string(), theme: str, scheduled_at: str, reason: z.string() })).default([]),
    video_audio: z.any().nullish().transform((v) => v ?? null),
  })
  .passthrough();

const insight = z
  .object({
    date: z.string(),
    followers_total: nullNum,
    new_followers: nullNum,
    reach: nullNum,
    views: nullNum,
    profile_views: nullNum,
    website_clicks: nullNum,
    accounts_engaged: nullNum,
    interactions: nullNum,
  })
  .passthrough();

const base = (ws: string) => `/v1/workspaces/${ws}`;

/** `instagram_accounts select * eq workspace_id maybeSingle` — a API devolve `{}` quando não há conta. */
export async function getIgAccount(ws: string): Promise<IgAccountRow | null> {
  const { data } = await api.get(`${base(ws)}/instagram-account`);
  return data && data.id ? (account.parse(data) as IgAccountRow) : null;
}

/** `ig_posts select * eq workspace_id order scheduled_at asc nullsFirst:false`. */
export async function listIgPosts(ws: string) {
  const { data } = await api.get(`${base(ws)}/ig-posts`);
  return z.array(post).parse(data);
}

/** Selo do menu lateral: `ig_posts` em `pending_approval` ou `needs_review` (count exato). */
export async function countIgPending(ws: string): Promise<number> {
  const { data } = await api.get(`${base(ws)}/ig-posts/pending-count`);
  return z.object({ count: z.coerce.number() }).parse(data).count;
}

/** `ig_posts update` do editor (legenda/hashtags/CTA/horário e a direção de arte em `creative_brief`). */
export async function patchIgPost(
  ws: string,
  id: string,
  body: { caption?: string; hashtags?: string[]; cta?: string; scheduled_at?: string | null; creative_brief?: Record<string, unknown> },
) {
  await api.patch(`${base(ws)}/ig-posts/${id}`, body);
}

/** `ig_post_metrics select * eq workspace_id order collected_at desc`. */
export async function listIgMetrics(ws: string) {
  const { data } = await api.get(`${base(ws)}/ig-post-metrics`);
  return z.array(metric).parse(data);
}

/** `ig_content_plans select *` (mais novos primeiro); `excludeArchived` = o `neq('status','archived')` do diálogo de programação. */
export async function listIgPlans(ws: string, opts: { excludeArchived?: boolean } = {}) {
  const { data } = await api.get(`${base(ws)}/ig-content-plans`, { params: opts.excludeArchived ? { exclude_archived: "true" } : undefined });
  return z.array(plan).parse(data);
}

export type IgPlanInput = Record<string, unknown>;

/** `ig_content_plans insert(...).select('id').single()` -> `{ id }`. */
export async function createIgPlan(ws: string, row: IgPlanInput): Promise<{ id: string }> {
  const { data } = await api.post(`${base(ws)}/ig-content-plans`, row);
  return z.object({ id: z.string() }).passthrough().parse(data);
}

/** `ig_content_plans update(...).eq('id').select('id').single()` -> `{ id }`. */
export async function updateIgPlan(ws: string, id: string, row: IgPlanInput): Promise<{ id: string }> {
  const { data } = await api.patch(`${base(ws)}/ig-content-plans/${id}`, row);
  return z.object({ id: z.string() }).passthrough().parse(data);
}

/** `ig_autopilot_events select * ... order created_at desc limit 20`. */
export async function listIgEvents(ws: string) {
  const { data } = await api.get(`${base(ws)}/ig-autopilot-events`, { params: { limit: 20 } });
  return z.array(event).parse(data);
}

/** Programações (`ig_auto_runs` raiz, 8 mais novas) já com semanas e contagem de posts por situação. */
export async function listAutoRuns(ws: string) {
  const { data } = await api.get(`${base(ws)}/ig-auto-runs`);
  return z.array(run).parse(data);
}

/** `ig_account_insights select * eq workspace_id gte date <since> order date`. */
export async function listIgAccountInsights(ws: string, since: string) {
  const { data } = await api.get(`${base(ws)}/ig-account-insights`, { params: { since } });
  return z.array(insight).parse(data);
}
