ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS meta_campaign_id text,
  ADD COLUMN IF NOT EXISTS meta_adset_id text,
  ADD COLUMN IF NOT EXISTS meta_ad_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS meta_delivery_status text;