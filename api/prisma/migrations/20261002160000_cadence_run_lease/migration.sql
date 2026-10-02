-- Task 8: motor de cadências com lease (nenhum passo é enviado duas vezes) e uma matrícula por (cadência, lead).
ALTER TABLE "crm_cadence_runs" ADD COLUMN "lease_until" TIMESTAMPTZ(6);
ALTER TABLE "crm_cadence_runs" ADD COLUMN "lease_token" UUID;

-- Duplicatas antigas (o protótipo não tinha a restrição): fica a mais recente de cada par.
DELETE FROM "crm_cadence_runs" a USING "crm_cadence_runs" b
 WHERE a."cadence_id" = b."cadence_id" AND a."lead_id" = b."lead_id"
   AND (a."created_at" < b."created_at" OR (a."created_at" = b."created_at" AND a."id" < b."id"));

CREATE UNIQUE INDEX "crm_cadence_runs_cadence_lead_uidx" ON "crm_cadence_runs"("cadence_id", "lead_id");
