# Fatia 1 — "Conte o que você quer" (entrada por conversa) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono escreve uma frase ("cadastros de bares e restaurantes de Jundiaí por 30 dias, 1ª contratação grátis"), o sistema devolve o "Entendi" com até 3 perguntas (verba → destino → condições da oferta) e cria a campanha pelo caminho de hoje.

**Architecture:** Rota nova `POST …/campaigns/intake` (IA com schema estrito; datas, verba e link decididos no servidor; nada gravado). O "Criar" usa o `POST …/campaigns` existente, que passa a aceitar `intake_text` e `offer_terms` (migração aditiva). Liberação por empresa (`CAMPAIGN_INTAKE_WORKSPACE_IDS`) com fonte única `GET /v1/workspaces/:ws/features`. As condições da oferta entram como restrição no prompt do estrategista e da copy.

**Tech Stack:** NestJS + Prisma (jest com IA falsa), Next.js (web).

**Spec:** `docs/superpowers/specs/2026-10-29-estrategista-conduz-design.md` §2.1, §0.4 #8–#9, §0.7 #1 e #4, §0.8 #1–#3; tela em `…-ui.md` §A.

## Global Constraints

- Datas "só dia" em Brasília (`todaySp()`, `addDays()`); a IA nunca escreve data de calendário relativa; período ≤ 180 dias; "30 dias" = hoje..hoje+29.
- Anti-invenção: verba/metas só se o número aparece no texto; link só se há URL no texto. Senão vão para `missing`.
- `missing` ≤ 3, nesta ordem: `budget_daily` → `landing_url` → `offer_terms` (esta só se houver promessa).
- Verba nunca vem marcada na tela.
- Destino "página" com objetivo `leads` vira `traffic` (sem formulário instantâneo na Meta), com suposição explicada.
- Fora da lista `CAMPAIGN_INTAKE_WORKSPACE_IDS` a rota responde 404 e a tela abre o formulário de hoje sem erro.
- Testes: um arquivo por comando via `scripts/run-capped.sh 1500 npx jest --runInBand <arquivo>`; web: eslint dos arquivos + `yarn typecheck` uma vez no fim.

## Review Focus

1. Texto sem período ("quero cadastros de bares") → 30 dias a partir de hoje, com a suposição "Considerei 30 dias, de DD/MM a DD/MM".
2. Texto com só o total ("R$ 900 no mês") → verba do dia = total ÷ dias, com a conta mostrada; nada de verba inventada.
3. IA devolve link ou verba que não estão no texto → descartados (vão para `missing`).
4. Pedido com promessa e sem condições → o "Criar" não sai sem as 3 respostas da oferta.
5. Empresa fora da lista → 404 na rota, e a tela não mostra erro.

---

### Task 1: Liberação por empresa e `GET /features`

**Files:**
- Modify: `api/src/common/config/vacancy-workspaces.ts` (generalizar), `api/src/common/config/env.validation.ts`, `api/.env.example`, `docker-compose.yml`
- Create: `api/src/modules/workspaces/features.service.ts`; Modify: `workspaces.controller.ts`, `workspaces.module.ts`
- Test: `api/src/modules/workspaces/__tests__/features.spec.ts`

**Interfaces:**
- Produces: `parseWorkspaceList(varName: string, raw: string | undefined, nodeEnv: string | undefined): '*' | Set<string>` (o `parseVacancyWorkspaces` vira um apelido dele); `FeaturesService.forWorkspace(userId, ws): Promise<{ campaign_intake: boolean; campaign_pilot: boolean; style_refs_pinterest: boolean; vacancy_stories: boolean }>` e `FeaturesService.intakeEnabled(ws): boolean`; rota `GET /v1/workspaces/:workspaceId/features` (qualquer membro; estranho 403/404 como as outras).
- [ ] Testes: lista com o id → `campaign_intake: true`; fora → `false`; `*` só em development/test; id inválido derruba a subida com a mensagem citando `CAMPAIGN_INTAKE_WORKSPACE_IDS`; `campaign_pilot` e `style_refs_pinterest` `false` (ligam nas fatias deles).
- [ ] Ver falhar → implementar → ver passar → commit `feat(features): liberação por empresa e GET /features`

### Task 2: `intake_text` e `offer_terms` na campanha, e a oferta como restrição nos prompts

**Files:**
- Create: `api/prisma/migrations/20261029120000_campaign_intake/migration.sql`; Modify: `api/prisma/schema.prisma`
- Modify: `api/src/modules/campaigns/dto/campaigns.dto.ts`, `campaigns.service.ts` (`create`)
- Modify: `api/src/modules/strategist/strategist.prompt.ts`, `api/src/modules/copy-ai/copy-ai.prompt.ts`
- Test: `campaigns.service.spec.ts`, `strategist.service.spec.ts` (ou o spec do prompt), `copy-ai.service.spec.ts`

