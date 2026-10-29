# Meu Funil — "O estrategista conduz" — design (29/10/2026)

Companheiro de tela/textos: `2026-10-29-estrategista-conduz-ui.md`. Base: `master` `5494fff` (o que está em produção).
Desenho feito pelos agentes `software-architect` (§1–§6) e `ux-designer` (arquivo `-ui`), um de cada vez e só lendo o código.
A §0 consolida os dois e registra as decisões tomadas na consolidação. **Nada foi construído.**

## 0. Consolidação

### 0.1 O pedido e o porquê

O pedido veio do Diego, dono da Freela, em áudio no WhatsApp em 29/10/2026. Transcrição resumida:

> "No Meu Funil a primeira etapa é criar a estratégia. Tem que ter o **estrategista**: você fala o que quer, a intenção da campanha, o prazo, o período.
> Ex.: quero uma pra **cadastros de bares e restaurantes de Jundiaí por 30 dias** oferecendo **a primeira contratação gratuita**. Ele cria a estratégia
> e direciona o criativo, o vídeo, a campanha no tráfego pago, os stories, o que postar, o reels. No tráfego pago já configura foco, persona, prazo,
> período, área, região, pega o criativo e anexa." + "Usa como referência o Pinterest (imagens e vídeos) pra melhorar a qualidade." +
> "Estou sem marketing nenhum, preciso usar isso."

**Por que agora:** a Freela não tem ninguém de marketing. O Meu Funil já faz quase tudo o que o pedido descreve, mas em 7 passos manuais, com
um formulário de até 20 campos (§1). Na prática o Diego não usa. O objetivo é ele contar o que quer, aprovar **uma vez** e encontrar tudo pronto:
posts, vídeo e o anúncio montado e desligado. Depois ele só confere e liga.

**Sucesso:** a 1ª campanha real é a de Jundiaí. Ela precisa sair da frase do Diego até "Pronto para ligar" sem que ele abra aba por aba.
Ligar a verba continua sendo um toque dele.

### 0.2 Objetivos, não-objetivos e anti-objetivos

- **Objetivos:**
  - entrada por conversa (§2.1);
  - região estruturada com raio (§2.2);
  - o estrategista conduz no servidor: textos → Instagram → artes e vídeo → anúncio montado pausado (§2.4);
  - referências de estilo por upload e, atrás de flag, por link do Pinterest (§2.3);
  - painel único com Pacote → Andamento → Pronto para ligar (ui §B–D).
- **Não-objetivos:** ficam fora Google/TikTok no piloto e o upload de áudio com transcrição (na v1 vale o microfone do teclado ou colar a
  transcrição do WhatsApp). Também ficam fora a busca automática no Pinterest pela API v5 (busca em beta, sem acesso garantido; verificado em 29/10)
  e qualquer mudança no app Freela, como criar a oferta grátis.
- **Anti-objetivos.** Se acontecer qualquer um destes, a entrega falhou, mesmo funcionando:
  1. O piloto liga verba sozinho. "Ativar na Meta" continua manual, só owner/admin (`manage`), e passa por uma tela de conferência.
  2. A IA inventa a verba ou o destino.
  3. O anúncio cai em "Brasil inteiro".
  4. Um post reprovado sai sozinho.
  5. Uma imagem de terceiro (Pinterest) entra como pixel no gerador ou é publicada.
  6. O fluxo manual atual quebra.

### 0.3 Achado grave do fluxo ATUAL → Fatia 0 (antes de tudo)

Estes 3 problemas foram conferidos no código em 29/10. Valem também para quem usa o caminho manual hoje:

