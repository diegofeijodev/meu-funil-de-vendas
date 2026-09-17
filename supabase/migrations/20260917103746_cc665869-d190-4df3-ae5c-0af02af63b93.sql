
CREATE TABLE public.crm_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_pipelines TO authenticated;
GRANT ALL ON public.crm_pipelines TO service_role;
ALTER TABLE public.crm_pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_pipelines members" ON public.crm_pipelines FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

CREATE TABLE public.crm_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  position integer NOT NULL DEFAULT 0,
  sla_hours integer NOT NULL DEFAULT 24,
  is_won boolean NOT NULL DEFAULT false,
  is_lost boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_stages TO authenticated;
GRANT ALL ON public.crm_stages TO service_role;
ALTER TABLE public.crm_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_stages members" ON public.crm_stages FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

CREATE TABLE public.crm_loss_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_loss_reasons TO authenticated;
GRANT ALL ON public.crm_loss_reasons TO service_role;
ALTER TABLE public.crm_loss_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_loss_reasons members" ON public.crm_loss_reasons FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

CREATE TABLE public.crm_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#22d3ee',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_tags TO authenticated;
GRANT ALL ON public.crm_tags TO service_role;
ALTER TABLE public.crm_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_tags members" ON public.crm_tags FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

CREATE TABLE public.crm_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  distribution text NOT NULL DEFAULT 'round_robin',
  default_owner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_settings TO authenticated;
GRANT ALL ON public.crm_settings TO service_role;
ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_settings members" ON public.crm_settings FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

