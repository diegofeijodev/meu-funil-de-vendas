-- ============ INTEGRATIONS ============
CREATE TABLE public.crm_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('meta_lead_ads','whatsapp')),
  provider text NOT NULL CHECK (provider IN ('meta','whatsapp_cloud','zapi','evolution')),
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connecting','connected','expired','error')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  webhook_token text NOT NULL DEFAULT encode(gen_random_bytes(18),'hex'),
  verify_token text NOT NULL DEFAULT encode(gen_random_bytes(12),'hex'),
  last_event_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind)
);
CREATE UNIQUE INDEX crm_integrations_webhook_token_key ON public.crm_integrations(webhook_token);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_integrations TO authenticated;
GRANT ALL ON public.crm_integrations TO service_role;
ALTER TABLE public.crm_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read integrations" ON public.crm_integrations FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins manage integrations" ON public.crm_integrations FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::workspace_role[]));

-- ============ CADENCES ============
CREATE TABLE public.crm_cadences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'meta_lead_ads',
  is_active boolean NOT NULL DEFAULT true,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_cadences TO authenticated;
GRANT ALL ON public.crm_cadences TO service_role;
ALTER TABLE public.crm_cadences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read cadences" ON public.crm_cadences FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins manage cadences" ON public.crm_cadences FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::workspace_role[]));

CREATE TABLE public.crm_cadence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cadence_id uuid NOT NULL REFERENCES public.crm_cadences(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  step_index integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','stopped','failed')),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_cadence_runs_due_idx ON public.crm_cadence_runs(status, next_run_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_cadence_runs TO authenticated;
GRANT ALL ON public.crm_cadence_runs TO service_role;
ALTER TABLE public.crm_cadence_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage cadence runs" ON public.crm_cadence_runs FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

-- ============ CONVERSATIONS / MESSAGES ============
CREATE TABLE public.crm_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'whatsapp_cloud',
  phone text NOT NULL,
  wa_id text,
  unread_count integer NOT NULL DEFAULT 0,
  window_expires_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, phone)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_conversations TO authenticated;
GRANT ALL ON public.crm_conversations TO service_role;
ALTER TABLE public.crm_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage conversations" ON public.crm_conversations FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

CREATE TABLE public.crm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.crm_conversations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','image','audio','video','document','template','sticker','other')),
  body text,
  media_url text,
  template_name text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('queued','sent','delivered','read','failed','received')),
  external_id text,
  error_message text,
  sent_by uuid,
  author_type text NOT NULL DEFAULT 'user' CHECK (author_type IN ('user','ai','system','contact')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_messages_conversation_idx ON public.crm_messages(conversation_id, created_at);
CREATE UNIQUE INDEX crm_messages_external_idx ON public.crm_messages(workspace_id, external_id) WHERE external_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_messages TO authenticated;
GRANT ALL ON public.crm_messages TO service_role;
ALTER TABLE public.crm_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage messages" ON public.crm_messages FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

CREATE TABLE public.crm_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_quick_replies TO authenticated;
GRANT ALL ON public.crm_quick_replies TO service_role;
ALTER TABLE public.crm_quick_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage quick replies" ON public.crm_quick_replies FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

CREATE TABLE public.crm_wa_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  language text NOT NULL DEFAULT 'pt_BR',
  category text,
  status text NOT NULL DEFAULT 'APPROVED',
  body_preview text,
  variables integer NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name, language)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_wa_templates TO authenticated;
GRANT ALL ON public.crm_wa_templates TO service_role;
ALTER TABLE public.crm_wa_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read templates" ON public.crm_wa_templates FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins manage templates" ON public.crm_wa_templates FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::workspace_role[]));

-- ============ CAMPAIGN COSTS ============
CREATE TABLE public.crm_campaign_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  date date NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text,
  spend numeric NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  leads integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, date, campaign_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_campaign_costs TO authenticated;
GRANT ALL ON public.crm_campaign_costs TO service_role;
ALTER TABLE public.crm_campaign_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read costs" ON public.crm_campaign_costs FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins manage costs" ON public.crm_campaign_costs FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']::workspace_role[]));

-- ============ WEBHOOK EVENT LOG (server only) ============
CREATE TABLE public.crm_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source text NOT NULL,
  external_id text,
  payload jsonb,
  status text NOT NULL DEFAULT 'processed',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_webhook_events_dedup_idx ON public.crm_webhook_events(source, external_id) WHERE external_id IS NOT NULL;
GRANT ALL ON public.crm_webhook_events TO service_role;
ALTER TABLE public.crm_webhook_events ENABLE ROW LEVEL SECURITY;

-- ============ LEAD COLUMNS ============
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS form_id text,
  ADD COLUMN IF NOT EXISTS form_name text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS wa_id text,
  ADD COLUMN IF NOT EXISTS referral_ad_id text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb;
CREATE INDEX IF NOT EXISTS crm_leads_phone_idx ON public.crm_leads(workspace_id, phone);
CREATE INDEX IF NOT EXISTS crm_leads_email_idx ON public.crm_leads(workspace_id, email);

CREATE TRIGGER crm_integrations_touch BEFORE UPDATE ON public.crm_integrations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER crm_cadences_touch BEFORE UPDATE ON public.crm_cadences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER crm_cadence_runs_touch BEFORE UPDATE ON public.crm_cadence_runs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER crm_conversations_touch BEFORE UPDATE ON public.crm_conversations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();