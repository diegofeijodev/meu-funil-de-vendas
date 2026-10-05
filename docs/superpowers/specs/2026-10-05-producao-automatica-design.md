# Produção de conteúdo automática e criativos melhores — design

**Data:** 05/10/2026 · **Projeto:** `meu-funil` (API NestJS em `api/`, web Next.js em `web/`)
**Pedido do dono:** "Calendário colocar para fazer cronograma de postagem automática, fazer o criativo de acordo com o cronograma e
postar automático, melhorar a qualidade dos criativos. A produção de conteúdo automática tá saindo uns vídeos meio ruins, então refine a
parte de prompt e deixe tudo o mais detalhado possível."

## 1. Decisões do dono (brainstorming)

| Tema | Decisão |
|---|---|
| Até onde vai o automático | **Zero cliques** no modo "Totalmente automático": estratégia aprovada sozinha; post reprovado é refeito pela IA com o motivo (até 2×) e, se ainda falhar, o horário é pulado com aviso no painel. |
| Antecedência | Produzir a partir de **48 h antes**; meta de **pronto até 24 h antes** do horário. |
| Vídeo | **Equilíbrio**: Veo 3.1 *fast*, foto da marca/produto como primeiro quadro, roteiro detalhado por tomada, nota de qualidade com **1 refação**. |
| Áudio do vídeo | **Configurável**: modo (ambiente + trilha / narração curta em pt-BR / sem áudio) + instruções livres; por período (execução) e por post. |
| Caminho | Evoluir o "Programar com IA" existente (sem tabela de fila nova). O piloto automático por **plano** (`ig_content_plans.auto_publish`) fica como está. |

## 2. Estado atual (resumo do mapeamento)

- Modos de execução: `publish` (totalmente automático) e `approval`. Ticks a cada 5 min (`instagram-media-5min`: `autoCalendarTick` +
  `autopilotTick`; `instagram-queue-5min`: poller de vídeo + fila de publicação), só com `SCHEDULER_ENABLED=true`.
- Travas de clique: estratégia sempre em `review` até aprovação manual; posts `needs_review` nunca ganham mídia sozinhos; mídia feita
  em cima da hora (2 por tick para todas as empresas; vídeo espera até 6 min síncrono); falha de publicação (sem conta IG/token) vira
  `failed` e a mídia é refeita à toa; token vencido deixa posts `scheduled` sem job.
- Qualidade: a direção de arte dos posts não recebe produto/estratégia/campanha; o caminho padrão do gateway ignora fotos de referência;
  headline não é aplicada (layout padrão `limpo`); carrossel sem crítico; vídeo: prompt de 60–120 palavras, `video_shots` gerado e
  **descartado**, sem foto de referência, modelo padrão `veo-3.0-fast-generate-preview`, sem crítico nem refação, vídeo fora do padrão
  do Instagram falha para sempre (não há conversão).

## 3. Escopo

**Dentro:** execuções do "Programar com IA" (`ig_auto_runs` + `ig_posts.run_id`), geração de mídia dos posts do Instagram (imagem,
carrossel, Reels, story em vídeo), parâmetros de vídeo do `AiService`, editor do post (painel de vídeo), diálogo e cartões do
Programar com IA, eventos no painel.

**Fora:** piloto automático por plano (gera posts com `automation = null`; segue o fluxo atual), Estúdio Criativo (só ganha o que for
compartilhado: prompts de vídeo, ffmpeg, contexto de marca), CRM, anúncios.

## 4. Parte A — automático de verdade

### A1. Estratégia no modo `publish`
- Logo após `buildRunStrategy`, se `run.mode === 'publish'`: `strategy_status = 'approved'` direto (sem passar por `review`), evento
  `strategy_auto_approved` ("Estratégia do período aprovada automaticamente (modo totalmente automático).").
- Modo `approval`: inalterado (fica em `review` até o clique).
- Semanas repetidas (`renewRecurring`): toda execução filha gera **estratégia própria para as suas datas** (corrige o
  `distribuicao_por_dia` com datas da semana raiz). Se a raiz tiver `strategy.texto_editado`, ele entra como orientação no prompt da
  filha. `publish` → aprovada sozinha; `approval` → vai para `review` como qualquer execução.

