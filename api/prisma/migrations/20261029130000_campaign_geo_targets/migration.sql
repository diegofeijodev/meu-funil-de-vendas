-- Estrategista conduz, Fatia 2 (29/10/2026): região da campanha como dado — lista de cidades da Meta com raio (17–80 km ou só a cidade).
-- Aditiva: campanhas antigas ficam com '[]' e seguem publicando pelo texto de `audience.localizacao`.
ALTER TABLE "campaigns" ADD COLUMN "geo_targets" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_geo_targets_array"
  CHECK (jsonb_typeof("geo_targets") = 'array' AND jsonb_array_length("geo_targets") <= 10);
