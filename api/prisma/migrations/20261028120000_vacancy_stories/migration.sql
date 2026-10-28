-- Stories automáticos das vagas do Freela (28/10/2026): configuração por empresa (`vacancy_story_settings`) e fila de stories
-- (`vacancy_stories`), uma linha por (empresa, origem, vaga). Além do que o Prisma expressa:
--  * colunas array NOT NULL (template_texts, cities), como nas demais tabelas;
--  * CHECKs: daily_cap 1..20, vendor openai|gemini, min_lead_minutes 60|120|240|360, janela HH:MM com início < fim, status da fila;
--  * gatilhos touch_updated_at nas duas tabelas.
-- CreateTable
CREATE TABLE "vacancy_story_settings" (
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabled_at" TIMESTAMPTZ(6),
    "enabled_by" UUID,
    "template_asset_id" UUID,
    "template_texts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "template_bg" TEXT,
    "template_landscape" BOOLEAN NOT NULL DEFAULT false,
    "cities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "daily_cap" INTEGER NOT NULL DEFAULT 10,
    "window_start" TEXT NOT NULL DEFAULT '08:00',
    "window_end" TEXT NOT NULL DEFAULT '21:00',
    "min_lead_minutes" INTEGER NOT NULL DEFAULT 120,
    "vendor" TEXT NOT NULL DEFAULT 'openai',
    "auto_publish" BOOLEAN NOT NULL DEFAULT false,
    "last_poll_at" TIMESTAMPTZ(6),
    "last_poll_ok_at" TIMESTAMPTZ(6),
    "last_poll_error" TEXT,
    "recent_cities" JSONB NOT NULL DEFAULT '[]',
    "preview" JSONB NOT NULL DEFAULT '{}',
    "ai_error" TEXT,
    "ai_error_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacancy_story_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "vacancy_stories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'freela',
    "external_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "skip_reason" TEXT,
    "wait_reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "template_asset_id" UUID,
    "lease_until" TIMESTAMPTZ(6),
    "next_attempt_at" TIMESTAMPTZ(6),
    "not_before" TIMESTAMPTZ(6),
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "post_now" BOOLEAN NOT NULL DEFAULT false,
    "mismatch_attempts" INTEGER NOT NULL DEFAULT 0,
    "ai_error_count" INTEGER NOT NULL DEFAULT 0,
    "redo_count" INTEGER NOT NULL DEFAULT 0,
    "attempts_log" JSONB NOT NULL DEFAULT '[]',
    "used_fallback" BOOLEAN NOT NULL DEFAULT false,
    "feedback" TEXT,
    "ig_post_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacancy_stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vacancy_stories_ig_post_id_key" ON "vacancy_stories"("ig_post_id");

-- CreateIndex
CREATE INDEX "vacancy_stories_status_starts_at_idx" ON "vacancy_stories"("status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "vacancy_stories_workspace_id_source_external_id_key" ON "vacancy_stories"("workspace_id", "source", "external_id");

-- AddForeignKey
ALTER TABLE "vacancy_story_settings" ADD CONSTRAINT "vacancy_story_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_story_settings" ADD CONSTRAINT "vacancy_story_settings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_story_settings" ADD CONSTRAINT "vacancy_story_settings_template_asset_id_fkey" FOREIGN KEY ("template_asset_id") REFERENCES "brand_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_stories" ADD CONSTRAINT "vacancy_stories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_stories" ADD CONSTRAINT "vacancy_stories_ig_post_id_fkey" FOREIGN KEY ("ig_post_id") REFERENCES "ig_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vacancy_story_settings" ADD CONSTRAINT "vacancy_story_settings_daily_cap_check" CHECK (daily_cap BETWEEN 1 AND 20);
ALTER TABLE "vacancy_story_settings" ADD CONSTRAINT "vacancy_story_settings_vendor_check" CHECK (vendor IN ('openai','gemini'));
ALTER TABLE "vacancy_story_settings" ADD CONSTRAINT "vacancy_story_settings_lead_check" CHECK (min_lead_minutes IN (60,120,240,360));
ALTER TABLE "vacancy_story_settings" ADD CONSTRAINT "vacancy_story_settings_window_check" CHECK (window_start ~ '^\d{2}:\d{2}$' AND window_end ~ '^\d{2}:\d{2}$' AND window_start < window_end);
ALTER TABLE "vacancy_stories" ADD CONSTRAINT "vacancy_stories_status_check" CHECK (status IN ('new','skipped','waiting','generating','handed_off','failed','expired','cancelled'));

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "vacancy_story_settings" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "vacancy_stories" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
