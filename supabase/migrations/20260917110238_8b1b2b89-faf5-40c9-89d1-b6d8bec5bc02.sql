ALTER TABLE public.crm_cadences
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'source',
  ADD COLUMN IF NOT EXISTS trigger_value text,
  ADD COLUMN IF NOT EXISTS exit_rules jsonb NOT NULL DEFAULT '{"on_reply":true,"on_stage_change":true,"on_won_lost":true,"on_opt_out":true,"on_human_takeover":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS template_key text;

ALTER TABLE public.crm_cadence_runs
  ADD COLUMN IF NOT EXISTS entered_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS entry_stage_id uuid,
  ADD COLUMN IF NOT EXISTS stop_reason text,
  ADD COLUMN IF NOT EXISTS last_step_at timestamptz;

ALTER TABLE public.crm_settings
  ADD COLUMN IF NOT EXISTS wa_hourly_limit integer NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS public.crm_cadence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cadence_id uuid NOT NULL REFERENCES public.crm_cadences(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.crm_cadence_runs(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  step_index integer NOT NULL DEFAULT 0,
  channel text NOT NULL DEFAULT 'wa_text',
  event text NOT NULL,
  message_id uuid REFERENCES public.crm_messages(id) ON DELETE SET NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crm_cadence_events TO authenticated;
GRANT ALL ON public.crm_cadence_events TO service_role;
ALTER TABLE public.crm_cadence_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cadence_events_select" ON public.crm_cadence_events FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE INDEX IF NOT EXISTS crm_cadence_events_cadence_idx ON public.crm_cadence_events (cadence_id, step_index);
CREATE INDEX IF NOT EXISTS crm_cadence_events_ws_created_idx ON public.crm_cadence_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_cadence_runs_due_idx ON public.crm_cadence_runs (status, next_run_at);