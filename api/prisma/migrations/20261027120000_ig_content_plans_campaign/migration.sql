-- Encerrar campanha (27/10/2026): o plano do Instagram criado a partir da estratégia ("Criar plano no Instagram") passa a
-- guardar a campanha de origem, para que encerrar a campanha cancele os posts ainda não publicados dela.
ALTER TABLE "ig_content_plans" ADD COLUMN "campaign_id" UUID;

ALTER TABLE "ig_content_plans" ADD CONSTRAINT "ig_content_plans_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ig_content_plans_campaign_id_idx" ON "ig_content_plans" ("campaign_id") WHERE campaign_id IS NOT NULL;

-- Planos já criados por "Criar plano no Instagram": liga quando
--  * o plano foi gravado pelo estrategista (hashtag_strategy.notes começa com "Temas da campanha:"),
--  * o nome "Instagram · <campanha>" casa com UMA única campanha da mesma empresa, e
--  * o nome NÃO é também o de uma marca da empresa (a programação automática cria "Instagram · <marca>": esse é o calendário
--    orgânico da marca e não pode ser cancelado por encerrar uma campanha homônima).
-- Na dúvida fica sem ligação: melhor não cancelar nada do que cancelar o plano errado.
UPDATE "ig_content_plans" p
SET "campaign_id" = c."id"
FROM "campaigns" c
WHERE p."campaign_id" IS NULL
  AND p."workspace_id" = c."workspace_id"
  AND p."name" = 'Instagram · ' || c."name"
  AND p."hashtag_strategy"->>'notes' LIKE 'Temas da campanha:%'
  AND NOT EXISTS (SELECT 1 FROM "brands" b WHERE b."workspace_id" = p."workspace_id" AND p."name" = 'Instagram · ' || b."name")
  AND (SELECT count(*) FROM "campaigns" c2 WHERE c2."workspace_id" = c."workspace_id" AND c2."name" = c."name") = 1;
