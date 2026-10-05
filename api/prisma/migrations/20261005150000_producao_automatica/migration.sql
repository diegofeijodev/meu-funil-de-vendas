-- Produção de conteúdo automática (05/10/2026): reescritas do post reprovado no modo totalmente automático, tipo da falha
-- (mídia × publicação: falha de publicação não refaz a mídia) e o áudio dos vídeos da programação.
ALTER TABLE "ig_posts" ADD COLUMN "review_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failure_kind" TEXT;

ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_failure_kind_check" CHECK (failure_kind IN ('media','publish'));

ALTER TABLE "ig_auto_runs" ADD COLUMN "video_audio" JSONB NOT NULL DEFAULT '{"modo":"ambiente_trilha","instrucoes":""}';

-- Produção antecipada (ProductionService): posts de programação ainda sem criativo, pelo horário.
CREATE INDEX "ig_posts_production_idx" ON "ig_posts" ("scheduled_at") WHERE run_id IS NOT NULL AND status = 'idea';
