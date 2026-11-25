-- Revisão de código das vagas fixas (CLT), 24/11/2026: o aviso vermelho da IA e a prévia passam a ter um lugar POR TIPO (a vaga fixa não
-- apaga nem grava o aviso das diárias, e a prévia da vaga fixa não sobrescreve a das diárias). Só aditiva; as colunas das diárias
-- (`ai_error`, `ai_error_at`, `preview`) não mudam.
ALTER TABLE "vacancy_story_settings"
  ADD COLUMN "clt_ai_error" TEXT,
  ADD COLUMN "clt_ai_error_at" TIMESTAMPTZ(6),
  ADD COLUMN "clt_preview" JSONB NOT NULL DEFAULT '{}';