### A2. Post reprovado no modo `publish`
Pontos de reprovação existentes: validador no preenchimento (`validatePosts` → `needs_review`) e checagem de alinhamento no
agendamento (`schedulePost` → `needs_review`).
- Nova coluna `ig_posts.review_attempts int NOT NULL DEFAULT 0`.
- No modo `publish`, em vez de deixar `needs_review`: `rewritePost(post, motivo)` — IA reescreve legenda/headline/CTA/briefing visual
  (mesmo schema de `askPosts`, com o motivo e as regras da estratégia/data no prompt), revalida (código + validador) e:
  - aprovado → volta para o fluxo (`idea` se ainda não tem mídia; se já tinha mídia e só o texto mudou, `ready`);
  - reprovado e `review_attempts < 2` → incrementa e tenta de novo (no próximo tick, para não prender o tick);
  - reprovado com `review_attempts = 2` → `status = 'cancelled'`, `last_error = 'Pulado automaticamente: <motivo>'`, evento
    `post_skipped` nível `warn`.
- Modo `approval`: inalterado (`needs_review` espera a pessoa).
- Regra de segurança mantida: post com `review_reason` nunca vira `ready` sem passar pela revalidação acima (no `publish`) ou pela
  aprovação humana (no `approval`).

### A3. Produção antecipada (janela 48 h → 24 h)
- Novo `ProductionService.productionTick()` chamado pelo job `instagram-media-5min` **no lugar** da parte de posts de execução do
  `autopilotTick` (o `autopilotTick` continua só para posts de plano, `automation = null`).
- Seleção: posts com `run_id` não nulo, `status = 'idea'`, `scheduled_at` dentro de **agora + 48 h**, ordenados por `scheduled_at`;
  **rodízio por empresa** (no máximo 1 post por empresa por rodada, até `IG_PRODUCTION_PER_TICK` posts por tick; padrão **4**).
- Prioridade: posts com `scheduled_at` em menos de 24 h passam à frente ("atrasados para a meta").
- Vídeo **assíncrono**: o tick só dispara a geração (`pending_job` no `creative_brief`) e segue; o `pollPendingMedia` conclui. Sem espera
  síncrona de 6 min no tick (`maxWaitMs` curto, ~25 s, como o Estúdio).
- Ao ficar `ready`, `scheduleAutomated` agenda no horário do cronograma (já existe).
- Prazo vencido (post ainda sem mídia no horário), modo `publish`: até 12 h de atraso → produz e publica assim que ficar pronto;
  mais de 12 h → `cancelled` + evento `post_skipped` (o cronograma é respeitado; não empurra 1 dia). Modo `approval`: regra atual
  inalterada (empurra 1 dia).
- Painel do período mostra: produzidos / produzindo / na fila / agendados / publicados / pulados.

### A4. Falhas de publicação sem refazer mídia
- Nova coluna `ig_posts.failure_kind text NULL` (`'media' | 'publish'`).
- `failed` por guardrail de conta/token/limite → `failure_kind = 'publish'`; o reset automático "falhou → idea" (tick 2b) passa a valer
  só para `failure_kind = 'media'`.
- Sem conta do Instagram conectada: post de execução fica `ready` com `last_error = 'Conecte o Instagram para publicar.'` (nenhum job
  `mock`); quando a conta conecta, o tick 2 (pega `ready`/`approved`) agenda normalmente.
- Token vencido (`ig-store.service.ts` que cancela jobs pendentes): posts de execução `scheduled` voltam para `ready` (com o motivo), para
  serem reagendados quando o token for renovado.

## 5. Parte B — imagem e carrossel melhores

- **Contexto completo na direção de arte dos posts** (`media-generation.service.ts` → `buildVisualPrompt`): produto do post
  (`product_id` → nome, descrição, preço, foto), pilar, persona, etapa do funil, objetivo e mensagem central/público/proibições da
  estratégia da execução, campanha (oferta/estratégia aprovada, como o Estúdio já faz em `directArt`). Implementado como um
  `PostCreativeContext` montado num só lugar e repassado; o Estúdio continua com o seu `directArt`.
- **Fotos de referência no caminho padrão do gateway**: quando houver refs (produto primeiro, depois marca), usar o endpoint de edição
  com imagens (`/images/edits`, compatível com OpenAI) também no gateway; se o gateway responder 400/404/415 para edição, cair para
  texto puro e registrar no log de geração ("Gateway sem suporte a referência; gerado sem foto da marca.").
- **Headline na arte**: `feed_image` e `story_image` com `headline` usam o layout `titulo_topo` por padrão; sem headline → `limpo`.
  O editor continua podendo trocar o layout.
- **Carrossel com nota de qualidade**: cada slide passa pelo crítico (`critic.ts`); slide abaixo de `MIN_SCORE` é refeito 1× com o motivo.
  Um "fio visual" único (paleta, estilo fotográfico, luz) é definido uma vez para o carrossel e repetido na direção de cada slide.

## 6. Parte C — vídeos

