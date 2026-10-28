# Stories automáticos das vagas do Freela — design

**Data:** 28/10/2026 · **Projeto:** `meu-funil` (API NestJS em `api/`, web Next.js em `web/`)
**Tela e textos:** `2026-10-28-vagas-instagram-ui.md` (ux-designer).
**Revisões feitas antes de construir:** leitura de quem vai construir, `software-architect` e `ux-designer` (28/10). Os achados entraram
neste texto.

**Pedido (Denner, repassando o Diego):** "Disparo de vagas automático no instagram seguindo template pronto." Sobre o template:
"Acho que é mandar algum template pronto e a ia já seguir ou deixar salvo." Formato: "Um story por vaga." Exemplo enviado: uma arte
2:3 (1024×1536) feita por IA de imagem — logo do Freela, faixa "VAGA / AUXILIAR DE LIMPEZA / FREELANCER", foto de uma pessoa na função
diante da fachada da Frutá, cartões (Estabelecimento, Função, Data + Horário, Região, Endereço, Valor para o freela, Descrição, Ver vaga +
link com UUID), rodapé preto com logo e selos das lojas. O dono confirmou que a arte saiu de uma IA de imagem ("Isso") e aprovou o resumo
do fluxo ("Tá legal assim, pode seguir").

## 1. Intenção

Cada vaga nova publicada no Freela vira, sozinha, um story no Instagram do Freela, com a cara do modelo que o dono enviou. Ninguém
precisa montar arte. O objetivo é que mais freelancers vejam a vaga e se candidatem ou baixem o app.

**Sucesso:** toda vaga nova elegível aparece em story no mesmo dia, com função, valor, data, horário e cidade **certos**, no estilo do
modelo, sem ninguém abrir o Canva.

## 2. Objetivos, não objetivos e anti-objetivos

**Objetivos**
- Detectar vagas novas do Freela sozinho e gerar 1 story por vaga.
- Salvar o modelo de arte enviado pelo dono e usá-lo como referência visual em toda geração.
- Conferir o texto da arte gerada contra os dados da vaga antes de postar.
- Tudo configurável por empresa (ligar/desligar, cidades, janela, limite por dia, antecedência, IA, aprovar antes ou postar sozinho).

**Não objetivos (fica para depois)**
- Endereço, bairro/região e descrição da vaga na arte (§11).
- Modelos de arte para as campanhas normais, Pinterest e imagens no briefing (pedidos separados do mesmo lote).
- Post no feed, carrossel ou reels de vagas. Só story.
- Apagar o story quando a vaga for preenchida (a API do Instagram não apaga story; ele some em 24 h).
- Link tocável no story (a API de publicação não aceita figurinha de link).
- Receber as vagas por webhook do Freela; aviso por e-mail/WhatsApp de story esperando aprovação.

**Anti-objetivos (seria fracasso mesmo funcionando)**
- Story com valor, data, horário ou cidade errados no Instagram público do Freela.
- Story com texto que a vaga não tem — em especial endereço, região, descrição ou link **copiados do modelo** (o exemplo traz o endereço
  e o link de uma vaga real da Frutá).
- Expor dado pessoal: nome de pessoa física, CPF/CNPJ, telefone, e-mail.
- Postar vaga de teste, vaga velha, vaga que já começou ou vaga cujo valor/horário mudou depois da arte.
- Estourar o limite de publicações do dia e travar os posts normais da empresa.
- Logo duplicada, ou arte de vaga passando pelo caminho comum de criativos (logo automática, sem conferência).

## 3. Restrições e fatos do código

- **Fonte = vitrine pública do Freela, sem autenticação** (`origin/main` do `api-freela`):
  `GET https://api.freelaservicosapp.com.br/v1/bars-restaurants/public/vacancies/recent?limit=24[&city=]` (padrão 8, teto 24; ordem por
  publicação) e `GET .../public/vacancies/:id` (vaga fechada → 404). Campos: `id, title, serviceType, city, date, startTime, endTime,
  amountInCents (valor do freelancer; pode ser null), contractorName (= companyName ?? contactName), publishedAt, isUpcoming,
  payoutTiming?`. `isUpcoming` = **ainda não terminou** (`endTime > agora`), não "ainda não começou". Vagas só para VIP não aparecem.
  Não há endereço, bairro nem descrição. A lista mistura vagas novas e antigas.
