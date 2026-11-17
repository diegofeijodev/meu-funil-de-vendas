-- Seleção do Meu Funil automática, em cada empresa (decisões de 17/11, P17/P29/P21'): a origem da pasta e da referência
-- ('own' = da empresa, 'selection' = trazida pelo catálogo), o último conferido da marca e a cota diária de leituras da Seleção.
-- Aditiva: nada existente muda de valor (tudo nasce 'own'/zerado). A 20261116122000_style_library não é editada.
ALTER TABLE "style_ref_sources" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'own';
ALTER TABLE "style_ref_sources" ADD CONSTRAINT "style_ref_sources_origin_check" CHECK ("origin" IN ('own','selection'));

ALTER TABLE "style_references" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'own';
ALTER TABLE "style_references" ADD CONSTRAINT "style_references_origin_check" CHECK ("origin" IN ('own','selection'));

ALTER TABLE "brands" ADD COLUMN "style_library_checked_at" TIMESTAMPTZ(6);
ALTER TABLE "brands" ADD COLUMN "style_selection_day" DATE;
ALTER TABLE "brands" ADD COLUMN "style_selection_reads" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "brands" ADD CONSTRAINT "brands_style_selection_reads_check" CHECK ("style_selection_reads" >= 0);
