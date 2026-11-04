-- Aviso de créditos de IA (04/11/2026): a chave própria (OpenAI/Gemini) da Freela App ficou sem saldo em 28/10 e 01/11 e ninguém foi avisado.
-- Uma linha por (empresa DONA da chave, provedor) enquanto a chave estiver sem saldo: gravada na falha por falta de saldo (mantém `first_at`),
-- apagada quando a mesma chave volta a responder ou é trocada/removida. Aditiva: nenhuma tabela existente muda.
CREATE TABLE "ai_credit_alerts" (
    "workspace_id" UUID NOT NULL,
    "vendor" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "first_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_alerts_pkey" PRIMARY KEY ("workspace_id","vendor"),
    CONSTRAINT "ai_credit_alerts_vendor_check" CHECK ("vendor" IN ('openai', 'gemini')),
    CONSTRAINT "ai_credit_alerts_message_check" CHECK (length("message") BETWEEN 1 AND 500),
    CONSTRAINT "ai_credit_alerts_dates_check" CHECK ("last_at" >= "first_at")
);

ALTER TABLE "ai_credit_alerts" ADD CONSTRAINT "ai_credit_alerts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "ai_credit_alerts" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