- Amostra de 28/10 (24 vagas): 10 publicadas em 27/10 (lote do Coco Bambu); nomes como `"GENILSON FERREIRA DA SILVA 26385530850"`
  (pessoa física com CPF), `"Enzo teste fernandes ltda"` (teste), `null`, `"KNK ALIMENTACAO LTDA"` (razão social).
- **Limite do Instagram:** a trava do app é 25 publicações por 24 h por empresa (`publishing.service.ts:12`, contando só `published`,
  `:309`) mais o `quota_usage` da Meta (`:388-392`). Bater nessas duas → `RateLimited` → a fila remarca para 1 h depois sem gastar
  tentativa, **sem teto e sem olhar janela nem início da vaga** (`:537-573`). Recusa da Meta no `media_publish` vem como `MetaError` e
  gasta tentativa. Tratar story como se contasse no limite.
- **IA:** só via `AiService`. `image()` aceita `referenceImages` (OpenAI `/images/edits`, Gemini `inlineData`) e respeita o `vendor`.
  `json()` com `images` (visão) **sempre** tenta OpenAI → Gemini → gateway, com o modelo de texto (`gpt-4o-mini`). Na OpenAI, `9:16` sai
  1024×1536 (2:3); só o Gemini gera 9:16 de verdade. Em produção a Freela App usa chaves próprias (gateway vazio de propósito).
- **Mídia:** `AssetsService.ingest` com `ig_story` faz `normalize` = `cover` para 1080×1920 (`assets.service.ts:186`,
  `image.service.ts:145-150`), o que **corta** uma arte 2:3. `ImageService.padToAspect` existe (`image.service.ts:187`), mas pinta com a
  cor dominante da imagem gerada.
- **`composeCreative`** só tem os layouts `titulo_topo | preco_destaque | cta_rodape | limpo` e logo num canto (`compose.ts:168-300`):
  não desenha cartões. A reserva precisa de um compositor novo (pode reaproveitar `fillPolys`, fontes e `hexToRgb`).
- `posicao_logo` é da marca (`brand.visual_style`), não do post. A logo só entra pelo caminho comum de criativos
  (`media-generation.service.ts:164-209`, `pipeline.service.ts:164`), e `generatePostAssets` hoje aceita regerar qualquer post sem olhar
  `source` (`media-generation.service.ts:514-519`).
- **Aprovação:** `approvePost` → `afterApproval` não faz nada para post sem `automation` e sem `plan_id` (`autopilot.service.ts:149-163`):
  aprovar **não agenda**. `approvalRequired` devolve `null` para esse post (`ig-store.service.ts:108-114`), e "Publicar agora" num
  `pending_approval` grava `failed` no 1º clique e publica no 2º (`instagram-actions.service.ts:134`, `publishing.service.ts:240`).
- `handleTokenExpired` cancela os jobs da empresa e só devolve para `ready` os posts com `run_id` (`ig-store.service.ts:135-143`).
- `PublishingService` não é exportado pelo `InstagramModule` (`instagram.module.ts:54`).
- `brand_assets.brand_id` é NOT NULL; o DTO só aceita os `ASSET_KINDS` (`brands.dto.ts:69,77`); o tipo do arquivo (PNG/JPG/WEBP) só é
  checado no web (`BrandDetail.tsx:149`); a API aceita SVG/PDF em `kind=brands` (`files.controller.ts:62`). `loadBrandRefs` só usa
  `reference|photo` (`refs.service.ts:13,67`), então um kind novo não vaza para os criativos normais.
- Não há conflito com encerrar campanha, produção automática, piloto, aprendizado e histórico **desde que** o post de vaga tenha
  `automation`, `plan_id` e `run_id` nulos.
