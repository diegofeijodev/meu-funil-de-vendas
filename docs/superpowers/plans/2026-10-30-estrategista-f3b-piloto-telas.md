# Estrategista — F3b: telas do piloto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** o dono vê e conduz o piloto pela tela: "Criar e montar o plano" no intake, o **Pacote** para aprovar uma vez, o **Andamento** com o
que precisa dele, e a linha do estrategista em cada cartão da lista.

**Architecture:** cliente tipado com zod (`modules/campaign-pilot/infrastructure/pilot.api.ts`) + textos e decisões puras (`lib/pilot-text.ts`,
testadas) + um componente `components/pilot/pilot-panel.tsx` montado no topo do detalhe da campanha quando `features.campaign_pilot`. A API é a §29
do contrato (F3a). A etapa Meta ainda é "pulada" (F4): o bloco do anúncio no pacote fica atrás de `PILOT_META_READY = false`.

**Tech Stack:** Next 15, React 19, TanStack Query, zod, componentes `components/ui/*`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-estrategista-conduz-ui.md` (B, C, Acessibilidade, Microcopy) + contrato §29.

## Global Constraints
- Web usa **yarn**; testes `scripts/run-capped.sh 1500 npx vitest run <arquivo> --maxWorkers=1`; `yarn typecheck` uma vez, sozinho, no fim; nunca `next build`.
- Toda tela responsiva no celular: 1 coluna, CTA fixo embaixo no celular, alvos ≥ 44 px (`h-11 sm:h-9`) (regra do dono 15/09).
- Todo número com a conta e a fonte: a estimativa mostra os `items` (`formula` + `source`) que a API devolve; a tela não refaz a conta.
- Textos em pt-BR do doc de UI (B, C); `role="status"`/`aria-live="polite"` no bloco "Precisa de você"; foco vai para o título "Andamento" depois de aprovar.
- `localStorage` só pelo `auth.storage.ts` (ESLint): a chave de idempotência vive no estado do componente.
- Erros pela `apiErrorMessage()` (nunca achatar `{error:{message}}`).

## Review Focus
1. Viewer abre a campanha com piloto: vê o andamento, sem nenhum botão de ação.
2. Plano ainda montando quando a pessoa abre: "Montando o plano…" e a tela atualiza sozinha até virar Pacote.
3. Clique duplo em "Aprovar e começar": um só pedido (botão desabilitado + chave), e o 409 vira frase.
4. Execução bloqueada por `COST_CAP`: os dois botões do doc ("Aumentar o teto para N", "Seguir com as N artes") e nada de "Tentar de novo".
5. API antiga sem o campo `pilot_summary` na lista: o cartão fica igual ao de hoje.

---

### Task 1: Cliente da API e textos puros
**Files:** Create `web/src/modules/campaign-pilot/infrastructure/pilot.api.ts`, `web/src/lib/pilot-text.ts`; Test `web/src/lib/pilot-text.test.ts`
- `pilot.api.ts`: `pilotRunSchema` (passthrough; `steps` record de `{status, attempts, error_code?, error?, note?, ref?, started_at?, finished_at?, slots?}`),
  `estimateSchema`; `getPilot(ws, campaignId)`, `createPilot(ws, campaignId, key)`, `estimatePilot(ws, campaignId, options)`, `approvePilot(ws, campaignId, runId, body)`,
  `resumePilot(ws, campaignId, runId, body)`, `cancelPilot(ws, campaignId, runId, cancelInstagram)`; `usePilot(ws, campaignId, enabled)` com `refetchInterval`
  15 s enquanto `planning` sem plano pronto ou `running`, senão sem polling.
- `pilot-text.ts`: `STEP_LABEL`, `stepStatusText(step)`, `blockerView(code, ctx)` → `{ message, actions: { kind, label }[] }`, `creditsLine(spent, max, done)`,
  `pilotListLine(summary)`, `raiseCapTo(max)` (= max + 12, o custo de um vídeo; ex. 48 → 60), `nextIdempotencyKey()`.
- Testes: status → texto da tabela C; `COST_CAP` → ["Aumentar o teto para 60", "Seguir com as 5 artes"] e sem "Tentar de novo"; `AI_NOT_CONFIGURED` → abrir integrações + "Já resolvi: continuar";
  `creditsLine(39, 48, 7)` = "Créditos: 39 de até 48 usados (soma do custo das 7 peças já feitas)"; linha da lista para planning/running(artes 4 de 7)/blocked/done/cancelled/null.
- Commit `feat(piloto-web): cliente da API e textos do estrategista`.

### Task 2: Painel do estrategista (Pacote e Andamento)
**Files:** Create `web/src/components/pilot/pilot-panel.tsx`, `web/src/components/pilot/pilot-adjust.tsx`; Modify `web/src/app/(app)/campaigns/[id]/CampaignDetail.tsx`
- Sem execução: cartão "Deixar o estrategista conduzir" (`write`) → `createPilot`.
- B0 (`planning`, plano não pronto): "Montando o plano. Leva até 1 minuto. Pode fechar a tela." + skeleton; falha → frase + "Tentar de novo" (`resume retry`).
- B1 (`planning`, pronto): ideia (big idea + ângulos da estratégia do detalhe), bloco Instagram (dias/horários/modo), custo "Até N créditos" com "Ver a conta"
  (itens da `estimate`), bloqueios da `estimate` com ação, "Ajustar" (Drawer com jeitos 1–5, artes por jeito 1–3, versões 1–3, vídeos 0–2, Instagram liga/desliga,
  dias, horários, modo "Eu aprovo cada post"/"Posta sozinho" (só owner/admin), teto); CTA "Aprovar e começar" (`write`, desabilitado com `can_approve=false`
  → "Falta 1 coisa para começar"); viewer: "Só quem edita a campanha pode começar."; 409 → frase da API.
- C (`running`/`blocked`/`failed`/`done`/`cancelled`): "Precisa de você" (bloqueios com ações), lista de etapas com `stepStatusText`, miniaturas das peças prontas
  (criativos do detalhe por `creative_id`), linha dos créditos, "Parar o estrategista" (AlertDialog com "Cancelar também os posts programados do Instagram").
  `done`: "Tudo pronto: textos, Instagram e artes." (+ com `PILOT_META_READY=false`: "Para anunciar, use Publicar na Meta como sempre.").
- Montagem: topo do detalhe (antes do guia e dos números) quando `features.campaign_pilot`.
- Commit `feat(piloto-web): painel do estrategista (pacote e andamento)`.

### Task 3: Intake, lista e guia
**Files:** Modify `web/src/app/(app)/campaigns/new/NewCampaign.tsx`, `IntakePanel.tsx`, `web/src/app/(app)/campaigns/CampaignsList.tsx`, `campaigns.api.ts`, `web/src/lib/guides.ts`
- Com `features.campaign_pilot`: botão final do intake "Criar e montar o plano" → `createCampaign` → `createPilot(nextIdempotencyKey())` → detalhe (sem a cadeia de estratégia + copy do navegador).
- Lista: `pilot_summary` (zod opcional) → `pilotListLine` sob o nome; ausente/null = cartão igual.
- `GUIDES.campaignPilot` (variante "com o estrategista"), usada no detalhe quando há piloto.
- Commit `feat(piloto-web): intake cria e monta o plano; linha do estrategista na lista`.

### Task 4: Verificação e revisão do designer
- vitest de `pilot-text.test.ts`; eslint nos arquivos tocados; `yarn typecheck` uma vez, sozinho → 0 erros.
- `ux-designer` revisa as telas (B, C, acessibilidade, celular) → uma rodada de correção → commit.
