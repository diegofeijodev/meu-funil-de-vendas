-- Versões únicas por campanha/criativo (a versão é calculada como max+1; gerações concorrentes duplicavam).
-- Antes de criar os índices, renumera quem já tem duplicatas: só nos pais afetados, mantendo a ordem
-- (version, created_at, id) e deixando a sequência 1..n sem buracos.
UPDATE "campaign_strategies" t SET "version" = r.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY version, created_at, id)::int AS rn
  FROM "campaign_strategies"
  WHERE campaign_id IN (SELECT campaign_id FROM "campaign_strategies" GROUP BY campaign_id, version HAVING COUNT(*) > 1)
) r
WHERE t.id = r.id AND t."version" <> r.rn;

UPDATE "copies" t SET "version" = r.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY version, created_at, id)::int AS rn
  FROM "copies"
  WHERE campaign_id IN (SELECT campaign_id FROM "copies" GROUP BY campaign_id, version HAVING COUNT(*) > 1)
) r
WHERE t.id = r.id AND t."version" <> r.rn;

UPDATE "creative_versions" t SET "version" = r.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY creative_id ORDER BY version, created_at, id)::int AS rn
  FROM "creative_versions"
  WHERE creative_id IN (SELECT creative_id FROM "creative_versions" GROUP BY creative_id, version HAVING COUNT(*) > 1)
) r
WHERE t.id = r.id AND t."version" <> r.rn;

CREATE UNIQUE INDEX "campaign_strategies_campaign_version_key" ON "campaign_strategies"("campaign_id", "version");
CREATE UNIQUE INDEX "copies_campaign_version_key" ON "copies"("campaign_id", "version");
CREATE UNIQUE INDEX "creative_versions_creative_version_key" ON "creative_versions"("creative_id", "version");