**Interfaces:**
- Produces: colunas `campaigns.intake_text text NULL CHECK (char_length ≤ 4000)` e `campaigns.offer_terms jsonb NULL`; tipo `OfferTerms = { what: string (1–200); valid_until: 'YYYY-MM-DD'; new_only: boolean; confirmed_by?: string; confirmed_at?: string }`; `offerConstraint(promise: string | null, terms: OfferTerms | null): string | null` em `api/src/modules/campaigns/offer-terms.ts`.
- Texto de `offerConstraint` (exato): `CONDIÇÕES DA OFERTA (obrigatório): prometa só "<promessa>". O que é grátis/oferecido: <what>. Vale até <DD/MM/AAAA>. <Só para empresas/clientes novos.|Vale para todos.> Não invente outras condições, prazos ou descontos.`
- [ ] Testes: `create` grava `intake_text` (trim) e `offer_terms`; `offer_terms.valid_until` inválido → `400 "Informe até quando a oferta vale."`; o prompt do estrategista leva `pedido_original` e a linha de `offerConstraint`; o prompt da copy leva a mesma linha quando o `brief` traz `offer_terms`.
- [ ] Migração escrita à mão (aditiva) + `scripts/run-capped.sh 1500 npx prisma generate`.
- [ ] Ver falhar → implementar → ver passar → commit `feat(campaigns): pedido original e condições da oferta como regra dos prompts`

### Task 3: `POST …/campaigns/intake`

**Files:**
- Create: `api/src/modules/campaigns/campaign-intake.service.ts`, `api/src/modules/campaigns/campaign-intake.ts` (regras puras: datas, números, URLs, `missing`)
- Modify: `campaigns.controller.ts` (rota estática antes de `:id`), `campaigns.module.ts`, `dto/campaigns.dto.ts` (`IntakeDto { brand_id: uuid; text: string ≤ 4000 }`), `docs/api-contract.md` §15
- Test: `api/src/modules/campaigns/__tests__/campaign-intake.spec.ts`

**Interfaces:**
- Consumes: `FeaturesService.intakeEnabled` (Task 1); `OfferTerms` (Task 2); `AiService.json`.
- Produces: resposta `{ summary: string; draft: { name, objective, offer_product, offer_promise, landing_url, start_date, end_date, audience: { persona, idade, localizacao, interesses, tipo }, budget_daily, budget_total, goal_leads, formats, intake_text }; missing: { field: 'budget_daily'|'landing_url'|'offer_terms'; question: string; suggestion: string | null }[]; assumptions: { field: string; text: string }[]; days: number }`.
- Perguntas (exatas): `budget_daily` → "Quanto gastar por dia no anúncio?"; `landing_url` → "Para onde vai quem se interessar?" (sugestão = último `landing_url` usado pela empresa); `offer_terms` → "O que exatamente é grátis ou oferecido, e até quando?".
- `summary` = `Uma campanha para <objetivo_em_frase>, de DD/MM a DD/MM (N dias)[, oferecendo <promessa em minúscula inicial>].`
- [ ] Testes (IA falsa devolvendo o JSON do schema): frase do Diego → `objective: 'leads'`, Jundiaí na `localizacao`, hoje..hoje+29, `days: 30`, `missing` = as 3 na ordem; IA inventa `verba_dia: 50` sem número no texto → `budget_daily: null` e `missing[0].field = 'budget_daily'`; texto "R$ 30 por dia" → `budget_daily: 30`, `budget_total: 900`; texto "R$ 900 no mês" → `budget_daily: 30` + suposição com a conta; URL no texto → `landing_url` e `missing` sem destino; IA com `fim_data` além de 180 dias → corta em 180 com suposição; empresa fora da lista → 404; texto vazio → `400 "Conte em uma ou duas frases o que você quer."`; viewer → 403.
- [ ] Ver falhar → implementar → ver passar → contrato → commit `feat(campaigns): estrategista entende o pedido em texto (intake)`

### Task 4: Web — "Conte o que você quer" + "Entendi"

**Files:**
- Create: `web/src/modules/features/infrastructure/features.api.ts` (`getFeatures`, `useFeatures`)
- Modify: `web/src/modules/campaigns/infrastructure/campaigns.api.ts` (`intakeCampaign`, `createCampaign` com `intake_text`/`offer_terms`), `web/src/app/(app)/campaigns/new/NewCampaign.tsx` (+ componente `IntakePanel.tsx` na mesma pasta), `web/src/lib/guides.ts` (`campaignNew`)

- [ ] Com `campaign_intake`: a tela abre na caixa "Conte o que você quer" (placeholder = frase do Diego; contador acima de 3.500; erro "Conte em uma ou duas frases o que você quer."), CTA "Mandar para o estrategista" / "Lendo o seu pedido…", link "Preencher formulário ›".
- [ ] "Entendi": resumo, "Considerei que" (suposições), até 3 perguntas — verba (chips R$ 20/30/50/Outro, nenhum marcado, conta "R$ X por dia × N dias = até cerca de R$ Y no período"), destino (campo de link com "Usar o último: …"; escolher página com objetivo `leads` troca para `traffic` com a frase), oferta (chips "A taxa"/"A diária"/"As duas"/"Escrever", "Vale até" = fim da campanha, "Só para empresa nova?" Sim/Não); região (campo da cidade); "Ver/ajustar todos os detalhes" abre o formulário de hoje já preenchido.
- [ ] "Criar campanha": sem resposta obrigatória, foco na 1ª pergunta com o erro dela; senão o `finish()` de hoje (campanha + estratégia + copy) com `intake_text` e `offer_terms`.
- [ ] Sem `campaign_intake`: tela igual à de hoje.
- [ ] `eslint` dos arquivos + `yarn typecheck` (uma vez) → commit `feat(web): nova campanha por conversa (Conte o que você quer)`
