-- Estrategista conduz, Fatia 1 (29/10/2026): o pedido do dono em texto (`intake_text`, vai ao prompt como pedido original) e as condições
-- da oferta anunciada (`offer_terms`, restrição obrigatória nos prompts). Aditiva: campanhas antigas ficam com NULL.
ALTER TABLE "campaigns" ADD COLUMN "intake_text" TEXT;
ALTER TABLE "campaigns" ADD COLUMN "offer_terms" JSONB;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_intake_text_len" CHECK ("intake_text" IS NULL OR char_length("intake_text") <= 4000);
