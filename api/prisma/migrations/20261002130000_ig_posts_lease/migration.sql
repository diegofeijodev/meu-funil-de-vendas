-- Lease de trabalho em ig_posts: quem está publicando, gerando mídia ou concluindo um job assíncrono grava
-- `lease_until` (UPDATE condicional: livre = NULL ou vencido) e renova enquanto trabalha; solta no fim.
-- Lease vencido = o processo morreu; o varredor do cron recupera o post (publishing/generating → failed).
ALTER TABLE "ig_posts" ADD COLUMN "lease_until" TIMESTAMPTZ(6);
