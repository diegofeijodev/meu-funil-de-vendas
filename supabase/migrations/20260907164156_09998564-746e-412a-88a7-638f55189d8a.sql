REVOKE SELECT ON public.mcp_connections FROM authenticated;
GRANT SELECT (id, workspace_id, provider, label, server_url, status, tools, last_error, connected_at, expires_at, created_at, updated_at) ON public.mcp_connections TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.mcp_connections TO authenticated;
GRANT ALL ON public.mcp_connections TO service_role;