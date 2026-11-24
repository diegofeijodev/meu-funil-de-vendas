# Vagas no Instagram: aviso de publicação parada, ajustes, link da vaga e vagas fixas (CLT) — design

**Data:** 24/11/2026 · **Projetos:** `meu-funil` (ramo `feat/vagas-clt-link`, a partir de `eb3eba2`, que é o que está em produção),
`api-freela` e `freela-web-v2` (só a parte CLT; nesses dois o código foi lido em `origin/main`, nada foi alterado).
**Pedido (card do Diego, 23/11):** "Ajustar os parametros para melhorar a geração de conteudos, criativos, e postagens. as Vagas do freela nao
estao entrando todas, precisa ver o motivo, e também fazer card para Vagas Fixas CLT e postar. Ver a possibilidade de colocar o link da vaga na
postagem."
**Base:** `2026-10-28-vagas-instagram-design.md` e `-ui.md`, e a arte desenhada pelo sistema de 11/11 (`vacancy-base-art.ts`, `composeBaseArt`).
**Situação:** só desenho. Nada foi implementado.

---

## 0. Resumo para o Diego

**As vagas estão entrando.** Desde 04/11, 248 vagas entraram na fila do Meu Funil. Das 264 vagas publicadas no Freela no período, só 17 ficaram
de fora, e todas foram fechadas, canceladas ou apagadas minutos depois de criadas, antes da consulta de 10 em 10 minutos. Isso é o esperado.
(264 − 17 = 247; a diferença de 1 para os 248 deve ser a borda de horário entre as duas consultas. Fonte: SQL de produção de 24/11.)

**O que está impedindo os stories de aparecer:**

1. **Desde 20/11 às 8h30, o Instagram recusa toda publicação de story de vaga.** Foram 40 recusas com a mensagem "(#10) Requires
   instagram_content_publish permission". O conserto não é no código: no Meta Business, o usuário do sistema precisa ter a permissão de publicar
   no Instagram do Freela. O Chopp e Espeto publica normalmente, então o problema está na configuração da conta do Freela, não na Meta inteira.
2. **O limite de 10 stories de vaga por dia cortou vagas** em 12, 13, 17 e 19/11.
3. **A IA de imagem (Gemini) do Freela App está sem crédito desde 17/11.** Os stories continuam saindo, mas sem a foto.

**O que muda primeiro (só no Meu Funil, pode ir ao ar logo):**

- Se o Instagram recusar publicação por falta de permissão ou por token vencido, aparece uma **faixa vermelha no topo de todas as telas**
  dizendo que a publicação parou e o que fazer. Enquanto isso:
  - o sistema **para de criar artes**, para não gastar IA à toa;
  - os posts esperam sem queimar tentativas.
- **Tudo volta sozinho** em qualquer destes casos: o sistema confere sozinho (1 h depois da recusa, e depois a cada 3, 6, 12 e no máximo
  24 h), você clica em "Já corrigi — testar agora", você reconecta o Instagram, ou uma publicação dá certo.
- O limite de publicações da Meta, hoje fixo em 25 por dia no código, passa a ser o número que a própria Meta informar (hoje, 50).
- Sugestão: subir o máximo de stories de vaga por dia de 10 para 15. É um ajuste na tela; a conta está na §2.2.
- **Link da vaga:** a API do Instagram não deixa pôr a figurinha de link no story. O substituto proposto tem duas partes:
  - um **QR code da vaga desenhado na arte**;
  - o **link na bio** apontando para as vagas do site.

  O QR funciona para quem tira print ou vê o story em outra tela. No próprio celular, só pelo print. Por isso ele fica como opção na tela,
  desligada até você aprovar numa prévia.

**Vagas fixas (CLT), depois:**

- Primeiro, a API do Freela precisa de uma lista pública das vagas fixas, sem e-mail, telefone nem endereço.
- O site ganha a página da vaga fixa.
- Depois disso, o Meu Funil passa a criar o story "Vaga fixa CLT" com Empresa, Cargo, Salário, Escala, Cidade e Benefícios. Ele tem limite
  próprio (sugestão: 2 por dia) e não despeja as 52 vagas abertas no primeiro dia.

**O que depende de você:**

- dar a permissão de publicação no Meta Business;
- pôr crédito no Gemini (ou trocar para a OpenAI em Ajustes);
- trocar o link da bio;
- responder as perguntas da §9.

---

## 1. Fatos e evidências

| # | Fato | Fonte |
|---|---|---|
| F1 | Empresa "Freela App" (`7309ae62-15c2-48d3-8990-4dbe75a29c4e`): stories ligados, `daily_cap` 10, janela 08–21h, antecedência 120 min, `auto_publish` true, fornecedor gemini | SQL de produção de 24/11 (pedido) |
| F2 | Desde 20/11 08h30, toda publicação de story de vaga falha com `(#10) Requires instagram_content_publish permission` (40 falhas); a Chopp e Espeto publica | SQL de 24/11 |
| F3 | Gemini sem crédito: alerta `gemini:no_credit` desde 17/11, último em 23/11 22h10 UTC | SQL de 24/11 (`ai_credit_alerts`) |
| F4 | O limite do dia (10) cortou vagas em 12, 13, 17 e 19/11 ("Não coube no máximo de 10 stories…") | SQL de 24/11 |
| F5 | O erro 190 (token) leva a `IgStore.handleTokenExpired`: a conta vira `status='error'`, `liveAccount` devolve null, o gerador espera com `NO_ACCOUNT_WAIT` e os posts de vaga e da programação voltam para `ready` | `instagram/ig-store.service.ts`, `instagram/publishing.service.ts` (catch da fila) |
| F6 | O erro #10 é só um `MetaError` comum: são 3 tentativas (5 e 10 min de espera) e o post termina `failed`. A conta continua `connected`, então o gerador segue criando arte (o portão dele é só `liveAccount`) | `publishing.service.ts` `runPublishingQueue`; `vacancy-generator.service.ts` `generateDue` |
| F7 | Já existe a faixa amarela "N posts do Instagram não foram publicados nos últimos 7 dias", com a ajuda de permissão (`META_PERMISSION_HELP`), desde 04/11. Ela conta posts `failed` com `updated_at` em 7 dias e não guarda estado | `health-alerts/health-alerts.service.ts`, `web/src/lib/health-alerts.ts`, contrato §30 |
| F8 | O limite da Meta está fixo em 25 em dois lugares: `DAILY_LIMIT` (`publishing.service.ts`) e `IG_DAILY_LIMIT` (`vacancy-scheduler.service.ts`). A consulta `content_publishing_limit` pede só `fields: quota_usage` | código |
| F9 | Documentação atual da Meta: o limite é de 50 posts em 24 h, e `content_publishing_limit` devolve `config { quota_total, quota_duration }` e `quota_usage`. A API não publica figurinha de link, enquete nem local em story; a legenda do story não aparece | documentação conferida em 24/11 (pedido) |
| F10 | A arte é desenhada pelo sistema. A IA só faz a foto 1:1 e a leitura às cegas que confere se a foto tem texto. Com erro de IA, sai a arte sem foto | `vacancy-generator.service.ts` `makeArt`, `vacancy-base-art.ts` |
| F11 | Decisão do dono em 28/10: o rodapé tem "Candidate-se pelo app / Procure Freela Serviços na loja" e os selos oficiais, **sem link, sem QR e sem domínio**, e o link da bio aponta para a loja | `2026-10-28-vagas-instagram-design.md` §4; `-ui.md` §1 |
| F12 | Página pública da vaga: `https://www.freelaservicos.com.br/vagas/<id>`. O domínio sem `www` responde 308 para o `www` mantendo caminho e query (conferido com `curl` em 24/11). A home tem a seção `id="vagas"`. Não há página `/vagas` (lista) nem página pública de vaga fixa | `freela-web-v2` `src/app/(public)/vagas/[id]/page.tsx`; `curl` |
| F13 | Vagas fixas: `shared.fixed_job_posts`. Os campos livres são `location` (180), `benefits` (3000), `work_schedule` (180), `description` (5000) e `application_instructions` (3000). Os contatos são `contact_email` e `contact_phone`. `company_name` é NOT NULL e vem do cadastro (`bRContractor.companyName`, decisão de 17/11) ou do que foi digitado. 52 vagas estão OPEN | `api-freela` `prisma/schema.prisma` `FixedJobPost`; `fixed-jobs.service.ts` `insertPost`; pedido |
| F14 | Não há rota pública de vaga fixa. `FixedJobsController` (`/v1/fixed-jobs`) tem `@UseGuards(JwtAuthGuard)` e `@Get(':id')` | `src/shared/fixed-jobs/http/fixed-jobs.controller.ts` |
| F15 | `parseLocationCityUf` é feita para rotear e **pode devolver a rua**. Em "Rua das Flores 120 Centro Jundiaí - SP" o grupo preguiçoso começa no início do trecho sem vírgula, e a "cidade" sai "Rua das Flores 120 Centro Jundiaí". Não serve para saída pública sem conferência | `src/shared/fixed-jobs/application/fixed-job-location.ts` |
| F16 | `shared.cities` tem `name` e `state`. É schema `shared`, então o Kernel pode ler | `schema.prisma` `model City` |

**Divergência a conferir (Fase 0, F0-1).** O pedido diz que "nenhum alerta apareceu para o dono". Pelo código (F7), se os 40 posts terminaram
`failed`, a faixa amarela deveria ter aparecido com a ajuda de permissão. Se terminaram `cancelled` (por exemplo, a guarda cancelou porque a vaga
entrou na antecedência entre as tentativas) ou `ready`/`scheduled`, ela não aparece. Este desenho não depende de qual dos dois aconteceu: as
lacunas abaixo existem nos dois casos.

**Lacunas que o código prova:**
- erro 190: o post volta para `ready`, não para `failed`, então hoje **nenhuma** faixa aparece com token vencido;
- erro #10: o gerador continua criando arte;
- a faixa conta posts, não diz que **toda** publicação parou, e fica velha por 7 dias depois do conserto;
- o "Publicar agora" (`instagram-actions.service.ts`) não passa pelo `catch` da fila, então qualquer classificação de erro precisa valer nos
  dois caminhos.

---

## 2. Decisões

### 2.1 Publicação parada: aviso, pausa e volta sozinha (item 1)

**Opções**

