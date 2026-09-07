ALTER TABLE public.mcp_connections
  ADD COLUMN IF NOT EXISTS refresh_token text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS oauth_client_id text,
  ADD COLUMN IF NOT EXISTS oauth_client_secret text,
  ADD COLUMN IF NOT EXISTS oauth_state text,
  ADD COLUMN IF NOT EXISTS oauth_code_verifier text,
  ADD COLUMN IF NOT EXISTS oauth_authorization_endpoint text,
  ADD COLUMN IF NOT EXISTS oauth_token_endpoint text,
  ADD COLUMN IF NOT EXISTS oauth_scope text,
  ADD COLUMN IF NOT EXISTS oauth_resource text;

CREATE INDEX IF NOT EXISTS mcp_connections_oauth_state_idx ON public.mcp_connections (oauth_state);

ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS final_prompt text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS external_job_id text;

CREATE TABLE IF NOT EXISTS public.creative_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  creative_id uuid REFERENCES public.creatives(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mock',
  type text NOT NULL DEFAULT 'static_image',
  prompt text,
  final_prompt text,
  aspect_ratio text,
  status text NOT NULL DEFAULT 'queued',
  external_job_id text,
  asset_url text,
  thumbnail_url text,
  error_message text,
  estimated_cost numeric DEFAULT 0,
  actual_cost numeric DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_generation_jobs TO authenticated;
GRANT ALL ON public.creative_generation_jobs TO service_role;

ALTER TABLE public.creative_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jobs_select_members" ON public.creative_generation_jobs
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "jobs_write_members" ON public.creative_generation_jobs
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE INDEX IF NOT EXISTS creative_generation_jobs_ws_idx ON public.creative_generation_jobs (workspace_id, created_at DESC);