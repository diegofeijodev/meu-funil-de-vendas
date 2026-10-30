-- Fatia 6 (revisão, 29/10/2026): Pins já vistos de cada pasta acompanhada. Sem isso, um Pin removido (ou que saiu pelo teto de 30)
-- voltava na renovação seguinte e gastava uma leitura de IA por dia. Guarda os 300 mais recentes.
ALTER TABLE "style_ref_sources" ADD COLUMN "seen_pin_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