### C1. Modelo e parâmetros
- `AI_MODEL_VIDEO` padrão passa a `veo-3.1-fast-generate-preview`; com chave própria do Gemini a lista vira
  `[AI_MODEL_VIDEO, 'veo-3.0-fast-generate-preview']` (fallback). Com chave própria também enviar `durationSeconds: 8` e o flag de áudio.
- Higgsfield (`kling2_6`) mantido como está na cadeia de provedores, respeitando o modo de áudio (`sound`).

### C2. Roteiro de vídeo detalhado (novo `video-director.ts` no módulo `creative`)
1. A IA devolve um JSON estruturado (`VIDEO_SCHEMA`):
   `gancho_visual` (o que acontece em 0–2 s), `sujeito`, `cenario`, `tomadas[]` (`inicio_s`, `fim_s`, `enquadramento`, `acao`,
   `movimento_camera`, `lente`), `iluminacao`, `paleta_hex[]`, `estilo`, `ritmo`, `cta_visual` (último segundo), `audio`
   (`modo`, `descricao`, `fala` quando narração), `evitar[]`.
2. Entradas: tudo do `PostCreativeContext` (parte B) + formato (Reels / story em vídeo), duração 8 s, 9:16, guia de marca
   (`visual-style.ts`), exemplos de prompt da marca, configuração de áudio, ajuste do usuário e prompt anterior (refação).
3. Regras no prompt da IA: tomadas cobrindo 0–8 s sem buracos, no máximo 3 tomadas, uma ação física clara por tomada, nada de texto,
   letras ou logotipos gerados na cena (o texto vai na capa/legendas), pessoas com anatomia natural, produto real fiel à foto quando houver,
   coerência com a data/estação, proibições da marca e da estratégia.
4. Um **montador determinístico** transforma o JSON no texto final em pt-BR (roteiro com marcas de tempo, câmera/lente/luz/paleta/estilo,
   direção de áudio e lista "Evite: …"), 250–450 palavras, dentro do limite de 3000 caracteres já aplicado.
5. `video_shots`/estrutura ficam gravados no `creative_brief.video_direction` (para o editor e para a refação).

### C3. Primeiro quadro
- Imagem para vídeo: foto do produto do post, senão primeira foto de referência da marca (`RefsService`), redimensionada para 9:16
  (sem distorcer; preenchimento com a cor dominante). Sem foto → texto para vídeo.

### C4. Áudio configurável
- `ig_auto_runs.video_audio jsonb NOT NULL DEFAULT '{"modo":"ambiente_trilha","instrucoes":""}'`;
  por post: `creative_brief.audio` (sobrepõe o da execução).
- `ambiente_trilha`: som da cena + trilha instrumental leve no tom da marca, **sem vozes/fala**.
  `narracao`: voz em pt-BR, natural, diz no máximo 2 frases curtas (gancho/CTA, escritas pela IA no campo `fala`), sobre som ambiente.
  `sem_audio`: `generateAudio: false` (gateway e chave própria) e `sound: false` (Higgsfield).
- `instrucoes` (≤ 500 caracteres, texto livre: "trilha animada", "sem música", "voz feminina calma"…) entra na direção de áudio.

### C5. Nota de qualidade do vídeo + 1 refação
- Novo `VideoQualityService`: extrai 3 quadros (15 %, 50 %, 85 % da duração) com **ffmpeg** → JPEG 768 px → crítico visual com critérios de
  vídeo (aderência ao roteiro/gancho, fidelidade à marca/paleta, qualidade técnica — deformações, artefatos, texto gerado ilegível —,
  clareza do produto, apelo para parar o scroll), 0–10 cada (total 50).
- Nota < `MIN_VIDEO_SCORE` (28) → refaz **1 vez** com o motivo do crítico no roteiro; fica o vídeo de maior nota. Notas e motivo no log de
  geração do post. Falha do crítico (IA fora) não bloqueia: segue com o vídeo e registra.

### C6. Conversão para o padrão do Instagram
- Após baixar o vídeo, se `video-meta` disser que não está `ig_ready`: converter com ffmpeg para H.264 High, `yuv420p`, 30 fps,
  1080×1920 (escala + preenchimento), AAC 48 kHz (trilha silenciosa quando `sem_audio`), `+faststart`, ≤ 60 s; reingerir e revalidar.
  Vídeo que continua inválido → `failed` com `failure_kind = 'media'`.
- Capa e legendas usam a **duração real** do vídeo (hoje fixa em 8 s).

### C7. ffmpeg
- Dependência `ffmpeg-static` (binário estático) com `FFMPEG_PATH` (opcional) para usar o ffmpeg do sistema; no `api/Dockerfile`
  (alpine) instalar `ffmpeg` e definir `FFMPEG_PATH=/usr/bin/ffmpeg`.
