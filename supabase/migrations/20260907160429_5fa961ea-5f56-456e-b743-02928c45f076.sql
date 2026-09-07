CREATE TABLE public.mcp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('higgsfield','meta')),
  label text,
  server_url text NOT NULL,
  access_token text,
  status text NOT NULL DEFAULT 'disconnected',
  tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcp_connections TO authenticated;
GRANT ALL ON public.mcp_connections TO service_role;

ALTER TABLE public.mcp_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read mcp connections" ON public.mcp_connections
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

CREATE POLICY "admins manage mcp connections" ON public.mcp_connections
  FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::workspace_role[]));

CREATE TRIGGER t_mcp_connections_updated BEFORE UPDATE ON public.mcp_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();