| Opção | Como | Prós | Contras |
|---|---|---|---|
| A. Só melhorar a faixa amarela | Texto melhor no aviso por contagem que já existe | Quase sem código | Não para a geração, não para as tentativas, fica velha depois do conserto e não cobre o 190 |
| B. Marcar a conta como `error` (reusar `handleTokenExpired`) | #10 trata como token vencido | Reaproveita tudo | Derruba métricas e Direct, que podem funcionar sem a permissão de publicar. Volta só com reconexão |
| **C. Bloqueio de publicação com 2 estados (normal ↔ bloqueado)** | Estado por empresa em `instagram_accounts`. A fila adia sem gastar tentativa, o gerador espera, uma sonda de leitura confere de hora em hora, e qualquer publicação que dá certo encerra o bloqueio | Para o gasto, não perde post e volta sozinho | Se a sonda disser "liberado" e a Meta ainda recusar, gera-se arte até a 1ª recusa (no máximo `PER_TICK` = 2 linhas por rodada de 10 min) e o bloqueio reabre |
| D. Bloqueio com 3 estados (normal → bloqueado → testando → normal) | Como C, mas depois da sonda só **1** publicação passa e o gerador faz no máximo 1 arte até ela dar certo | Desperdício máximo de 1 arte por tentativa | Mais um estado na fila, no gerador e na tela |

**Recomendação: C**, com a troca para D condicionada à Fase 0 (F0-5). Se `GET /me/permissions` com o token da Freela App mostrar hoje
`instagram_content_publish` sem `granted`, a sonda distingue os dois casos e C basta: o falso "liberado" fica raro.

O custo do falso "liberado" é limitado:
- **Por ciclo:** a 1ª publicação sai em até ≈ 15 min (rodada da agenda de 10 min + fila de 5 min). Até lá, o gerador faz no máximo 2 linhas
  por rodada, ou seja, ≈ 4 artes por falso "liberado".
- **Entre ciclos:** a contagem de falhas **não zera** quando quem fecha é a sonda (R9), então a conferência seguinte espera mais: 1 h, 3 h,
  6 h, 12 h e 24 h.
- **No pior caso:** ≈ 4 artes × 5 ciclos no 1º dia (≈ 20) e depois ≈ 4 por dia.

Se a permissão aparecer `granted` mesmo com o #10 acontecendo, a sonda não serve para decidir e o D entra.

**Regras do bloqueio (C)**

- **R1 — Classificação pelo código, só no caminho de publicação.** `createContainer` (POST `/{ig}/media`) e o POST `/{ig}/media_publish`
  passam a lançar `PublishPermissionError` (subclasse de `MetaError`) quando `MetaError.code` é 10 ou está entre 200 e 299. O 190 continua no
  caminho do token. Nada de regex de mensagem (já existem duas cópias: `health-alerts.service.ts` e `web/src/lib/health-alerts.ts`).
  - Uma função pura `classifyPublishError(e)` em `instagram/publish-block.ts` devolve `'permission' | 'token' | null`.
  - `content_publishing_limit` e `permalink` continuam como estão: os erros deles são engolidos e não classificam.
- **R2 — Abrir o bloqueio** com `IgStore.openPublishBlock(ws, reason, message, code)`:
  - grava em `instagram_accounts`: `publish_block_reason`, `publish_block_message`, `publish_blocked_at` (mantém o primeiro),
    `publish_block_last_at = now`, `publish_block_failures + 1` e `publish_next_check_at = now + espera(falhas)`;
  - as esperas seguem 1 h, 3 h, 6 h, 12 h e 24 h (teto);
  - registra **um** evento em `ig_autopilot_events` por abertura (não por falha): "Publicação parada: a Meta recusou por falta de permissão.";
  - `handleTokenExpired` passa a gravar também `reason = 'token'`, sem sonda.
- **R3 — O post que falhou não gasta tentativa.**
  - **Pela fila:**
    - o job volta para `pending` com `run_at = mín(publish_next_check_at, agora + 60 min)` e `attempts` igual;
    - o post volta para `scheduled` **sem mudar `scheduled_at`**, com `last_error = PUBLISH_BLOCKED_MSG`.
  - **Pelo "Publicar agora"** (não há job: o `claim` cancela os pendentes nesse caminho). O bloqueio abre do mesmo jeito e o erro vai para o
    toast. O post termina assim:
    - story de vaga e post da programação (`run_id`) → `ready` com `PUBLISH_BLOCKED_MSG`; a reconciliação os agenda depois que o bloqueio
      fechar;
    - post manual → `failed` com `PUBLISH_BLOCKED_MSG` e `failure_kind = 'publish'`. Quem clicou vê o motivo e publica de novo depois; nada
      fica `scheduled` sem job.
- **R4 — Fila com a empresa bloqueada.** Antes do `claim`, o job é adiado como no R3, sem chamar a Meta.
  - Se o post passou do horário em mais de `OVERDUE_MS` (12 h, a constante que já existe), o job vira `failed` e o post vira `failed` com
    `failure_kind = 'publish'` e a mensagem "Não foi publicado: a Meta recusou as publicações desta empresa entre {início} e {agora}.".
  - Story de vaga não precisa de regra própria: `expireDue` (T10) cancela o agendado cuja vaga começou, e a guarda cancela na hora de publicar
    se a vaga entrou na antecedência.
- **R5 — Gerador das vagas.**
  - `IgStore.publishAccount(ws)` = `liveAccount(ws)` **e** sem `publish_block_reason`.
  - `generateDue` usa `publishAccount` no lugar de `liveAccount`.
  - Bloqueado: a linha espera com `wait_reason = PUBLISH_BLOCKED_WAIT` e nenhuma IA é chamada.
  - **Motivo claro ao expirar.** A expiração por antecedência continua, mas com motivo próprio (`blockedExpireReason(startsAt, since)` em
    `vacancy-reasons.ts`): "Não foi ao ar: o Instagram recusava as publicações desta empresa desde {dia às hora}, e a vaga começa {dia às
    hora}."
  - Esse motivo vale em três casos:
    - linha com `wait_reason = PUBLISH_BLOCKED_WAIT` no `expireDue`;
    - post cancelado pelo T10 com `last_error = PUBLISH_BLOCKED_MSG`;
    - post cancelado pela guarda com `last_error = PUBLISH_BLOCKED_MSG`.

    Nunca o `tooCloseReason` genérico. O teste fica no M5.
- **R6 — Agenda das vagas.** `VacancySchedulerService.schedule` trata o bloqueio como `'no_account'`: o post fica `ready` com
  `last_error = PUBLISH_BLOCKED_MSG`, e a reconciliação da rodada o agenda quando o bloqueio fecha.
- **R7 — Produção automática (posts normais).** No filtro "48 h com Instagram conectado / 24 h sem" (`production.service.ts`, `EXISTS … status =
  'connected'`), conta bloqueada conta como não conectada: o criativo só sai nas 24 h.
- **R8 — Sonda.** O job `instagram-queue-5min` roda `PublishBlockService.checkDue(now)`.
  - Só para contas com `reason = 'permission'` e `publish_next_check_at <= now`.
  - A chamada é `GET /me/permissions` (leitura, sem mídia e sem gastar cota).
  - `instagram_content_publish` = `granted` → fecha o bloqueio (R9).
  - Ausente ou `declined` → `failures + 1` e a próxima espera.
  - Erro de rede → +1 h sem contar falha.
  - `reason = 'token'` não tem sonda: só a reconexão resolve, como hoje.
- **R9 — Fechar o bloqueio** com `closePublishBlock(ws, como)`, em qualquer destes casos:
  - publicação que deu certo (`finishPublish`);
  - sonda ok;
  - reconexão (`AccountService.connectInner` com sucesso);
  - botão "Já corrigi — testar agora" com sonda ok.

  Ao fechar:
  - grava `publish_unblocked_at = now` e zera motivo, mensagem, `blocked_at` e próxima conferência;
  - **as falhas só zeram com prova real** (publicação que deu certo ou reconexão). Quando quem fecha é a sonda ou o botão, `publish_block_failures`
    fica, e um novo bloqueio continua a escada de esperas (é o que limita o falso "liberado");
  - registra o evento "A Meta voltou a aceitar publicações ({como})";
  - antecipa para agora os jobs pendentes da empresa adiados pelo bloqueio (`run_at > now` e post com `scheduled_at <= now`).
- **R10 — Faixa.** `GET …/health-alerts` ganha `publishing` (§4.2), com faixa vermelha. Enquanto `publishing` existir, a faixa amarela de
  "posts que falharam" não aparece se `instagram.permission` for true (é o mesmo fato). A contagem amarela passa a considerar só falhas com
  `updated_at > publish_unblocked_at`, para não ficar velha depois do conserto.
- **R11 — Isolamento.** O bloqueio é por empresa: o da empresa A nunca adia a fila nem pausa o gerador da empresa B, e a faixa de A não aparece
  em B.

### 2.2 Parâmetros (item 2)

Toda mudança abaixo tem evidência. **Prompt não muda:** desde 11/11, todo texto da arte é escrito pelo sistema (F10). A IA só faz a foto e não
há dado de foto ruim (os chips "Foto estranha" podem ser contados na F0-2 antes de qualquer mexida).

