# Estrategista — F4: piloto monta o anúncio na Meta (pausado) + conferência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** depois das artes, o piloto monta o anúncio **desligado** na Meta com as artes dele que passaram na revisão (G1, escolhido pelo dono em
30/10), e a pessoa liga numa tela de conferência — que exige "Confirmo que o Freela cumpre a oferta" quando há promessa e deixa tirar uma arte.

**Architecture:** `MetaAdsService.publishAsSystem` reaproveita a trava e o miolo do `publishLocked` (pausado, `end_time`, região, verba). A etapa
`meta` do piloto espera a aprovação da campanha (o "Aprovar e começar" do dono decide na hora; o de marketing pede em Approvals), a Meta conectada,
destino e verba; aprova os criativos do piloto com nota ≥ 28/50 e publica pausado. Ligar continua só pelo `setStatus` (manage), que ganha a guarda
`OFFER_UNCONFIRMED` e respeita "Não usar esta arte".

**Spec:** design §0.7 #1 e #6, §2.0 #1, §2.4 (etapa meta, G1/G2, quem aprova), §5; UI D; contrato §15/§19/§29.

## Global Constraints
- O piloto **nunca** liga verba: `campaign-pilot/` não importa `setStatus`/`setDeliveryStatus` (o teste de fronteira continua valendo; `publishAsSystem` mora em `ads/`).
- Nada de verba/destino inventado: sem `landing_url` → `LANDING_MISSING`; sem verba → `BUDGET_MISSING`; cidade não achada → `GEO_UNRESOLVED` (nunca Brasil inteiro).
- Aprovar campanha = `manage`. Marketing começa o piloto, mas a etapa meta espera o dono/admin (`WAITING_APPROVAL`, revista a cada rodada).
- Mesmas regras de baixo consumo (jest um arquivo por vez, tsc sozinho no fim).

## Review Focus
1. Campanha publicada à mão enquanto o piloto andava → etapa meta "Já enviada à Meta.", sem segunda campanha na Meta.
2. Pedido recusado em Approvals → campanha volta a rascunho e a etapa meta termina "Recusado em Approvals.".
3. Nenhuma arte do piloto com nota ≥ 28 → `NO_CREATIVE_PASSED` (não publica com arte reprovada); arte aprovada à mão conta.
4. "Não usar esta arte" antes de ligar → o anúncio dela continua pausado depois do "Ligar".
5. Oferta com promessa sem confirmação → "Ligar" recusa com `OFFER_UNCONFIRMED`, também pelo caminho manual.

---

### Task 1: `publishAsSystem` e a guarda `OFFER_UNCONFIRMED` + "Não usar esta arte" no ads
**Files:** Modify `api/src/modules/ads/meta-ads.service.ts`, `ads` controller da campanha; Test `api/src/modules/ads/__tests__/meta-ads.spec.ts`
- `publishAsSystem(ws, campaignId, via: { runId })` → mesmo lock e miolo (`publishLocked` com ator `null`: sem `member`, sem `assertCanSetDelivery` — nasce PAUSED; atividade `campaign.published` com `{ via:'pilot', run_id }`).
- `setStatus(..., 'ACTIVE', { confirmOffer?: boolean })`: com `offer_promise` e sem `offer_terms.confirmed_at` → se `confirmOffer` grava `confirmed_by/at` (owner/admin) e segue; senão `400 OFFER_UNCONFIRMED "Confirme que o Freela cumpre a oferta antes de ligar."`. Anúncios de criativos com `extras.excluded_from_ads_at` ficam fora do ACTIVE.
- `excludeCreative(userId, ws, campaignId, creativeId)` (manage): pausa na Meta os anúncios desse criativo (`meta_ad_map`) e grava `extras.excluded_from_ads_at`; rota `POST /v1/workspaces/:ws/campaigns/:id/creatives/:creativeId/exclude-from-ads`.
- Testes: publicar pelo sistema sem membro e sem nenhuma chamada com `status: ACTIVE`; ligar sem confirmar = 400; confirmar grava e liga; excluído fica pausado no ligar.

### Task 2: aprovação da campanha no "Aprovar e começar"
**Files:** Modify `pilot.service.ts`, `pilot.dto.ts` (`approve_now?: boolean`), `campaigns.service.ts` (`requestApproval(..., summary?)`); Test `pilot.service.spec.ts`
- Com `options.meta.enabled` e campanha em `draft`: pede aprovação com o resumo do pacote ("Anúncio montado pelo estrategista: N artes, R$ X/dia de DD/MM a DD/MM"); `approve_now` (manage) decide na hora (`ApprovalsService.decide`); marketing com `approve_now` = 403. Grava `approval_request_id`.
- Testes: dono aprova tudo de uma vez (campanha `approved`); marketing deixa `pending_approval`; sem meta não pede aprovação.

### Task 3: etapa `meta` (G1/G2)
**Files:** Modify `steps/meta.step.ts`, `pilot-runner.service.ts` (`wait` com `code`/`message` = etapa `blocked` sem parar; `resume retry` com a execução `running` antecipa a conferência); Test `pilot-meta.spec.ts`
- Ordem: desligado → `skipped`; `meta_campaign_id` → `skipped "Já enviada à Meta."`; `pending_approval` → `wait 5` `WAITING_APPROVAL`; `draft` com pedido recusado → `skipped "Recusado em Approvals."`; Meta sem credenciais → `wait 30` `META_NOT_CONNECTED`; sem `landing_url` → `LANDING_MISSING`, sem verba → `BUDGET_MISSING` (param); `ads_config` vazio → `{ ...DEFAULT_ADS_CONFIG, structure: 'per_angle' }`; G1: aprova criativos do piloto `ready` com nota ≥ 28 (vídeo pronto entra: o caminho de criativos de campanha não dá nota a vídeo) — nenhum aprovado → `NO_CREATIVE_PASSED`; G2: sem aprovado → `wait 5` `WAITING_CREATIVE_REVIEW`; `publishAsSystem` → `done` (`ref` = id da campanha na Meta); `UserError`/400 com código → `blocked` com a frase.

### Task 4: web — Meta no painel e conferência "Pronto para ligar"
**Files:** `components/pilot/pilot-panel.tsx` (`PILOT_META_READY = true`, CTA "Aprovar e começar" com `approve_now` para owner/admin, "Começar e pedir aprovação do anúncio" para marketing), `lib/pilot-text.ts` (bloqueios novos), novo `components/pilot/go-live-dialog.tsx` (UI D), `CampaignDetail.tsx` ("Ativar na Meta" abre a conferência).

### Task 5: verificação + revisão (arquiteto e designer) + correções
