-- Fatia 0 (29/10/2026): campanhas LIGADAS na Meta antes da correção da data de fim.
-- Até a Fatia 0, o conjunto ia para a Meta sem end_time: depois de ativado, gasta até alguém pausar.
-- SÓ LEITURA. O deploy não pausa nada: o Denner confere caso a caso com o dono de cada empresa.
-- Rodar no EC2:
--   docker exec -i meufunil-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X' < api/scripts/ops/campanhas-meta-sem-fim.sql
\pset pager off
SELECT
  w.name                                            AS empresa,
  c.name                                            AS campanha,
  c.status,
  c.meta_delivery_status                            AS na_meta,
  c.start_date                                      AS inicio,
  c.end_date                                        AS fim,
  c.budget_daily                                    AS verba_dia,
  (c.end_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS ja_passou_do_fim,
  c.meta_campaign_id,
  c.id
FROM campaigns c
JOIN workspaces w ON w.id = c.workspace_id
WHERE c.meta_campaign_id IS NOT NULL
  AND c.meta_delivery_status = 'ACTIVE'
ORDER BY c.end_date NULLS FIRST, w.name;
