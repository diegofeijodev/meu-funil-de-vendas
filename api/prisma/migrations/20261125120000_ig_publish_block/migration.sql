-- Bloqueio de publicação do Instagram por empresa (desenho de 24/11/2026, §2.1 R2/R9) e limite de publicações lido da Meta (§2.2 P1).
-- Só o estado ATUAL fica aqui (1 linha por empresa); o histórico de aberturas e fechamentos fica em `ig_autopilot_events` (só inserções).
--  * publish_block_reason: NULL = publicando normalmente; 'permission' (#10/#200–299) ou 'token' (190).
--  * publish_blocked_at: início do bloqueio aberto, ou do último (fica depois do fechamento para o motivo "recusava desde…").
--  * publish_block_failures: recusas seguidas; só zera com prova real (publicação que deu certo ou reconexão).
--  * publish_checked_at: última conferência (automática ou pelo botão; o botão aceita 1 por minuto).
--  * publish_quota_total: `config.quota_total` da Meta em janela de 86400 s (1–1000); NULL = 25.
ALTER TABLE "instagram_accounts"
  ADD COLUMN "publish_block_reason" TEXT,
  ADD COLUMN "publish_block_message" TEXT,
  ADD COLUMN "publish_blocked_at" TIMESTAMPTZ(6),
  ADD COLUMN "publish_block_last_at" TIMESTAMPTZ(6),
  ADD COLUMN "publish_block_failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "publish_next_check_at" TIMESTAMPTZ(6),
  ADD COLUMN "publish_checked_at" TIMESTAMPTZ(6),
  ADD COLUMN "publish_unblocked_at" TIMESTAMPTZ(6),
  ADD COLUMN "publish_quota_total" INTEGER,
  ADD COLUMN "publish_quota_checked_at" TIMESTAMPTZ(6);

ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_publish_block_reason_check" CHECK (publish_block_reason IN ('permission','token'));
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_publish_block_failures_check" CHECK (publish_block_failures >= 0);
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_publish_quota_total_check" CHECK (publish_quota_total BETWEEN 1 AND 1000);
