-- Estrategista conduz, Fatias 5 e 6 (29/10/2026): referências de estilo das artes. A imagem de referência (enviada ou do Pinterest)
-- só vira NOTAS DE ESTILO em texto para o gerador — o pixel de terceiro nunca vai ao gerador, à Biblioteca, à Meta ou ao Instagram.
-- `style_ref_sources` = pastas/perfis públicos do Pinterest acompanhados pelo RSS (renovados a cada 24 h).
CREATE TABLE "style_ref_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "rss_url" TEXT NOT NULL,
    "title" TEXT,
    "last_synced_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "style_ref_sources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "style_ref_sources_workspace_id_brand_id_rss_url_key" ON "style_ref_sources"("workspace_id", "brand_id", "rss_url");

CREATE TABLE "style_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "campaign_id" UUID,
    "source_id" UUID,
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "pin_id" TEXT,
    "title" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "storage_path" TEXT,
    "style_notes" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'processing',
    "error" TEXT,
    "claimed_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "style_references_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "style_references_source_check" CHECK ("source" IN ('pinterest', 'upload')),
    CONSTRAINT "style_references_kind_check" CHECK ("kind" IN ('image', 'video')),
    CONSTRAINT "style_references_status_check" CHECK ("status" IN ('processing', 'ready', 'failed'))
);
-- Colar o mesmo Pin de novo (ou o RSS trazer o mesmo) = a mesma linha.
CREATE UNIQUE INDEX "style_references_pin_key" ON "style_references"("workspace_id", "brand_id", "pin_id") WHERE "pin_id" IS NOT NULL;
CREATE INDEX "style_references_workspace_id_brand_id_created_at_idx" ON "style_references"("workspace_id", "brand_id", "created_at" DESC);
CREATE INDEX "style_references_pending_idx" ON "style_references"("created_at") WHERE "status" = 'processing';

ALTER TABLE "style_ref_sources" ADD CONSTRAINT "style_ref_sources_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "style_ref_sources" ADD CONSTRAINT "style_ref_sources_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "style_references" ADD CONSTRAINT "style_references_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "style_references" ADD CONSTRAINT "style_references_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "style_references" ADD CONSTRAINT "style_references_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "style_references" ADD CONSTRAINT "style_references_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "style_ref_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
