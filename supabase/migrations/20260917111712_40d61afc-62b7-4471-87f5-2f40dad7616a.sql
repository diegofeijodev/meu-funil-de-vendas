create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.cron_tokens (
  name text primary key,
  token text not null,
  created_at timestamptz not null default now()
);
grant all on public.cron_tokens to service_role;
alter table public.cron_tokens enable row level security;
create policy "Somente o servidor acessa tokens de cron"
  on public.cron_tokens for all to service_role using (true) with check (true);