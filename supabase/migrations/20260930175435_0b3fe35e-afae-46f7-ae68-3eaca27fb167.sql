ALTER TABLE public.app_credentials ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.app_credentials ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.app_credentials DROP CONSTRAINT IF EXISTS app_credentials_pkey;
ALTER TABLE public.app_credentials ADD PRIMARY KEY (id);
ALTER TABLE public.app_credentials ADD CONSTRAINT app_credentials_workspace_key UNIQUE NULLS NOT DISTINCT (workspace_id, key);

ALTER TABLE public.ig_posts ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';
CREATE UNIQUE INDEX IF NOT EXISTS ig_posts_ws_media_uidx ON public.ig_posts (workspace_id, ig_media_id) WHERE ig_media_id IS NOT NULL;