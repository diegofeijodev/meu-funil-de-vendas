-- Task 8 (correção): uma mensagem RECEBIDA por (workspace, id do provedor). Reentrega/reprocessamento não insere duas vezes.

-- Duplicatas antigas: fica a mais antiga de cada par. Os eventos de cadência que apontam para a apagada passam para a que fica.
WITH ranked AS (
  SELECT "id", first_value("id") OVER (PARTITION BY "workspace_id", "external_id" ORDER BY "created_at", "id") AS keep_id
    FROM "crm_messages"
   WHERE "external_id" IS NOT NULL AND "direction" = 'in'
), dups AS (
  SELECT "id", keep_id FROM ranked WHERE "id" <> keep_id
)
UPDATE "crm_cadence_events" e SET "message_id" = d.keep_id FROM dups d WHERE e."message_id" = d."id";

DELETE FROM "crm_messages" m USING (
  SELECT "id", first_value("id") OVER (PARTITION BY "workspace_id", "external_id" ORDER BY "created_at", "id") AS keep_id
    FROM "crm_messages"
   WHERE "external_id" IS NOT NULL AND "direction" = 'in'
) r
 WHERE m."id" = r."id" AND r."id" <> r.keep_id;

-- Só as recebidas: o id das enviadas só é conhecido depois do envio (e o recibo de status usa o mesmo id).
CREATE UNIQUE INDEX "crm_messages_ws_external_in_uidx" ON "crm_messages"("workspace_id", "external_id") WHERE "external_id" IS NOT NULL AND "direction" = 'in';
