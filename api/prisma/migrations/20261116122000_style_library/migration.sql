-- Fatia 4 (Seleção do Meu Funil; decisão P11): a marca completa as referências de estilo com as da empresa interna "Biblioteca Meu Funil".
-- style_library_enabled: interruptor da marca (padrão ligado; só vale com STYLE_LIBRARY_ENABLED=true no servidor).
-- style_library_segment: NULL = ramo automático pelo texto de brands.segment; id de categoria (style-refs/categories.ts) = ramo escolhido;
--   'none' = "Nenhum desses". Na empresa Biblioteca, cada marca leva aqui o ramo que serve.
-- O CHECK aceita só ids no formato de categoria (a lista fechada fica no código, como em style_notes).
ALTER TABLE "brands" ADD COLUMN "style_library_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "brands" ADD COLUMN "style_library_segment" TEXT;
ALTER TABLE "brands" ADD CONSTRAINT "brands_style_library_segment_check" CHECK ("style_library_segment" IS NULL OR "style_library_segment" ~ '^[a-z_]{2,40}$');
CREATE INDEX "brands_style_library_segment_idx" ON "brands"("workspace_id", "style_library_segment") WHERE "style_library_segment" IS NOT NULL;