CREATE TABLE public.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pipeline_id uuid REFERENCES public.crm_pipelines(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.crm_stages(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text,
  email text,
  city text,
  source text NOT NULL DEFAULT 'manual',
  campaign_name text,
  adset_name text,
  ad_name text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  owner_id uuid,
  score integer NOT NULL DEFAULT 0,
  temperature text NOT NULL DEFAULT 'frio',
  estimated_value numeric NOT NULL DEFAULT 0,
  tags text[] NOT NULL DEFAULT '{}',
  loss_reason text,
  lgpd_consent boolean NOT NULL DEFAULT false,
  lgpd_consent_at timestamptz,
  unsubscribed boolean NOT NULL DEFAULT false,
  ai_active boolean NOT NULL DEFAULT true,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  last_interaction_at timestamptz,
  first_response_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_leads TO authenticated;
GRANT ALL ON public.crm_leads TO service_role;
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_leads members" ON public.crm_leads FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));
CREATE INDEX crm_leads_ws_stage_idx ON public.crm_leads (workspace_id, stage_id);

CREATE TABLE public.crm_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'note',
  author_type text NOT NULL DEFAULT 'user',
  author_id uuid,
  content text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_interactions TO authenticated;
GRANT ALL ON public.crm_interactions TO service_role;
ALTER TABLE public.crm_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_interactions members" ON public.crm_interactions FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));
CREATE INDEX crm_interactions_lead_idx ON public.crm_interactions (lead_id, created_at DESC);

CREATE TABLE public.crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  title text NOT NULL,
  assignee_id uuid,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_tasks TO authenticated;
GRANT ALL ON public.crm_tasks TO service_role;
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_tasks members" ON public.crm_tasks FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

CREATE TABLE public.crm_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  from_stage_id uuid,
  to_stage_id uuid,
  moved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_stage_history TO authenticated;
GRANT ALL ON public.crm_stage_history TO service_role;
ALTER TABLE public.crm_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_stage_history members" ON public.crm_stage_history FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));
CREATE INDEX crm_stage_history_ws_idx ON public.crm_stage_history (workspace_id, created_at);

CREATE TRIGGER crm_pipelines_touch BEFORE UPDATE ON public.crm_pipelines FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER crm_stages_touch BEFORE UPDATE ON public.crm_stages FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER crm_leads_touch BEFORE UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER crm_tasks_touch BEFORE UPDATE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER crm_settings_touch BEFORE UPDATE ON public.crm_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $seed$
DECLARE
  ws record;
  pid uuid;
  stage_ids uuid[];
  lead_id uuid;
  i integer;
  si integer;
  names text[] := ARRAY['Ana Souza','Bruno Lima','Carla Mendes','Diego Rocha','Eduarda Prado','Felipe Nunes','Gabriela Dias','Henrique Alves','Isabela Martins','João Pedro','Karina Freitas','Lucas Barbosa','Marina Castro','Nelson Ribeiro','Olívia Campos','Paulo Tavares','Queila Moreira','Rafael Pires','Sabrina Lopes','Thiago Correia'];
  cities text[] := ARRAY['São Paulo','Campinas','Belo Horizonte','Curitiba','Porto Alegre','Goiânia'];
  sources text[] := ARRAY['meta_lead_ads','click_to_whatsapp','site','whatsapp','manual','import'];
  campaigns text[] := ARRAY['Franquias - Interesse','Chopp Verão','Institucional','Retargeting Q3'];
  ads text[] := ARRAY['Video Depoimento','Carrossel Oferta','Imagem Estática','Reels UGC'];
  temps text[] := ARRAY['frio','morno','quente'];
  created timestamptz;
BEGIN
  FOR ws IN SELECT id FROM public.workspaces LOOP
    INSERT INTO public.crm_pipelines (workspace_id, name, is_default)
    VALUES (ws.id, 'Funil Padrão', true) RETURNING id INTO pid;

    INSERT INTO public.crm_stages (workspace_id, pipeline_id, name, color, position, sla_hours, is_won, is_lost)
    VALUES
      (ws.id, pid, 'Novo Lead', '#38bdf8', 1, 1, false, false),
      (ws.id, pid, 'Contato Iniciado (SDR IA)', '#818cf8', 2, 4, false, false),
      (ws.id, pid, 'Qualificado', '#a78bfa', 3, 24, false, false),
      (ws.id, pid, 'Reunião Agendada', '#f59e0b', 4, 48, false, false),
      (ws.id, pid, 'Reunião Realizada', '#f97316', 5, 48, false, false),
      (ws.id, pid, 'Proposta', '#22d3ee', 6, 72, false, false),
      (ws.id, pid, 'Ganho', '#22c55e', 7, 72, true, false),
      (ws.id, pid, 'Perdido', '#ef4444', 8, 72, false, true);

    SELECT array_agg(id ORDER BY position) INTO stage_ids FROM public.crm_stages WHERE pipeline_id = pid;

    INSERT INTO public.crm_loss_reasons (workspace_id, name)
    VALUES (ws.id,'Sem orçamento'),(ws.id,'Sem perfil'),(ws.id,'Escolheu concorrente'),(ws.id,'Não respondeu'),(ws.id,'Fora da região');

    INSERT INTO public.crm_tags (workspace_id, name, color)
    VALUES (ws.id,'VIP','#f59e0b'),(ws.id,'Investidor','#22d3ee'),(ws.id,'Baixo ticket','#94a3b8'),(ws.id,'Reengajar','#a78bfa');

    INSERT INTO public.crm_settings (workspace_id, distribution) VALUES (ws.id, 'round_robin');

    FOR i IN 1..20 LOOP
      si := 1 + ((i * 3) % 8);
      created := now() - ((i * 9) || ' hours')::interval - ((i % 5) || ' days')::interval;
      INSERT INTO public.crm_leads (
        workspace_id, pipeline_id, stage_id, name, phone, email, city, source,
        campaign_name, adset_name, ad_name, utm_source, utm_medium, utm_campaign,
        score, temperature, estimated_value, tags, loss_reason, lgpd_consent, lgpd_consent_at,
        ai_active, stage_entered_at, last_interaction_at, first_response_at, created_at
      ) VALUES (
        ws.id, pid, stage_ids[si], names[i], '+5511' || lpad((900000000 + i * 137)::text, 9, '0'),
        lower(replace(split_part(names[i],' ',1),' ','')) || i || '@exemplo.com',
        cities[1 + (i % 6)], sources[1 + (i % 6)],
        campaigns[1 + (i % 4)], 'Conjunto ' || (1 + (i % 3)), ads[1 + (i % 4)],
        'facebook', 'paid_social', lower(replace(campaigns[1 + (i % 4)], ' ', '_')),
        30 + ((i * 7) % 70), temps[1 + (i % 3)], 1500 + (i * 320),
        CASE WHEN i % 4 = 0 THEN ARRAY['VIP'] WHEN i % 3 = 0 THEN ARRAY['Investidor'] ELSE '{}'::text[] END,
        CASE WHEN si = 8 THEN 'Sem orçamento' ELSE NULL END,
        true, created, si < 3, created + ((i % 7) || ' hours')::interval,
        created + ((i % 9) || ' hours')::interval,
        created + ((10 + (i % 50)) || ' minutes')::interval,
        created
      ) RETURNING id INTO lead_id;

      INSERT INTO public.crm_stage_history (workspace_id, lead_id, from_stage_id, to_stage_id, created_at)
      VALUES (ws.id, lead_id, NULL, stage_ids[1], created);
      IF si > 1 THEN
        FOR si IN 2..si LOOP
          INSERT INTO public.crm_stage_history (workspace_id, lead_id, from_stage_id, to_stage_id, created_at)
          VALUES (ws.id, lead_id, stage_ids[si-1], stage_ids[si], created + ((si * 6) || ' hours')::interval);
        END LOOP;
      END IF;

      INSERT INTO public.crm_interactions (workspace_id, lead_id, kind, author_type, content, created_at)
      VALUES
        (ws.id, lead_id, 'message_in', 'system', 'Lead recebido via ' || sources[1 + (i % 6)] || '.', created),
        (ws.id, lead_id, 'ai_action', 'ai', 'SDR IA enviou mensagem de abertura e qualificação.', created + interval '12 minutes'),
        (ws.id, lead_id, 'message_out', 'ai', 'Olá ' || split_part(names[i],' ',1) || '! Posso te enviar as condições da unidade?', created + interval '13 minutes');

      IF i % 3 = 0 THEN
        INSERT INTO public.crm_tasks (workspace_id, lead_id, title, due_at, status)
        VALUES (ws.id, lead_id, 'Follow-up com ' || split_part(names[i],' ',1), date_trunc('day', now()) + ((9 + (i % 8)) || ' hours')::interval, 'open');
      END IF;
    END LOOP;
  END LOOP;
END
$seed$;