| # | Ajuste | Evidência | Proposta |
|---|---|---|---|
| P1 | Limite da Meta | F8 e F9: 25 fixo no código; a Meta informa 50 | Pedir `fields=config,quota_usage`. Guardar `quota_total` em `instagram_accounts.publish_quota_total` só quando `quota_duration = 86400` e o valor for inteiro entre 1 e 1000. Usar `publish_quota_total ?? 25` no guardrail local, na comparação com `quota_usage` e no `igRoom` da agenda das vagas. A folga de 5 para posts normais (`IG_RESERVE`) continua |
| P2 | Máximo de stories de vaga por dia (`daily_cap`) | F4: corte em 4 dos 21 dias (04 a 24/11); média ≈ 12 vagas por dia que entraram (248 ÷ 21; pode incluir puladas) | **15** para a Freela App, na tela (sem código), conferido pela F0-3 (p90 das vagas elegíveis por dia). Se o p90 passar de 15, usar 20 (o teto atual do CHECK). Conta de que cabe: 15 × 15 min de espaço = 3 h 45 min dos 13 h da janela 08–21h; na Meta, 15 diárias + 2 CLT + 5 de folga = 22 dos 50, sobrando 28 para posts normais |
| P3 | Espaço de 15 min entre stories de vaga (`SPACING_MIN`) | Num lote publicado à tarde, a antecedência de 120 min + 15 min de folga deixa poucos horários. Exemplo: vaga às 19h, lote às 16h → prazo 16h45 (19h − 2 h − 15 min) → horários 16h01 (agora + 1 min), 16h16 e 16h31; o próximo (16h46) já passa do prazo → 3 stories, e as outras expiram com `spacingReason` | **Medir antes** (F0-2 agrupa os motivos). Se `spacingReason` for relevante, baixar para 10 min. A fila aguenta: 4 jobs por rodada de 5 min = 48 por hora |
| P4 | Pedir foto à IA sem crédito | F3: o aviso de sem crédito foi regravado até 23/11, ou seja, a foto é pedida (e recusada) a cada story | Em `makeArt`: com aviso `no_credit` aberto para o fornecedor escolhido **e** `last_at` desse aviso (`ai_credit_alerts.last_at`, lido por `AiCreditAlertsService.status`) há menos de 60 min, vai direto para a arte sem foto, sem chamar a IA. Não usar `settings.ai_error_at`: o `generateOne` o regrava a cada story com erro e o `handOff` o apaga, então ele não mede "última recusa". Uma tentativa por hora continua indo, senão o aviso nunca se apaga (`recovered` só roda numa chamada que deu certo). Prioridade baixa: recusa por falta de crédito não custa dinheiro |
| P5 | Vagas gêmeas (lote da mesma empresa, mesma função, horário, valor e cidade) | Pendência de 10/11 ("vagas repetidas gastam o teto de 10 por dia"); o Freela tem "lote de vagas" desde 11/11 | **Medir antes** (F0-4). Se mais de 15% das elegíveis forem gêmeas, pular as gêmeas da mesma rodada com o motivo "Igual a outra vaga que já tem story (mesma empresa, função, horário e valor)". Fora deste lote |

**Por que não mexer em mais:** `PER_TICK = 2` (até 12 artes por hora, 156 nos 13 h da janela) não é gargalo. A antecedência de 120 min é decisão
do dono. A janela 08–21h nunca apareceu como motivo nos dados citados.

### 2.3 Link da vaga no story (item 3)

**Opções**

| Opção | Clica no mesmo celular? | Automático? | Por vaga? | Prós | Contras |
|---|---|---|---|---|---|
| Figurinha de link | Sim | **Não** (a API não aceita, F9) | Sim | É o padrão do Instagram | Exige alguém pondo à mão em cada story: mata a automação |
| Post no feed com link na legenda | **Não** (o Instagram não deixa link clicável na legenda) | Sim | Sim | — | Não resolve o link. O post fica para sempre no perfil com a vaga já fechada (o Meu Funil não apaga post do feed) |
| **Link na bio** | Sim (perfil → link) | Configuração única, à mão | Não (lista) | Clicável, sem código | Um passo a mais. Leva à lista, não à vaga |
| **QR code da vaga desenhado na arte** | Não (só por print com Lens, Fotos do iPhone ou Círculo para Pesquisar) | Sim | Sim | Determinístico e sem permissão nova. Serve para print repassado em grupo, para tela de computador ou TV e para quem vê no celular de outra pessoa | Reverte a decisão de 28/10 (F11). Ocupa espaço no rodapé. No próprio celular, só por print |
| Responder o story e receber o link no Direct | Sim | Sim | Sim | Link clicável por vaga, e a pessoa vira lead no CRM | Exige `instagram_manage_messages` e o webhook de mensagens. A Freela App hoje não tem nem a permissão de publicar. A resposta a story chega como DM com a referência do story, que precisa ser ligada à vaga |

**Recomendação.**
- **Agora:**
  - link na bio, que o Diego troca à mão, apontando para `https://www.freelaservicos.com.br/?utm_source=instagram&utm_medium=bio#vagas`. O
    Instagram aceita até 5 links na bio, e só o **primeiro** aparece direto (os outros ficam atrás de um toque). Por isso o das vagas deve ser
    o 1º; o da loja pode ficar junto. Conferido em 24/11 na ajuda da Meta e na imprensa de abril/2023. Também conferido: link na legenda do
    feed não é clicável.
  - QR code na arte, como **opção na tela, desligada por padrão**, ligada só depois que o Diego aprovar numa prévia (pergunta 1).
- **Depois:** o "Responda VAGA e receba o link" no Direct, quando as permissões da Meta estiverem em ordem (fora deste lote).

**O QR, por dentro**
- **Biblioteca:** `qrcode-generator@2.0.4`, versão exata e sem `^`.
  - MIT, zero dependências, CommonJS (`require` → `dist/qrcode.js`) e tipos inclusos (`dist/qrcode.d.ts`). Publicada em 07/08/2025 (conferido no
    registro do npm em 24/11).
  - Uso: `qrcode(0, 'M')`, `addData(url, 'Byte')`, `make()`, `getModuleCount()` e `isDark(l, c)`. O sistema desenha cada módulo com o `rect` de
    `creative/compose`, sem canvas e sem PNG da biblioteca.
  - Conferir no 1º uso se o `.d.ts` tem `default`; se não tiver, importar com `import qrcode = require('qrcode-generator')`.
  - Descartadas:
    - `qrcode@1.5.4`: traz `yargs`, `pngjs@5` e `dijkstrajs` para o servidor;
    - `uqr@0.1.3`: é só ESM, e a API compila em CommonJS.
- **Teste de leitura:** `jsqr@1.4.0` como **devDependency** (Apache-2.0, zero dependências). Decodifica a arte final depois de:
  - JPEG q92;
  - redução para 720 px de largura, simulando a compressão do Instagram.

  O valor lido tem de ser igual à URL.
- **Onde entra no `composeBaseArt`:** no **rodapé preto** (`FOOT_TOP` = 1500, `FOOT_H` = 196), à esquerda. Os cartões ficam como estão: com
  Descrição, a pilha já encolhe e um cartão a mais a deixaria ilegível.
  - Quadrado branco de 184 × 184 px em x 56, y 1506, com os módulos centralizados, módulo de pixel inteiro ≥ 4 px e zona clara de 2 módulos
    dentro do quadrado.
  - O texto passa a começar em x 256, com `fitWrapped` até a borda dos selos:
    - linha 1 (amarela): "Candidate-se pelo app";
    - linha 2 (branca): "Aponte a câmera para ver a vaga";
    - linha 3 (branca): "ou procure Freela Serviços na loja".
  - Os selos ficam iguais, nunca redesenhados.
  - Arquivo novo `vacancy-stories/vacancy-qr.ts` com `vacancyLink(kind, id)` e `drawQr(img, url, box)`. `composeBaseArt` ganha
    `qrUrl: string | null`; null mantém o rodapé de hoje, idêntico.
- **URL:** `https://freelaservicos.com.br/vagas/<id>?utm_source=ig` (86 caracteres).
  - Sem `www` para caber numa versão menor: o 308 leva ao `www` mantendo a query (F12).
  - Com correção M, cabe na versão 6 (41 módulos + 4 de zona = 45 × 4 px = 180 px).
  - Se a versão escolhida passar do quadrado com módulo de 4 px, usa correção L. Se nem assim couber, a arte sai **sem** QR e o log avisa.
- **Por que no rodapé e não na foto ou nos cartões:**
  - a foto divide o canto com o título, e funções longas chegam a x ≈ 980;
  - os cartões já encolhem com 6 itens (conta: ≈ 912 px a k = 1 para 736 px disponíveis);
  - o rodapé está no ar desde 11/11 e é visto inteiro.
- **Limitações a dizer na tela:** no próprio celular, o QR só funciona por print. A Meta recomprime a imagem, por isso o QR precisa ser testado
  num story real antes de ligar (critério da tarefa M9).

### 2.4 Vagas fixas (CLT) (item 4)

#### 2.4.1 Na API do Freela: vitrine pública de vagas fixas

**Opções**

| Opção | Prós | Contras |
|---|---|---|
| **Rota pública no Kernel `fixed-jobs` (`/v1/fixed-jobs/public/*`)** | A tabela é do schema `shared` e a capacidade já está na lista do ADR-003. Molde idêntico ao da vitrine de diárias. Serve o Meu Funil e o site | Torna públicos nome da empresa, salário e cidade (pergunta 7) |
| Meu Funil lendo o mural autenticado com um usuário de serviço | Sem rota nova | Acopla sistema externo a login de pessoa. O mural filtra por raio de 30 km do freelancer |
| Evento ou webhook do Freela para o Meu Funil | Tempo real | Infra nova (fila, assinatura, retentativa) para poucas vagas por semana |

**Recomendação: a rota pública.** Ela segue as regras de `docs/architecture.md`:
- caminho em inglês (ADR-011);
- rota de Shared Kernel sem prefixo de produto;
- leitura só do schema `shared`: `fixed_job_posts`, `users` e `cities`.

Não lê `bares_restaurantes.contractors`. Por isso a cidade **não** cai para a do cadastro da empresa: cidade da matriz errada numa página pública
é pior que nenhuma, o mesmo princípio do comentário de `toPublicVacancy`. Como é adição a uma capacidade do Kernel, o texto de ADR está na §11.

**Rotas** (controller próprio, **sem** `JwtAuthGuard`, em `src/shared/fixed-jobs/http/public-fixed-jobs.controller.ts`, `@Controller('v1/fixed-jobs/public')`):
- `GET /v1/fixed-jobs/public/recent?limit=`: padrão 8, teto 100 (há 52 abertas, F13; com folga, o Meu Funil vê todas as abertas numa
  chamada só, inclusive o retroativo). Ordena por `createdAt desc`.
- `GET /v1/fixed-jobs/public/:id` (`ParseUUIDPipe`, declarada **depois** de `recent`) → 404 se não existe, está `CLOSED`, venceu
  (`expiresAt <= now`) ou o dono está inativo.

Não colide com o `GET /v1/fixed-jobs/:id` autenticado, porque são 2 segmentos contra 1.

**Filtro:** `status = 'OPEN'`, `expiresAt` nulo ou no futuro, e `contractorUser` com `isActive = true`, `deletedAt = null` e
`status = 'ACTIVE'` (tabela `shared.users`).

**Lista de permissão (o `select` se monta dela, como `PUBLIC_VACANCY_SELECT`):** `id`, `title`, `role`, `category`, `companyName`,
`location` (só para derivar a cidade, **nunca** sai), `salaryMinInCents`, `salaryMaxInCents`, `salaryProposalInCents`, `workSchedule`,
`workScheduleSlots`, `benefits`, `description`, `createdAt` e `expiresAt`.

