# Estrategista — piloto (Fatias 3 e 4): entrega de 30/10/2026

Branch `feat/estrategista-piloto` (sobre `bac3c32`, que é o `stack-freela` no ar). Planos: `2026-10-30-estrategista-f3a-piloto-servidor.md`,
`2026-10-30-estrategista-f3b-piloto-telas.md`, `2026-10-30-estrategista-f4-piloto-meta.md`. Decisão do dono: **G1** ("Faz do jeito que ele pediu, opção 1").

## O que ficou pronto
- Servidor (`api/src/modules/campaign-pilot`): o plano é montado no servidor; depois de UMA aprovação, o piloto faz textos → programação do Instagram
  ("eu aprovo" por padrão) → artes e vídeo (uma peça a cada 5 min, teto de créditos) → anúncio **pausado** na Meta (artes do piloto com nota ≥ 28/50).
  Lease condicional, retomada depois de falhas (5/15/60 min), bloqueios com frase e botão, parar/recomeçar. Nunca liga verba (porta `MetaPilotPublisher`).
- Telas: painel do estrategista no topo da campanha (plano → andamento → "Pronto para ligar"), intake "Criar e montar o plano", linha na lista de campanhas,
  conferência antes de ligar (verba × dias, região, destino, oferta com "Confirmo que o Freela cumpre", artes com "Não usar esta arte").
- Ligar (manual ou pelo piloto) passa a exigir a confirmação da oferta do intake (Meta, Google e TikTok) e respeita as artes tiradas.
- Revisões: arquiteto (F3a, F4) e designer (F3b, F4), cada uma com uma rodada de correção.

## Como subir (Denner, pela ordem, via `!`)
1. `cd /home/doutor/coding/freela/meu-funil && git push origin feat/estrategista-piloto && git branch -f master feat/estrategista-piloto && git push origin master:stack-freela`
2. `bash ~/meufunil-deploy/subir-api.sh` — backup + imagem de volta `meufunil-api:pre-piloto-2026-10-30`; migração `20261030120000_campaign_pilot_runs` (aditiva).
3. `ssh ubuntu@56.124.127.54 'sh -s' < ~/meufunil-deploy/ligar-piloto.sh` — `CAMPAIGN_PILOT_ENABLED=true` + `CAMPAIGN_PILOT_WORKSPACE_IDS=<Freela App>`.
4. `bash ~/meufunil-deploy/subir-web.sh`.
Voltar: `cd /opt/meu-funil && IMAGE_TAG=pre-piloto-2026-10-30 docker compose -f docker-compose.prod.yml up -d --no-build api` (e desligar `CAMPAIGN_PILOT_ENABLED`).

