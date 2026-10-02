-- Reserva atômica de trabalho externo (Task 6, fix 1): quem está criando a campanha no Google/TikTok grava
-- `*_creating_at` (UPDATE condicional; livre = NULL ou vencido) e `applying_at` marca a recomendação em "applying".
-- Reserva vencida = o processo morreu: a criação pode ser retomada e a recomendação volta a "pending".
ALTER TABLE "campaigns" ADD COLUMN "google_creating_at" TIMESTAMPTZ(6);
ALTER TABLE "campaigns" ADD COLUMN "tiktok_creating_at" TIMESTAMPTZ(6);
ALTER TABLE "ai_recommendations" ADD COLUMN "applying_at" TIMESTAMPTZ(6);
