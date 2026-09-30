CREATE TABLE public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  creative_id uuid REFERENCES public.creatives(id) ON DELETE SET NULL,
  ig_post_id uuid REFERENCES public.ig_posts(id) ON DELETE SET NULL,
  parent_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Mídia',
  kind text NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video')),
  source text NOT NULL DEFAULT 'upload' CHECK (source IN ('higgsfield','chatgpt','gemini','upload','mock','other')),
  storage_path text,
  url text,
  thumbnail_path text,
  thumbnail_url text,
  mime text,
  width int,
  height int,
  duration_seconds numeric,
  size_bytes bigint,
  aspect_ratio text,
  target_format text NOT NULL DEFAULT 'other' CHECK (target_format IN ('ig_feed_square','ig_feed_portrait','ig_story','ig_reel','meta_ad_square','meta_ad_vertical','meta_ad_landscape','other')),
  ig_ready boolean NOT NULL DEFAULT false,
  quality_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  folder text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','archived')),
  prompt text,
  provider text,
  cost numeric,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_ws_idx ON public.media_assets(workspace_id, created_at DESC);
CREATE INDEX media_assets_creative_idx ON public.media_assets(creative_id);
CREATE INDEX media_assets_igpost_idx ON public.media_assets(ig_post_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO authenticated;
GRANT ALL ON public.media_assets TO service_role;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Membros veem mídias" ON public.media_assets FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Editores gerenciam mídias" ON public.media_assets FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin','marketing']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin','marketing']::workspace_role[]));
CREATE TRIGGER t_media_assets_updated BEFORE UPDATE ON public.media_assets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill: criativos existentes
INSERT INTO public.media_assets (workspace_id, brand_id, campaign_id, creative_id, title, kind, source, url, thumbnail_url, aspect_ratio, target_format, ig_ready, status, prompt, provider, cost, created_at)
SELECT c.workspace_id, c.brand_id, c.campaign_id, c.id, c.title,
  CASE WHEN c.type ILIKE '%video%' OR c.type ILIKE '%reel%' THEN 'video' ELSE 'image' END,
  CASE WHEN c.provider IN ('higgsfield','chatgpt','gemini','mock') THEN c.provider ELSE 'other' END,
  c.preview_url, c.thumbnail_url, c.aspect_ratio,
  CASE c.aspect_ratio WHEN '1:1' THEN 'ig_feed_square' WHEN '4:5' THEN 'ig_feed_portrait' WHEN '9:16' THEN (CASE WHEN c.type ILIKE '%video%' OR c.type ILIKE '%reel%' THEN 'ig_reel' ELSE 'ig_story' END) WHEN '16:9' THEN 'meta_ad_landscape' ELSE 'other' END,
  false,
  CASE WHEN c.status IN ('approved','published') THEN 'approved' WHEN c.status = 'rejected' THEN 'rejected' ELSE 'draft' END,
  coalesce(c.final_prompt, c.prompt), c.provider, c.real_cost, c.created_at
FROM public.creatives c WHERE c.preview_url IS NOT NULL;

-- Backfill: mídias dos posts do Instagram
INSERT INTO public.media_assets (workspace_id, ig_post_id, title, kind, source, url, width, height, duration_seconds, target_format, ig_ready, status, provider, created_at, quality_report)
SELECT p.workspace_id, p.id, coalesce(p.theme, 'Post do Instagram'),
  CASE WHEN m->>'type' = 'video' THEN 'video' ELSE 'image' END,
  CASE WHEN p.ai_provider IN ('higgsfield','chatgpt','gemini','mock') THEN p.ai_provider ELSE 'other' END,
  m->>'url', nullif(m->>'width','')::int, nullif(m->>'height','')::int, nullif(m->>'duration','')::numeric,
  CASE p.format WHEN 'feed_image' THEN 'ig_feed_square' WHEN 'feed_carousel' THEN 'ig_feed_portrait' WHEN 'reel' THEN 'ig_reel' ELSE 'ig_story' END,
  p.status = 'published',
  CASE WHEN p.status IN ('approved','scheduled','published','ready') THEN 'approved' ELSE 'draft' END,
  p.ai_provider, p.created_at,
  jsonb_build_object('backfill', true, 'issues', '[]'::jsonb)
FROM public.ig_posts p, jsonb_array_elements(CASE WHEN jsonb_typeof(p.media) = 'array' THEN p.media ELSE '[]'::jsonb END) m
WHERE m->>'url' IS NOT NULL;