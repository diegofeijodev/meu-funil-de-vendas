-- Fatia 0 (16/11/2026): leitura de estilo que falha por motivo passageiro (sem crédito, limite, rede) volta para a fila
-- em vez de virar "failed"; `attempts` conta as leituras que falharam (0 a 3).
ALTER TABLE "style_references" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "style_references" ADD CONSTRAINT "style_references_attempts_check" CHECK ("attempts" BETWEEN 0 AND 3);