Ficam **fora de propósito:** `contactEmail`, `contactPhone`, `applicationInstructions`, `preferredContactChannel`, `latitude`, `longitude`,
`geocodedAt` e `contractorUserId`.

**Regras de cada campo público** (funções puras em `src/shared/fixed-jobs/domain/public-fixed-job.ts`):

- **Filtros de texto compartilhados.** `CONTACT_LIKE`, `STREET_LIKE` e `publicDescription` hoje moram no handler das diárias, dentro do módulo
  `bares-restaurantes`, e o Kernel não pode importar de módulo. Eles **mudam** para `src/common/public-text/public-text.ts`, com
  `publicDescription(value, max)`, e as duas vitrines importam de lá. É o mesmo filtro nos dois lugares, sem cópia que se desencontre.
- **Cidade (`publicFixedJobCity`).** A saída é **sempre** um nome canônico de `shared.cities`, nunca um pedaço do texto.
  1. Tenta `parseLocationCityUf(location)` → (trecho, UF).
  2. Testa os **sufixos** do trecho, da última palavra para trás, até 4 palavras ("Jundiaí", "Centro Jundiaí", …). Vale o mais longo que casar,
     sem acento e sem maiúsculas, com `cities.name` **e** `cities.state = UF`.
     **Exceção:** se a palavra logo antes do sufixo achado for de logradouro (rua, r., av., avenida, alameda, travessa, estrada, rodovia,
     praça), o resultado é `null`. "Rua Santo André - SP" é uma rua, não a cidade de Santo André.
  3. Sem UF: o texto inteiro só vale se for exatamente um nome que exista uma única vez na tabela (exemplo: "Campinas").
  4. Senão, `city = null` e `uf = null`.

  Bairro nunca sai, porque o texto é livre e pode ter rua. O índice de cidades fica em memória por 1 h. Se `shared.cities` estiver vazia
  (F0-6), toda vaga sai sem cidade, que é a falha segura.
- **Empresa (`publicCompanyName`).** `cleanProfileField(companyName)`. Vira `null` com:
  - 5 ou mais dígitos no total (CPF, CNPJ, "66.699.088 Denner…");
  - `@`, link ou telefone (`CONTACT_LIKE`);
  - `*`;
  - mais de 80 caracteres.

  O sufixo societário (LTDA) é mantido, porque o site mostra o nome. O Meu Funil tira o cartão nesses casos (`cleanEstablishment`).
  **Limitação conhecida (igual à I2):** nome de pessoa física sem dígito não é detectável pelo texto.
- **Título e cargo.** `title` com `CONTACT_LIKE` vira o `role`. `role` com `CONTACT_LIKE` faz a vaga **não** sair da lista (não há o que
  mostrar).
- **Salário (`publicSalary`).**
  - Só inteiros maiores que 0 e até 5.000.000.
  - Com mínimo e máximo e mínimo < máximo, sai a faixa. Iguais, ou só um dos dois, sai valor único.
  - Sem nenhum, usa `salaryProposalInCents`.
  - Senão, `null`.
  - Formato: `{ minInCents, maxInCents }`.
- **Escala.**
  - `workSchedule`: `CONTACT_LIKE` → `null`; corte em 80 caracteres.
  - `workScheduleSlots`: só itens `{ day, start, end }` com `day` de até 20 letras e horários `^\d{2}:\d{2}$`, no máximo 7.
- **Benefícios (`publicBenefits`).**
  - Divide por quebra de linha, `;`, `•`, `·`, `|`, " - " ou vírgula **que não esteja entre dígitos** (`(?<!\d),(?!\d)`), para "R$ 1.200,00"
    não virar dois itens.
  - Cada item: tira espaços e cai fora se tiver `CONTACT_LIKE` ou `STREET_LIKE`, se estiver vazio ou se passar de 40 caracteres.
  - Tira repetidos e fica com no máximo 6.
  - **Defesa:** se o texto inteiro casar com `CONTACT_LIKE` mas nenhum item tiver caído por contato (a divisão partiu o telefone), devolve `[]`.
- **Descrição.** `publicDescription(description, 600)`: com contato ou endereço, não sai nada (regra de 24/07).

**Resposta** (`{ data: … }`, como a vitrine):

```json
{
  "id": "uuid", "title": "Atendente CLT", "role": "atendente", "category": "salão",
  "companyName": "Spoleto Shopping Aricanduva",
  "city": "São Paulo", "uf": "SP",
  "salary": { "minInCents": 187432, "maxInCents": 187432 },
  "workSchedule": "6x1, 10h às 18h20",
  "workScheduleSlots": [{ "day": "Segunda", "start": "10:00", "end": "18:20" }],
  "benefits": ["Vale-transporte", "Refeição no local", "Plano de saúde"],
  "description": "Atendimento no salão e caixa…",
  "publishedAt": "2026-11-20T14:02:11.000Z", "expiresAt": null
}
```

**Testes obrigatórios** (`src/shared/fixed-jobs/__tests__/public-fixed-jobs.spec.ts`):
- o `select` não contém nenhum campo da lista "fora";
- **canários:** uma linha com telefone, e-mail, link, "@perfil" e rua **sem vírgula** ("Rua das Flores 120 Centro Jundiaí - SP") em **todos**
  os campos livres; o `JSON.stringify` da resposta não contém nenhum canário (`99999-8888`, `rh@empresa.com`, `Rua das Flores`, `120`,
  `@perfil`);
- cidade:
  - "Rua das Flores 120 Centro Jundiaí - SP" → "Jundiaí"/"SP";
  - "Shopping Rio - RJ, Av. X 100, Jundiaí - SP" → "Jundiaí";
  - "Rua Santo André - SP" → `null` (canário: rua com nome de cidade);
  - texto sem cidade conhecida → `null`;
- benefícios: "Vale-refeição R$ 1.200,00, VT" → `["Vale-refeição R$ 1.200,00", "VT"]`;
- empresa: "66.699.088 DENNER…" → `null`; "GENILSON … 26385530850" → `null`;
- `CLOSED`, vencida e dono inativo: fora da lista e 404 no `:id`;
- `limit` padrão 8 e teto 100;
- `/public/recent` não é capturada pelo `:id` (teste do controller).

#### 2.4.2 No site (freela-web-v2): página pública da vaga fixa

- **Para onde o link/QR da CLT aponta:** `https://freelaservicos.com.br/vagas-fixas/<id>?utm_source=ig` (92 caracteres; versão 6, correção M),
  numa **página nova** no molde de `/vagas/[id]`:
  - título, empresa, cidade, salário, escala e benefícios;
  - "O endereço e o contato são informados ao candidato pela plataforma.";
  - CTA "Entrar para se candidatar" → `withReturnUrl('/cadastro?perfil=freelancer', '/freelancer/vagas-fixas/<id>')`; freelancer logado → abre
    `/freelancer/vagas-fixas/<id>`.
- **Marcação `JobPosting`** com `employmentType: FULL_TIME`, `baseSalary` (só com salário) e `jobLocation` (só cidade e UF, só com cidade).
  `validThrough` é `expiresAt` ou publicação + 30 dias. Vaga fixa é o caso certo para o Google for Jobs.
- `/vagas-fixas` não está no `matcher` do `middleware.ts`, então é pública.
- **Sem a página, o QR da CLT fica desligado** e a arte sai sem ele. A alternativa é apontar para `/cadastro` com `returnUrl`, mas quem ainda
  não tem conta cai num cadastro sem ver a vaga.

#### 2.4.3 No Meu Funil: segunda fonte `freela_clt`

**Reaproveitamento:** a mesma tabela `vacancy_stories` (`source = 'freela_clt'`; a chave única já tem `source`), a mesma fila, os mesmos lease,
guarda, agenda, janela, espaço de 15 min, aprovação, entrega e tela.

**Opções que mudam o desenho**

| Tema | Opções | Recomendação e motivo |
|---|---|---|
| `ig_posts.source` | `'vacancy'` (mesmo) × `'vacancy_clt'` (novo) | **`'vacancy'`**. `cancelledOrigin` só chama a guarda com `source === 'vacancy'`; um valor novo publicaria **sem conferir a vaga**. O tipo vai em `creative_brief.vacancy.kind = 'clt'` e em `vacancy_stories.source` |
| Interruptor | Próprio × o mesmo das diárias | **Próprio** (`clt_enabled`). A CLT não usa a arte modelo, e ligar uma não deve ligar a outra |
| Limite por dia | Próprio × compartilhado | **Próprio** (`clt_daily_cap`, padrão 2, CHECK 1–10). Diária tem prazo de horas; CLT dura semanas. Com limite compartilhado, o retroativo CLT tomaria a vez de diárias urgentes. A cota da Meta (§2.2 P1), a folga, a janela e o espaço de 15 min continuam **compartilhados** |
| Story × feed | Story × feed × os dois | **Story**: mesmo caminho, a guarda cancela vaga fechada, some em 24 h. O feed não dá link clicável (§2.3) e deixa vaga fechada no perfil. Carrossel semanal "Vagas fixas da semana" fica para depois |
| Retroativo (52 abertas) | Só novas × retroativo em gotas | **Em gotas.** `clt_backlog_days`: 0, 7, 14 ou 30 (padrão 0; recomendado 14, pergunta 4). Entram as publicadas depois de `clt_enabled_at − clt_backlog_days`, da mais nova para a mais velha, e o limite de 2 por dia espalha. Conta: no pior caso, as 52 em 26 dias (52 ÷ 2); a F0-6 diz quantas caem em 14 dias |
| Prazo para divulgar | Sem prazo × prazo | `starts_at` da linha CLT = **"divulgar até"** = `mín(expiresAt, publishedAt + 30 dias)`. Os 30 dias se calibram pela idade das 52 abertas (F0-6). Sem prazo, uma vaga esquecida aberta iria ao ar meses depois |
| Sem salário | Pular × "A combinar" | **Pular** com o motivo "A vaga fixa não tem salário informado." (é o cartão que atrai; mesma regra das diárias). Pergunta 5 |

**Onde `starts_at` é lido e o texto da CLT em cada lugar.** Na CLT, `starts_at` é "divulgar até". Todo texto que hoje diz "a vaga começa" ganha
a versão CLT, escolhida pelo `source` da linha ou por `creative_brief.vacancy.kind`.

