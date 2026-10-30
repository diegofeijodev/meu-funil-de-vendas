# Fatia 2 — Região de verdade (cidade + raio) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A campanha guarda a região como dado (cidade da Meta + raio), escolhida com "Só a cidade / +20 / +40 / +80 / Outra"; o publicar usa isso e nunca cai em "Brasil inteiro".

**Architecture:** Coluna `campaigns.geo_targets jsonb` (lista ≤ 10 de `{ type: 'city', name, uf, meta_key, radius_km }`). Busca de cidade pela Meta (`GET …/geo/search`), gravação por `POST …/campaigns` (intake) e `PATCH …/campaigns/:id/geo-targets` (detalhe). `geoFor` usa `geo_targets` quando houver; sem eles, o caminho de texto da Fatia 0 continua.

**Tech Stack:** NestJS + Prisma (jest com Graph falsa), Next.js.

**Spec:** `docs/superpowers/specs/2026-10-29-estrategista-conduz-design.md` §2.2, §0.4 (raio 17–80 km, opções), §0.7 #4 (F2 vale para todas as empresas); tela `…-ui.md` §A (Região).

## Global Constraints

- Raio de cidade na Meta: 17 a 80 km (`distance_unit: 'kilometer'`); `radius_km: null` = só a cidade (sem `radius`). Padrão da tela = +20 (igual a hoje).
- Item gravado: `{ type: 'city', name (≤ 120), uf (2 letras) | null, meta_key (só dígitos) | null, radius_km: null | 17..80 }`; até 10 itens.
- Sem Meta conectada a busca responde `{ error: { code: 'META_NOT_CONNECTED' } }` (200) e a cidade é salva sem `meta_key` (resolvida no publicar).
- Publicar com `geo_targets`: item sem `meta_key` é resolvido por nome + UF; se algum não resolver → `GEO_UNRESOLVED` com o nome (nunca "Brasil inteiro").
- `PATCH geo-targets` segue a janela e o papel do `setLocation` (antes da Meta; depois do pedido de aprovação só owner|admin) e também grava `audience.localizacao` legível ("Jundiaí, SP").
- Testes um arquivo por comando via `scripts/run-capped.sh`.

## Review Focus

1. Raio fora de 17–80 (ex.: 10, 100) → 400 com a frase "A Meta aceita de 17 a 80 km em volta de uma cidade.".
2. Campanha antiga sem `geo_targets` → publica como na Fatia 0 (texto), sem mudança.
3. Item com `meta_key` → vai direto para a Meta, sem nova busca.
4. Mudar a cidade no detalhe depois de criada pelo intake → `geo_targets` e `audience.localizacao` mudam juntos (sem duas verdades).
5. Busca com a Meta fora do ar → 502 da Meta, não lista vazia.

---

### Task 1: API — `geo_targets` na campanha e no publicar

**Files:**
- Create: `api/prisma/migrations/20261029130000_campaign_geo_targets/migration.sql`; Modify: `api/prisma/schema.prisma`
- Create: `api/src/modules/campaigns/geo-targets.ts` (`parseGeoTargets(raw: unknown): GeoTarget[]`, `geoLabel(targets): string`)
- Modify: `campaigns.service.ts` (`create` aceita `geo_targets`; `setGeoTargets`), `campaigns.controller.ts` (`PATCH :id/geo-targets`), `dto/campaigns.dto.ts`
- Modify: `api/src/modules/ads/meta-ops.service.ts` (`PublishInput.geoTargets?`, `geoFor` usa os itens), `meta-ads.service.ts` (passa `c.geo_targets`)
- Modify: `api/src/modules/strategist/strategist.prompt.ts` (`regiao` = `geoLabel` quando houver)
- Test: `api/src/modules/campaigns/__tests__/geo-targets.spec.ts`, `api/src/modules/ads/__tests__/meta-ads.spec.ts`

**Interfaces:**
- Produces: `type GeoTarget = { type: 'city'; name: string; uf: string | null; meta_key: string | null; radius_km: number | null }`; `geoLabel` → "Jundiaí – SP (+20 km)", "Jundiaí – SP (só a cidade)", itens unidos por ", ".
- [ ] Testes: parse aceita o item e normaliza UF maiúscula; raio 10/100 → 400 "A Meta aceita de 17 a 80 km em volta de uma cidade."; `meta_key` com letra → 400; > 10 itens → 400; `create` grava; `setGeoTargets` grava `geo_targets` + `audience.localizacao`; publicar com `meta_key` não chama `/search` e manda `{ key, radius: 40, distance_unit: 'kilometer' }`; `radius_km: null` manda só `{ key }`; item sem chave resolve por nome+UF; item não achado → `GEO_UNRESOLVED` com o nome; sem `geo_targets` = Fatia 0.
- [ ] Ver falhar → implementar → ver passar → commit `feat(campaigns): região estruturada (cidade + raio) usada no publicar`

### Task 2: API — busca de cidade

**Files:**
- Modify: `api/src/modules/ads/meta-ops.service.ts` (`searchCities(ws, q)`), `meta-ads.service.ts` (`geoSearch(userId, ws, q)`), `ads.controller.ts` ou controller próprio `GET /v1/workspaces/:workspaceId/geo/search?q=`
- Test: `api/src/modules/ads/__tests__/meta-ads.spec.ts`

**Interfaces:**
- Produces: `GET /v1/workspaces/:workspaceId/geo/search?q=` (read) → `{ items: { meta_key, name, uf, region }[] }` (até 8 cidades do BR) ou `{ error: { code: 'META_NOT_CONNECTED', message } }`; q < 2 letras → `{ items: [] }`.
- [ ] Testes: devolve as cidades com UF tirada do `region`; sem credenciais → `META_NOT_CONNECTED`; erro da Meta → 502; estranho → 403.
- [ ] Ver falhar → implementar → ver passar → contrato → commit `feat(ads): busca de cidade da Meta para a região`

### Task 3: Web — região no "Entendi" e no detalhe

**Files:**
- Create: `web/src/components/region-picker.tsx` (campo da cidade com busca + chips de raio + "Outra distância" de 17 a 80)
- Modify: `web/src/modules/campaigns/infrastructure/campaigns.api.ts` (`searchGeo`, `setCampaignGeoTargets`, `geo_targets` no `NewCampaignInput` e no `campaign`), `IntakePanel.tsx` (usa o picker), `CampaignDetail.tsx` (o aviso da cidade vira o picker e grava `geo-targets`)

- [ ] Picker: digita → busca (debounce 400 ms) → lista "Jundiaí – SP"; escolher grava `meta_key`; sem Meta conectada: texto "Escreva cidade e estado, como no endereço. Vamos conferir na Meta quando ela estiver conectada." e salva só o nome; chips "Só a cidade · +20 km · +40 km · +80 km · Outra distância" (+20 marcado), "Outra" abre número 17–80 com a frase da Meta; frase de resumo ("Jundiaí e cidades em volta, até 20 km do centro.").
- [ ] eslint dos arquivos + `yarn typecheck` → commit `feat(web): região com cidade da Meta e raio`
