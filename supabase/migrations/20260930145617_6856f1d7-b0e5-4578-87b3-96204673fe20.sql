alter table public.ig_content_plans
  add column if not exists ai_notes jsonb not null default '[]',
  add column if not exists pillar_weights jsonb not null default '{}',
  add column if not exists last_autopilot_at timestamptz;
alter table public.ig_posts add column if not exists approved_at timestamptz;

create table public.ig_autopilot_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid references public.ig_content_plans(id) on delete set null,
  post_id uuid references public.ig_posts(id) on delete set null,
  kind text not null,
  level text not null default 'info',
  message text not null,
  created_at timestamptz not null default now()
);
create index ig_autopilot_events_ws on public.ig_autopilot_events(workspace_id, created_at desc);
grant select on public.ig_autopilot_events to authenticated;
grant all on public.ig_autopilot_events to service_role;
alter table public.ig_autopilot_events enable row level security;
create policy "ws members read events" on public.ig_autopilot_events for select to authenticated using (public.is_workspace_member(workspace_id));

select cron.schedule('instagram-autopilot-weekly', '0 21 * * 0', $c$
  select net.http_post(
    url := 'https://project--9177203a-9cd6-4830-837f-805f2df251ed.lovable.app/api/public/cron/instagram',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='instagram')),
    body := '{"task":"weekly"}'::jsonb);
$c$);
select cron.schedule('instagram-optimizer-monday', '0 12 * * 1', $c$
  select net.http_post(
    url := 'https://project--9177203a-9cd6-4830-837f-805f2df251ed.lovable.app/api/public/cron/instagram',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='instagram')),
    body := '{"task":"optimize"}'::jsonb);
$c$);