- Story tem 1080×1920; o Instagram cobre o topo e a base (o repo usa 14% em cima e 20% embaixo como área segura, `compose.ts:193-195`).
- Regras do repositório (`CLAUDE.md`): contrato em `docs/api-contract.md` primeiro; erros `{ error: { code, message } }`; toda rota de
  workspace com `WorkspaceAccessService`; arquivos só via `FilesService`; nenhum teste faz rede; flag nova em `env.validation.ts` +
  `.env.example` + `docker-compose.yml`; uma instância com `SCHEDULER_ENABLED`; comandos pesados só por `scripts/run-capped.sh`.

## 4. Decisões do dono

| Tema | Decisão |
|---|---|
| Formato | Um story por vaga (resposta a "quando entram várias vagas no mesmo dia, como aparece?"). |
| Modelo | O dono envia uma arte pronta; ela fica salva; a IA segue o estilo dela em toda vaga. |
| Como a arte é feita | IA de imagem gera a arte (foto + textos), como no exemplo. *Rodapé: ver §10.* |
| Conferência | O sistema lê o texto da arte; se sair errado, refaz até 2 vezes; se continuar errado, usa uma versão em que o próprio sistema escreve os textos por cima de uma foto. |
| Detecção | Automática, consultando a vitrine periodicamente. |
| Configuração | Configurável (pedido recorrente do dono: "deixa tudo configurável"). |

## 5. Fluxo

1. **Consulta** (job novo `vacancy-stories-10min` no agendador, com heartbeat): uma chamada `recent?limit=24` **sem cidade**; filtro de
   cidade local, comparando sem acento e sem maiúsculas. Só entram vagas com `publishedAt` posterior a `enabled_at` (**sem retroativo**).
   Grava a hora e o erro da última consulta (a tela mostra). Uma rajada de mais de 24 vagas em 10 min perde as excedentes (limitação
   aceita; webhook do Freela é para depois).
2. **Triagem** — cada vaga vira uma linha em `vacancy_stories` (`INSERT … ON CONFLICT DO NOTHING` na chave única). Pula, com motivo:
   - teste: `\btest(e|es)?\b` (sem acento/maiúsculas) no nome do contratante ou no `title`;
   - `amountInCents` nulo ou zero;
   - cidade fora do filtro;
   - `startTime − agora` menor que a antecedência mínima (padrão 2 h).
3. **Limpeza dos dados:**
   - **Função:** `title` sem telefone, e-mail e URL, até 40 caracteres; vazio ou longo demais → nome derivado do `serviceType`
     (`lavagem-de-loucas` → "Lavagem de louças" via catálogo/mapa; senão hífen → espaço).
   - **Estabelecimento** — o cartão **sai da arte** quando: nome nulo ou de teste; havia CPF/CNPJ (11 ou 14 dígitos, com ou sem
     pontuação); termina em sufixo societário (LTDA, ME, EPP, EIRELI, S.A., S/A — é razão social, que o freelancer não reconhece e que
     viraria "Knk Alimentacao"). Nos demais, MAIÚSCULAS viram "Título", siglas de até 3 letras continuam maiúsculas
     ("COCO BAMBU CAMPINAS SHOPPING" → "Coco Bambu Campinas Shopping").
   - **Datas** em `America/Sao_Paulo`, tiradas de `startTime`/`endTime` (instantes UTC): `startTime 2026-10-29T14:30Z` →
     "Qua, 29/10 · 11h30 às 21h". Dia da semana + data, sem ano, nunca "hoje/amanhã". Horas cheias sem minutos ("18h").
   - **Valor:** `15000` → "R$ 150"; `15250` → "R$ 152,50".
   - **Assinatura (`fingerprint`)** de `title/serviceType, startTime, endTime, amountInCents, contractorName, city` gravada na linha e em
     `ig_posts.creative_brief.vacancy`.
