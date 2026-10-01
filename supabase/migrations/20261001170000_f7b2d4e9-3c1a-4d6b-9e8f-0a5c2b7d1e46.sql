-- lovable-cron-fallback-reviewed: user requested daily Instagram account insights (item 5.2) on the existing instagram cron endpoint
-- Fase 5: insights da conta do Instagram por dia.
create table if not exists public.ig_account_insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  followers_total int,
  new_followers int,
  reach int,
  views int,
  profile_views int,
  website_clicks int,
  accounts_engaged int,
  interactions int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, date)
);
grant select on public.ig_account_insights to authenticated;
grant all on public.ig_account_insights to service_role;
alter table public.ig_account_insights enable row level security;
create policy "ws members read account insights" on public.ig_account_insights
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- 5.5 Uma semana por plano no piloto automático (evita calendário duplicado se a tarefa rodar duas vezes).
create table if not exists public.ig_autopilot_weeks (
  plan_id uuid not null references public.ig_content_plans(id) on delete cascade,
  week_start date not null,
  created_at timestamptz not null default now(),
  primary key (plan_id, week_start)
);
grant all on public.ig_autopilot_weeks to service_role;
alter table public.ig_autopilot_weeks enable row level security;

do $$ begin
  perform cron.unschedule('instagram-account-daily') where exists (select 1 from cron.job where jobname='instagram-account-daily');
end $$;
select cron.schedule('instagram-account-daily','25 10 * * *',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/instagram', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='instagram')), body := '{"task":"account"}'::jsonb, timeout_milliseconds := 120000);$c$);
