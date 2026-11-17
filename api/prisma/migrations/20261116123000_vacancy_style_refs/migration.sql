-- Pinterest automático, Fatia 5: a foto do story das vagas pode seguir paleta, luz e clima das referências da marca.
-- Desligado por padrão: ligar por empresa nos Ajustes das vagas e medir `used_fallback` por uma semana.
ALTER TABLE "vacancy_story_settings" ADD COLUMN "style_refs_enabled" BOOLEAN NOT NULL DEFAULT false;
