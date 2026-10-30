# Fatia 0 — anúncio na Meta com data de fim, verba e cidade de verdade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O "Publicar na Meta" do caminho manual nunca mais cria anúncio sem data de fim, com verba inventada (R$ 20) ou para o Brasil inteiro por engano.

**Architecture:** Correções dentro do módulo `ads` (`MetaOpsService.publishPaused`, `MetaAdsService.publish/setStatus`, `AdsChannelsService`) mais duas rotas de ajuste no módulo `campaigns` (verba e cidade) e dois avisos no detalhe da campanha no web, no mesmo molde do aviso "Falta a página de destino". Sem migração: verba e cidade já existem (`budget_daily`, `budget_total`, `audience.localizacao`).

**Tech Stack:** NestJS + Prisma (api, jest com `META_FETCH` falso), Next.js (web).

**Spec:** `docs/superpowers/specs/2026-10-29-estrategista-conduz-design.md` §0.3, §0.5 (F0), §0.7 #2–#3, §0.8.

## Global Constraints

- Data "só dia" é Brasília: `todaySp()`; dia de coluna `DATE` vira texto com `dateToString()` (`api/src/common/time/dates.ts`).
- Fim do dia na Meta = `<end_date>T23:59:59-0300` (Brasília, sem horário de verão desde 2019).
- O deploy não pausa nada; campanha sem `end_date` continua publicando sem `end_time` (§0.7 #3).
- Mensagens pt-BR prontas para a tela, no formato `{ code, message }` da API.
- Testes: um arquivo por comando, `scripts/run-capped.sh 1500 npx jest --runInBand <arquivo>` dentro de `api/`; nada de suíte inteira, build ou `next dev`.

## Review Focus

1. Cidade digitada com UF ("Jundiaí, SP", "Jundiaí - SP") → a Meta acha a cidade; nunca vira "Brasil inteiro".
2. Campanha antiga sem verba que já está aprovada → o publicar recusa com `BUDGET_MISSING` e a tela mostra onde pôr a verba (não fica presa).
3. Falha da cidade não deixa campanha órfã na Meta (a cidade é resolvida ANTES de criar a campanha).
4. Campanha com `end_date` no passado → publicar e ativar recusam (`PERIOD_ENDED`); pausar continua possível.
5. Link de destino que já tem `utm_source` (ex.: link do Freela já marcado) → o sistema não duplica as UTMs.

---

### Task 1: API — data de fim, verba obrigatória e cidade estrita na publicação

**Files:**
- Modify: `api/src/modules/ads/meta-ops.service.ts` (`PublishInput`, `geoFor`, `publishPaused`)
- Modify: `api/src/modules/ads/meta-ads.service.ts` (`publishLocked`, `setStatus`)
- Modify: `api/src/modules/ads/ads-channels.service.ts` (Google/TikTok `|| 20` / `|| 50`)
- Test: `api/src/modules/ads/__tests__/meta-ads.spec.ts`, `api/src/modules/ads/__tests__/channels.spec.ts`, `api/src/modules/ads/__tests__/harness.ts`

**Interfaces:**
- Produces: `PublishInput.endDate?: string | null` ("YYYY-MM-DD"); erros `BUDGET_MISSING`, `GEO_UNRESOLVED`, `PERIOD_ENDED` (400, `{code, message}`); helper exportado `metaEndTime(endDate: string): string` em `meta-ops.service.ts`; `withUtm(url: string, source: string, medium: string, campaign: string): string` em `api/src/modules/ads/ads-utm.ts`.

- [ ] **Step 1: harness** — `seedCampaign` passa a ter `audience: { localizacao: 'Jundiaí, SP' }` por padrão; `respondPublish` responde `/search` com `type=adgeolocation` → `{ data: [{ key: '269969', name: 'Jundiaí', type: 'city' }] }` e mantém `{ data: [] }` para os outros tipos.
- [ ] **Step 2: testes que falham** (em `meta-ads.spec.ts`, `describe('MetaAdsService.publish — Fatia 0')`):
  - `end_date` 2026-11-28 → conjunto com `end_time: '2026-11-28T23:59:59-0300'` e step com "para sozinha em 28/11/2026 às 23:59"; sem `end_date` → conjunto sem `end_time`.
  - `budget_daily: 0` e `null` → `400:Defina quanto quer gastar por dia antes de publicar.` com `code: 'BUDGET_MISSING'`, `w.calls` vazio.
  - `audience: {}` → `400:Diga em que cidade o anúncio deve aparecer antes de publicar.` (`GEO_UNRESOLVED`); `/search` vazio para "Cidade Inventada" → `400:A Meta não achou a cidade "Cidade Inventada". Escreva como no mapa (ex.: Jundiaí, SP).` (`GEO_UNRESOLVED`); nos dois, nenhum POST em `/campaigns`.
  - `audience: { localizacao: 'Brasil inteiro' }` → `geo_locations: { countries: ['BR'] }` (escolha explícita continua valendo).
  - `end_date` ontem (Brasília) → `400:O período desta campanha terminou em DD/MM/AAAA. Crie uma campanha nova para anunciar de novo.` (`PERIOD_ENDED`), no publicar e no `setStatus('ACTIVE')`; `setStatus('PAUSED')` continua ok.
  - `landing_url` com `?utm_source=x` → link do criativo sem segunda `utm_source`.
  - Em `channels.spec.ts`: Google e TikTok com `budget_daily: 0` → `BUDGET_MISSING`.
- [ ] **Step 3: rodar e ver falhar** — `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/ads/__tests__/meta-ads.spec.ts` → FAIL nos casos novos.
- [ ] **Step 4: implementar**
  - `geoFor` devolve `{ geo, label, unresolved: string[] }`; texto vazio → lança `GEO_UNRESOLVED`; nenhuma cidade achada e texto não é "Brasil/Brasil inteiro/nacional/todo o país" → lança `GEO_UNRESOLVED` com o texto; escolha nacional explícita → `countries: ['BR']`, label "Brasil inteiro (escolhido)". Resolver a cidade ANTES do POST `/campaigns`.
  - `publishPaused`: com `input.endDate`, cada conjunto recebe `end_time: metaEndTime(endDate)`; step `{ key: 'end', label: 'A Meta para sozinha em DD/MM/AAAA às 23:59 (fim da campanha)' }`.
  - `publishLocked`: `budget_daily` vazio/≤ 0 → `BUDGET_MISSING`; `end_date < todaySp()` → `PERIOD_ENDED`; passa `endDate`; UTM via `withUtm` (não duplica quando o link já tem `utm_source`).
  - `setStatus('ACTIVE')`: `end_date < todaySp()` → `PERIOD_ENDED`.
  - `AdsChannelsService`: Google e TikTok sem verba → `BUDGET_MISSING` (mesma mensagem), UTM via `withUtm`.
- [ ] **Step 5: rodar os dois arquivos** (um por comando) → PASS, inclusive os testes antigos.
- [ ] **Step 6: commit** `fix(ads): anúncio da Meta com data de fim, verba obrigatória e cidade de verdade`

### Task 2: API — rotas para ajustar verba e cidade antes de publicar

**Files:**
- Modify: `api/src/modules/campaigns/campaigns.service.ts`, `campaigns.controller.ts`, `dto/campaigns.dto.ts`
- Modify: `docs/api-contract.md` (seção de campanhas)
- Test: `api/src/modules/campaigns/__tests__/campaigns.service.spec.ts`

**Interfaces:**
- Produces: `PATCH /v1/workspaces/:ws/campaigns/:id/budget` corpo `{ budget_daily: number (1–100000), budget_total?: number | null }`; `PATCH /v1/workspaces/:ws/campaigns/:id/location` corpo `{ location: string (2–200) }` → grava `audience.localizacao` mantendo o resto do `audience`. `CampaignsService.setBudget(userId, ws, id, dto)` e `setLocation(userId, ws, id, location)`; atividades `campaign.budget_updated` e `campaign.location_updated`.

- [ ] **Step 1: testes que falham** — grava verba (e teto opcional) e cidade (trim, mantém `audience.idade`); verba ≤ 0 → `400:Informe um valor por dia maior que zero.`; teto menor que a verba do dia → `400:O teto do mês não pode ser menor que a verba de um dia.`; cidade vazia → `400:Informe a cidade (ex.: Jundiaí, SP).`; campanha já enviada à Meta (`meta_campaign_id`) ou fora de `draft|pending_approval|approved` → `400:A campanha já foi publicada: mude direto na Meta.`; outro workspace → 404.
- [ ] **Step 2: ver falhar** — `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/campaigns/__tests__/campaigns.service.spec.ts`.
- [ ] **Step 3: implementar** no molde do `setLandingUrl` (mesma janela `LANDING_EDITABLE` + `meta_campaign_id` nulo).
- [ ] **Step 4: ver passar** e atualizar o contrato.
- [ ] **Step 5: commit** `feat(campaigns): ajustar verba e cidade antes de publicar`

### Task 3: Web — avisos "Falta a verba" e "Em que cidade" no detalhe da campanha

**Files:**
- Modify: `web/src/modules/campaigns/infrastructure/campaigns.api.ts` (`setCampaignBudget`, `setCampaignLocation`)
- Modify: `web/src/app/(app)/campaigns/[id]/CampaignDetail.tsx`

**Interfaces:**
- Consumes: rotas da Task 2; códigos da Task 1.

- [ ] **Step 1:** painel "Falta a verba por dia" (campo "R$ por dia" + "Teto do mês (opcional)", botão "Salvar verba") quando `!metaId`, status editável e `!(budget_daily > 0)`.
- [ ] **Step 2:** painel "Em que cidade o anúncio aparece" (campo com a cidade atual, botão "Salvar cidade") quando `!metaId`, status editável e (cidade vazia OU o último publicar voltou `GEO_UNRESOLVED`).
- [ ] **Step 3:** no `publish`, `BUDGET_MISSING` e `GEO_UNRESOLVED` mostram o toast com ação "Ajustar" que rola até o painel; `PERIOD_ENDED` só o toast.
- [ ] **Step 4:** checagem estática: `cd web && ../scripts/run-capped.sh 1500 npx eslint "src/app/(app)/campaigns/[id]/CampaignDetail.tsx" src/modules/campaigns/infrastructure/campaigns.api.ts`.
- [ ] **Step 5: commit** `feat(web): avisos de verba e cidade antes de publicar na Meta`

### Task 4: Lista só de leitura das campanhas já ligadas sem data de fim

**Files:**
- Create: `api/scripts/ops/campanhas-meta-sem-fim.sql`
- Modify: `docs/deploy.md` (passo "depois de subir a Fatia 0")

- [ ] **Step 1:** SQL só de leitura: campanhas com `meta_campaign_id` e `meta_delivery_status = 'ACTIVE'`, com empresa, `end_date`, `budget_daily`, "já passou do fim?" (`end_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date`), ordenado pelo fim.
- [ ] **Step 2:** no `docs/deploy.md`, o comando de leitura (via `docker exec meufunil-postgres psql`) e a regra: o deploy não pausa nada; o Denner confere caso a caso.
- [ ] **Step 3: commit** `docs(ops): lista das campanhas da Meta ligadas antes da data de fim`