4. **Geração** (no máximo 2 vagas por rodada do job, como `production.service.ts`; só se a empresa tem Instagram conectado —
   `liveAccount(ws)` —, exceto a prévia): antes, `GET /public/vacancies/:id` confere se a vaga segue aberta e com a mesma assinatura.
   `AiService.image` com `referenceImages = [modelo]`, `vendor` da configuração e um prompt com:
   - os campos limpos (só eles);
   - "siga o estilo e o layout do modelo; troque todos os textos";
   - **proibido**: cartões de Endereço, Região, Descrição, qualquer link/site, selos de loja, nomes ou logos de outras empresas na cena;
   - a cena: pessoa fazendo a função em bar/restaurante, **sem fachada, nome ou logo de empresa** (no exemplo a IA desenhou a fachada da
     Frutá; repetir com Coco Bambu/Spoleto arrisca logo errada e uso de marca alheia — o nome do estabelecimento só aparece no cartão);
   - margem: deixar a faixa de baixo lisa para o rodapé do sistema (§10).
5. **Conferência às cegas:** `AiService.json` com a imagem **final** (já encaixada em 1080×1920, ver §6.3) devolve **todos os textos
   visíveis** e os campos `{funcao, estabelecimento, data, inicio, fim, valor, cidade}` — o prompt de leitura **não** contém os valores
   esperados. Comparação por valor interpretado (centavos, dia+mês, minutos do dia; função, cidade e estabelecimento normalizados sem
   acento/maiúsculas/pontuação). Reprova se:
   - função, valor, data, início, fim ou cidade não baterem; estabelecimento não bater quando ele deveria aparecer, ou aparecer quando
     deveria ter saído;
   - aparecer texto proibido: rótulos Endereço/Região/Descrição, `http`, `www`, `.com`, "Google Play", "App Store", ou qualquer texto do
     modelo que não seja rótulo genérico (os textos do modelo são lidos e guardados no envio; ex.: "Frutá", "Rio abaixo", "Itupeva",
     "R$ 95,95", "Estrada Joaquim Bueno Neto").
   Reprovou → gera de novo citando o erro (até 2 refações). Esgotou → **reserva** (§6.5).
   **Erro da IA** (`noCredit`, `refused`, `down`, `model`) não conta como refação nem cai na reserva: espera crescente (5, 15, 45 min)
   com motivo gravado; vira `failed` quando a antecedência acabar.
6. **Entrega** — numa transação, condicionada ao lease da linha: cria o `ig_post` (§6.2) com a mídia final e marca a linha `handed_off`
   com `ig_post_id`. Modo "aprovar antes": `status 'pending_approval'`. Modo "postar sozinho": `status 'ready'` + `schedulePost` no
   próximo horário livre (§6.6).
7. **Guarda antes de publicar** (porta nova de "guardas de origem", no molde de `CRM_CHANNEL_HOOKS`, servida por um módulo `@Global`):
   consultada em `cancelledOrigin` (antes de criar o container, `publishing.service.ts:379`) **e** no `catch` da fila (`:542`). Para
   `source='vacancy'`: `GET /:id`; cancela o post se a vaga sumiu (404), se a assinatura mudou (a linha volta para `new` e gera de novo)
   ou se `startTime − agora` < antecedência mínima. Vitrine fora do ar → não publica, a fila tenta de novo. Num `RateLimited`, o guarda
   cancela em vez de remarcar quando a próxima tentativa já passaria do início.
8. **Depois da aprovação:** o job pega `source='vacancy' AND status='approved'` sem job pendente e chama
   `PublishingService.schedulePost(ws, id, próximo horário livre)` (exportar o serviço). Post `pending_approval` cuja vaga entra na
   antecedência mínima é cancelado com o motivo "Ninguém aprovou a tempo". O job também reconcilia post de vaga `scheduled` sem job
   pendente (token vencido).

## 6. Decisões de construção (minhas, para o dono conferir)

### 6.1 Onde mora e quem usa
Módulo novo `api/src/modules/vacancy-stories/`. A leitura da vitrine fica atrás de uma porta injetável (`FREELA_VACANCIES_FETCH`); URL
base em `FREELA_PUBLIC_API_URL`. A tela, as rotas e o job só valem para empresas em `VACANCY_STORIES_WORKSPACE_IDS` (env, padrão vazio);
fora da lista as rotas respondem 404 no servidor (teste de isolamento empresa A × B). Dentro dela a função começa **desligada**. Ligar,
desligar e trocar "aprovar antes/postar sozinho" exigem `manage` e entram no log de atividade.