| Leitor | Hoje (diária) | CLT |
|---|---|---|
| `triage` (`tooCloseReason`) | "A vaga começa {dia às hora}. Para dar tempo de divulgar…" | `cltTriage`: prazo passado → "O prazo para divulgar esta vaga fixa terminou em {dia}." (a antecedência é 0 na CLT) |
| `forcedTriage` ("Criar story mesmo assim") | valor, cidade e antecedência | `cltForcedTriage`: salário, cidade e prazo |
| `VacancyPollService.expireDue` (fila: `tooCloseReason` / `capWaitReason`) | começo ou limite | "O prazo para divulgar esta vaga fixa terminou em {dia}." / "Não coube no máximo de {n} stories de vagas fixas por dia até {dia}." |
| `expireDue` T10 (`VACANCY_STARTED_REASON`) | "A vaga começou antes de ir ao ar." | "O prazo para divulgar esta vaga fixa terminou antes de ir ao ar." |
| `planSlot` (`windowReason`, `igLimitReason`, `spacingReason`, via `leadIntro`) | "A vaga começa…, o story teria de ir ao ar até…" | introdução CLT: "O prazo para divulgar esta vaga fixa vai até {dia}" + o mesmo final |
| `approveUntil` / `noApprovalReason` | prazo + "a vaga começa às…" | "Ninguém aprovou a tempo. O prazo era {dia}." |
| `VacancyGuardService.blockReason` (`timing`, `VACANCY_CLOSED_REASON`) | começou, perto do começo ou fechada | prazo passado, ou "A vaga fixa foi fechada ou venceu no Freela." (404 de `/public/:id`) |
| `vacancy-display.ts` `whenOf` (`shortDay`, `formatWhen`) e `snap` (presume `FreelaVacancy`) | "Qua, 29/10 · 11h30 às 21h" | "Vaga fixa · divulgar até {dd/mm}"; `snap` decide o tipo pelo `source` |
| `handOff` (`theme` com `shortDay(v.startTime)`) | "Vaga · Função · Loja · Sáb 29/10" | "Vaga fixa · Cargo · Empresa" |

**Onde `enabled` é lido e o que muda com o interruptor próprio da CLT.** Regra geral:
- **empresa ativa** = `enabled OR clt_enabled`;
- **linha ativa** = `enabled` para `source = 'freela'` e `clt_enabled` para `source = 'freela_clt'`.

| Leitor | Hoje | Com a CLT |
|---|---|---|
| `VacancyGeneratorService.generateDue` (`findMany({ enabled: true })`) | só empresas com diárias ligadas | empresas ativas; cada linha confere o interruptor do seu tipo |
| `VacancyPollService.activeSettings` / `pollAll` | `enabled: true` | consulta das diárias para `enabled`; consulta CLT para `clt_enabled` (chamadas e erros separados) |
| `VacancySchedulerService.tick` (`enabled: true`) | idem | empresas ativas; o post é conferido pelo interruptor do seu tipo (`creative_brief.vacancy.kind`) |
| `VacancySchedulerService.schedule` (`MSG.off` se `!s.enabled`) | recusa post com as diárias desligadas | confere o interruptor do tipo do post; texto CLT: "Os stories das vagas fixas estão desligados nesta empresa." |
| `VacancySettingsService.turnOff` | cancela toda linha da fila e todo post `source='vacancy'` não publicado | recebe o `kind`: diárias cancelam só linhas `freela` e posts **sem** `vacancy_story.source = 'freela_clt'`; CLT cancela só os seus |
| `VacancyPollService.disableOrphans` (arte modelo apagada) | desliga tudo | desliga **só as diárias** (a CLT não usa a arte modelo) |
| `VacancySettingsService.enable` | exige arte modelo | `clt/enable` não exige arte modelo; se `brand_id` for nulo, grava a marca mais antiga da empresa (`templateBrand`), e sem marca responde `400 "Cadastre uma marca em Marcas antes de ligar."` (a logo vem dela) |
| `view` (`enabled`, `today`) | só diárias | ganha o bloco `clt` (§4.2) |

**Uma porta por fonte.** `vacancy-stories/vacancy-sources.ts` com `SOURCES: Record<'freela' | 'freela_clt', VacancySource>`:
- `byId(feed, id)`, `fingerprint`, `triage`, `forcedTriage`, `fields`, `compose`, `theme`, `deadline`;
- `reasons`, com os textos da tabela acima.

Gerador, guarda, consulta e tela chamam pela porta. É abstração com **dois** usos reais hoje, não "para o futuro".

**Contagem do dia por tipo.** `countVacancyStoriesOnDay(prisma, ws, day, exceptPostId, kind)`:
- diária = posts `source = 'vacancy'` **e** `NOT { vacancy_story: { is: { source: 'freela_clt' } } }`;
- CLT = `vacancy_story: { is: { source: 'freela_clt' } }`.

O filtro de relação do Prisma vira `EXISTS`, sem a armadilha do `NOT` em caminho JSON ausente (que devolveria NULL e sumiria com os posts
antigos). Os posts de antes deste lote continuam contando como diária.

**Consulta.**
- `pollAll` faz uma segunda chamada (`feed.recentClt()` → `/v1/fixed-jobs/public/recent?limit=100`), **com o seu próprio try/catch**, só se
  alguma empresa tiver `clt_enabled`.
- O erro vai para `clt_last_poll_error`, sem sujar o `last_poll_error` das diárias.
- Fora do ar uma das duas, a outra segue.

**Triagem CLT (`cltTriage`):**
- "teste" na empresa, no título ou no cargo;
- sem salário;
- sem cidade ("A vaga fixa não tem cidade que dê para mostrar.");
- cidade fora da lista de cidades (a mesma `cities` dos Ajustes);
- prazo passado.

**Campos (`cltFields`):**
- Empresa: `cleanEstablishment`, a mesma regra das diárias;
- Cargo: título limpo até 40 caracteres, senão o `role`;
- Salário: "R$ 2.200" ou "R$ 2.000 a R$ 2.500";
- Escala: `workSchedule` cortado, ou derivado dos `slots` ("Seg a Sex, 8h às 17h");
- Cidade: "Jundiaí – SP";
- Benefícios: até 4 itens unidos por " · ", no máximo 80 caracteres.

A assinatura (`fingerprint`) usa esses campos: se algum mudar entre a consulta e a publicação, a guarda refaz o story, como já faz hoje.

**Arte "Vaga fixa CLT"** (`vacancy-stories/vacancy-clt-art.ts`, `composeCltArt`):
- **Reaproveita:** os desenhos (`text`, `brush`, `disc`, `icon`), `fitWrapped`, as fontes, os selos, o rodapé e o QR do `vacancy-base-art.ts`
  (exportados de lá).
- **Título:**
  - "VAGA FIXA" em pincelada preta;
  - o CARGO em pincelada amarela;
  - pílula "CARTEIRA ASSINADA" no lugar de "FREELANCER".
- **Cartões:** Empresa (se houver), Cargo, Salário (escuro e grande, como o "Valor para o freela"), Escala, Cidade e Benefícios.
- **Foto e QR:**
  - a mesma foto 1:1 da IA (`photoPrompt(cargo)`), com a mesma conferência de texto na foto;
  - o QR aponta para `/vagas-fixas/<id>`.
- Antes de construir, o `ux-designer` revisa a arte. É regra do projeto para mudança visual grande.

**Aprovação:** o mesmo `auto_publish` das diárias. **Desligar a CLT** (`clt/disable`) cancela só as linhas e os posts CLT ainda não publicados,
com "Os stories das vagas fixas foram desligados.".

---

## 3. Modelo de dados (migrações só aditivas)

**Meu Funil.** Três migrações. Os CHECKs vão no SQL, como na `20261028120000_vacancy_stories`.

1. `20261125120000_ig_publish_block` em `instagram_accounts`:
   - `publish_block_reason text NULL`, com CHECK `publish_block_reason IN ('permission','token')`;
   - `publish_block_message text NULL`;
   - `publish_blocked_at timestamptz NULL`;
   - `publish_block_last_at timestamptz NULL`;
   - `publish_block_failures int NOT NULL DEFAULT 0`;
   - `publish_next_check_at timestamptz NULL`;
   - `publish_unblocked_at timestamptz NULL`;
   - `publish_quota_total int NULL`, com CHECK `publish_quota_total BETWEEN 1 AND 1000`;
   - `publish_quota_checked_at timestamptz NULL`.

   A tabela é 1 por empresa (`@@unique([workspace_id])`), e o `upsert` da reconexão não apaga essas colunas: ele tem de zerá-las de propósito
   (R9).
2. `20261125121000_vacancy_qr` em `vacancy_story_settings`: `qr_enabled boolean NOT NULL DEFAULT false`.
3. `20261201120000_vacancy_clt` (fase 3):
   - em `vacancy_story_settings`:
     - `clt_enabled boolean NOT NULL DEFAULT false`;
     - `clt_enabled_at timestamptz NULL`;
     - `clt_enabled_by uuid NULL`;
     - `clt_daily_cap int NOT NULL DEFAULT 2`, com CHECK 1–10;
     - `clt_backlog_days int NOT NULL DEFAULT 0`, com CHECK `IN (0,7,14,30)`;
     - `clt_last_poll_at timestamptz NULL`;
     - `clt_last_poll_ok_at timestamptz NULL`;
     - `clt_last_poll_error text NULL`;
   - em `vacancy_stories`: CHECK `source IN ('freela','freela_clt')`. Seguro: hoje toda linha é `'freela'`, o padrão; conferir com F0-7 antes
     de aplicar.

O histórico do bloqueio fica nos eventos `ig_autopilot_events`, que só recebem inserções: abertura e fechamento, com quem e como. A coluna guarda
só o estado atual.

**API Freela:** nenhuma migração. **Site:** nenhuma.

---

## 4. Contratos

### 4.1 API do Freela (novo; `docs/api-contracts.md` + Swagger)

- `GET /v1/fixed-jobs/public/recent?limit=` (sem autenticação) → `200 { data: PublicFixedJob[] }`, podendo vir vazia. `limit` é inteiro de 1
  a 100 (padrão 8); um valor inválido vale o padrão, como na vitrine.
- `GET /v1/fixed-jobs/public/:id` (sem autenticação) → `200 { data: PublicFixedJob }`, `404` (inexistente, fechada, vencida ou dono inativo)
  ou `400` (id não é UUID).
- `PublicFixedJob`: como em §2.4.1. Nunca traz contato, `location` cru, coordenada, `applicationInstructions` nem id do dono.

