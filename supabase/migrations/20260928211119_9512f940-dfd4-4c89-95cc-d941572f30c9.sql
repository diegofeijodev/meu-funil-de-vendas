CREATE TABLE public.app_credentials (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.app_credentials TO service_role;

ALTER TABLE public.app_credentials ENABLE ROW LEVEL SECURITY;
-- Sem policies: anon/authenticated não leem nem escrevem. Acesso exclusivo via supabaseAdmin no servidor.