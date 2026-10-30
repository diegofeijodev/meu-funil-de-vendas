-- Estrategista conduz, Fatia 3 (30/10/2026): o piloto que monta o plano, espera UMA aprovação do pacote e produz o resto (textos,
-- programação do Instagram, artes e vídeo) no servidor. A linha é só cursor + erros: cada etapa deduz "feito" das tabelas de domínio.
CREATE TABLE "campaign_pilot_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "approval_request_id" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "strategy_version" INTEGER,
    "status" TEXT NOT NULL,
    "current_step" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL DEFAULT '{}',
    "estimated_credits" DECIMAL(12,2),
    "max_credits" DECIMAL(12,2),
    "idempotency_key" TEXT NOT NULL,
    "lease_until" TIMESTAMPTZ(6),
    "next_run_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_pilot_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaign_pilot_runs_status_check" CHECK ("status" IN ('planning', 'running', 'blocked', 'done', 'failed', 'cancelled')),
    CONSTRAINT "campaign_pilot_runs_current_step_check" CHECK ("current_step" IN ('strategy', 'copies', 'instagram', 'creatives', 'meta')),
    CONSTRAINT "campaign_pilot_runs_idempotency_key_check" CHECK (length("idempotency_key") BETWEEN 8 AND 100)
);
-- Mesma chave = mesma execução (clique duplo, nova tentativa do navegador).
CREATE UNIQUE INDEX "campaign_pilot_runs_workspace_id_idempotency_key_key" ON "campaign_pilot_runs"("workspace_id", "idempotency_key");
-- Um piloto ativo por campanha.
CREATE UNIQUE INDEX "campaign_pilot_runs_one_active" ON "campaign_pilot_runs"("campaign_id") WHERE "status" IN ('planning', 'running', 'blocked');
CREATE INDEX "campaign_pilot_runs_status_next_run_at_idx" ON "campaign_pilot_runs"("status", "next_run_at");
CREATE INDEX "campaign_pilot_runs_campaign_id_created_at_idx" ON "campaign_pilot_runs"("campaign_id", "created_at" DESC);

ALTER TABLE "campaign_pilot_runs" ADD CONSTRAINT "campaign_pilot_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_pilot_runs" ADD CONSTRAINT "campaign_pilot_runs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "campaign_pilot_runs" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