## Decisão pendente do dono
O intake escolhe o objetivo pela IA; para "cadastros" quase sempre `leads` = **formulário instantâneo da Meta** (o contato fica na Meta / CRM do Meu Funil),
não a página de cadastro do Freela combinada em 29/10 (§0.8 #2). Para levar à página: objetivo "Tráfego" na campanha. A conferência mostra qual é.

## Decisões que tomei e pendências (copiadas dos ledgers)

### 2026-10-30-estrategista-f3a-piloto-servidor
- Task 1: Ruling: tipo do criativo de imagem do piloto = 'static_image' (o mesmo dos testes/tela), vídeo = 'reels' — o plano dizia 'image' — custo se errado: só o rótulo do tipo
- Task 2: Ruling: índice extra (campaign_id, created_at desc) para 'execução mais recente por campanha' (GET e lista) — custo se errado: um índice a mais
- Task 3: Ruling: pilotSummary define a ordem das etapas localmente (não importa tipos do piloto) — 'ninguém importa o piloto' — custo se errado: duas listas para manter iguais
- Task 4: Ruling: StepResult ganhou 'state' (estado próprio da etapa, ex. vagas) gravado pelo runner sob o mesmo lease; etapa strategy reconhece versão já gravada depois do nascimento da execução — toda escrita passa pelo lease — custo se errado: nenhum além do campo extra
- Task 4: Ruling: falha comum grava error_code 'STEP_FAILED' (a UI mostra o motivo + 'Tentar de novo') — o plano não nomeava o código — custo se errado: renomear um código
- Task 5: Ruling: campanha sem end_date → instagram blocked IG_NOT_SCHEDULED (não inventa fim); NO_STRATEGY do plano IG → IG_NOT_SCHEDULED genérico — o intake sempre grava fim e a estratégia já está aprovada aqui — custo se errado: frase genérica num caso raro
- Task 6: Ruling: estratégia sem ângulos → vagas com ângulo 'Principal' (não trava); job sumido do banco → vaga failed — custo se errado: rótulo de ângulo genérico
- Task 7: Ruling: gravação do runner também exige status igual ao lido (parar no meio descarta o resultado) — Review Focus #3 — custo se errado: nenhum
- Task 7: Ruling: chave de idempotência usada em OUTRA campanha = 409 'Esta chave já foi usada em outra campanha.'; retomar grava atividade campaign.pilot_resumed e parar campaign.pilot_cancelled (actor = quem clicou) — o plano não dizia — custo se errado: atividades a mais
- Task 7: Ruling: retry de falha na estratégia (current_step strategy) volta a execução a 'planning' — custo se errado: nenhum
- Task 8: Ruling: InstagramModule passa a exportar AutoCalendarService (o piloto precisa do createAutoRun/cancelAutoRun) — custo se errado: nenhum
- Final: minor (deferred): M8 execuções blocked/planning em campanha encerrada não viram cancelled (precisa varredura no tick ou no CampaignEndService)
- Final: minor (deferred): M11 auditoria da copy e da programação do Instagram sem via/run_id
- Final: minor (deferred): M15 lista traz todas as execuções e deduplica em JS (trocar por DISTINCT ON quando crescer)
- Final: minor (deferred): M16 CHECK de faixa em max_credits/estimated_credits no banco
- Final: minor (deferred): teste do ramo P2002 no create; renovar o lease pelo onStage do pipeline (o lease de 10 min por execução cobre a arte típica)
- Final: Ruling: instagram sem end_date no estimate continua sem bloqueio (o intake sempre grava fim; a etapa bloqueia com frase) — custo se errado: aviso tardio numa campanha manual sem fim

### 2026-10-30-estrategista-f3b-piloto-telas
- Task 2: Ruling: 'Ajustar' é UMA folha com artes + Instagram (o doc pedia uma por bloco); verba/região/destino seguem nos painéis que já existem no detalhe — custo se errado: dividir a folha depois
- Task 3: Ruling: só o caminho do intake cria o piloto; o formulário de 5 passos continua com a cadeia de hoje (estratégia + copy no navegador) — custo se errado: o formulário não ganha o piloto
- Final: Ruling: I19 (posts esperando aprovação no Andamento) adiado — precisa de contagem por campanha na API; o doc de UI ainda quer — custo se errado: o Diego abre a aba Instagram para ver
- Final: Ruling: 'Refazer só o Instagram' (pedido 5 do designer / spec §0.4 #7) adiado; NO_IG_PLAN leva à aba Estratégia, onde o botão 'Criar plano no Instagram' já existe
- Final: Ruling: parcelas do spent_credits (prontas/falhas/vídeo estimado) não detalhadas; o texto diz 'soma do custo registrado de cada geração' — custo se errado: menos detalhe na conta
- Final: minor (deferred): melhorias 1 parcial, 3 (contagem de posts no bloco do Instagram), 9 (ligar action edit_campaign ao briefing), 11 (marketing × Integrações), 12 (contar posts no diálogo de parar), 13 (links 'Ver textos'/'Ver o plano completo'), 15 parcial, 17 parcial, 19 (Solicitar aprovação competindo no cabeçalho; ROAS vermelho em rascunho), 20 (safe-area no intake), 21 (anúncios de etapa no leitor de tela)

### 2026-10-30-estrategista-f4-piloto-meta
- Task 1: Ruling: OFFER_UNCONFIRMED só vale para campanhas com offer_terms (oferta definida no intake); campanhas antigas com offer_promise livre ligam como antes — não travar o caminho manual de todas as empresas — custo se errado: campanha manual com promessa liga sem a caixa
- Task 1: Ruling: 'Não usar esta arte' segue o estilo de rota do AdsController (POST meta-ads-exclude-creative com corpo), papel write como pausar — o plano dizia rota REST — custo se errado: renomear rota
- Task 3: Ruling: porta estreita MetaPilotPublisher (só publishPaused/missingCredentials) em ads/ — o piloto não recebe o MetaAdsService inteiro; o teste de fronteira continua proibindo meta-ads/meta-ops no piloto — custo se errado: nenhum
- Task 3: Ruling: vídeo do piloto pronto entra no G1 sem nota (o caminho de criativos de campanha não dá nota a vídeo; VideoQualityService só roda no Instagram) — custo se errado: vídeo fraco no anúncio, que a pessoa tira na conferência
- Task 3: Ruling: campanha em rascunho sem pedido recusado → NOT_APPROVED (para) — custo se errado: frase genérica
- Final: minor (deferred): M2 approve_now com pedido manual pendente agora reaproveita o pedido (resolvido junto do M1); M6 ads_config padrão sem where condicional (JSON vazio) — corrida rara com 'Anúncios e regras'
- Final: minor (deferred): M7 'usar de novo' a arte tirada, applyRecommendation activate_ad reativando excluída, publishLocked sem filtrar excluídas; M8 confirmOffer de marketing quando já ACTIVE; M11 estimate sem bloquear destino/verba/período com meta; M13 lista perde 'aprovar o anúncio' com bloqueio leve anterior
- Final: Ruling: objetivo 'leads' (padrão do intake) leva ao formulário instantâneo da Meta, não à página de cadastro do Freela (§0.8 #2) — a conferência agora diz isso; decisão do Denner/Diego: trocar o objetivo da campanha de Jundiaí para tráfego (página de cadastro) ou manter formulário → CRM
- Final: Ruling: 'o contato cai no CRM' removido (não sabemos se a integração de formulários da Meta está ligada); falta a API dizer isso — pedido ao arquiteto adiado
- Final: minor (deferred): 'usar de novo' a arte tirada (endpoint); públicos da estratégia em 'Para quem'; texto real do anúncio na conferência; X do Dialog compartilhado (16 px, 'Close'); viewport-fit=cover para safe-area