### 6.2 O post
`ig_posts` com `format 'story_image'`, `source 'vacancy'`, `automation`/`plan_id`/`run_id` **nulos**, sem legenda nem hashtags, `theme`
= "Vaga · Garçom · Coco Bambu · Sáb 29/10" (o card de Aprovações usa `theme`), `creative_brief.vacancy` = `{ external_id, fingerprint,
requires_approval, checked_fields, attempts, used_fallback }`, `ai_generation_log` copiado das tentativas. Correções em código comum:
- `approvalRequired` devolve `true` para post de vaga com `requires_approval`; erro vindo do `claim` não grava `failed`.
- `generatePostAssets` recusa `source='vacancy'` (o "Refazer a arte" usa o fluxo da vaga); o editor esconde "Regenerar mídia",
  "Ajustar", legenda e hashtags para esses posts.
- Aprovações: "Rejeitar" de post de vaga sem motivo obrigatório.

### 6.3 Proporção e área livre
IA padrão = **OpenAI** (`gpt-image-1`, melhor texto em imagem), que devolve 2:3. O sistema monta o 1080×1920 final **antes** de salvar,
com `normalize:false` (sem o `cover` que corta): arte reduzida para caber na área livre, faixas na **cor de fundo do modelo** (lida no
envio), rodapé do sistema. Nada importante fora de y 250–1600. A conferência roda nos bytes finais. Gemini fica como opção (9:16 direto,
mesma montagem). Testar num celular real.

### 6.4 Logo
O modelo já traz a logo. O story de vaga não passa pelo caminho comum de criativos, então não recebe a logo automática no canto. A reserva
desenha a logo da marca uma vez, no lugar do layout.

### 6.5 Reserva
Quando a IA erra o texto 3 vezes: a IA gera só uma foto **sem texto** (pessoa na função) e um compositor novo desenha faixa de título,
cartões e rodapé nas cores do modelo. Se a foto também falhar por erro de IA, entra a reserva sem IA (fundo nas cores do modelo, sem
foto). A reserva também passa pela conferência de texto proibido.

### 6.6 Volume e horário
- Janela padrão 08:00–21:00 (Brasília); vaga que chega fora espera.
- Limite padrão de **10 stories de vagas por dia** (1 a 20). Limite efetivo = mín(limite, 25 − 5 de folga para posts normais −
  publicados em 24 h − posts não-vaga agendados nas próximas 24 h), contando os stories de vaga já agendados/aprovados, não só os
  publicados.
- Excedentes ficam esperando e entram no dia seguinte, por início mais próximo, se ainda respeitarem a antecedência.
- Espaço mínimo de 15 min entre stories de vaga (a fila pega 4 jobs por rodada de 5 min; 10 stories às 08:00 atrasariam os posts normais).

### 6.7 Aprovar antes ou postar sozinho
**Padrão ao ligar: "Eu aprovo cada story"**, para os primeiros stories passarem pelo olho do Denner/Diego; virar "Postar sozinho" é um
clique, com diálogo que mostra como foram os últimos stories. O pedido original é "automático" — o padrão é só para a estreia. Story não
aprovado a tempo é cancelado (não vai ao ar sozinho); a tela mostra o prazo ("Aprove até 16h") e o selo do menu conta esses stories.

### 6.8 Desligar
Desligar cancela as linhas na fila/gerando/esperando e os posts de vaga ainda não publicados, com o motivo "Os stories das vagas foram
desligados". Religar move a marca d'água: vagas do intervalo não entram (o diálogo diz isso).

### 6.9 Dados guardados
- `vacancy_story_settings` (1 por empresa): `brand_id`, `enabled`, `enabled_at`, `enabled_by`, `template_asset_id` (FK `brand_assets`
  ON DELETE SET NULL; ficou nulo → desliga), `template_texts text[]` e `template_bg` (lidos no envio), `cities text[]` (vazio = todas),
  `daily_cap` (CHECK 1–20, padrão 10), `window_start`/`window_end` (`08:00`/`21:00`), `min_lead_minutes` (120), `vendor`
  (`openai`|`gemini`), `auto_publish` (false), `last_poll_at`, `last_poll_error`.
