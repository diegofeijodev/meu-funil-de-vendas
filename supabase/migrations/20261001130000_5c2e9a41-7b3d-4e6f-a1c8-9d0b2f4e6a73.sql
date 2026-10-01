-- Fase 1 (1.2): cada criativo e cada copy guarda o ângulo da estratégia que testa,
-- para medir depois qual ângulo vende mais.
alter table public.creatives add column if not exists angle text;
alter table public.copies add column if not exists angle text;
alter table public.media_assets add column if not exists angle text;
create index if not exists creatives_campaign_angle on public.creatives(campaign_id, angle);
