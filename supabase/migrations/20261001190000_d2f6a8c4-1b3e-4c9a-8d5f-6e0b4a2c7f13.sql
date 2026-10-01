-- Fase 8 (8.4): última execução de cada agendador, para o painel "o que falta configurar".
create table if not exists public.cron_heartbeats (
  name text primary key,
  last_run_at timestamptz not null default now(),
  last_status text not null default 'ok',
  last_detail text
);
grant select on public.cron_heartbeats to authenticated;
grant all on public.cron_heartbeats to service_role;
alter table public.cron_heartbeats enable row level security;
create policy "logged users read cron heartbeats" on public.cron_heartbeats for select to authenticated using (true);