### 4.2 Meu Funil (contrato `docs/api-contract.md`: atualizar §22, §26 e §30 **antes** do código)

- **§30 `GET /v1/workspaces/:workspaceId/health-alerts`** ganha o campo `publishing`:

  ```json
  "publishing": null | {
    "reason": "permission" | "token",
    "since": "<publish_blocked_at ISO>", "last_at": "<publish_block_last_at ISO>",
    "message": "<texto da Meta traduzido, até 300>",
    "next_check_at": "<ISO>" | null,
    "waiting": { "posts": 3, "vacancies": 7 }
  }
  ```

  - `waiting.posts`: posts da empresa em `scheduled`, `ready` ou `approved` com `last_error = PUBLISH_BLOCKED_MSG`.
  - `waiting.vacancies`: linhas `new` ou `waiting` com `wait_reason = PUBLISH_BLOCKED_WAIT`.
  - `instagram` (a faixa amarela) passa a contar só falhas com `updated_at > coalesce(publish_unblocked_at, -infinito)` nos 7 dias.
- **§22 `POST /v1/workspaces/:workspaceId/instagram-account/publish-check`** (write) → `200 { ok: true, unblocked: boolean, message }`:
  - roda a sonda R8 na hora;
  - sem bloqueio aberto → `{ unblocked: true, message: "A publicação está funcionando." }` sem chamar a Meta;
  - no máximo 1 a cada 60 s por empresa → `409 { error: { code: "PUBLISH_CHECK_TOO_SOON", message: "Espere um minuto para testar de novo." } }`;
  - `reason = 'token'` → `422 { error: { code: "PUBLISH_NEEDS_RECONNECT", message: "Reconecte o Instagram em Instagram → Visão geral." } }`.
- **§26 Stories das vagas:**
  - `GET …/vacancy-stories/settings` ganha:
    - `qr_enabled`;
    - `publishing_blocked: { reason, since } | null`;
    - `clt: { enabled, enabled_at, daily_cap, backlog_days, last_poll_at, last_poll_ok_at, last_poll_error, today: { posted, scheduled, cap } }`,
      que só aparece depois da migração 3.
  - `PATCH …/settings` aceita `qr_enabled` (bool), `clt_daily_cap` (1–10) e `clt_backlog_days` (0, 7, 14 ou 30). Sem padrão no DTO.
  - `POST …/vacancy-stories/clt/enable` e `POST …/vacancy-stories/clt/disable` (manage). Ligar não exige arte modelo; exige marca (para a
    logo). Atividades `vacancy_stories.clt_enable` e `vacancy_stories.clt_disable`.
  - `GET …/stories?filter=&kind=diaria|clt`: cada item ganha `kind`.
  - Erros sempre no formato `{ error: { code, message } }`.

---

## 5. Regras de negócio novas (numeradas para revisão)

- **V1.** Publicação bloqueada por permissão ou token: nenhuma arte de vaga é criada e nenhum job gasta tentativa.
- **V2.** O bloqueio fecha sozinho por: publicação que deu certo, sonda ok, reconexão ou botão. A causa fica no evento.
- **V3.** Post adiado pelo bloqueio por mais de 12 h depois do horário vira `failed` com o motivo; story de vaga é cancelado antes, pela regra de
  antecedência.
- **V4.** O limite da Meta é o que ela informa (`quota_total`), entre 1 e 1000, em janela de 86400 s; fora disso, 25.
- **V5.** O QR só entra com `qr_enabled`. Se não couber com módulo ≥ 4 px, a arte sai sem ele (nunca um QR ilegível).
- **V6.** A vitrine CLT nunca expõe contato, endereço, coordenada nem instrução de candidatura. A cidade é sempre um nome de `shared.cities`.
- **V7.** CLT tem interruptor e limite próprios. Cota da Meta, folga, janela e espaço de 15 min são compartilhados com as diárias, que têm
  preferência por prazo mais curto (a fila ordena por `starts_at`).
- **V8.** O retroativo CLT nunca passa de `clt_daily_cap` por dia.
- **V9.** Story CLT só vai ao ar com a vaga aberta na hora: a guarda consulta `/public/:id`.
- **V10.** Isolamento A×B em toda rota nova e em todo estado novo: bloqueio, sonda, ajustes e CLT.

---

## 6. Telas e textos (pt-BR)

**Faixa vermelha, permissão** (`components/health-alerts-banner.tsx`, textos em `lib/health-alerts.ts`):
- **Título:** "O Instagram parou de aceitar publicações desta empresa"
- **Corpo:** "Desde {dd/mm às hh:mm}, a Meta recusa as publicações por falta de permissão. Enquanto isso, o Meu Funil não cria artes novas e os
  posts esperam: {n} posts e {m} vagas na fila. O que perder o prazo é cancelado com o motivo."
- **Ajuda:** `META_PERMISSION_HELP` + "No Meta Business: Configurações do negócio → Usuários do sistema → escolha o usuário → Atribuir ativos →
  Instagram desta empresa → Controle total. Confira também se o app tem a permissão de publicar no Instagram."
- **Rodapé:** "Conferimos sozinhos de tempos em tempos. Próxima conferência: {hh:mm}."
- **Botão:** "Já corrigi — testar agora" (qualquer papel com escrita).
  - Deu certo: "Tudo certo: a Meta voltou a aceitar publicações. Os posts que esperavam saem nos próximos minutos."
  - Não deu: "A Meta ainda não deu a permissão de publicar. Confira o passo acima e tente de novo."

**Faixa vermelha, token:**
- **Título:** o mesmo.
- **Corpo:** "Desde {…}, o acesso da Meta desta empresa venceu ou foi trocado. Reconecte o Instagram para voltar a publicar."
- **Botão:** "Reconectar" (leva a Instagram → Visão geral).

**Aba Vagas:**
- **Cartão de situação** (`status-card.tsx`): "Pausado: o Instagram não está aceitando publicações. As vagas esperam aqui."
- **Motivo da linha:** "Esperando o Instagram voltar a aceitar publicações para criar a arte."
- **Ajustes** (`settings-panel.tsx`):
  - interruptor "QR code da vaga na arte" com a ajuda "Quem tira print do story ou vê em outra tela abre a vaga no site. No próprio celular, só
    pelo print.", e o botão "Gerar prévia" ao lado;
  - campo "Máximo de stories de vagas por dia" sem mudança.
- **Seção "Vagas fixas (CLT)"** (fase 3):
  - interruptor;
  - "Máximo por dia" (1–10);
  - "Divulgar também as abertas nos últimos" (Nenhuma, 7, 14 ou 30 dias);
  - a última consulta e o erro dela.
- **Lista de stories:** chips "Diárias" e "Fixas (CLT)"; cada linha CLT com o selo "CLT" e "divulgar até {dd/mm}" no lugar de data e hora.

**Estados:** carregando, vazio ("Nenhuma vaga fixa nova desde que você ligou."), erro (texto da API) e sucesso, em todas as telas novas.
Responsivo no celular, em uma coluna.

---

## 7. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| O #10 vem de revisão do app na Meta (acesso avançado), não do papel do usuário do sistema | O conserto é no painel de apps, não no Business | A faixa cita os dois lugares; F0-5 mostra as permissões do token |
| A sonda diz "liberado" e a Meta recusa | Até 2 artes por rodada até a 1ª recusa | Espera crescente (1 h, 3 h, 6 h, 12 h, 24 h); troca para 3 estados se a F0-5 mostrar que a sonda não distingue |
| QR ilegível depois da recompressão do Instagram | Promessa vazia na arte | Teste com `jsqr` em 720 px + teste num story real antes de ligar; padrão desligado |
| Cidade CLT vazia porque `shared.cities` está incompleta | Vagas puladas por "sem cidade" | F0-6 mede; falha segura (nunca rua) |
| Nome de pessoa física em `companyName` sem dígitos | Nome de pessoa no story e no site | Limitação já aceita na I2; o Meu Funil tira o cartão com sufixo ou dígito; aprovação manual se o Diego preferir |
| Vagas fixas públicas na internet (nome, salário, cidade) | Concorrente vê; empresa pode não gostar | Pergunta 7; só campos de vitrine; contato e endereço nunca |
| Mais stories por dia (15) cansam quem segue | Pulam ou silenciam o perfil | Começar em 15, olhar alcance e respostas dos stories (métricas `views`/`replies` que o Meu Funil já coleta) depois de 2 semanas |
| `starts_at` com dois sentidos (começo × "divulgar até") | Texto errado na tela | Tabela da §2.4.3 + porta por fonte + testes de cada texto CLT |

---

## 8. Fora do escopo (e por quê)

- "Responda e receba o link" no Direct: depende das permissões da Meta que hoje estão quebradas (§2.3).
- Gêmeas e espaço de 15 min: só depois da medição (F0-2 e F0-4).
- Repetir story CLT de vaga que segue aberta: pergunta 8.
- Página `/vagas` (lista) no site para o link da bio: a home `#vagas` serve agora.
- Ajuste de prompt e de "criativos" das campanhas normais: o bloqueio de hoje é crédito de IA e permissão da Meta, não parâmetro. Mexer em
  prompt sem dado contraria a regra deste pedido.
- Apagar story ou post: a API não apaga story, e o Meu Funil não apaga post do feed.

---

## 9. Perguntas ao Diego (com recomendação)

1. **QR na arte?** Em 28/10 você decidiu "sem link, sem QR". Ele ajuda quem tira print ou vê em outra tela, mas não é tocável no próprio celular.
   *Recomendo:* sim, como opção na tela, ligada só depois de você ver a prévia.
2. **Link da bio:** trocar (ou somar) o link da loja por `freelaservicos.com.br/#vagas`? *Recomendo:* somar; a bio aceita até 5 links.
3. **Máximo de stories de vaga por dia:** de 10 para 15? *Recomendo:* 15, confirmado pelos números da Fase 0.
4. **Vagas fixas já abertas (52):** divulgar as dos últimos 14 dias aos poucos, ou só as novas? *Recomendo:* últimos 14 dias, 2 por dia.
5. **Vaga fixa sem salário:** pular ou mostrar "A combinar"? *Recomendo:* pular.
6. **Limite próprio das vagas fixas:** 2 por dia? *Recomendo:* sim.
7. **Vagas fixas públicas** (site e Google) com nome da empresa, salário e cidade? *Recomendo:* sim; contato e endereço nunca.
8. **Repetir o story** da vaga fixa que segue aberta depois de 7 dias? *Recomendo:* não agora; decidir com os primeiros números.
9. **Publicação parada:** além das vagas, segurar também os posts normais até a Meta voltar? *Recomendo:* sim, todos esperam e nada se perde.

