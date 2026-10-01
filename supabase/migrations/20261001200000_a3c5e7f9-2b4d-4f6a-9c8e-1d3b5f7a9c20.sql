-- 2.8 / 2.9 Google Ads e TikTok Ads: campanhas ligadas e resultados diários.
alter table public.campaigns
  add column if not exists google_campaign_id text,
  add column if not exists google_status text,
  add column if not exists tiktok_campaign_id text,
  add column if not exists tiktok_status text;

alter table public.performance_daily add column if not exists external_id text;
create unique index if not exists performance_daily_external_key on public.performance_daily(campaign_id, source, external_id, date);
