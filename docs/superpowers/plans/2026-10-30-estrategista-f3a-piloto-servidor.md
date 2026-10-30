# Estrategista — F3a: piloto no servidor (sem Meta) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a campanha sai da frase do dono até "textos + Instagram programado + artes e vídeo prontos" sem a pessoa abrir aba por aba: o servidor
monta o plano, espera UMA aprovação do pacote e produz o resto sozinho, retomando depois de falhas.

**Architecture:** módulo novo `api/src/modules/campaign-pilot/` (ninguém o importa). Uma linha `campaign_pilot_runs` por execução é só cursor +
erros; cada etapa deduz "feito" das tabelas de domínio. Um job de 5 min (e um "chute" logo depois de criar/aprovar) pega a execução com lease
condicional e faz **uma ação por rodada**, chamando os serviços existentes por entradas "de sistema" (sem `userId` de tela) extraídas sem mudar
nenhuma rota. A etapa `meta` fica para a F4: aqui ela termina `skipped` com aviso.

**Tech Stack:** NestJS 11, Prisma 5 (Postgres), jest com `FakeTable` (`modules/brands/__tests__/fake-prisma.ts`), class-validator.

**Spec:** `docs/superpowers/specs/2026-10-29-estrategista-conduz-design.md` (§0.4, §0.7 #5, §0.8 #6, §2.0, §2.4, §2.5, §2.5a, §2.6, §5) e
`docs/superpowers/specs/2026-10-29-estrategista-conduz-ui.md` (B, C: estados, códigos de bloqueio e frases).

## Global Constraints

- Regras de baixo consumo do `CLAUDE.md`: jest **um arquivo por vez** via `scripts/run-capped.sh 1500 npx jest <arquivo> --runInBand`; `tsc` uma vez,
  sozinho, no fim (`NODE_OPTIONS=--max-old-space-size=1536 timeout 450 nice -n 19 scripts/run-capped.sh 1500 npm run typecheck`); nada de build.
- O piloto **nunca** chama `MetaAdsService.setStatus`/`setDeliveryStatus` nem nada da Meta nesta fatia (§2.0 #1).
- Post reprovado nunca sai sozinho: o piloto só **cria** a programação do Instagram (§2.0 #2). Modo padrão do pacote: `approval` (§0.8 #6).
- Fluxo manual intacto: nenhuma rota existente muda de caminho, corpo, resposta ou código de erro (§2.0 #3).
- Verba e destino nunca vêm da IA (§2.0 #4) — esta fatia não toca neles.
- Erros `{ error: { code, message } }`; ids da URL por `ParseUuidPipe`; todo `where` com `workspace_id`; rotas estáticas antes das `:id`.
- Flag nova em `common/config/env.validation.ts`, `api/.env.example`, `docker-compose.yml` e `docs/deploy/.env.prod.example`.
- Contrato `docs/api-contract.md` atualizado **antes** do controller (nova §29).
- Custos em créditos do app (`AI_COST` de `modules/ai/ai.service.ts`: imagem ChatGPT 1,5 · vídeo 6,0); nunca em `campaign_costs`.
- Todo número mostrado vem com a conta e a fonte: a estimativa devolve `items[] = { label, formula, value, source }` (regra do dono 08/10).
- Commits locais no branch `feat/estrategista-piloto`, com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Duas rodadas pegando a mesma execução (job + chute ao mesmo tempo) → só uma faz a ação; a outra não grava nada (teste no Task 4).
2. Execução que perde o lease no meio (ação demorou > 10 min) → o resultado atrasado não sobrescreve o estado novo (teste no Task 4).
3. Campanha encerrada ou apagada enquanto o piloto anda → a execução vira `cancelled` na próxima rodada, sem gerar nada (teste no Task 4).
4. Teto de créditos atingido no meio das artes → para em `COST_CAP` antes de gastar, e "Seguir com as N artes" / "Aumentar o teto" continuam (Task 6).
5. Vídeo assíncrono que termina (ou falha) só no `creative-poll-5min` → a vaga sai de `waiting` e o criativo ganha a proveniência sem perder
   os `extras` que o vídeo já tem (legendas/capa) (Task 6).

---

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `api/prisma/migrations/20261030120000_campaign_pilot_runs/migration.sql` + `schema.prisma` | tabela, CHECKs, índices, gatilho |
| `api/src/modules/campaign-pilot/pilot.types.ts` | `PilotOptions`, `StepName`, `StepState`, `Slot`, `PilotRunRow` |
| `api/src/modules/campaign-pilot/pilot-estimate.ts` | conta dos créditos (pura) + opções sugeridas |
| `api/src/modules/campaigns/pilot-summary.ts` | resumo da execução para a lista de campanhas (puro) |
| `api/src/modules/campaign-pilot/pilot-runner.service.ts` | claim/lease, rodada, chute, roteamento por etapa, erros e espera |
| `api/src/modules/campaign-pilot/steps/{strategy,copies,instagram,creatives}.step.ts` | uma ação por etapa |
| `api/src/modules/campaign-pilot/pilot.service.ts` | criar, ler, estimar, aprovar, retomar, parar (API) |
| `api/src/modules/campaign-pilot/pilot.controller.ts` + `pilot.dto.ts` | rotas §29 |
| `api/src/modules/campaign-pilot/pilot-cron.service.ts` + `campaign-pilot.module.ts` | job `campaign-pilot-5min` e DI |
| `api/src/modules/copy-ai/copy-brief.ts` | `buildCopyBrief(campaign, brand)` único (o web monta o mesmo formato) |

---

### Task 1: Entradas "de sistema" nos serviços existentes (sem mudar rotas)

**Files:**
- Modify: `api/src/modules/copy-ai/copy-ai.service.ts`, `api/src/modules/strategist/strategist.service.ts`, `api/src/modules/creative/creative.service.ts`,
  `api/src/modules/campaigns/campaigns.service.ts` (`createCopy`)
- Create: `api/src/modules/copy-ai/copy-brief.ts`
- Test: `api/src/modules/copy-ai/__tests__/copy-ai.service.spec.ts`, `api/src/modules/strategist/__tests__/strategist.service.spec.ts`,
  `api/src/modules/creative/__tests__/creative.service.spec.ts`, novo `api/src/modules/copy-ai/__tests__/copy-brief.spec.ts`

**Interfaces — Produces:**
- `CopyAiService.generateAsSystem(input: same as generate's input): Promise<{ content: any; engine: string }>` — sem `access.require`; `generate` = `require(write)` + `generateAsSystem`.
- `buildCopyBrief(campaign: campaigns row, brand: brands row | null): { brand: Record<string, unknown>; brief: Record<string, unknown> }` — `brand` com
  `name, description, segment, differentials, target_audience, competitors, tone_of_voice, preferred_words, banned_words, region`; `brief` com
  `name, objective, offer_product, offer_price, offer_promise, landing_url, start_date, end_date, audience, budget_total, budget_daily, goal_leads,
  goal_sales, avg_ticket` (números como number, datas `YYYY-MM-DD`; **sem** `brand_id` e **sem** `intake_text`, igual ao `finish()` do web).
- `CampaignsService.createCopy(actorId: string | null, workspaceId, campaignId, dto)` — só o tipo do 1º parâmetro muda.
- `StrategistService.generateAsSystem(workspaceId: string, campaignId: string): Promise<{ version: number; content: FullStrategy }>` (grava a versão
  `draft`, sem atividade); `generate` = `resolveCampaign` + `generateAsSystem` + a mesma atividade de hoje.
- `StrategistService.approveVersion(workspaceId: string, campaignId: string, version: number, actorId: string | null): Promise<void>` — mesma
  transação do `approve` (anteriores `superseded`); 404 se a versão não existe na campanha.
- `StrategistService.latestVersion(workspaceId: string, campaignId: string): Promise<number | null>`.
- `StrategistService.createIgPlanAsSystem(workspaceId: string, campaignId: string): Promise<{ planId: string } | { error: 'NO_IG_PLAN' | 'NO_STRATEGY' | 'CAMPAIGN_ENDED' }>`;
  `createIgPlan` = `resolveCampaign` + `createIgPlanAsSystem` + as MESMAS exceções/mensagens de hoje para cada `error`.
- `CreativeService.generateAsSystem(dto: GenerateCreativeDto, actorId: string, via: { runId: string }): Promise<ArtOutcome>` — sem `access.require`;
  `created_by` = `actorId`; atividade `creative.generated` com `actor_id = null` e `{ via: 'pilot', run_id }`.

- [ ] **Step 1:** rode os 3 specs existentes (um por vez) e anote os totais — é a linha de base do "nada mudou".
- [ ] **Step 2: testes que falham**
  - `copy-ai.service.spec.ts` › `generateAsSystem não exige papel na empresa` (um usuário sem papel chamando `generate` = 403; `generateAsSystem` com o mesmo input devolve a copy do fake).
  - `copy-brief.spec.ts` › `monta marca e briefing como o web` (campanha com `budget_daily: '30.00'` Decimal-like → `30`; `start_date` Date → `'2026-10-30'`; sem `intake_text`/`brand_id`; marca nula → `brand = {}`).
  - `strategist.service.spec.ts` › `generateAsSystem grava versão draft sem exigir papel` · `approveVersion aprova e supersede a anterior` ·
    `createIgPlanAsSystem devolve NO_IG_PLAN sem pilares e createIgPlan mantém a mensagem de hoje`.
  - `creative.service.spec.ts` › `generateAsSystem gera sem papel, created_by = ator e atividade via pilot`.
- [ ] **Step 3:** rode cada spec novo/alterado → FALHA pelos métodos inexistentes.
- [ ] **Step 4:** implemente extraindo o miolo (o método de rota passa a chamar o de sistema).
- [ ] **Step 5:** rode os 4 specs (um por vez) → todos passam e os totais antigos se mantêm (+ os novos).
- [ ] **Step 6:** commit `refactor(piloto): entradas de sistema para copy, estratégia, plano do Instagram e criativos (rotas iguais)`.

### Task 2: Tabela, flags e liberação por empresa

**Files:**
- Create: `api/prisma/migrations/20261030120000_campaign_pilot_runs/migration.sql`; Modify: `api/prisma/schema.prisma`
- Modify: `api/src/common/config/env.validation.ts`, `api/.env.example`, `docker-compose.yml`, `docs/deploy/.env.prod.example`,
  `api/src/modules/workspaces/features.service.ts`, `api/src/modules/brands/__tests__/fake-prisma.ts`
- Create: `api/src/modules/campaign-pilot/pilot.types.ts`, `api/src/modules/campaign-pilot/pilot-gate.ts`
- Test: `api/src/modules/workspaces/__tests__/features.service.spec.ts` (ou o spec onde `campaign_pilot: false` é conferido hoje), novo
  `api/src/modules/campaign-pilot/__tests__/pilot-gate.spec.ts`

**Interfaces — Produces:**
- Tabela `campaign_pilot_runs` (siga a sintaxe de FK/gatilho de `20261029140000_style_references`): `id uuid pk default gen_random_uuid()`,
  `workspace_id uuid not null → workspaces on delete cascade`, `campaign_id uuid not null → campaigns on delete cascade`, `created_by uuid not null`,
  `approval_request_id uuid null`, `approved_by uuid null`, `approved_at timestamptz null`, `strategy_version int null`,
  `status text not null` CHECK in `('planning','running','blocked','done','failed','cancelled')`, `current_step text null` CHECK in
  `('strategy','copies','instagram','creatives','meta')`, `options jsonb not null default '{}'`, `steps jsonb not null default '{}'`,
  `estimated_credits numeric(12,2) null`, `max_credits numeric(12,2) null`, `idempotency_key text not null` CHECK `length between 8 and 100`,
  `lease_until timestamptz null`, `next_run_at timestamptz null`, `created_at`/`updated_at timestamptz not null default now()`;
  `UNIQUE (workspace_id, idempotency_key)`; `CREATE UNIQUE INDEX campaign_pilot_runs_one_active ON campaign_pilot_runs (campaign_id) WHERE status IN ('planning','running','blocked')`;
  índice `(status, next_run_at)`; gatilho `touch_updated_at`. Modelo Prisma `campaign_pilot_runs` com as back-relations em `workspaces` e `campaigns`.
- Env: `CAMPAIGN_PILOT_ENABLED` bool, padrão `false`; `CAMPAIGN_PILOT_WORKSPACE_IDS` texto, padrão `''`; `CAMPAIGN_PILOT_PER_TICK` int 1–10, padrão `2`;
  `CAMPAIGN_PILOT_MAX_CREATIVES` int 1–20, padrão `10`.
- `pilot.types.ts`: `type StepName = 'strategy'|'copies'|'instagram'|'creatives'|'meta'`; `type StepStatus = 'pending'|'running'|'waiting'|'done'|'skipped'|'blocked'|'failed'`;
  `type StepState = { status: StepStatus; attempts: number; error_code?: string | null; error?: string | null; note?: string | null; ref?: string | null; started_at?: string | null; finished_at?: string | null; slots?: Slot[] }`;
  `type Slot = { slot: number; kind: 'image'|'video'; angle: string; status: 'pending'|'waiting'|'done'|'failed'|'skipped'; job_id?: string | null; creative_id?: string | null; score?: number | null; error?: string | null }`;
  `type PilotOptions = { max_angles: number; images_per_angle: number; variations: number; videos: number; instagram: { enabled: boolean; mode: 'approval'|'publish'; weekdays: number[]; times: string[]; story_times: string[]; formats: IgFormat[] }; meta: { enabled: boolean; review_creatives: boolean }; max_credits: number }`;
  `const RUN_STEPS: StepName[] = ['copies','instagram','creatives','meta']`.
- `pilot-gate.ts`: `class PilotGate { constructor(env); enabled(workspaceId: string): boolean }` = `CAMPAIGN_PILOT_ENABLED && inWorkspaceList(parseWorkspaceList('CAMPAIGN_PILOT_WORKSPACE_IDS', …), ws)`.
- `FeaturesService.forWorkspace` devolve `campaign_pilot: gate.enabled(ws)`.
- `FakeTable.match` passa a entender `lt`, `lte`, `gt`, `gte` (Date ou número) — os testes do runner precisam.

- [ ] **Step 1: testes que falham** — `pilot-gate.spec.ts`: `desligado = false mesmo na lista` · `ligado + na lista = true` · `ligado + fora = false` ·
  `'*' em produção derruba a subida`; spec das features: `campaign_pilot segue o portão`; `fake-prisma`: um caso `lte` com Date num spec existente que usa FakeTable (ou no gate spec).
- [ ] **Step 2:** rode → FALHA.
- [ ] **Step 3:** migração, modelo, env (+ arquivos de exemplo/compose), tipos, portão, features, operadores do FakeTable; `scripts/run-capped.sh 1500 npx prisma generate`.
- [ ] **Step 4:** rode os specs → PASSA. Aplique a migração no Postgres local (`docker compose up -d postgres` na raiz; `scripts/run-capped.sh 1500 npx prisma migrate deploy`;
  `docker compose stop postgres` depois).
- [ ] **Step 5:** commit `feat(piloto): tabela campaign_pilot_runs, flags e liberação por empresa`.

### Task 3: Conta dos créditos, opções sugeridas e resumo para a lista (puros)

**Files:** Create `api/src/modules/campaign-pilot/pilot-estimate.ts`, `api/src/modules/campaigns/pilot-summary.ts`; Test
`api/src/modules/campaign-pilot/__tests__/pilot-estimate.spec.ts`, `api/src/modules/campaigns/__tests__/pilot-summary.spec.ts`

**Interfaces — Produces:**
- `type EstimateItem = { label: string; formula: string; value: number; source: string }`.
- `estimatePilot(o: PilotOptions, instagram: { slots: { format: IgFormat }[] } | null): { items: EstimateItem[]; total: number; instagram: EstimateItem | null }`.
  Itens, nesta ordem: **Artes** `"{A} jeitos × {I} artes × {V} versões × 1,5"` = A·I·V·1,5; **Refações** `"até {A·I} × 1,5"` = A·I·1,5; **Vídeo**
  (só se N > 0) `"{N} × 2 tentativas × 6"` = N·2·6. `source` = `"tabela de custo do Meu Funil (imagem 1,5 · vídeo 6)"`. Use `AI_COST.chatgptImage`
  e `AI_COST.video`. Instagram (fora do teto): soma por formato com custo unitário `feed_image 1,5 · story_image 1,5 · feed_carousel 5 × 1,5 · reel 6 · story_video 6`
  (carrossel = 5 slides, média dos 4–7 do `auto-calendar.service.ts`), `formula` listando `"{qtd} {formato} × {custo}"` por formato presente.
- `slotCost(kind: 'image'|'video', variations: number): number` — imagem = `variations × 1,5 + 1,5` (uma refação); vídeo = `2 × 6`.
- `suggestedOptions(strategy: FullStrategy | null, maxCreatives: number): PilotOptions` — `max_angles = min(3, nº de ângulos, ≥1)`, `images_per_angle 2`,
  `variations 3`, `videos 1`, `instagram { enabled: true, mode: 'approval', weekdays [1,3,5], times ['11:00','18:00'], story_times ['12:00'],
  formats ['feed_image','reel','story_image'] }`, `meta { enabled: true, review_creatives: false }`, `max_credits` = total da estimativa dessas opções;
  se `A·I + videos > maxCreatives`, reduz `images_per_angle` até caber. *(decisão da consolidação; o dono troca no "Ajustar")*
- `pilotSummary(run: { status; current_step; steps } | null): { status: string; current_step: string | null; first_block_code: string | null; counts: { done: number; total: number } } | null`
  — `counts` = vagas de criativos `done` / total; `first_block_code` = `error_code` da 1ª etapa `blocked`/`failed` na ordem `RUN_STEPS`.

- [ ] **Step 1: testes que falham** — `exemplo padrão da spec dá 27 + 9 + 12 = 48` (A3 I2 V3 N1; confere `formula` exata dos 3 itens) · `sem vídeo não tem item de vídeo` ·
  `Instagram: 4 feed_image + 2 reel + 4 story_image = 4×1,5 + 2×6 + 4×1,5 = 24` · `slotCost imagem V3 = 6; vídeo = 12` ·
  `suggestedOptions corta artes por jeito para caber no máximo de peças` · `pilotSummary acha o 1º bloqueio e conta as vagas`.
- [ ] **Step 2:** rode → FALHA. **Step 3:** implemente. **Step 4:** rode → PASSA.
- [ ] **Step 5:** commit `feat(piloto): conta dos créditos com fórmula e fonte, opções sugeridas e resumo`.

### Task 4: Runner — lease, rodada, chute, etapa `strategy`, erros e cancelamento

**Files:** Create `api/src/modules/campaign-pilot/pilot-runner.service.ts`, `api/src/modules/campaign-pilot/steps/strategy.step.ts`,
`api/src/modules/campaign-pilot/__tests__/world.ts` (FakeTables + serviços falsos), `api/src/modules/campaign-pilot/__tests__/pilot-runner.spec.ts`

**Interfaces — Produces:**
- `type StepResult = { kind: 'done'; ref?: string | null; note?: string | null } | { kind: 'again' } | { kind: 'wait'; minutes: number } | { kind: 'skipped'; note: string }
  | { kind: 'blocked'; code: string; message: string; stopRun: boolean }` — `again` = há mais trabalho nesta etapa (rodada seguinte já);
  `wait` = nada a fazer até `minutes`; `blocked` com `stopRun=false` marca a etapa e segue para a próxima.
- `interface PilotStep { run(run: PilotRunRow): Promise<StepResult> }`; registro `Record<StepName, PilotStep>`.
- `PilotRunnerService.tick(now = new Date()): Promise<number>` (quantas rodou) — até `CAMPAIGN_PILOT_PER_TICK`, uma por empresa por rodada, mais
  antiga (`next_run_at`) primeiro; `PilotRunnerService.kick(runId: string): void` (`setImmediate`, erros só no log); `PilotRunnerService.runOnce(runId, now)`.
- Claim: `updateMany({ where: { id, status: { in: ['planning','running'] }, next_run_at: { lte: now }, OR: [{ lease_until: null }, { lease_until: { lt: now } }] }, data: { lease_until: now + 10 min } })`;
  `count === 1` = é nossa. Toda gravação depois da ação usa `where: { id, lease_until: <o valor que pegamos> }` e solta o lease (`lease_until: null`);
  `count === 0` = perdemos o lease → descarta e loga.
- Antes da ação: campanha sumiu ou `status === 'finished'` → execução `cancelled`, `next_run_at null`, nota "Campanha encerrada".
- Etapa `strategy` (status `planning`): `StrategistService.generateAsSystem` → etapa `done`, `ref = String(version)`, `run.strategy_version = version`,
  `next_run_at = null` (fica esperando o "Aprovar").
- Etapas da execução (`running`): `RUN_STEPS` em ordem; a etapa corrente roda; `done`/`skipped`/`blocked(stopRun=false)` → `current_step` = próxima e
  `next_run_at = now` (chute imediato não: a próxima rodada); fim da lista → `status 'done'`, atividade `campaign.pilot_done` (`actor null`, `{ via:'pilot', run_id }`).
- Erros lançados pela etapa: `AiError` com código `AI_NOT_CONFIGURED` → `blocked` `AI_NOT_CONFIGURED` (para a execução: `status 'blocked'`);
  mensagem que começa com `"Créditos de IA esgotados"` → `blocked` `AI_NO_CREDITS` (idem); qualquer outro → `attempts+1`, espera 5 / 15 / 60 min;
  na 3ª falha a etapa vira `failed` e a execução `failed` com o motivo.
- `started_at`/`finished_at` por etapa (ISO).

- [ ] **Step 1: testes que falham** (`pilot-runner.spec.ts`, relógio passado como argumento):
  `planning: gera a estratégia, grava strategy_version e para esperando aprovação` ·
  `duas rodadas ao mesmo tempo: só uma chama o estrategista` (dispare `runOnce` duas vezes antes de resolver o fake) ·
  `lease perdido: resultado atrasado não grava` (avance o relógio 11 min e pegue de novo antes do 1º terminar) ·
  `campanha encerrada vira cancelled sem chamar nada` ·
  `erro comum: 3 tentativas com 5, 15 e 60 min e depois failed` ·
  `AI_NOT_CONFIGURED bloqueia a execução sem nova tentativa` ·
  `tick: no máximo PER_TICK execuções e uma por empresa`.
- [ ] **Step 2:** rode → FALHA. **Step 3:** implemente. **Step 4:** rode → PASSA.
- [ ] **Step 5:** commit `feat(piloto): runner com lease, uma ação por rodada e etapa da estratégia`.

### Task 5: Etapas `copies`, `instagram` e `meta` (aviso)

**Files:** Create `steps/copies.step.ts`, `steps/instagram.step.ts`, `steps/meta.step.ts` em `api/src/modules/campaign-pilot/`; Test `__tests__/pilot-steps.spec.ts`

**Interfaces — Consumes:** Task 1 (`generateAsSystem`, `buildCopyBrief`, `createCopy`, `createIgPlanAsSystem`), `AutoCalendarService.createAutoRun(ws, actorId, CreateAutoInput)`.
- `copies`: já existe `copies` da campanha com `created_at ≥ approved_at` → `done` (`note` "já feita"); senão copy de sistema + `createCopy(null, …)` → `done`, `ref = copy.id`.
- `instagram`: `options.instagram.enabled === false` → `skipped` "Instagram desligado no pacote."; já existe `ig_auto_runs` desta campanha com `created_at ≥ approved_at`
  → `done` com esse `ref`; senão `createIgPlanAsSystem` (`NO_IG_PLAN` → `blocked` `NO_IG_PLAN` "O plano veio sem os temas do Instagram, então os posts não foram programados. O anúncio segue normal.", `stopRun=false`)
  → `createAutoRun(ws, run.approved_by, { planId, campaignId, brandId, mode, startDate: max(campaign.start_date, hoje SP), endDate: campaign.end_date, weekdays, times, storyTimes, formats, focus })`
  com `focus` = `"{objetivo}: {offer_product} — {offer_promise}"` completado com o nome da campanha até ≥ 30 caracteres; `UserError` do `createAutoRun` →
  `blocked` `IG_NOT_SCHEDULED` com a mensagem dele, `stopRun=false`; sucesso → `done`, `ref = runId`, `note` = `"{total} posts até DD/MM"`.
- `meta`: `options.meta.enabled` → `skipped` "A montagem do anúncio na Meta entra na próxima etapa do piloto."; senão `skipped` "Anúncio na Meta desligado no pacote."

- [ ] **Step 1: testes que falham** — `copies: gera uma vez; segunda rodada não duplica` · `copies: copy feita à mão depois de aprovar conta como feita` ·
  `instagram: cria plano + programação no modo approval com início não antes de hoje` · `instagram: sem pilares = NO_IG_PLAN e a execução segue para criativos` ·
  `instagram: desligado = skipped` · `instagram: programação já existente não é recriada` · `meta: sempre skipped nesta fatia`.
- [ ] **Step 2:** FALHA. **Step 3:** implemente. **Step 4:** PASSA.
- [ ] **Step 5:** commit `feat(piloto): etapas de textos e Instagram (modo eu aprovo por padrão)`.

### Task 6: Etapa `creatives` — vagas, teto, proveniência, vídeo assíncrono

**Files:** Create `steps/creatives.step.ts`; Test `__tests__/pilot-creatives.spec.ts`

**Interfaces — Consumes:** `CreativeService.generateAsSystem` (Task 1), `slotCost` (Task 3). **Produces:** `spentCredits(slots, jobs): number` exportado (usado no Task 7).
- Primeira entrada: monta `slots` = para cada um dos primeiros `max_angles` ângulos da estratégia aprovada (nome do ângulo), `images_per_angle` vagas `image`;
  depois `videos` vagas `video` (ângulo = 1º); numeradas a partir de 1. Grava e devolve `again`.
- Cada rodada: (a) toda vaga `waiting` → lê `creative_generation_jobs` do `job_id`: `ready` com `creative_id` → vaga `done` + proveniência; `failed` → vaga `failed` com o erro;
  (b) depois, no máximo UMA vaga `pending`: se `spentCredits + slotCost(kind, variations) > max_credits` → `blocked` `COST_CAP`
  ("Chegamos ao teto de {max} créditos com {feitas} de {total} artes prontas.", `stopRun=true`); senão `generateAsSystem({ workspaceId, campaignId, brandId,
  title: "{campanha} · {ângulo}", type: image ? 'image' : 'reels', aspectRatio: image ? '4:5' : '9:16', angle, variations, provider: 'auto', useBrandImage: true }, approved_by, { runId })`
  → `ready` = `done` + proveniência; `generating` = `waiting` (`job_id`); `failed` = vaga `failed` com `error`.
- Proveniência: `creatives.extras = { ...extras atuais, pilot: { run_id, slot, score } }` (`score` = nota total da variação vencedora; vídeo `null`). Nunca apaga chaves existentes.
- `spentCredits` = Σ das vagas com `job_id` de `actual_cost ?? estimated_cost ?? 0` do job (derivado, nunca guardado).
- Fim: nenhuma `pending`/`waiting` → `done` se ≥ 1 vaga `done` (note `"{feitas} de {total} prontas"`), senão `blocked` `NO_CREATIVE_MADE` "Nenhuma arte ficou pronta." (`stopRun=true`);
  só restam `waiting` → `wait 5`; ainda há `pending` → `again`.

- [ ] **Step 1: testes que falham** — `monta 3×2 imagens + 1 vídeo e gera uma por rodada` · `teto: para em COST_CAP antes de gastar a vaga que estoura` ·
  `vídeo: waiting até o job ficar pronto; proveniência preserva captions_srt/cover_url` · `vaga que falha não para as outras` ·
  `todas falharam = NO_CREATIVE_MADE` · `só criativos do piloto ganham extras.pilot (criativo manual da mesma campanha fica intacto)`.
- [ ] **Step 2:** FALHA. **Step 3:** implemente. **Step 4:** PASSA.
- [ ] **Step 5:** commit `feat(piloto): artes e vídeo uma por rodada, com teto de créditos e proveniência`.

### Task 7: API do piloto (contrato primeiro)

**Files:** Modify `docs/api-contract.md` (nova §29); Create `pilot.dto.ts`, `pilot.service.ts`, `pilot.controller.ts`; Test `__tests__/pilot.service.spec.ts`

Rotas (`v1/workspaces/:workspaceId/campaigns/:campaignId/pilot`; estáticas antes de `:runId`; portão desligado = 404 `NOT_FOUND` antes do acesso):

| Rota | Nível | Corpo → resposta |
|---|---|---|
| `POST /` | write | `{ idempotency_key (8–100) }` → run (mesma chave = mesma run, 200; outra ativa = 409 `CONFLICT` "O estrategista já está trabalhando nesta campanha."; campanha encerrada = 400) |
| `GET /` | read | `{ run: PilotRunView \| null }` |
| `POST /estimate` | write, sem efeito | `{ options }` → `{ estimate: { items, total, instagram }, blockers: [{ code, message, action }], can_approve }` |
| `POST /:runId/approve` | write | `{ strategy_version, options }` → run (`planning` com estratégia pronta; versão ≠ última = 409 `STRATEGY_CHANGED` "A estratégia mudou. Confira o plano de novo."; antes de pronta = 409 `CONFLICT` "O plano ainda está sendo montado.") |
| `POST /:runId/resume` | write | `{ action: 'retry' \| 'proceed_partial' \| 'raise_cap', max_credits? }` → run |
| `POST /:runId/cancel` | write | `{ cancel_instagram: boolean }` → run |

- `PilotOptionsDto`: todos os campos com decorator e **sem default** (o web manda explícito): `max_angles 1–5`, `images_per_angle 1–3`, `variations 1–3`,
  `videos 0–2`, `instagram { enabled, mode in (approval, publish), weekdays (0–6, 1–7 itens), times/story_times (HH:MM, ≤ 6), formats (IgFormat, 1–5) }`,
  `meta { enabled, review_creatives }`, `max_credits 1–500`; `max_angles × images_per_angle + videos > CAMPAIGN_PILOT_MAX_CREATIVES` = 400 "No máximo {N} peças por campanha.".
- `PilotRunView` = `{ id, status, current_step, steps, options, strategy_version, approved_at, approved_by, created_at, estimated_credits, max_credits,
  spent_credits, summary: pilotSummary(run), suggested_options (só em planning com estratégia pronta) }`.
- `blockers` desta fatia: `NO_BRAND` "Escolha a marca da campanha antes de começar." (`action: 'edit_campaign'`); `CAMPAIGN_ENDED`; `STRATEGY_NOT_READY`.
  `can_approve = blockers.length === 0`.
- `approve`: `approveVersion(ws, campaign, version, userId)`; grava `options`, `max_credits`, `estimated_credits = estimate.total`, `approved_by/at`,
  `status 'running'`, `current_step 'copies'`, `steps` das 4 etapas `pending`, `next_run_at = now`; atividade `campaign.pilot_started`; `kick`.
- `resume`: `retry` — etapa `blocked`/`failed` volta a `pending` (`attempts 0`; em `creatives`, vagas `failed` voltam a `pending`), execução `running`, `next_run_at now`, `kick`;
  `proceed_partial` — só com `COST_CAP` e ≥ 1 vaga `done`: vagas `pending` viram `skipped`, segue (`NO_CREATIVE_MADE` só aceita `retry`); `raise_cap` — `max_credits` > atual e ≤ 500, segue.
  Ação que não cabe no estado = 409 `CONFLICT` com frase.
- `cancel`: execução ativa → `cancelled`, `lease_until null`, `next_run_at null`; `cancel_instagram` e `steps.instagram.ref` → `AutoCalendarService.cancelAutoRun(ws, ref)`.
- Execução de outra empresa/campanha = 404; viewer em rota write = 403.

- [ ] **Step 1:** escreva a §29 do contrato (rotas, corpos, erros, `PilotRunView`).
- [ ] **Step 2: testes que falham** — `mesma chave = mesma execução` · `segunda ativa = 409` · `portão desligado = 404 antes do acesso` · `viewer não inicia (403)` ·
  `empresa A não lê nem cancela a execução da B (404)` · `aprovar com versão velha = 409 STRATEGY_CHANGED` · `aprovar grava opções, teto e começa em copies` ·
  `estimate sem marca: NO_BRAND e can_approve false` · `resume proceed_partial pula as vagas restantes` · `raise_cap abaixo do atual = 409` ·
  `cancel com cancel_instagram cancela a programação`.
- [ ] **Step 3:** FALHA. **Step 4:** implemente DTO/serviço/controller. **Step 5:** PASSA.
- [ ] **Step 6:** commit `feat(piloto): rotas do piloto (criar, ver, estimar, aprovar, retomar, parar)`.

### Task 8: Job, lista de campanhas, módulo e subida

**Files:** Create `pilot-cron.service.ts`, `campaign-pilot.module.ts`; Modify `api/src/modules/scheduler/job-schedules.ts`,
`api/src/modules/scheduler/__tests__/scheduler.service.spec.ts` (14 → 15), `api/src/app.module.ts`, `api/src/modules/campaigns/campaigns.service.ts` (`list`);
Test `api/src/modules/campaigns/__tests__/campaigns*.spec.ts` (o que cobre `list`)

- `JOB_SCHEDULES['campaign-pilot-5min'] = { name: 'campaign-pilot-5min', cron: '*/5 * * * *', heartbeat: 'campaign-pilot' }`; o cron service segue o padrão do
  `style-refs-cron.service.ts` e só roda com `SCHEDULER_ENABLED` **e** `CAMPAIGN_PILOT_ENABLED`.
- `CampaignsService.list` acrescenta `pilot_summary` (execução mais recente de cada campanha, uma consulta só, `pilotSummary`); sem execução = `null`.
- Módulo importa os módulos de strategist, copy-ai, creative, instagram e campaigns (exportando o que faltar); **nenhum módulo importa `CampaignPilotModule`** além do `AppModule`.

- [ ] **Step 1: testes que falham** — `scheduler: 15 jobs` · `list: pilot_summary da execução mais recente; sem execução = null`.
- [ ] **Step 2:** FALHA. **Step 3:** implemente. **Step 4:** PASSA.
- [ ] **Step 5:** verificação de subida, sozinha: Postgres local de pé, `scripts/run-capped.sh 1300 npm run start:smoke` em background, `curl -s localhost:3015/health`,
  `curl -s -o /dev/null -w '%{http_code}' localhost:3015/v1/workspaces/<uuid>/campaigns/<uuid>/pilot` → `401`; mate pelo PID; pare o Postgres.
- [ ] **Step 6:** `typecheck` uma vez, sozinho → 0 erros. Commit `feat(piloto): job de 5 min, resumo na lista e módulo`.

## Depois desta fatia
Revisão do `software-architect` (opus) sobre o branch inteiro → uma rodada de correção → F3b (web, com revisão do `ux-designer`) → F4 (Meta pausada,
G1, conferência com "Não usar esta arte", `OFFER_UNCONFIRMED`, pedido de aprovação com o pacote).
`redo-instagram` (§0.4 #7) fica fora desta fatia: o `NO_IG_PLAN` não para o resto, e a estratégia já exige `plano_instagram`.