---

## 10. Plano de implementação

**Regras de execução** (máquina do dono, `CLAUDE.md` do Meu Funil):
- comando pesado só por `scripts/run-capped.sh`;
- jest focado no que mudou;
- `typecheck` uma vez no fim;
- nunca `build`.

**Uma subida da API do Freela por vez** (EC2 travou em 16/11 com duas). Cada tarefa é uma fatia com testes; o critério de pronto inclui
`jest` focado verde e o contrato atualizado.

### Fase 0: dados (só leitura; o dono roda pelo caminho de sempre, ssh + `psql`)

- **F0-1. Status final dos 40.**

  ```sql
  SELECT status, COUNT(*), MIN(updated_at), MAX(updated_at)
  FROM ig_posts WHERE workspace_id = '7309ae62-15c2-48d3-8990-4dbe75a29c4e' AND source = 'vacancy'
    AND created_at >= '2026-11-20 08:30-03' GROUP BY status;
  ```

- **F0-2. Motivos por dia, em categorias.**

  ```sql
  SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia, status,
    CASE WHEN skip_reason LIKE 'Não coube no máximo%' THEN 'limite do dia'
         WHEN skip_reason LIKE '%já têm outros stories%' THEN 'espaço 15 min'
         WHEN skip_reason LIKE '%antes do seu horário para postar%' THEN 'janela'
         WHEN skip_reason LIKE '%espaço no Instagram%' THEN 'limite Meta'
         WHEN skip_reason LIKE 'A vaga começa%' THEN 'antecedência'
         WHEN skip_reason LIKE 'Parece vaga de teste%' THEN 'teste'
         WHEN skip_reason LIKE 'Cidade fora%' THEN 'cidade'
         WHEN skip_reason LIKE 'A vaga não está mais aberta%' THEN 'fechada'
         WHEN skip_reason IS NULL AND wait_reason IS NULL THEN '-'
         ELSE LEFT(COALESCE(skip_reason, wait_reason), 40) END AS motivo,
    COUNT(*) FROM vacancy_stories
  WHERE workspace_id = '7309ae62-15c2-48d3-8990-4dbe75a29c4e' AND created_at >= '2026-11-04'
  GROUP BY 1, 2, 3 ORDER BY 1, 2, 4 DESC;
  ```

  Mais os chips: `SELECT feedback, COUNT(*) FROM vacancy_stories WHERE … GROUP BY 1;`.

- **F0-3. Vagas elegíveis por dia (p50, p90, máximo)**, para o `daily_cap`.

  ```sql
  WITH d AS (SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date dia, COUNT(*) FILTER (WHERE status <> 'skipped') n
             FROM vacancy_stories WHERE workspace_id = '7309ae62-15c2-48d3-8990-4dbe75a29c4e' AND created_at >= '2026-11-04' GROUP BY 1)
  SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY n) p50, percentile_disc(0.9) WITHIN GROUP (ORDER BY n) p90, MAX(n) FROM d;
  ```

- **F0-4. Gêmeas.**

  ```sql
  SELECT COUNT(*) total,
         COUNT(DISTINCT (snapshot->>'contractorName', snapshot->>'title', snapshot->>'startTime', snapshot->>'endTime',
                         snapshot->>'amountInCents', snapshot->>'city')) distintas
  FROM vacancy_stories WHERE workspace_id = '7309ae62-15c2-48d3-8990-4dbe75a29c4e' AND created_at >= '2026-11-04' AND status <> 'skipped';
  ```

- **F0-5. Meta** (leitura). O token da Freela App está **no cofre do Meu Funil, cifrado** (`META_SYSTEM_USER_TOKEN` da empresa → global →
  env; `MetaConfigService`). O Business não mostra um token já gerado. Dois caminhos:
  - (a) se o dono guardou o token quando o gerou:
    - `curl "https://graph.facebook.com/v24.0/me/permissions?access_token=…"`: é `instagram_content_publish` `granted`?
    - `curl "https://graph.facebook.com/v24.0/{ig-user-id}/content_publishing_limit?fields=config,quota_usage&access_token=…&appsecret_proof=…"`:
      devolve `quota_total` 50? Dá #10?
  - (b) senão, o M4 sobe primeiro com a sonda em **modo só registro**: o botão e a conferência automática gravam no log do servidor o que as
    duas chamadas devolveram (sem o token) e **não** fecham o bloqueio. Um dia depois, o log decide.

  Esta verificação decide C ou D (§2.1) e confirma o P1. O fechamento pela sonda só é ligado depois dela.
- **F0-6. CLT** (banco do Freela, schema `shared`).

  ```sql
  SELECT id, created_at, location, company_name, salary_min_in_cents, salary_max_in_cents, salary_proposal_in_cents,
         LEFT(work_schedule, 60), LEFT(benefits, 80), expires_at
  FROM shared.fixed_job_posts WHERE status = 'OPEN' AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC;
  SELECT COUNT(*), COUNT(DISTINCT state) FROM shared.cities;
  ```

  Mede: idade das 52, quantas sem salário, quantas resolvem cidade pela regra de §2.4.1 e quantas entram com 14 dias de retroativo.
- **F0-7.** `SELECT source, COUNT(*) FROM vacancy_stories GROUP BY 1;` (antes da migração 3).

**Ações do dono, que não são código:** permissão no Meta Business; crédito no Gemini ou fornecedor OpenAI nos Ajustes; link da bio; `daily_cap`
15 na tela depois da F0-3.

### Fase 1: Meu Funil (pode subir sem esperar o Freela)

- **M1. Classificação do erro de publicação.**
  - Arquivos: `api/src/modules/instagram/publish-block.ts` (puro: `classifyPublishError` e `nextCheckDelay(falhas)`); `meta-graph.ts`
    (`PublishPermissionError extends MetaError`); `publishing.service.ts`, onde `createContainer` e o POST de `media_publish` lançam a
    subclasse.
  - Testes: `__tests__/publish-block.spec.ts`, com 10, 200, 299, 190, 100, 9004 e erro de rede, e o `content_publishing_limit` com #10 que não
    classifica.
  - Pronto: unidade verde; nenhum comportamento muda ainda.
- **M2. Migração 1 + `IgStore`.**
  - Arquivos: `prisma/schema.prisma`; `prisma/migrations/20261125120000_ig_publish_block/migration.sql`; `ig-store.service.ts`
    (`publishAccount`, `openPublishBlock`, `closePublishBlock`, `publishQuota`); `ig-types.ts` (`PUBLISH_BLOCKED_MSG`); `vacancy-generator.service.ts`
    (`PUBLISH_BLOCKED_WAIT`).
  - Testes: abrir mantém `blocked_at` e soma falhas; fechar zera e grava `unblocked_at`; os eventos de abrir e fechar saem uma vez; isolamento A×B.
  - Pronto: `prisma migrate status` limpo no banco local.
- **M3. Fila e "Publicar agora" com bloqueio** (R3, R4 e R9).
  - Arquivos: `publishing.service.ts` (`runPublishingQueue`, `publishInstagramPost`, `finishPublish`); `ig-store.service.ts` (`handleTokenExpired`
    grava `reason = 'token'`).
  - Testes (Graph falsa): o #10 abre o bloqueio, o job volta `pending` com as mesmas tentativas, e o post fica `scheduled` com `scheduled_at` igual.
    Com a empresa bloqueada, o job é adiado sem chamar a Meta. Com mais de 12 h, `failed` com o texto. O sucesso fecha, zera as falhas e
    antecipa os adiados; o fechamento pela sonda **mantém** as falhas. O "Publicar agora" com #10 abre o bloqueio, o erro vai para a resposta,
    e o post termina `ready` (vaga ou programação) ou `failed` (manual), nunca `scheduled` sem job. Empresa B não é afetada.
  - Pronto: testes da fila existentes verdes + os novos.
- **M4. Sonda, reconexão e botão** (R8 e R9).
  - Arquivos: `instagram/publish-block.service.ts` (`checkDue`, `checkNow`); `instagram-cron.service.ts` (chama `checkDue` no `queue`);
    `account.service.ts` (`connectInner` fecha o bloqueio); `instagram.controller.ts` + `instagram-actions.service.ts`
    (`POST …/instagram-account/publish-check`, write, 1 a cada 60 s).
  - Testes: `granted` fecha; ausente soma falha e respeita a espera; erro de rede +1 h; `token` → 422; 409 em menos de 60 s; não-membro 403;
    empresa A × B; modo só registro (F0-5 b) não fecha.
  - Pronto: rota no contrato §22.
- **M5. Gerador, agenda e produção respeitam o bloqueio** (R5, R6 e R7).
  - Arquivos: `vacancy-generator.service.ts` (`generateDue` com `publishAccount`); `vacancy-scheduler.service.ts` (`schedule`);
    `production.service.ts` (o `EXISTS` passa a exigir `publish_block_reason IS NULL`).
  - Testes:
    - bloqueado → nenhuma chamada ao `AiService` fake e linha com `PUBLISH_BLOCKED_WAIT`;
    - `ready` não agenda;
    - ao fechar, a rodada agenda;
    - a linha que expira durante o bloqueio e o post cancelado (T10 e guarda) gravam `blockedExpireReason`, nunca o `tooCloseReason`.
  - Pronto: `jest` de `vacancy-stories` e de `instagram` verdes.
- **M6. Faixa** (R10).
  - Arquivos: `health-alerts/health-alerts.service.ts` (`publishing`, contagem amarela depois de `publish_unblocked_at`);
    `web/src/lib/health-alerts.ts` (`publishingAlertText`); `web/src/components/health-alerts-banner.tsx` (faixa vermelha, botão, esconder
    a amarela duplicada); `web/src/components/instagram/vacancies/status-card.tsx`; contrato §30.
  - Testes: unidade da API (A×B); `vitest` dos textos (datas de Brasília, singular e plural).
  - Pronto: `browser-check` do grupo da faixa, se houver memória; senão anotar.
