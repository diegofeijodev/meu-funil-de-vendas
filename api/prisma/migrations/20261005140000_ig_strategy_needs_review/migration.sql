-- Atualização do protótipo (20261002133929): estratégia do período, posts amarrados a objetivo/pilar/persona/produto e o status
-- `needs_review` (post reprovado pela revisão da IA ou pelas regras de data; entra na fila de Aprovações com o motivo).
ALTER TABLE "ig_auto_runs" ADD COLUMN "strategy" JSONB,
ADD COLUMN "strategy_status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "paused_reason" TEXT;

ALTER TABLE "ig_posts" ADD COLUMN "objective_link" TEXT,
ADD COLUMN "pillar" TEXT,
ADD COLUMN "persona" TEXT,
ADD COLUMN "product_id" UUID,
ADD COLUMN "funnel_stage" TEXT,
ADD COLUMN "review_reason" TEXT,
ADD COLUMN "review_score" DECIMAL;

ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- O CHECK do status vem da migração init (nome `ig_posts_status_check`); o protótipo derruba e recria com `needs_review`.
ALTER TABLE "ig_posts" DROP CONSTRAINT "ig_posts_status_check";
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_status_check" CHECK (status IN ('idea','generating','ready','pending_approval','approved','scheduled','publishing','published','failed','cancelled','needs_review'));
