-- Registro por peça das referências de estilo que o diretor seguiu (decisão P6).
-- Formato: { "own": [uuid], "library": [uuid], "brand_id": uuid|null }. NULL = peça anterior ou prompt escrito à mão
-- (o diretor não rodou). Fica numa coluna própria, fora do creative_brief, porque o PATCH de ig-posts deixa o cliente
-- reescrever o brief; esta coluna só o servidor grava. O vídeo assíncrono do Estúdio leva o registro em
-- creative_generation_jobs.options.style_refs até o poller criar o criativo.
ALTER TABLE "creatives" ADD COLUMN "style_refs" JSONB;
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_style_refs_check" CHECK ("style_refs" IS NULL OR jsonb_typeof("style_refs") = 'object');

ALTER TABLE "ig_posts" ADD COLUMN "style_refs" JSONB;
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_style_refs_check" CHECK ("style_refs" IS NULL OR jsonb_typeof("style_refs") = 'object');