- Porta injetável `FFMPEG_RUNNER` (processo filho com tempo-limite de 120 s, `nice`, entrada/saída em arquivos temporários dentro do
  diretório de uploads, apagados no `finally`). Testes unitários usam um fake; smoke/browser-check usam o binário real com vídeos curtos.

### C8. Editor do post (vídeo)
- O painel de direção de arte passa a aparecer para `reel`/`story_video` com: roteiro final (editável → `visual_prompt_override`),
  tomadas (só leitura), modo de áudio + instruções, nota do crítico e "Regenerar vídeo".

## 7. Web

- Diálogo "Programar com IA": seção "Áudio dos vídeos" (3 opções + instruções) e texto explicando a produção antecipada no modo
  totalmente automático.
- Cartão do período: contagens produzidos/produzindo/na fila/agendados/publicados/pulados; lista de "Pulados" com motivo.
- Visão geral (painel do piloto automático): passa a mostrar também os eventos das execuções (`strategy_auto_approved`, `post_rewritten`,
  `post_skipped`, `video_regenerated`).
- Editor: painel de vídeo (C8).

## 8. Dados (migração)

- `ig_posts`: `review_attempts int NOT NULL DEFAULT 0`, `failure_kind text NULL CHECK (failure_kind IN ('media','publish'))`.
- `ig_auto_runs`: `video_audio jsonb NOT NULL DEFAULT '{"modo":"ambiente_trilha","instrucoes":""}'`.
- `ig_autopilot_events.kind` ganha os novos valores (texto livre hoje; sem CHECK novo).
- Variáveis: `IG_PRODUCTION_PER_TICK` (padrão 4), `IG_PRODUCTION_WINDOW_HOURS` (48), `IG_PRODUCTION_TARGET_HOURS` (24),
  `MIN_VIDEO_SCORE` (28), `FFMPEG_PATH` (opcional) — em `env.validation.ts`, `.env.example` e `docker-compose.yml`.

## 9. Concorrência e segurança

- Toda produção usa o lease existente de `ig_posts.lease_until` (claim atômico; renovação antes de cada chamada de IA/ffmpeg).
- Reescrita (A2) e produção (A3) nunca rodam juntas no mesmo post (mesmo lease).
- Rodízio por empresa é feito na consulta (janela por `workspace_id`), não em memória.
- ffmpeg só lê/escreve dentro do diretório temporário do upload; nada de caminho vindo do usuário; tempo-limite e limite de tamanho.
- Prompts: instruções livres do usuário (áudio, ajuste) entram delimitadas e com teto de tamanho.

## 10. Custos (para o dono)

- Vídeo: até 2 gerações Veo 3.1 *fast* por vídeo (1 + 1 refação) + 1 chamada de crítico com 3 imagens.
- Imagem: igual a hoje + crítico por slide no carrossel (+1 refação por slide ruim).
- Reescrita de post reprovado: até 2 chamadas de texto + 2 validações por post reprovado.

## 11. Testes

- jest (IA e ffmpeg falsos): aprovação automática da estratégia; estratégia própria por semana repetida; reescrita 0/1/2 → pulado;
  rodízio por empresa e prioridade < 24 h; vídeo assíncrono; `failure_kind` (publicação não refaz mídia); sem conta IG → `ready` sem
  job mock; token vencido → `ready`; contexto completo na direção de arte; refs no gateway com fallback; headline padrão; crítico por
  slide; roteiro de vídeo (schema, montador, limites de tamanho, áudio por modo); primeiro quadro; crítico de vídeo + 1 refação;
  conversão quando não `ig_ready`; capa com duração real.
- smoke e browser-check (grupo instagram) cobrindo o diálogo com áudio, a execução totalmente automática sem cliques (gateway de IA
  falso), o painel de vídeo do editor e os pulados.

## 12. Critérios de aceite

1. Execução "Totalmente automático" criada e **nenhum clique depois**: estratégia aprovada sozinha, posts produzidos entre 48 h e 24 h
   antes, agendados e publicados no horário (com conta IG conectada).
2. Post reprovado é refeito até 2× e, se não passar, aparece como "Pulado" com o motivo — nunca publicado sem passar na validação.
3. Vídeo gerado com roteiro detalhado por tomada, primeiro quadro da marca/produto quando houver, áudio conforme a configuração,
   nota de qualidade registrada e no máximo 1 refação; vídeo sempre no padrão do Instagram ou `failed` com motivo.
4. Sem conta/token: nada é refeito à toa; volta sozinho quando reconecta.
5. Todos os testes (jest, typecheck, lint, smoke, browser-check por grupos) verdes, rodando sob `scripts/run-capped.sh`.