- **M7. Limite da Meta lido** (P1).
  - Arquivos: `publishing.service.ts` (`fields: 'config,quota_usage'`, grava `publish_quota_total`, guardrail e `RateLimited` com o número);
    `vacancy-scheduler.service.ts` (`igRoom` com `publishQuota`); `publish-block.ts` ou `ig-quota.ts` (puro: `quotaFrom(resposta)`).
  - Testes: 50 → `room` com 50; ausente → 25; `quota_duration` ≠ 86400 → 25; 5000 → 25.
  - Pronto: `jest` verde.
- **M8. (baixa) Foto sem chamar a IA sem crédito** (P4).
  - Arquivo: `vacancy-generator.service.ts` `makeArt`.
  - Testes: aviso aberto e `ai_error_at` com menos de 60 min → zero chamadas e arte sem foto; com mais de 60 min → 1 chamada.
- **M9. QR na arte** (§2.3).
  - Arquivos: `api/package.json` (`qrcode-generator` `2.0.4`; dev `jsqr` `1.4.0`); `vacancy-stories/vacancy-qr.ts`; `vacancy-base-art.ts`
    (`qrUrl`, rodapé com QR e 3 linhas); `vacancy-generator.service.ts` e `vacancy-preview.service.ts` (passam `qrUrl` quando `qr_enabled`);
    migração 2; DTO `qr_enabled`; `web/…/settings-panel.tsx`; contrato §26.
  - Testes:
    - `jsqr` lê a URL da arte final em JPEG q92 e em 720 px;
    - sem `qr_enabled`, os bytes do rodapé são iguais aos de hoje (teste de igualdade com a arte de referência);
    - URL longa demais → sem QR + log;
    - PATCH A×B.
  - Pronto: prévia em produção lida pela câmera do iPhone e pelo Lens do Android num story real de teste, **antes** de ligar na Freela App.
- **M10. Contrato e documentação.** `docs/api-contract.md` §22, §26 e §30; `CLAUDE.md` (bloqueio e QR numa linha cada). Pronto: revisão do
  `software-architect` e do `ux-designer` antes de subir.

### Fase 2: API do Freela (`api-freela`, ramo próprio a partir de `origin/main`)

- **A1. ADR-028 e contrato.** O texto da §11 vai para `docs/architecture.md` e as rotas para `docs/api-contracts.md`. Conferir se o número
  028 está livre na hora (hoje vai até o 027).
- **A2. Filtros de texto públicos em `common`.**
  - `src/common/public-text/public-text.ts`: `CONTACT_LIKE`, `STREET_LIKE` e `publicDescription(value, max)`, movidos de
    `list-public-recent-vacancies.handler.ts`, que passa a importar de lá.
  - Testes: os da vitrine (`list-public-recent-vacancies.handler.spec.ts`) verdes **sem mudança**, mais um spec do módulo novo.
- **A3. Domínio puro.**
  - `src/shared/fixed-jobs/domain/public-fixed-job.ts`: `PUBLIC_FIXED_JOB_SELECT`, `toPublicFixedJob`, `publicCompanyName`,
    `publicFixedJobCity(location, citiesIndex)`, `publicSalary`, `publicSchedule` e `publicBenefits`.
  - Testes: todos os de §2.4.1, com os canários.
- **A4. Aplicação.**
  - `src/shared/fixed-jobs/application/public-fixed-jobs.service.ts`: `listRecent(limit)` e `getOne(id)`, com o filtro de status, validade e
    usuário ativo, e o índice de `shared.cities` em memória por 1 h.
  - Testes com Prisma falso: o `where` exato; o `take` com padrão e teto.
- **A5. HTTP.**
  - `src/shared/fixed-jobs/http/public-fixed-jobs.controller.ts` (sem guard; `recent` antes de `:id`) e registro em `fixed-jobs.module.ts`.
  - Testes: ordem das rotas; 404; 400 de UUID; sem autenticação.
- **A6. Subida.**
  - Um deploy por vez.
  - Depois: `curl /v1/fixed-jobs/public/recent?limit=100 | grep -E '@|[0-9]{4}-?[0-9]{4}|Rua |Av\.'` tem de sair vazio.
  - Pronto: as 52 da F0-6 conferidas, com cidade e empresa como esperado.

### Fase 2b: site (`freela-web-v2`, yarn; nunca `gh pr merge`, o dono faz o merge)

- **W1.** `src/lib/public-fixed-jobs.ts` (fetch + Zod na borda; formata salário e escala). Teste `vitest`.
- **W2.** `src/app/(public)/vagas-fixas/[id]/page.tsx` + `_components/public-fixed-job-cta.tsx` + `FixedJobPostingJsonLd`.
  - `generateMetadata` com "Vaga fixa de {cargo} em {cidade}".
  - Testes: CTA anônimo e logado; JSON-LD só com cidade e salário presentes; nenhum campo de contato no HTML.
  - Pronto: responsivo no celular, `yarn lint` e `yarn test` verdes.
- **W3.** (opcional) Entrada no `sitemap.ts`.

### Fase 3: Meu Funil, vagas fixas (depois de A6 e W2 no ar)

- **M11.** Migração 3 (depois da F0-7) + DTO + tipos.
- **M12. Feed.**
  - `vacancy-feed.ts`: `recentClt()`, `cltById()`, `cltItemSchema` (Zod); `vacancy-types.ts`: `FreelaFixedJob`.
  - Testes: formato inválido descartado; 404 → null; queda → `FeedDownError`.
- **M13. Porta por fonte, sem mudar as diárias.** `vacancy-sources.ts`. Gerador, guarda, consulta, ações e tela passam a chamar pela porta.
  Pronto: **toda** a suíte de `vacancy-stories` verde, sem editar asserções.
- **M14. Triagem, campos, textos e assinatura CLT.**
  - `vacancy-clt.ts` (`cltTriage`, `cltForcedTriage`, `cltFields`, `cltFingerprint`) e `vacancy-reasons.ts` (textos da tabela §2.4.3).
  - Testes: cada texto CLT; `snap` por `source`.
- **M15. Arte CLT.**
  - `vacancy-clt-art.ts` (`composeCltArt`), com os desenhos exportados de `vacancy-base-art.ts`.
  - Testes: tamanho 1080 × 1920; `jsqr` lê `/vagas-fixas/<id>`; sem empresa, o cartão sai.
  - Pronto: prévia aprovada pelo `ux-designer` e pelo Diego.
- **M16. Consulta CLT com retroativo.**
  - Arquivo: `vacancy-poll.service.ts`.
  - Testes: marca d'água com `clt_backlog_days`; erro da CLT só em `clt_last_poll_error`; diárias seguem com a CLT fora; inserção sem
    duplicar.
- **M17. Agenda e gerador por tipo.**
  - Arquivos: `vacancy-usage.ts` (contagem por `kind` com o filtro de relação), `vacancy-scheduler.service.ts` (antecedência 0 e limite CLT)
    e `vacancy-guard.service.ts` (`cltById`).
  - Testes: 52 vagas no retroativo → 2 por dia; diária antes da CLT no mesmo horário; a guarda cancela a CLT fechada; os posts antigos contam
    como diária.
- **M18. Rotas e interruptores.**
  - `clt/enable`, `clt/disable` (manage), PATCH e `kind` na lista; `vacancy-settings.service.ts` (`turnOff(kind)`), `vacancy-poll.service.ts`
    (`disableOrphans` só das diárias); todos os leitores de `enabled` da tabela da §2.4.3.
  - Testes: viewer 403; A×B; desligar a CLT não toca diária e vice-versa; arte modelo apagada não desliga a CLT; diárias desligadas com CLT
    ligada → o gerador e a agenda seguem só para a CLT; `clt/enable` sem marca → 400.
- **M19. Telas.** `settings-panel.tsx` (seção CLT), `stories-list.tsx` (chips e selo) e `story-detail.tsx` (sem data e hora), em `vitest`.
- **M20.** Contrato §26 e `CLAUDE.md`. Revisão do `software-architect` e do `ux-designer` antes de subir.

### Depois (fora deste lote)

- "Responda e receba o link" no Direct.
- Gêmeas (se a F0-4 justificar).
- Espaço de 10 min (se a F0-2 justificar).
- Repetir story CLT.
- Carrossel semanal de vagas fixas.

---

## 11. ADR-028 (texto para `api-freela/docs/architecture.md`)

### ADR-028 (24/11/2026): vitrine pública de vagas fixas no Kernel `fixed-jobs`

**Contexto.** As vagas fixas (CLT) moram em `shared.fixed_job_posts` e só são lidas com login (`FixedJobsController`, `JwtAuthGuard`). O Meu
Funil vai divulgar as vagas fixas no Instagram do Freela e o site vai ter a página pública da vaga fixa. A vitrine das diárias
(`/v1/bars-restaurants/public/vacancies/*`) já mostrou o molde: lista de permissão de campos e teste que falha se endereço ou contato vazarem.
O texto do endereço (`location`) é livre e pode ter rua; a cidade do cadastro da empresa pode ser a da matriz.

**Decisão.**
- Controller sem autenticação `v1/fixed-jobs/public` dentro da capacidade `src/shared/fixed-jobs/` (já listada no ADR-003), com
  `GET recent` (teto 100) e `GET :id`.
- Lê só o schema `shared`: `fixed_job_posts`, `users` (dono ativo) e `cities`.
- Campos por lista de permissão (`PUBLIC_FIXED_JOB_SELECT`).
- Contato, `location` cru, coordenadas, instruções de candidatura e id do dono nunca saem.
- A cidade sai só como nome canônico de `shared.cities`, achado nos sufixos do texto com a UF; senão, null (nunca a do cadastro da empresa).
- Os filtros de texto público (`CONTACT_LIKE`, `STREET_LIKE` e `publicDescription`) mudam de `bares-restaurantes` para
  `src/common/public-text/`, usados pelas duas vitrines.

**Alternativas.**
- Usuário de serviço lendo o mural autenticado: acopla sistema externo a login de pessoa, e o mural filtra por raio.
- Evento ou webhook para o Meu Funil: infra nova para poucas vagas por semana.
- Vitrine dentro de `bares-restaurantes`: a tabela é do Kernel, e o módulo não pode ler outro schema que não o seu e o `shared`.

**Consequências.**
- Nome da empresa, salário, escala, benefícios e cidade das vagas fixas ficam públicos (internet e Google), decisão de produto do dono.
- Nome de pessoa física sem dígitos em `companyName` não é detectável (mesma limitação da vitrine das diárias).
- Testes de canário (contato e rua sem vírgula em todos os campos livres) são obrigatórios e travam regressão.
- Rota nova = entrada em `docs/api-contracts.md`.
