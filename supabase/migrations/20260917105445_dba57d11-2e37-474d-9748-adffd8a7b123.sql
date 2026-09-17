CREATE TABLE public.crm_sdr_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT false,
  name text NOT NULL DEFAULT 'Agente SDR',
  persona text NOT NULL DEFAULT '',
  tone text NOT NULL DEFAULT 'consultivo e cordial',
  goal text NOT NULL DEFAULT 'Qualificar o lead e agendar uma reuniao com o time comercial.',
  knowledge_text text NOT NULL DEFAULT '',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_score integer NOT NULL DEFAULT 60,
  scheduling_link text,
  available_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  business_hours jsonb NOT NULL DEFAULT '{"timezone":"America/Sao_Paulo","days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb,
  offhours_message text NOT NULL DEFAULT 'Recebemos sua mensagem! Nosso time responde no proximo horario comercial.',
  max_messages integer NOT NULL DEFAULT 20,
  handoff_triggers jsonb NOT NULL DEFAULT '["negociacao de preco","reclamacao","assunto juridico","falar com atendente"]'::jsonb,
  model text NOT NULL DEFAULT 'openai/gpt-6-astra',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_sdr_agents TO authenticated;
GRANT ALL ON public.crm_sdr_agents TO service_role;
ALTER TABLE public.crm_sdr_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sdr_agents_select" ON public.crm_sdr_agents FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY "sdr_agents_write" ON public.crm_sdr_agents FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::public.workspace_role[]));

CREATE TRIGGER touch_crm_sdr_agents BEFORE UPDATE ON public.crm_sdr_agents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.crm_sdr_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.crm_sdr_agents(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/pdf',
  size_bytes integer NOT NULL DEFAULT 0,
  extracted_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_sdr_documents TO authenticated;
GRANT ALL ON public.crm_sdr_documents TO service_role;
ALTER TABLE public.crm_sdr_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sdr_documents_select" ON public.crm_sdr_documents FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY "sdr_documents_write" ON public.crm_sdr_documents FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::public.workspace_role[]));

CREATE TABLE public.crm_sdr_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.crm_sdr_agents(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.crm_conversations(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'live',
  inbound_text text,
  reply_text text,
  decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  score integer,
  handoff boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ok',
  error_message text,
  model text,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crm_sdr_runs TO authenticated;
GRANT ALL ON public.crm_sdr_runs TO service_role;
ALTER TABLE public.crm_sdr_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sdr_runs_select" ON public.crm_sdr_runs FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE INDEX crm_sdr_runs_ws_created_idx ON public.crm_sdr_runs (workspace_id, created_at DESC);
CREATE INDEX crm_sdr_runs_lead_idx ON public.crm_sdr_runs (lead_id, created_at DESC);
CREATE INDEX crm_sdr_documents_agent_idx ON public.crm_sdr_documents (agent_id);