- `vacancy_stories`: `workspace_id`, `source` ('freela'), `external_id`, **único** (`workspace_id, source, external_id`);
  `status` só do antes do post: `new | skipped | waiting | generating | handed_off | failed | expired | cancelled`; depois de
  `handed_off` a tela lê `ig_posts.status` (evita dois status divergindo). Mais: `skip_reason`, `wait_reason`, `snapshot jsonb`,
  `fingerprint`, `template_asset_id` (o modelo usado), `lease_until`, `next_attempt_at`, `not_before`, `mismatch_attempts`,
  `ai_error_count`, `attempts_log jsonb`, `used_fallback`, `ig_post_id` (FK `ig_posts` SET NULL, índice único), `created_at`,
  `updated_at`.
- Transições com `UPDATE … WHERE status IN (…) AND lease livre` (o job, "Gerar prévia", "Postar agora" e "Criar story mesmo assim"
  concorrem); varredura de lease vencido devolve `generating → waiting` (molde em `media-generation.service.ts:672-691`); `waiting/
  generating → expired` quando entra na antecedência; `handed_off → new` em "Refazer a arte" (com teto).
- Modelo: `brand_assets` com `kind 'vacancy_template'` incluído em `ASSET_KINDS`, escondido ou rotulado "Arte modelo de vaga" no
  BrandDetail; tipo validado **no servidor** (PNG/JPG/WEBP de verdade, dimensões); no envio o sistema lê os textos do modelo e a cor de
  fundo.

### 6.10 Custo
Cada story custa de 1 a 3 imagens da IA (+1 foto se cair na reserva) e de 1 a 3 leituras de imagem, na chave da própria empresa. A tela
mostra por story as tentativas e se caiu na reserva. (Preço por imagem: conferir na página do fornecedor antes de prometer número.)

## 7. Tela

Ver `2026-10-28-vagas-instagram-ui.md`: aba "Vagas" no Instagram (2ª), situação + interruptor, "Para aprovar", "Vagas que chegaram",
"Ajustes"; detalhe com a conferência campo a campo; textos prontos; estados vazio/erro/carregando; mudanças em Aprovações, editor de
post e calendário.

## 8. Limitações aceitas

- Story não é apagado quando a vaga é preenchida (some em 24 h); vaga preenchida pode até continuar na vitrine.
- A vitrine não filtra a janela de prioridade dos favoritos (`priorityUntil`): o story pode levar gente a uma vaga que ainda só os
  favoritos veem no app. O site público já mostra essas vagas hoje. Corrigir é no `api-freela` (fora deste projeto).
- Rajada de mais de 24 vagas em 10 min perde as excedentes.

## 9. O que fica com quem constrói

Nome dos arquivos, prompt exato, geometria exata da área livre, normalização da comparação, compositor da reserva (dentro do estilo do
modelo), testes (fakes da vitrine e da IA; fuso com `startTime` perto da meia-noite UTC; vaga que muda de valor; lote de 10; isolamento
entre empresas; aprovação que não agenda; "Publicar agora" duas vezes), textos finais (seguir o arquivo da tela).

## 10. Pendente com o dono

- **Rodapé desenhado pelo sistema** ("Candidate-se pelo app / Procure Freela Serviços na loja" + selos oficiais), em vez de link/selos
  desenhados pela IA. Recomendado por designer e arquiteto; muda um pouco o "a IA gera a arte inteira".
- **Aviso "Pagamento depois da fatura da empresa"** (`payoutTiming`) dentro ou fora da arte. Designer recomenda fora na v1.

## 11. Depois (depende de outra decisão)

Endereço, bairro e descrição na arte exigem mudar a API do Freela (`api-freela`, outro repositório, sobe para produção no push da main,
só com o dono) **e** decidir se o endereço da empresa pode ficar público no Instagram — a vitrine o esconde de propósito.
