-- Vagas fixas (CLT) nos stories (desenho 2026-11-24 §3, migração 3): interruptor, limite por dia e retroativo PRÓPRIOS, e o estado da
-- consulta da vitrine CLT, separado do das diárias. Só aditiva.
ALTER TABLE "vacancy_story_settings"
  ADD COLUMN "clt_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "clt_enabled_at" TIMESTAMPTZ(6),
  ADD COLUMN "clt_enabled_by" UUID,
  ADD COLUMN "clt_daily_cap" integer NOT NULL DEFAULT 2,
  ADD COLUMN "clt_backlog_days" integer NOT NULL DEFAULT 14,
  ADD COLUMN "clt_last_poll_at" TIMESTAMPTZ(6),
  ADD COLUMN "clt_last_poll_ok_at" TIMESTAMPTZ(6),
  ADD COLUMN "clt_last_poll_error" TEXT;

ALTER TABLE "vacancy_story_settings"
  ADD CONSTRAINT "vacancy_story_settings_clt_daily_cap_check" CHECK ("clt_daily_cap" BETWEEN 1 AND 10),
  ADD CONSTRAINT "vacancy_story_settings_clt_backlog_days_check" CHECK ("clt_backlog_days" IN (0, 7, 14, 30));

-- NOT VALID: vale para as linhas novas sem varrer as antigas (hoje todas são 'freela', o padrão; a F0-7 confere). Assim a subida nunca
-- falha por uma linha antiga inesperada.
ALTER TABLE "vacancy_stories"
  ADD CONSTRAINT "vacancy_stories_source_check" CHECK ("source" IN ('freela', 'freela_clt')) NOT VALID;
