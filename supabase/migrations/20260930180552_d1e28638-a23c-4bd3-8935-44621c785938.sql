ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS visual_style jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.brand_assets ADD COLUMN IF NOT EXISTS tag text;
ALTER TABLE public.brand_assets ADD COLUMN IF NOT EXISTS storage_path text;