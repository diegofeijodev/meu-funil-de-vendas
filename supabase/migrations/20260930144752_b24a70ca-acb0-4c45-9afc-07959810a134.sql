-- lovable-cron-fallback-reviewed: user explicitly requires 5-minute publishing queue for time-scheduled Instagram posts plus metric collection windows
create table public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade unique,
  ig_user_id text, username text, facebook_page_id text, profile_picture_url text,
  status text not null default 'disconnected' check (status in ('connected','error','disconnected')),
  last_error text, connected_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ig_content_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  name text not null, objective text, tone_of_voice text,
  content_pillars jsonb not null default '[]', posting_frequency jsonb not null default '{"feed":3,"reels":2,"stories":7}',
  preferred_times jsonb not null default '[]', hashtag_strategy jsonb not null default '{}', cta_default text,
  status text not null default 'draft' check (status in ('draft','active','paused')),
  auto_publish boolean not null default false, requires_approval boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ig_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid references public.ig_content_plans(id) on delete set null,
  format text not null check (format in ('feed_image','feed_carousel','reel','story_image','story_video')),
  status text not null default 'idea' check (status in ('idea','generating','ready','pending_approval','approved','scheduled','publishing','published','failed','cancelled')),
  scheduled_at timestamptz, published_at timestamptz,
  theme text, hook text, caption text, hashtags text[] not null default '{}', cta text,
  creative_brief jsonb not null default '{}', media jsonb not null default '[]',
  ig_media_id text, ig_permalink text, ai_provider text, ai_generation_log jsonb not null default '[]',
  last_error text, rejection_reason text, retry_count int not null default 0,
  metrics_collected jsonb not null default '[]',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index ig_posts_ws_status on public.ig_posts(workspace_id, status);
create table public.ig_post_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  post_id uuid not null references public.ig_posts(id) on delete cascade,
  collected_at timestamptz not null default now(),
  reach int, impressions int, likes int, comments int, saves int, shares int, plays int, profile_visits int,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['instagram_accounts','ig_content_plans','ig_posts','ig_post_metrics'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "ws members full access" on public.%I for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))', t);
    execute format('create trigger t_%s_updated before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

alter table public.publishing_jobs
  add column if not exists channel text not null default 'meta_ads' check (channel in ('meta_ads','instagram_organic')),
  add column if not exists ig_post_id uuid references public.ig_posts(id) on delete cascade,
  add column if not exists run_at timestamptz,
  add column if not exists attempts int not null default 0,
  add column if not exists locked_at timestamptz;
create index if not exists publishing_jobs_queue on public.publishing_jobs(channel, status, run_at);

insert into public.cron_tokens(name, token) values ('instagram', encode(extensions.gen_random_bytes(32),'hex'))
on conflict (name) do nothing;

select cron.schedule('instagram-queue-5min', '*/5 * * * *', $c$
  select net.http_post(
    url := 'https://project--9177203a-9cd6-4830-837f-805f2df251ed.lovable.app/api/public/cron/instagram',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='instagram')),
    body := '{}'::jsonb);
$c$);