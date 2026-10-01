-- Calendário automático do Instagram: a IA estrategista planeja um período escolhido
-- (datas, dias da semana, horários, formatos), os criativos são gerados sozinhos e a fila publica.

create table if not exists public.ig_auto_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.ig_content_plans(id) on delete cascade,
  parent_id uuid references public.ig_auto_runs(id) on delete set null,
  created_by uuid,
  campaign_id uuid references public.campaigns(id) on delete set null,
  start_date date not null,
  end_date date not null,
  weekdays int[] not null default '{0,1,2,3,4,5,6}',
  times text[] not null default '{}',
  story_times text[] not null default '{}',
  formats text[] not null default '{feed_image,feed_carousel,reel}',
  focus text,
  mode text not null default 'publish' check (mode in ('publish','approval')),
  recurring boolean not null default false,
  status text not null default 'planning' check (status in ('planning','active','done','cancelled','failed')),
  slots jsonb not null default '[]'::jsonb,
  filled int not null default 0,
  last_error text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ig_auto_runs_ws_idx on public.ig_auto_runs (workspace_id, created_at desc);
create unique index if not exists ig_auto_runs_recurring_uidx on public.ig_auto_runs (parent_id, start_date) where parent_id is not null;
grant all on public.ig_auto_runs to service_role;
grant select on public.ig_auto_runs to authenticated;
alter table public.ig_auto_runs enable row level security;
create policy "ws members read auto runs" on public.ig_auto_runs
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Cada post sabe se veio de uma programação automática e qual o modo dela
-- ('publish' = publica sozinho; 'approval' = espera aprovação). Nulo = segue o plano.
alter table public.ig_posts add column if not exists automation text check (automation in ('publish','approval'));
alter table public.ig_posts add column if not exists run_id uuid references public.ig_auto_runs(id) on delete set null;
create index if not exists ig_posts_automation_idx on public.ig_posts (status, scheduled_at) where automation is not null;

-- Dias da semana em que o piloto semanal do plano pode publicar (0 = domingo).
alter table public.ig_content_plans add column if not exists posting_days int[] not null default '{0,1,2,3,4,5,6}';