1. **O anúncio não tem data de fim.**
   - O que o código faz: `MetaOpsService.publishPaused` cria campanha e conjuntos com `daily_budget` e **sem `end_time`**. Nenhum job
     pausa no `end_date`; só o "Encerrar campanha" manual pausa.
   - Consequência: depois de ativada, a campanha gasta até alguém pausar à mão.
   - Correção: criar o conjunto com `end_time` = fim do `end_date`, 23:59 de Brasília. A partir daí, a própria Meta para o conjunto.
     Não há job de pausa automática (§0.7 #3).
   - Na subida: uma consulta só de leitura lista as campanhas ativadas antes da F0. O Denner confere caso a caso com o dono de cada empresa,
     e o deploy não pausa nada.
2. **Verba silenciosa de R$ 20/dia.** `Number(budget_daily) || 20` publica com R$ 20 quando a verba está vazia. Correção: bloquear o "Publicar na Meta"
   sem verba, com frase e campo.
3. **"Brasil inteiro" por engano.** Quando o `geoFor` não reconhece a cidade, cai em `countries:['BR']`. Correção imediata no manual: bloquear o publicar
   com "Não achamos a cidade". A região estruturada vem na F2.

A Fatia 0 é pequena, não depende de decisão do dono e destrava usar o caminho manual com segurança enquanto o piloto é construído.

### 0.4 Pedidos do designer ao arquiteto: resolvidos (decisões da consolidação, marcadas como tal)

| # | Pedido | Decisão |
|---|---|---|
| 1 | Data de fim na Meta | **Sim**, na Fatia 0 (§0.3). A frase "até 27/11" na conferência passa a ser verdadeira. |
| 2 | Resumo do piloto na lista de campanhas | Sim: a listagem ganha `pilot_summary {status, current_step, first_block_code, counts}` (derivado da run mais recente). |
| 3 | Estratégia gerada no servidor ("pode fechar") | **Decisão da consolidação:** a run do piloto nasce no "Criar e montar o plano" com `status='planning'` e uma etapa `strategy` executada pelo job/chute do servidor. O "Aprovar e começar" vira `POST …/pilot/:runId/approve` (corpo `{strategy_version, options, approve_now?}`), que leva a run a `running`. Isso substitui o `POST …/pilot` da §2.5 como 2º passo; o `idempotency_key` fica na criação. O CHECK de `status` ganha `planning`. |
| 4 | Horário por etapa | Sim: `steps.*.started_at` / `finished_at`. |
| 5 | "Seguir com o que tem" | Sim: `resume` aceita `{action: 'retry' \| 'proceed_partial' \| 'raise_cap', max_credits?}`. `proceed_partial` marca os slots restantes como `skipped`. |
| 6 | "Não usar esta arte" antes de ligar | Sim, na conferência: pausa o anúncio daquela arte na Meta (`setAdStatus PAUSED`, que já existe) antes de ativar. Com isso, **o padrão do pacote é G1**. G2 continua como opção. |
| 7 | Refazer só o Instagram | Sim: `POST …/pilot/:runId/redo-instagram` gera só o `plano_instagram` (prompt parcial) e grava na mesma versão da estratégia aprovada, sem nova aprovação. Como gravar sem violar o versionamento fica com quem construir (ex.: `campaign_strategies.content.plano_instagram` + atividade). |
| 8 | Intake: máx. 3 perguntas, suposições estruturadas | Sim: `missing` ≤ 3, na ordem verba → destino → condições da oferta; `assumptions: [{field, text}]`. As condições da oferta só viram pergunta quando o texto traz promessa. |
| 9 | Fonte única de "liberado para a empresa" | Sim: `GET /v1/workspaces/:ws/features` → `{campaign_pilot, style_refs_pinterest, vacancy_stories}`. |
| 10 | Estimativa com as parcelas | Sim: `estimate.items[] = {label, formula, value, source}` + `total`. A tela não refaz a conta. |
| 11 | Manual sem R$ 20 e sem "Brasil inteiro" | Sim, Fatia 0. |

**Também da consolidação:** o "Entendi" do intake **já é a revisão** (severidade 3 do designer). O formulário de 5 passos fica fechado e
preenchido em "Ver/ajustar detalhes" e não é obrigatório. Raio de cidade: **17–80 km** (doc de targeting da Meta, conferida pelo designer). As opções
são só a cidade · +20 (padrão, igual a hoje) · +40 · +80 · outra.

### 0.5 Fatias (ordem)

| # | Fatia | Depende de decisão do dono? |
|---|---|---|
| **F0** | Data de fim na Meta (`end_time`) + lista só de leitura das campanhas ativadas antes + bloquear publicar sem verba e sem cidade (§0.3, §0.7 #3) | Não |
| F1 | Intake por conversa (§2.1 + §0.4 #8) | Não (a pergunta de destino e de oferta aparece na tela) |
| F2 | Região estruturada com raio 17–80 km (§2.2) | Não |
| F3 | Piloto sem Meta: planning → strategy → pacote → copies → Instagram → artes/vídeo (§2.4 + §0.4) | Modo do Instagram (padrão "eu aprovo") |
| F4 | Piloto com Meta pausada + conferência com "Não usar esta arte" (§2.4, G1) | Destino do lead, verba |
| F5 | Referências por upload → notas de estilo (§2.3) | Não |
| F6 | Link do Pinterest (flag `STYLE_REFS_PINTEREST_ENABLED`) | OK jurídico |
| F7 | Depois: áudio → texto, bairros, busca no Pinterest, aviso fora do app | Sim |

F5 pode andar junto com F3. Uma fatia por vez, com revisão do arquiteto e do designer no fim de cada uma (regra do projeto). Os testes e verificações
seguem as regras de baixo consumo do `CLAUDE.md`, sempre via `scripts/run-capped.sh`.

### 0.6 Decisões que só o dono toma

Resumo para o Diego no fim da conversa de 29/10. Os detalhes estão na §4 e na ui "Decisões que só o dono toma".

1. **"1ª contratação grátis":** existe no app Freela? O que é grátis (a taxa do Freela, a diária ou as duas), até quando, só para empresa nova, e
   como se prova que a empresa veio da campanha. Sem regra escrita, o anúncio não promete (oferta anunciada obriga, CDC). A mudança no app Freela
   fica fora deste repo.
2. **Destino do interessado:** formulário da Meta (o contato cai no CRM do Meu Funil e a Rebeca liga) ou a página de cadastro do Freela (qual link?).
   Nos dois casos, qual é o link da política de privacidade?
3. **Verba:** quanto por dia (opções R$ 20/30/50?) e qual o teto do mês.
4. **A Meta está conectada** na empresa Freela App do Meu Funil (conta de anúncios, página, Instagram)? Conferir em Integrações.
5. **Pinterest por link** precisa de OK jurídico. Sem esse OK, a v1 aceita só o envio da imagem ou do vídeo salvo no celular.
6. Padrões propostos, que o dono pode trocar:
   - G1: as artes que passam na revisão vão para o anúncio, e ele pode tirar uma na conferência;
   - Instagram "eu aprovo cada post" na 1ª campanha;
   - raio de +20 km.
7. Depois:
   - aviso fora do app (WhatsApp) quando precisar dele;
   - menu em português (quebra o 1:1 do protótipo);
   - quanto vale 1 crédito em R$;
   - categoria especial "Emprego" da Meta, se alguma campanha recrutar freelancers.

### 0.7 Respostas à revisão de construtor (decisões da consolidação)

1. **Condições da oferta.**
   - Onde ficam: coluna nova `campaigns.offer_terms jsonb NULL`, no formato `{what: 'taxa'|'diaria'|'ambas'|texto, valid_until: date, new_only: bool,
     confirmed_by, confirmed_at}`.
   - Quando são obrigatórias: se o pedido traz promessa (`offer_promise` não vazio), o "Criar" do intake exige `what`/`valid_until`/`new_only`.
     É a pergunta 3, sem nada marcado.
   - Nos prompts: entram como **restrição obrigatória** na estratégia, na copy e no diretor de arte ("prometa só isto, com estas condições").
   - No Ativar: com promessa, o servidor recusa sem `confirmed_at` (`OFFER_UNCONFIRMED`). A caixa "Confirmo que o Freela cumpre" grava a
     confirmação; não vale só como trava na tela.
   - Enquanto o Diego não confirma: o piloto produz tudo, mas **não liga**. Ligar é sempre humano mesmo.
2. **Verba.**
   - É obrigatória no "Criar" do intake (pergunta 1, sem padrão) e mora em `campaigns.budget_daily/budget_total`.
   - Rota nova `PATCH …/campaigns/:id/budget`, com a mesma janela do `landing-url`: antes de `meta_campaign_id`.
   - O drawer "Ajustar" e o bloqueio `BUDGET_MISSING` usam essa rota. `BUDGET_MISSING` fica para campanhas antigas que entram no piloto sem verba.
   - Mudar verba, região ou público **não** gera nova versão da estratégia. O pacote mostra "metas do plano calculadas com R$ X/dia" quando os
     valores divergirem.
3. **Campanhas já no ar (F0).**
   - O deploy **não pausa nada**. A Meta passa a parar sozinha os conjuntos novos pelo `end_time`, e o job de "rede de segurança" sai do escopo.
   - Na subida, uma consulta só de leitura lista as campanhas ativadas antes da F0. O Denner confere caso a caso com o dono de cada empresa.
   - Campanha sem `end_date` publica sem `end_time` (comportamento de hoje), e a conferência diz "Roda até você pausar ou encerrar".
     Pelo intake, o `end_date` sempre existe.
4. **Para quem vale cada fatia.**
   - **F0 e F2 valem para todas as empresas.** São correções de segurança: bloquear sem verba e sem cidade é melhor que gastar errado, e o
     caminho com `geo_targets` vazio continua igual ao de hoje.
   - F1 ganha lista própria `CAMPAIGN_INTAKE_WORKSPACE_IDS` e `/features.campaign_intake`.
   - Só com F1, o botão final do intake é "Criar campanha" (vai ao detalhe de hoje). Com F3 liberado, vira "Criar e montar o plano".
5. **Criação da run.**
   - O web chama `POST …/campaigns` e depois `POST …/campaigns/:id/pilot {idempotency_key}`. A segunda chamada cria a run em `planning` e dispara
     a etapa `strategy` no servidor.
   - O "Aprovar e começar" é `POST …/pilot/:runId/approve`.
   - O índice "1 piloto ativo por campanha" passa a ser `WHERE status IN ('planning','running','blocked')`.
6. **Armadilha conferida:** `MetaAdsService.setStatus('ACTIVE')` reativa todos os `meta_ad_ids`, menos os pausados pelo otimizador.
   - Problema: o "Não usar esta arte" seria desfeito no próprio "Ligar".
   - Correção: a exclusão fica gravada (`creatives.extras.excluded_from_ads_at`) e o Ativar a respeita, com teste.

---

## Desenho de arquitetura (software-architect)

## 1. Fluxo atual (conferido no código) e correções ao briefing

| Etapa | Onde | Observação |
|---|---|---|
| Criar campanha | `web/.../campaigns/new/NewCampaign.tsx` (5 passos) → `POST /v1/workspaces/:ws/campaigns` (`CampaignsService.create`, sempre `draft`) | `audience` = `{persona, idade, localizacao, interesses, tipo}` (jsonb livre). O `finish()` **do navegador** encadeia estratégia + copy (a copy recebe `brand`/`brief` montados no cliente). |
| Editar campanha | só `PATCH :id/landing-url` | **Não existe** PATCH dos outros campos. |
| Estratégia | `StrategistService.generate` (`POST /v1/ai/generate-campaign-strategy`, write) → `campaign_strategies` versionada; `approve` | **Correção:** aprovar estratégia exige `write`, não `manage`. |
| Plano IG | `StrategistService.createIgPlan` → `ig_content_plans` `status:'draft'`, `auto_publish:false` | **Correção:** esse plano sozinho não produz nada (o autopilot por plano só lê `auto_publish && active`). Quem produz é a programação `ig_auto_runs` (`AutoCalendarService.createAutoRun`, aceita `planId`, `campaignId`, `mode`, datas, horários; exige `focus` ≥ 30 caracteres). |
| Copy | `CopyAiService.generate` (exige `userId` + `brand`/`brief` do cliente) → `CampaignsService.createCopy` | |
| Criativos | `CreativeService.generate` → `runArtDirected` → `PipelineService.run` (3 variações + crítico + 1 refação < 28/50 + composição); vídeo assíncrono termina no job `creative-poll-5min` | `RefsService.loadBrandRefs` carrega `brand_assets` `reference/photo` e os manda **como pixels** (`referenceImages`, `/images/edits`). |
| Aprovar campanha | `CampaignsService.requestApproval` → `ApprovalsService.decide` (`manage`) → `campaigns.status='approved'` | |
| Meta | **Botão separado** "Publicar na Meta" → `MetaAdsService.publish` → `publishLocked` → `MetaOpsService.publishPaused` | **Correção:** não é automático após aprovar (o passo 5 do `GUIDES.campaign` sugere que é). `publishLocked` exige: campanha `approved/active`, `meta_campaign_id` nulo, `landing_url` (mesmo com formulário instantâneo), ≥1 criativo `approved`. Verba: `Number(budget_daily) \|\| 20` (**R$ 20/dia silencioso**). Trava em memória por campanha. |
| Geo | `MetaOpsService.geoFor` | Texto livre → cidades com **raio 20 km fixo** (linhas 222 e 225); não reconhecido → **"Brasil inteiro"** (`countries:['BR']`). `special_ad_categories: []` fixo. |
| Ativar | `MetaAdsService.setStatus` + `CampaignGuardsService.assertCanSetDelivery` (`manage`) | Fica como está. |
| Custos | `creatives.real_cost`, `creative_generation_jobs.actual_cost`, `media_assets.cost` em **créditos do app** (`AI_COST` em `ai/ai.service.ts:29`: imagem 1,0 Gemini / 1,5 ChatGPT, vídeo 6,0; 0 com chave própria) | `campaign_costs` é **lido** como gasto extra em R$ nos KPIs (`CampaignDetail.tsx:121`) e nunca escrito pelo app. **Não** gravar créditos lá (mistura unidade). |
| IA | `AiService`: `text`, `json`, `jsonWithEngine`, `vision`, `image`, `video` | Não há transcrição de áudio. |
| Encerrar | `CampaignEndService.end` pausa canais, cancela posts IG da campanha e `approval_requests` pendentes | |

---

## 2. Desenho

### 2.0 Regras cravadas (anti-objetivos)
1. O piloto **nunca** chama `setStatus('ACTIVE')`/`setDeliveryStatus('ACTIVE')`. O módulo do piloto nem importa esse caminho; teste garante.
   "Ativar na Meta" continua manual, `manage`, e ganha uma tela de conferência (verba diária × dias = máximo, região, públicos, criativos, destino).
2. Post reprovado nunca sai sozinho: o piloto só **cria** a programação do Instagram; produção, revisão e publicação são as do 05/10.
3. Fluxo manual intacto: as abas continuam funcionando; o piloto lê o estado do domínio e se adapta (ex.: publicado à mão → etapa "já enviada").
4. Nenhum valor que muda gasto vem da IA sem confirmação humana: verba e destino nunca são inventados; o piloto não usa o `|| 20`.
5. Referência de terceiro **nunca** entra como pixel no gerador, nunca vai para a Biblioteca, nunca é publicada.

### 2.1 (a) Entrada conversacional — sem migração obrigatória, sem tabela

`POST /v1/workspaces/:workspaceId/campaigns/intake` (write: gasta IA; rota estática **antes** de `:id`).
Corpo: `{ brand_id, text (≤ 4000), previous_draft? (≤ 20 KB), answers? { campo: texto ≤ 500 } (≤ 10) }`.
Resposta 200: `{ draft: { name, objective, offer_product, offer_promise, start_date, end_date, audience:{persona,idade,localizacao,interesses,tipo},
geo_targets:[…], budget_daily, budget_total, goal_leads, formats, intake_text }, missing: [{ field, question, suggestion }], assumptions: [texto] }`.

- `AiService.json` com schema estrito; prompt leva o DNA da marca (segmento, região, produtos, personas). `objective` = enum das chaves de `OBJECTIVES`.
- **Datas derivadas no servidor**: a IA devolve `periodo {inicio: hoje|amanha|data, inicio_data, duracao_dias, fim_data}`; o servidor calcula com
  `todaySp()` (+ `duracao_dias − 1`, 30 dias = hoje..hoje+29), valida fim ≥ início e ≤ 180 dias. A IA nunca escreve uma data de calendário relativa.
- **Guarda anti-invenção**: `budget_*`/`goal_*` só são aceitos se houver número no texto/respostas; `landing_url` só se houver URL. Senão vão para `missing`.
  `budget_total` = `budget_daily × dias` calculado no servidor e mostrado com a conta.
- Nada é gravado: o web preenche o formulário atual (revisável) e o "Criar" usa o `POST campaigns` existente, que ganha `intake_text` (opcional) e `geo_targets`.
- Migração aditiva: `campaigns.intake_text text NULL` (CHECK ≤ 4000) — guarda as palavras do dono para o prompt do estrategista (`pedido_original`) e auditoria.
- Exemplo (frase do Diego) → `objective: leads`, `tipo: B2B`, persona "donos/gerentes de bares e restaurantes", Jundiaí-SP, hoje..+29,
  `offer_promise: "Primeira contratação gratuita"`; `missing`: verba diária, destino do lead, condições da oferta.
- Áudio: fatia 1 = texto colado + botão "Falar" com Web Speech API do navegador (sem servidor; Chrome/Android). Upload de áudio com transcrição
  = depois (`AiService.transcribe` novo, atrás de flag).

### 2.2 (c) Região como campo de verdade

| Opção | Prós | Contras |
|---|---|---|
| **`campaigns.geo_targets jsonb` (recomendada)** | 1 coluna aditiva; lista pequena; "fotografada" na campanha | validação no DTO/serviço (o banco só confere array e tamanho) |
| Tabela `campaign_geo_targets` | constraints por linha | join a mais para 1–10 itens lidos só no publicar |
| Continuar em `audience.localizacao` | zero migração | texto livre é o problema de hoje |

- Migração: `geo_targets jsonb NOT NULL DEFAULT '[]'` + `CHECK (jsonb_typeof(geo_targets)='array' AND jsonb_array_length(geo_targets) <= 10)`.
- Item: `{ type: 'city'|'neighborhood'|'point', name, uf?, meta_key?, radius_km?, lat?, lng? }`. DTO com `ValidateNested` + `Type`.
  Raio de cidade: `null` = só a cidade, senão faixa da Meta (**conferir na doc antes de expor o seletor**; 20 km funciona hoje — eu lembro 17–80 km, não confirmado).
  Fatia 1 só `city`; `neighborhood`/`point` depois (cobertura de bairros no BR incerta; ponto exige geocodificação que o Meu Funil não tem).
- `GET /v1/workspaces/:ws/geo/search?q=` (read) → busca `adgeolocation` da Meta (`MetaOpsService`), devolve `{meta_key, name, region, type}`;
  sem Meta conectada: `{ error:{ code:'META_NOT_CONNECTED' } }` e o nome é salvo sem chave (resolvido no publicar).
- `PATCH /v1/workspaces/:ws/campaigns/:id/geo-targets` (write), mesmo padrão do `setLandingUrl` (só `draft/pending_approval/approved` e `meta_campaign_id` nulo).
- `geoFor`: com `geo_targets` não vazio usa só eles e **falha** se algum não resolver (nunca "Brasil inteiro"); sem `geo_targets` = caminho legado inalterado.
- Estratégia: `buildStrategyPrompt` recebe `regiao` estruturada + `pedido_original`.

### 2.3 (d) Referências visuais ("Pinterest")

**Decisão de direitos autorais (arquitetural):** referência → `ai.vision` → **notas de estilo em texto** (paleta, composição, luz, enquadramento,
ritmo/movimento de câmera no vídeo, "evitar"). O gerador recebe só o texto, delimitado: "inspiração; não copie composição, pessoas, marcas, textos".
Pixels de terceiros nunca entram em `referenceImages`, no crítico como "fidelidade", no primeiro quadro do vídeo, na Biblioteca ou na Meta/IG.
Fotos de produto da marca (`brand_assets` `tag: produto`) continuam como hoje.

| Onde guardar | Prós | Contras |
|---|---|---|
| `brand_assets` kind novo | tabela existente | `RefsService` carrega `reference/photo` como pixel — um erro de kind vira cópia; sem campo de origem |
| `media_assets` com tag `referencia` | upload/miniatura prontos | é a Biblioteca: vira mídia selecionável para post/anúncio (risco de publicar obra de terceiro); toda tela de escolha teria de filtrar |
| **`style_references` (recomendada)** | isolada do que é publicável; origem e notas explícitas | 1 tabela; reusa `FilesService`/`ImageService`/`FfmpegService` |

`style_references`: `id, workspace_id, brand_id (FK cascade), campaign_id NULL (FK cascade), source CHECK ('pinterest','upload'), source_url,
pin_id, kind CHECK ('image','video'), storage_path (≤ 1024 px JPEG), frames jsonb '[]' (≤ 4 quadros), style_notes jsonb '{}', status CHECK
('processing','ready','failed'), error, created_by, created_at`; `UNIQUE (workspace_id, brand_id, pin_id) WHERE pin_id IS NOT NULL` (colar o mesmo Pin = mesma linha);
índice `(workspace_id, brand_id, created_at DESC)`; teto 30 por marca, até 8 usadas por campanha. Vídeo enviado (≤ 50 MB) → `FfmpegService.extractFrames`
(o mesmo do `VideoQualityService`) → apaga o vídeo, fica com os quadros.

Link do Pinterest (atrás de `STYLE_REFS_PINTEREST_ENABLED`, padrão false até o OK jurídico):
1. Aceita `https://{www,br,…}.pinterest.com/pin/<id>/` e `https://pin.it/<código>` (o redirecionamento do `pin.it` é seguido à mão e o destino tem de ser `*.pinterest.com/pin/<id>`); normaliza para `https://www.pinterest.com/pin/<id>/`.
2. `GET https://www.pinterest.com/oembed.json?url=…` (endpoint usado pelo WordPress, **não documentado** pelo Pinterest) → `thumbnail_url`; sem ele, HTML da página do Pin (≤ 2 MB) → `og:image`.
3. Download só de `i.pinimg.com`, `image/(jpeg|png|webp)`, ≤ 15 MB, via `createGuardedFetch` (SSRF) com allowlist checada **a cada salto** de redirecionamento; reduz a ≤ 1024 px.
4. Pin de vídeo: só a capa (sem raspar o stream); a tela orienta "para usar o movimento, envie o arquivo do vídeo".
5. Falhou → mensagem com a saída "envie a imagem".

Rotas (sob a marca; WorkspaceAccessGuard): `GET …/brands/:brandId/style-refs?campaign_id=` (read), `POST …/style-refs/pinterest {url, campaign_id?}`,
`POST …/style-refs/upload` (multipart pela API), `DELETE …/style-refs/:id` (write). Consumo: `RefsService.loadStyleNotes(ws, brandId, campaignId)` →
`ArtBrief.styleNotes` / `VideoBrief.styleNotes`. Isso também atende "imagens no briefing" (aparecem na aba Briefing) e, em parte, "modelos de arte"
(estilo a seguir; um molde de layout fixo como o `vacancy_template` é outra coisa e fica fora).
Busca automática no Pinterest (API v5) = fase posterior atrás de `PINTEREST_SEARCH_ENABLED`, só se o acesso for liberado (OAuth + segredos no cofre).

### 2.4 (b) O estrategista conduz

| Opção | Prós | Contras |
|---|---|---|
| Encadear no navegador (como o `finish()` de hoje) | zero tabela | morre se a aba fechar; vídeo leva minutos; sem retomada | 
| **Executor no servidor: `campaign_pilot_runs` + job (recomendada)** | retoma sozinho, idempotente, auditável; chama os serviços existentes | 1 tabela, 1 job; refatorar `CreativeService.generate`, `CopyAiService.generate` e `MetaAdsService.publish` para aceitar ator de sistema |
| Estender `ig_auto_runs` para também fazer anúncios | reaproveita a máquina do IG | mistura orgânico e pago numa máquina que já é grande |

**Portão de aprovação** (decisão do dono, ver §4):

| | G1 (atende o pedido) | G2 (mais conservador) |
|---|---|---|
| Como | O pacote é aprovado UMA vez em Aprovações (`manage`) e isso vale como "publicar pausada"; o piloto marca como `approved` só os criativos **dele** com nota ≥ 28/50 (vídeo ≥ `MIN_VIDEO_SCORE`) e monta pausada | Piloto para em "pronto para revisar"; 1 clique "Aprovar criativos e montar pausada" |
| Gasto | nenhum (pausada) | nenhum |
| Cliques até ativar | 2 (aprovar pacote, ativar) | 3 |
Implementado como a opção `meta.review_creatives` do pacote (G2 = true).

**Quem aprova o quê** (sem papel novo): o clique "Começar" de quem tem `write` já autoriza a produção (copies, criativos, programação do IG — hoje
um `write` já pode gastar IA e criar programação em modo `publish`). Só a parte da Meta exige `manage`: com `meta.enabled`, o piloto reusa o miolo do
`CampaignsService.requestApproval` (mesma transação `approval_request` + `campaigns.status = pending_approval`, com o resumo do **pacote** no lugar de
"0 criativo(s)"); se quem inicia é owner/admin e marca `approve_now`, o pedido é decidido na hora pelo `ApprovalsService.decide`. Para o Diego (owner):
**1 clique** "Aprovar pacote e começar". Recusa em Aprovações → `decide` já volta a campanha a `draft` → etapa meta `skipped` ("recusado em Aprovações").

**Dados** — `campaign_pilot_runs` (migração aditiva + gatilho `touch_updated_at`):
`id, workspace_id (FK cascade), campaign_id (FK cascade), created_by, approval_request_id NULL, approved_by NULL, approved_at NULL,
strategy_version int, status CHECK ('running','blocked','done','failed','cancelled'), current_step CHECK
('copies','instagram','creatives','meta') NULL, options jsonb (fotografia do pacote), steps jsonb (por etapa: status pending|running|waiting|done|skipped|blocked|failed,
attempts, error_code, error, note, ref), estimated_credits numeric(12,2), max_credits numeric(12,2), idempotency_key text, lease_until, next_run_at, created_at, updated_at`.
`UNIQUE (workspace_id, idempotency_key)`; `UNIQUE (campaign_id) WHERE status IN ('running','blocked')` (1 piloto ativo por campanha);
índice `(status, next_run_at)`. Proveniência dos criativos em `creatives.extras.pilot = {run_id, slot, auto_approved_at, score}` (coluna existente).

**Etapas** (cada uma deduz "feito" das tabelas de domínio; a linha do piloto é só cursor + erros — não é uma segunda verdade):

| Etapa | Ação (serviço existente) | "Feito" quando |
|---|---|---|
| 0. Pacote | estratégia gerada pelo caminho atual; `POST …/pilot` aprova a versão `strategy_version` (`StrategistService.approve`, write), cria a run `running` e, com `meta.enabled`, o pedido de aprovação (acima) | — |
| copies | `CopyAiService` interno com brand/brief montados no **servidor** (helper único extraído do que o web faz) → `createCopy` | copy da campanha criada após `approved_at` |
| instagram | `createIgPlan` + `AutoCalendarService.createAutoRun({planId, campaignId, mode, datas da campanha (início ≥ hoje), horários/formatos do pacote, focus = objetivo + oferta})` | `ig_auto_runs` com este `campaign_id` criado após `approved_at` (id em `steps.instagram.ref`) |
| creatives | slots `ângulo × imagens` + vídeo(s) 9:16; **1 slot por tick**; imagem pelo `runArtDirected`; vídeo fica pendente e o `creative-poll-5min` conclui | todos os slots terminais (≥ 1 pronto) |
| meta | espera o pedido decidido (`WAITING_APPROVAL`, revisto a cada tick, sem "Retomar") → pré-condições → `ads_config` vazio? grava o padrão do piloto pelo miolo do `saveSettings` (`structure: 'per_angle'`, `useStrategyAudiences: true`; se a pessoa já configurou "Anúncios e regras", respeita) → (G1) aprova criativos ≥ nota / (G2) espera aprovação humana → `MetaAdsService.publishAsSystem` (mesmo corpo/trava do `publishLocked`) | `campaigns.meta_campaign_id` preenchido (se já estava, `skipped` "já enviada") |
| fim | `done`; atividade `campaign.pilot_done`; painel mostra "Pronto para ativar" | — |

- **Sem Instagram conectado:** a programação é criada assim mesmo (regra A4: posts ficam `ready` com "Conecte o Instagram"); etapa `done` com aviso.
  Modo `approval`: a estratégia do período e cada post esperam a pessoa (o painel aponta); modo `publish`: zero clique, com o revisor/reescrita existentes.
- **Sem Meta conectada:** etapa `blocked` `META_NOT_CONNECTED` ("Conecte a Meta em Integrações"), revista a cada 30 min até o fim da campanha; nada mais trava.
- **Bloqueios (precisam da pessoa, sem retry automático):** `NO_IG_PLAN` (o `createIgPlan` recusa estratégia sem `plano_instagram.pilares`: "Regere a estratégia"),
  `LANDING_MISSING`, `BUDGET_MISSING`, `GEO_UNRESOLVED`, `COST_CAP`, `NO_CREATIVE_PASSED`,
  `WAITING_CREATIVE_REVIEW`, `AI_NOT_CONFIGURED`/sem créditos (códigos do `AiError`). "Retomar" (`resume`) volta a etapa para `pending`.
- **Falhas transitórias** (5xx, 429, tempo): até 3 tentativas com espera 5 / 15 / 60 min → `failed` com motivo; "Tentar de novo" reabre.
- **Encerramento:** o tick vê `status = finished` → `cancelled`. `CampaignEndService` já cancela os pedidos de aprovação pendentes (a etapa meta em `WAITING_APPROVAL` vira `skipped`);
  cancelar o piloto oferece "cancelar também a programação do Instagram" (`cancelAutoRun`). Assim nenhum módulo passa a depender do piloto.

**Execução e concorrência**
- Job `campaign-pilot-5min` em `JOB_SCHEDULES` (heartbeat `campaign-pilot`), só com `SCHEDULER_ENABLED` e `CAMPAIGN_PILOT_ENABLED`; após aprovar, um "chute"
  em segundo plano (`setImmediate`, depois do commit) roda a 1ª etapa sem esperar o job.
- Claim atômico: `UPDATE … SET lease_until = now()+10 min WHERE id=$1 AND status='running' AND next_run_at <= now() AND (lease_until IS NULL OR lease_until < now()) RETURNING *`;
  renovado antes de cada chamada de IA/Meta. Até `CAMPAIGN_PILOT_PER_TICK` (2) execuções por tick, rodízio por empresa (mais antiga primeiro), **uma ação por execução por tick**.
- Publicar continua sob a trava em memória do `MetaAdsService` + `meta_campaign_id`; publicação manual no meio do caminho → etapa `skipped`.
- Ator: chamadas internas sem `userId` (como os jobs descritos no `CampaignGuardsService`); a atividade grava `actor_id = null` + `{ via:'pilot', run_id, approved_by }`.

**Custos (créditos do app, `AI_COST` em `api/src/modules/ai/ai.service.ts:29`; 0 com chave própria)**
- Fórmula dos criativos da campanha paga: `ângulos × imagens_por_ângulo × variações × custo_imagem` + refações (até 1 imagem por criativo) + `vídeos × (1 + 1 refação) × 6,0`.
  Ex. padrão sugerido: 3 ângulos × 2 imagens × 3 variações × 1,5 = 27; refações até 6 × 1,5 = 9; 1 vídeo × 2 × 6,0 = 12 → **teto 48 créditos**.
  Chamadas de texto/visão (intake, estratégia, copy, crítico, notas de estilo) não estão no `AI_COST` → não entram na conta (dizer isso na tela).
- A programação do Instagram produz ao longo do período pelas regras de 05/10; o pacote mostra a estimativa separada (posts por formato × mesmos custos), fora do teto do piloto.
- `spent_credits` é derivado (`SUM(creatives.real_cost)` dos criativos do piloto), nunca guardado; antes de cada slot: gasto + estimativa do slot ≤ `max_credits`, senão `COST_CAP`.
- Créditos **não** vão para `campaign_costs` (é R$ e entra no CPL/ROI da tela).

### 2.5a Onde mora o código (api/src/modules)
| Novo/estendido | Arquivos |
|---|---|
| Intake | `campaigns/intake.service.ts` + `campaigns/intake.prompt.ts`; `campaigns/dto/campaigns.dto.ts` (`IntakeDto`, `GeoTargetDto`, `intake_text`, `geo_targets`) |
| Região | `ads/geo-targets.ts` (validação de raio + montagem do `geo_locations`, puro); `MetaOpsService.geoFor` (usa `geo_targets`) e `searchGeo`; rota `geo/search` no `AdsController` de workspace |
| Referências | `creative/style-refs.service.ts` + `style-refs.controller.ts` + `style-refs.prompt.ts` (schema de visão); `RefsService.loadStyleNotes`; `ArtBrief`/`VideoBrief` ganham `styleNotes`; allowlist do Pinterest em `media/external-fetch.ts` (`assertAllowedHost`) |
| Piloto | módulo novo `campaign-pilot/` (`pilot.controller.ts`, `pilot.service.ts` = API, `pilot-runner.service.ts` = tick/claim, `steps/{copies,instagram,creatives,meta}.step.ts`, `pilot-estimate.ts` puro, `pilot.dto.ts`). Depende de strategist, copy-ai, creative, instagram (`AutoCalendarService`), ads, approvals, campaigns; **ninguém importa o piloto** |
| Ator de sistema | extrair o miolo, sem mudar as rotas: `MetaAdsService.publishAsSystem`, `CreativeService.generateAsSystem`, `CopyAiService.generateAsSystem` + `buildCopyBrief(campaign, brand)` único (o web passa a ser só um dos chamadores do mesmo formato); `CampaignsService.requestApproval` aceita `summary` do pacote |
| Agendador | `scheduler/job-schedules.ts` (`campaign-pilot-5min`); `common/config/env.validation.ts`; parser de lista de empresas generalizado de `common/config/vacancy-workspaces.ts` |
| Web | `app/(app)/campaigns/new/` (Intake + formulário atual), `app/(app)/campaigns/[id]/` (painel do estrategista, conferência do Ativar, referências no Briefing), `lib/campaign-pilot.ts` (cliente tipado + zod), `lib/guides.ts` |

### 2.5 Contratos (atualizar `docs/api-contract.md` §15, §16, §19 e nova §27 ANTES do código)
| Rota | Nível | Corpo → resposta |
|---|---|---|
| `POST /v1/workspaces/:ws/campaigns/intake` | write | §2.1 |
| `POST /v1/workspaces/:ws/campaigns` | write | + `intake_text?`, `geo_targets?` |
| `PATCH /v1/workspaces/:ws/campaigns/:id/geo-targets` | write | `{ geo_targets }` → campanha |
| `GET /v1/workspaces/:ws/geo/search?q=` | read | `[{meta_key,name,region,type}]` |
| `POST /v1/workspaces/:ws/campaigns/:id/pilot/estimate` | write (sem efeito) | `{options}` → `{estimate:{itens com conta}, blockers:[{code,message,action}], can_approve}` |
| `POST /v1/workspaces/:ws/campaigns/:id/pilot` | write; `approve_now` exige manage | `{idempotency_key, strategy_version, options, approve_now?}` → run (mesma chave = mesma run; outra ativa = 409 `CONFLICT`) |
| `GET /v1/workspaces/:ws/campaigns/:id/pilot` | read | run mais recente + etapas + contagens derivadas + `spent_credits` |
| `POST …/pilot/:runId/resume` · `POST …/pilot/:runId/cancel {cancel_instagram}` | write | run |
| style-refs (§2.3) | read/write | — |
`options`: `{ max_angles 1–5, images_per_angle 1–3, variations 1–3, videos 0–2, instagram:{enabled, mode:'approval'|'publish', weekdays, times, story_times, formats},
meta:{enabled, review_creatives}, max_credits }` — todos com decorator; os que mudam gasto/publicação **sem default no DTO** (o web manda explícito).
Erros no formato do projeto `{ error: { code, message } }`. Ids sempre `ParseUuidPipe` + `workspace_id` no `where`.

### 2.6 Flags/variáveis (em `env.validation.ts`, `.env.example`, `docker-compose.yml` e `docker-compose.prod.yml`)
`CAMPAIGN_PILOT_ENABLED` (false) · `CAMPAIGN_PILOT_WORKSPACE_IDS` ('' ; `*` só fora de produção — generalizar o parser de `VACANCY_STORIES_WORKSPACE_IDS`; fora da lista as rotas do piloto
respondem 404) · `CAMPAIGN_PILOT_PER_TICK` (2) · `CAMPAIGN_PILOT_MAX_CREATIVES` (10) · `STYLE_REFS_PINTEREST_ENABLED` (false) · depois: `PINTEREST_SEARCH_ENABLED`, `AI_TRANSCRIBE_ENABLED`.

### 2.7 Web (designer revisa antes; regra de mudança drástica)
`/campaigns/new`: "Contar para o estrategista" (padrão) | "Preencher formulário" → conversa curta (perguntas só do que falta) → formulário atual preenchido para revisão → Criar.
Detalhe: painel "Estrategista" no topo (pacote: estratégia, região, verba com a conta, estimativa de créditos com a conta, bloqueios com botão de ação, "Aprovar pacote e começar"
(owner/admin) ou "Começar e pedir aprovação da Meta" (marketing)); depois, progresso por etapa (TanStack Query com `refetchInterval` enquanto `running`). "Ativar na Meta" ganha a conferência. `GUIDES.campaign` ganha a variante "com o estrategista".
Aba Briefing mostra as referências (miniaturas + origem + excluir).

---

## 3. Fatias (cada uma vale sozinha; ordem sugerida)

| # | Fatia | Valor sozinha | Risco |
|---|---|---|---|
| F1 | Intake (texto + "Falar" do navegador) + `intake_text` + prompt com `pedido_original` | Diego descreve em 1 frase e revisa o formulário pronto | Baixo: IA inventar verba/URL (guarda numérica) |
| F2 | Região estruturada (cidade + raio, busca na Meta, PATCH, `geoFor` sem "Brasil inteiro") | conserta o raio fixo e o fallback perigoso também no fluxo manual | Médio: limites de raio da Meta; mexe no publicar (manter o legado igual + snapshot) |
| F3 | Piloto parte 1: pacote, aprovação, copies, programação IG, criativos (sem Meta) | "descrevi → saiu tudo produzido" | Médio: custo; refatorar `CreativeService`/`CopyAiService` para ator de sistema sem mudar as rotas |
| F4 | Piloto parte 2: Meta pausada (G1/G2) + conferência no Ativar | campanha montada na Meta sem cliques | Alto: objetos externos; atrás da lista de empresas; campanha órfã pausada se cair entre criar na Meta e gravar o id (sem gasto, limpeza manual) |
| F5 | Referências por upload (imagem/vídeo) → notas de estilo no diretor de arte e de vídeo | qualidade + "imagens no briefing" | Baixo/médio: efeito na qualidade é subjetivo (medir pela nota do crítico) |
| F6 | Link do Pinterest (oEmbed/og:image) atrás de flag | referência sem baixar à mão | Médio: endpoint não documentado; termos de uso |
| F7 | Depois: áudio→texto, bairros/ponto, busca do Pinterest (API v5) | — | dependem de acesso/decisão |
F5 pode andar em paralelo à F3.

---

## 4. Riscos e decisões que só o dono toma
1. **Destino do lead**: formulário instantâneo da Meta (lead cai no CRM do Meu Funil via Lead Ads, a Rebeca liga) **ou** página de cadastro do Freela (UTM; a conversão só é medida se o Freela devolver o evento). Nos dois casos o código exige uma URL (agradecimento/privacidade) — qual?
2. **Verba**: diária e teto do período; o piloto nunca assume (hoje o manual cai em R$ 20/dia).
3. **"1ª contratação grátis"** existe de verdade no Freela (outro sistema)? Regras (só empresa nova? até quando? cobre a taxa da plataforma ou a diária do freelancer? limite de valor?), e como a empresa prova que veio da campanha (cupom/UTM). Oferta anunciada vincula (CDC); sem regra escrita, o estrategista não deve prometer. Mudança no Freela fica fora deste repo.
4. **Portão G1 × G2** (§2.4) e **modo do Instagram** (`approval` × `publish`): recomendo G1 + `approval` na 1ª campanha, `publish` depois de ver a qualidade.
5. **Pinterest**: OK jurídico para buscar a miniatura de um Pin colado (termos de uso); sem OK, só upload.
6. **Créditos × R$** e teto mensal por empresa.
7. **Categoria especial "Emprego" da Meta** se alguma campanha recrutar freelancers (vaga de trabalho): o código manda `special_ad_categories: []` fixo — conferir a regra no Brasil antes.
Técnicos: oEmbed pode mudar; faixas de raio; refações elevam custo (teto cobre só a campanha paga); regressão no manual pela refatoração de ator (mitigar mantendo as rotas e cobrindo com os testes atuais).

---

## 5. Testes previstos (jest com `AI_FETCH`, `META_FETCH`, `EXTERNAL_FETCH`, `FFMPEG_RUNNER` falsos; relógio virtual; nada de rede)
- **Intake:** a frase do Diego → leads/B2B/Jundiaí/hoje..+29 e `missing` [verba, destino, condições]; sem número no texto → verba nula; "a partir de segunda"; fim < início = 400; texto > 4000 = 400; viewer 403; marca de outra empresa 404; IA fora → código do `AiError`.
- **Região:** DTO (tipo, raio, máx. 10); `geoFor` com `geo_targets` monta `cities` com chave/raio e **nunca** cai em BR; legado idêntico; PATCH bloqueado depois de publicar; empresa A não altera campanha da B (404).
- **Piloto:** mesma `idempotency_key` = mesma run; segunda ativa = 409; write inicia (copies/criativos/IG andam) mas `approve_now` = 403 e a etapa meta fica em `WAITING_APPROVAL`; campanha `pending_approval` junto com o pedido; aprovado em Aprovações → meta anda no tick; recusado → campanha `draft` e meta `skipped`; estratégia sem pilares → `NO_IG_PLAN` (sem retry); `ads_config` do usuário respeitado / vazio recebe o padrão; dois ticks seguidos = 1 copy, 1 `ig_auto_runs`, N slots, 1 publicação; lease vencido retoma; cada bloqueio e o `resume`; encerrar → `cancelled`; publicação manual antes → `skipped`;
  **nenhuma chamada à Meta com `status: ACTIVE`** (espião no `META_FETCH`) e o módulo não importa `setStatus`; só criativos do piloto com nota ≥ 28 são aprovados; atividade com `via: pilot`; teto de créditos; conta da estimativa; empresa A não lê/cancela a run da B (404); viewer não inicia (403); fora de `CAMPAIGN_PILOT_WORKSPACE_IDS` = 404.
- **Referências:** IP privado, redirecionamento para host fora da lista, `pin.it` apontando para fora, > 15 MB, content-type errado; sem oEmbed → og:image; sem os dois → mensagem de upload; mesmo Pin = mesma linha; vídeo → 4 quadros (ffmpeg falso); **referência nunca em `referenceImages`** (espião do provedor) nem em `media_assets`; notas delimitadas e com teto no prompt; excluir de outra empresa 404.
- Depois: smoke e grupo novo do browser-check ("estrategista"), sempre via `scripts/run-capped.sh`.

## 6. Fora do escopo
Google/TikTok no piloto; editar a campanha depois de criada além de destino/região; molde de layout fixo ("modelo de arte" tipo vaga); mudanças no Freela (oferta grátis); transcrição de áudio e busca do Pinterest (F7).
