ALTER TABLE public.ig_posts ADD COLUMN IF NOT EXISTS ig_creation_id text;
DROP POLICY IF EXISTS "service_role reads ig-media and creative-assets" ON storage.objects;
CREATE POLICY "service_role reads ig-media and creative-assets" ON storage.objects
  FOR SELECT TO service_role USING (bucket_id IN ('ig-media','creative-assets'));