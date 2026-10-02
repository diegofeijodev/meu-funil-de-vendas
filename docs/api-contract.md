# Contrato da API — Meu Funil

Contrato canônico. **Mudou rota? Atualize este arquivo primeiro.** Base local: `http://localhost:3015`.
Cada tarefa do port acrescenta as suas seções no fim (§N+1…).

## 1. Convenções

### 1.1 Formato
- JSON, UTF-8. **Wire snake_case** espelhando o banco (mesmos nomes de coluna que o Supabase devolvia).
- `numeric` e `bigint` saem como **number**; timestamps como ISO-8601 UTC (`2026-10-02T03:04:05.000Z`);
  colunas `date` (só-dia: `date`, `start_date`, `end_date`, `week_start`) como `"YYYY-MM-DD"`.
  Feito por um interceptor global (`common/http/wire.ts`) — controllers devolvem o resultado do Prisma direto.
- "Hoje"/datas de agenda: America/Sao_Paulo (`todaySp()` em `common/time/dates.ts`), nunca `toISOString()`.

### 1.2 Erros
Toda resposta de erro é `{ "error": { "code": "…", "message": "…" } }`. A `message` é a MESMA do protótipo (pt-BR) ou, no auth,
a string do GoTrue que a tela já mapeia. Status: 400, 401, 403, 404, 409, 422, 429, 502.

| status | code (exemplos) | quando |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST`, `INVALID_CREDENTIALS` | corpo inválido (campo desconhecido também), login errado |
| 401 | `UNAUTHORIZED`, `INVALID_REFRESH_TOKEN` | sem/ruim token |
| 403 | `FORBIDDEN` | não é membro / papel insuficiente / link de arquivo inválido |
| 404 | `NOT_FOUND` | recurso inexistente **ou id da URL malformado** (`isUuid`) |
| 422 | `USER_ALREADY_EXISTS`, `WEAK_PASSWORD`, `EMAIL_ADDRESS_INVALID` | cadastro |
| 429 | `TOO_MANY_REQUESTS` | throttle (300/min por IP; auth tem teto próprio) |
| 502 | `AI_ERROR`, `AI_NOT_CONFIGURED` | falha de provedor de IA |
| 503 | `GOOGLE_NOT_CONFIGURED` | login Google sem credenciais |

Funções que no protótipo DEVOLVIAM `{ ok:false, error }` continuam devolvendo isso (HTTP 200) — regra das tarefas seguintes;
os helpers de IA lançam `AiError` (502) e o handler da ação o converte quando for o caso.

### 1.3 Autenticação
`Authorization: Bearer <access_token>` em toda rota, exceto as marcadas **(pública)**. Mensagens do guard:
`Unauthorized: No authorization header provided` · `…Only Bearer tokens are supported` · `…No token provided` · `…Invalid token`.
O workspace **nunca** vem do token: é sempre o `:workspaceId` da URL (ou o workspace de onde a entidade foi resolvida).

### 1.4 Autorização (substitui o RLS)
`WorkspaceAccessService.require(userId, workspaceId, level)`:

| nível | quem | uso |
|---|---|---|
| `read` | qualquer membro (inclui `viewer`) | GET |
| `write` | owner · admin · marketing (**viewer só lê**) | POST/PATCH/DELETE comuns |
| `manage` | owner · admin | aprovar decisão, aprovar/ativar campanha, conectar contas, chaves de IA, renomear workspace |

Erros: não membro → `403 "Você não tem acesso a esta empresa."`; papel insuficiente → `403 "Seu perfil não tem permissão para esta ação."`;
`workspaceId` malformado → `404`. Em controllers de `/v1/workspaces/:workspaceId/**` use `@UseGuards(WorkspaceAccessGuard)`
(+ `@RequireAccess('manage')`; sem decorator, GET = read e o resto = write). **Toda id recebida no corpo/URL deve ser conferida
contra o workspace** (sem vazamento entre workspaces).

### 1.5 Ids, validação e ordem de rotas
- Id da URL passa por `ParseUuidPipe` (404 se malformado). `ValidationPipe` global com `whitelist + forbidNonWhitelisted`:
  todo campo aceito tem decorator no DTO; mandar a linha inteira de um GET num PATCH dá 400.
- Rotas estáticas antes das `:id` no controller.

### 1.6 Rotas públicas
`/api/public/**` do protótipo vivem **na API com o mesmo caminho** (o Next faz `rewrites`). Marcadas com `@Public()`.
Nesta tarefa só existem `GET /health`, o download de arquivo assinado e o início/callback do Google.

## 2. Auth — `POST /v1/auth/*`

Sessão (`SessionView`): `{ access_token, refresh_token, token_type: "bearer", expires_in, expires_at, user: { id, email } }`.
Access token HS256 (`typ: "access"`, claim `ver` = `users.token_version`, vida `ACCESS_TOKEN_TTL`, padrão 1 h). Refresh token stateless (`typ: "refresh"`, segredo derivado,
vida `REFRESH_TOKEN_TTL`, padrão 30 d), revogado por `users.token_version`.

| rota | corpo | resposta |
|---|---|---|
| `POST /v1/auth/signup` **(pública)** | `{ email, password, full_name?, company_name? }` | `201` `SessionView` |
| `POST /v1/auth/login` **(pública)** | `{ email, password }` | `200` `SessionView` |
| `POST /v1/auth/refresh` **(pública)** | `{ refresh_token }` | `200` `SessionView` (token novo) |
| `POST /v1/auth/logout` | — | `204`; incrementa `token_version`: invalida TODOS os refresh tokens **e os access tokens** já emitidos (o guard compara `ver` com o banco) |
| `GET /v1/auth/me` | — | `{ user: { id, email, created_at }, profile: { id, email, full_name, avatar_url, created_at } }` |
| `GET /v1/auth/google?redirect_uri=` **(pública)** | — | `302` para o Google; `503 GOOGLE_NOT_CONFIGURED` sem `GOOGLE_CLIENT_ID/SECRET` |
| `GET /v1/auth/google/callback` **(pública)** | query do Google | `302` para `redirect_uri#access_token=…&refresh_token=…&token_type=bearer&expires_in=…` (ou `#error=…`) |

Mensagens (iguais às do GoTrue que `routes/auth.tsx` mapeia):

| situação | status | `error.message` |
|---|---|---|
| e-mail já cadastrado | 422 | `User already registered` |
| senha < 6 caracteres | 422 | `Password should be at least 6 characters.` |
| senha comum | 422 | `Password is known to be weak and easy to guess, please choose a different one.` |
| e-mail inválido | 422 | `Unable to validate email address: invalid format` |
| senha ausente | 400 | `Signup requires a valid password` |
| login errado / conta só-Google | **400** | `Invalid login credentials` (400 como o GoTrue, para o cliente HTTP não tentar refresh) |
| refresh inválido/revogado | 401 | `Invalid Refresh Token: Refresh Token Not Found` |

**Signup** faz o que o trigger `on_auth_user_created → handle_new_user()` fazia, numa transação: `users` + `profiles`
(mesmo `id`; `full_name` = `full_name` ou parte local do e-mail) + `workspaces` (`name` = `company_name` ou "Meu Workspace";
`slug` = `ws-` + 10 primeiros hex do id do usuário; `owner_id`) + `workspace_members(role='owner')`. A versão final do trigger
**não** semeia dados de demonstração (db.md §4/§8). Diferença deliberada: o signup já devolve a sessão (o protótipo fazia
`signUp` + `signInWithPassword`). E-mail é normalizado (trim + minúsculas).

**Google**: exige `email_verified === true`; ao vincular a um usuário existente por e-mail, a senha dele é apagada e as sessões caem (anti pre-hijack). Senha > 72 bytes → 422 `Password should be at most 72 bytes.`. `redirect_uri` precisa ser da origem de `APP_URL` ou de `CORS_ORIGINS`. A sessão volta no fragmento (`#`), como o fluxo implícito do Supabase.

## 3. Workspaces e perfil — `/v1/workspaces`, `/v1/profiles`

| rota | nível | resposta |
|---|---|---|
| `GET /v1/workspaces` | — (os meus) | `[{ workspace_id, role, workspaces: { id, name, slug, plan } }]`, mais antigo primeiro (mesmo formato de `workspace_members(workspaces(...))` do protótipo) |
| `POST /v1/workspaces` `{ name }` | — | `201` `{ id }` — equivalente a `create_workspace(_name)`: nome vazio → `400 "nome obrigatório"`; `slug` = `ws-` + 12 hex; criador vira `owner` |
| `GET /v1/workspaces/:workspaceId` | read | linha de `workspaces` |
| `PATCH /v1/workspaces/:workspaceId` `{ name }` | manage | linha de `workspaces` |
| `GET /v1/workspaces/:workspaceId/members` | read | `{ members: workspace_members[], profiles: profiles[] }` — perfis dos membros (no Supabase o RLS só devolvia o próprio; aqui qualquer membro vê os colegas do MESMO workspace) |
| `GET /v1/profiles/me` | — | linha de `profiles` |
| `PATCH /v1/profiles/me` `{ full_name?, avatar_url? }` | — | linha de `profiles` |

Não há convite de membros nesta fase (igual ao protótipo: só o criador é `owner`).

## 4. Arquivos — `/v1/files`, `/v1/workspaces/:workspaceId/files`

Disco local em `UPLOADS_DIR/<bucket>/<chave>`; buckets `creative-assets` (privado) e `ig-media`. Chave com `..`, `.`, vazia, absoluta,
com `\` ou `\0` → `400`; o caminho resolvido precisa ficar dentro do bucket. O banco guarda **a URL assinada** (como o protótipo
guardava as URLs de 1–5 anos) e/ou a `storage_path`.

| rota | nível | descrição |
|---|---|---|
| `GET /v1/files/:bucket/*?exp=<unix>&sig=<hmac>` **(pública)** | assinatura | stream do arquivo; `Content-Type` pela extensão, `Cache-Control: private, max-age=31536000, immutable`. Assinatura inválida/expirada → `403 "Link inválido ou expirado."`; inexistente → `404` |
| `POST /v1/workspaces/:workspaceId/files?kind=` | write | multipart, campo `file`, 1 arquivo. `kind` ∈ `brands`\|`media`\|`posts`\|`tmp` (padrão `media`). Resposta `{ bucket, key, storage_path, url, mime, size_bytes }`; `key` = `<kind>/<workspaceId>/<uuid>.<ext>`; `url` assinada por 5 anos |
| `DELETE /v1/workspaces/:workspaceId/files?key=` | write | `204`; a chave precisa ser `<kind>/<workspaceId>/…` (senão `400`) |

Tipos aceitos: `image/png|jpeg|webp|gif` (≤ 20 MB), `video/mp4|quicktime|webm` (≤ 100 MB), `application/pdf` (≤ 10 MB).
**Só com `kind=brands`** (400 `Tipo de arquivo não suportado.` nos outros): `image/svg+xml` e fontes `.ttf`/`.otf` (≤ 20 MB). A fonte é reconhecida pela extensão
(navegadores mandam `octet-stream`/`x-font-*`) e o conteúdo é conferido (assinatura sfnt/`OTTO`/`true`/`ttcf`; SVG precisa conter `<svg`) — senão `400 "O conteúdo do arquivo não corresponde ao tipo."`.
O download de SVG sai com `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` (scripts do SVG não rodam).
Assinatura: `HMAC-SHA256(key = HKDF(FILES_SIGNING_SECRET || JWT_SECRET), "<bucket>\n<key>\n<exp>")`, hex. Arquivos gerados no servidor
usam `YYYY-MM-DD/<uuid>.<ext>` (`FilesService.newGeneratedKey`).

## 5. Cofre de credenciais (interno, sem rotas)

`VaultService` (`modules/vault`) espelha `credentials.server.ts`: tabela `app_credentials`; `workspaceId = null` = global. Valores sempre
cifrados com AES-256-GCM, chave HKDF de `CREDENTIALS_ENCRYPTION_KEY` (obrigatória em produção; em dev usa chave de desenvolvimento).
Formato `enc:v2:<iv>:<ciphertext>:<tag>` (base64). Texto sem prefixo (legado) é lido como está. Chave errada/adulteração → `null` + log (sem lançar).
API: `get(ws|null, key)`, `has`, `set(ws|null, {k:v})`, `delete`, `listMasked(ws|null)` (valor mascarado `••••1234`).
As chaves BYO de IA ficam no cofre **global** com o id do workspace no nome: `AI_OPENAI_KEY:<wsId>` / `AI_GEMINI_KEY:<wsId>` (herança por `workspaces.ai_inherit_from`, 1 nível).
O Prisma não faz upsert com `workspace_id` nulo, então a escrita é `INSERT … ON CONFLICT (workspace_id, key)` sobre o índice `UNIQUE NULLS NOT DISTINCT`.

## 6. IA (interno, sem rotas)

`AiService` (`modules/ai`) — única porta de rede: o token `AI_FETCH` (nos testes entra um fake).
Ordem em texto/JSON (igual ao protótipo): chave OpenAI do workspace → chave Gemini do workspace → gateway do app.

- `text(ws, { prompt, system?, model? })`, `json(ws, { prompt, schema, name, images?, model? })` (JSON estrito; o gateway usa `json_schema` strict
  em `chat/completions`; sempre passa pelo parser tolerante `{…}`), `vision(...)` = `json` com imagens.
- `image(ws, { prompt, aspectRatio, referenceImages?, vendor: 'openai'|'gemini', strict? })` → `{ bytes, mime, ext, cost, note }` (quem chama grava via `FilesService`).
- `video(ws, { prompt, aspectRatio, referenceImages?, maxWaitMs? })` → `{ status:'ready', bytes… }` ou `{ status:'pending', jobId }`; `videoStatus(ws, jobId)` para o cron.
- `AiKeysService`: `get/set/test(vendor, key)`. Erros: `AiError` (HTTP 502, `AI_ERROR`; `AI_NOT_CONFIGURED` = "IA do app não configurada.") com as mensagens do protótipo.
- **Gateway** = API compatível com OpenAI em `AI_GATEWAY_URL` (base com `/v1`): `/chat/completions`, `/images/generations`, `/images/edits`, `/videos`.
- **Mapa de modelos** (`AI_MODEL_*`): `openai/gpt-6-astra`→`AI_MODEL_TEXT`, `openai/gpt-image-2.5-sunburst`→`AI_MODEL_IMAGE_OPENAI`,
  `google/gemini-3.1-flash-image`→`AI_MODEL_IMAGE_GEMINI`, `google/veo-3.1-fast`→`AI_MODEL_VIDEO`, `google/gemini-3.1-flash`→`AI_MODEL_GEMINI_FLASH`,
  `google/gemini-3.1-pro`→`AI_MODEL_GEMINI_PRO`; id desconhecido passa como está. O valor gravado em `crm_sdr_agents.model` continua sendo o id do protótipo.

## 7. Agendador (interno)

`SchedulerService.register({ name, cron (UTC), heartbeat?, handler })`; só liga com `SCHEDULER_ENABLED=true` (UMA instância). Cada execução grava
`cron_heartbeats(name, last_run_at, last_status, last_detail)` e não se sobrepõe. `JOB_SCHEDULES` traz os 10 horários do pg_cron (db.md §6).
`run(name)` também serve às rotas `/api/public/cron/*` (protegidas por token) das tarefas seguintes.

## 8. Padrões do CRM (interno)

`CrmDefaultsService.ensure(workspaceId)` — chamar no início de TODA leitura de CRM. Cria, uma vez e de forma idempotente (advisory lock por workspace;
`crm_settings` é o marcador), o que a migração do protótipo só inseriu para workspaces já existentes: funil "Funil Padrão" (`is_default`) com 8 etapas
(Novo Lead 1h · Contato Iniciado (SDR IA) 4h · Qualificado 24h · Reunião Agendada 48h · Reunião Realizada 48h · Proposta 72h · Ganho 72h `is_won` · Perdido 72h `is_lost`),
5 motivos de perda, 4 tags e `crm_settings(distribution='round_robin')`. Não cria leads/tarefas de demonstração.

## 9. Saúde

`GET /health` **(pública)** → `{ status: "ok", time }` (faz `SELECT 1`).

## 10. Marcas (Brand Kit) — `/v1/workspaces/:workspaceId/brands`

Telas `/brands` e `/brands/$id`. GET = `read`; POST/PATCH/DELETE = `write` (viewer só lê). Todo `:brandId`/`:id` é conferido contra o workspace da URL
(marca/filho de outro workspace → `404`). Estáticas antes das `:id`. Atividade gravada no servidor (`activity_logs`): `brand.created {name}`,
`brand.updated {brand_id}` (não grava quando só `visual_style` muda, como o protótipo), `brand.deleted {name}`.

| rota | corpo | resposta |
|---|---|---|
| `GET /brands` | — | `brands[]` por `created_at`, cada uma com `campaigns: [{count}]` e `products: [{count}]` (embeds do PostgREST) |
| `POST /brands` | `{ name, segment? }` (`name` não vazio, ≤ 200) | `201` linha de `brands`; atividade `brand.created` |
| `GET /brands/:brandId` | — | linha de `brands`; `404 "Marca não encontrada."` |
| `PATCH /brands/:brandId` | qualquer de `name, website, segment, region, description, differentials, target_audience, competitors, tone_of_voice, past_campaigns, primary_color, secondary_color, typography, logo_url` (strings), `preferred_words[]`, `banned_words[]`, `visual_style` (objeto jsonb ≤ 50 000 caracteres) | linha de `brands`. `name` em branco → `400 "Informe o nome da marca."`; campo desconhecido → `400 VALIDATION_ERROR` |
| `DELETE /brands/:brandId` | — | `204`; o cascade (campanhas, produtos, criativos…) vem das FKs |
| `GET /brands/:brandId/products` | — | `products[]` por `created_at` |
| `POST /brands/:brandId/products` | `{ name, description?, price?, margin_percent? }` (números; padrão 0) | `201` linha |
| `PATCH /brands/:brandId/products/:id` | `{ name?, description?, price?, margin_percent? }` | linha |
| `DELETE /brands/:brandId/products/:id` | — | `204` |
| `GET\|POST /brands/:brandId/personas`, `PATCH\|DELETE …/personas/:id` | `{ name, age_range?, location?, interests?, pains?, desires?, segment_type? }` (`segment_type` padrão do banco `B2C`) | linha / `204` |
| `GET /brands/:brandId/learnings` | — | `brand_learnings[]` por `score` desc (somente leitura) |
| `GET /brands/:brandId/assets` | — | `brand_assets[]` por `created_at` |
| `POST /brands/:brandId/assets` | `{ kind: logo\|identity\|reference\|font\|photo, name, storage_path, tag?: produto\|ambiente\|equipe }` | `201` linha de `brand_assets`. **Fluxo de envio**: o navegador manda o arquivo para `POST /v1/workspaces/:ws/files?kind=brands` (§4) e registra aqui a `key` devolvida como `storage_path`. A API exige chave `brands/<workspaceId>/…` existente (senão `400 "Chave de arquivo inválida."`) e **gera a `url`** (assinada de 5 anos, mesma forma do protótipo); a `url` NÃO é aceita do cliente (`400 VALIDATION_ERROR`). `tag` só vale para `reference`. `kind=logo` também grava `brands.logo_url` (o protótipo fazia um 2º `update`) |
| `DELETE /brands/:brandId/assets/:id` | — | `204` (só a linha; o arquivo em disco fica) |

### 10.1 `POST /v1/creative/generate-brand-guide` (server fn `generateBrandGuide`)
Corpo `{ brandId }` → `200 { guide, referencias: string[] }`. A IA (`AiService.vision`, schema estrito `brand_guide`) olha até 6 fotos de referência da marca
(`kind` `reference`|`photo`, sem PDF/SVG, produto primeiro, lidas do disco pela `storage_path`) e sugere `estilo_fotografico, iluminacao, paleta_hex[], ambientes[],
elementos_obrigatorios[], elementos_proibidos[], fonte_titulo, fonte_corpo`. Acesso: precisa de `write` no workspace da marca (gasta crédito de IA; a tela esconde o botão do viewer);
marca inexistente **ou de workspace do qual o usuário não é membro** → `404 "Marca não encontrada."`; sem foto → `400 "Envie ao menos uma foto de referência (produto, ambiente ou equipe)."`;
IA não configurada/falha → `502 AI_NOT_CONFIGURED`/`AI_ERROR`. Diferença: as fotos vão como estão (≤ 8 MB cada; o protótipo reduzia para 1024 px com Jimp).

## 11. Visão geral — `GET /v1/workspaces/:workspaceId/overview` (read)

As cinco leituras diretas da tela `/overview`, devolvidas juntas (rotas por tabela ficam para as tarefas de campanhas/insights):
`{ performance_daily: [...] (todas as linhas com source ≠ 'demo'), campaigns: [...], campaign_costs: [{ amount }], ai_recommendations: [...] (status 'pending', ordem por severity asc), creatives: [{ id, title }] }`.
KPIs/agrupamentos continuam no navegador (`lib/metrics.ts`).

## 12. Setup — `POST /v1/setup/status` (server fn `setupStatus`)
Corpo `{ workspaceId }` (uuid; senão `400`), qualquer membro (`read`) → `{ items: SetupItem[] }`, `SetupItem = { key, group: "Começo"|"Conexões"|"CRM"|"Agendadores", label, status: "ok"|"pending"|"error"|"optional", detail, link, required }`.
Mesmos itens, textos e regras do protótipo. Chama `CrmDefaultsService.ensure` antes (as etapas do funil nascem na 1ª leitura). Diferenças: "IA do app" testa `AI_GATEWAY_URL` + `AI_GATEWAY_API_KEY`
(era `LOVABLE_API_KEY`); os agendadores usam `cron_heartbeats` (`SCHEDULER_ENABLED=true`). As sondas de Meta/Google/TikTok/Canva/Higgsfield leem o cofre/tabelas com as mesmas chaves do protótipo
(`META_*`, `GOOGLE_ADS_*`, `TIKTOK_*`, `CANVA_TOKENS`, `mcp_connections`), sem chamar os provedores.

## 13. Agência — `POST /v1/agency/*` (sem workspace na URL)
| rota | corpo | resposta / erros |
|---|---|---|
| `POST /v1/agency/overview` | `{}` | `{ workspaces: [{ id, name, role, inheritFrom, spend, adLeads, cpl, roas, activeCampaigns, crmLeads7d, postsWeek, pending }] }` das empresas em que o usuário é membro (qualquer papel), mais antiga primeiro. Gasto/leads/receita dos últimos 30 dias (`source ≠ 'demo'`, data de Brasília); leads CRM e posts em 7 dias; `pending` = `approval_requests` pendentes + `ig_posts` `pending_approval`; `cpl`/`roas` = `null` sem leads/gasto |
| `POST /v1/agency/set-ai-inheritance` | `{ workspaceId, sourceId: uuid\|null }` | `{ ok: true }`. **Segurança (Task 0): o chamador precisa ser owner\|admin da empresa E da origem** — senão qualquer um herdaria as chaves BYO de IA de outro cliente. `403 "Só o dono ou um administrador altera esta empresa."` (empresa) · `403 "Você precisa ser dono ou administrador da empresa de origem."` (origem) · `400 "Escolha outra empresa como origem."` (origem = empresa). Anti-corrente: a origem passa a não herdar de ninguém (mesma transação). `sourceId` é obrigatório (`null` explícito limpa) |
| `POST /v1/agency/apply-ai-inheritance-to-all` | `{ sourceId }` | `{ updated: n }`: aplica a origem às OUTRAS empresas em que o usuário é owner\|admin (a origem fica sem herança). Origem que ele não administra → `403 "Você precisa ser dono ou administrador da empresa de origem."` |

## 14. Configurações e auditoria
A tela `/settings` usa rotas do §3: `GET /v1/workspaces/:id/members` (membros + perfis), `GET /v1/profiles/me`, `GET /v1/workspaces/:id`, `PATCH /v1/workspaces/:id` (manage) e `PATCH /v1/profiles/me`.
`PATCH /v1/workspaces/:id` agora grava `activity_logs` `workspace.updated {name}` (o protótipo gravava no navegador). `ActivityService.log(workspaceId, actorId, action, entityType, metadata)`
(módulo global `modules/activity`) é o ponto único de auditoria para as próximas tarefas: mesmas strings de `action`, falha de auditoria nunca derruba a operação.


## 15. Campanhas — `/v1/workspaces/:workspaceId/campaigns`

Telas `/campaigns`, `/campaigns/new`, `/campaigns/$id`. GET = `read`; POST = `write` (viewer só lê). Toda id é conferida contra o workspace da URL
(campanha/marca de outro workspace → `404`). Estáticas (`performance`) antes das `:id`.

| rota | corpo | resposta |
|---|---|---|
| `GET /campaigns` | — | `campaigns[]` por `created_at` desc, cada uma com `brands: { name }` (embed `brands(name)`) |
| `GET /campaigns/performance` | — | `performance_daily[]` do workspace com `source ≠ 'demo'` (KPIs por campanha da lista, calculados no navegador) |
| `POST /campaigns` | `{ brand_id, name, objective, offer_product?, offer_price?, offer_promise?, landing_url?, start_date?, end_date?, audience{}, budget_total?, budget_daily?, goal_leads?, goal_sales?, avg_ticket?, margin_percent?, max_cac?, formats[] }` (números/datas aceitam `null`; datas `YYYY-MM-DD`) | `201` linha de `campaigns`. **`status` NÃO é aceito** (`400 VALIDATION_ERROR`): nasce sempre `draft`. Marca de outro workspace → `404 "Marca não encontrada."`; nome em branco → `400 "Informe o nome da campanha."`. Atividade `campaign.created {campaign_id, name}` |
| `GET /campaigns/:id` | — | linha de `campaigns` + `brands: {…marca inteira}` (`brands(*)`); `404 "Campanha não encontrada."` |
| `GET /campaigns/:id/detail` | — | as seis leituras de `["campaign", id]`: `{ campaign (com brands(*)), strategy (última versão ou null), copy (última versão ou null), creatives[] (created_at desc), perf[] (source ≠ 'demo'), costs[] }` |
| `POST /campaigns/:id/copies` | `{ content }` (objeto `CopyContent`, ≤ 50 000 caracteres) | `201` linha de `copies`; `status` = `draft`, `version` = anterior + 1 (calculada no servidor; `version` no corpo → `400`). Atividade `campaign.copy_generated {campaign_id}` (também para a copy do wizard) |
| `POST /campaigns/:id/request-approval` | `{}` | `201` linha de `approval_requests`. Só de `draft` (`400 "Só campanhas em rascunho podem solicitar aprovação."`). Numa transação: cria o pedido (`entity_type 'campaign'`, `title` `Publicar campanha "X" na Meta`, `summary` `Verba diária de R$…, N criativo(s), objetivo …`, `requested_by` = usuário) e leva a campanha a `pending_approval`. Atividade `campaign.approval_requested {campaign_id}` |

**Gatilhos de papel (db.md §4) viraram guardas de serviço** (`CampaignGuardsService`, exportado por `CampaignsModule` para as próximas tarefas): campanha virar `approved|active` (vindo de outro estado) e decidir um pedido = owner|admin
(`403 "Só o dono ou um administrador da empresa pode aprovar a campanha."` / `"…pode decidir aprovações."`); `meta_delivery_status` virar `ACTIVE` = owner|admin
(`403 "Só o dono ou um administrador pode ativar a veiculação (gastar verba)."`). Alternar `approved`↔`active` e `PAUSED` são livres. **A tarefa de Meta Ads deve chamar `assertCanSetCampaignStatus`/`assertCanSetDelivery`**
antes de gravar esses campos e registrar a atividade `campaign.published {campaign_id, mode:'live'}` (o navegador não grava mais auditoria).

## 16. Estrategista e Copy Engine — `POST /v1/ai/*`, `POST /v1/copy-ai/*`

Server fns portadas (corpo = o `data` do protótipo). IA só via `AiService` (chave OpenAI do workspace → chave Gemini → gateway do app; schema estrito).

| rota | corpo | resposta / erros |
|---|---|---|
| `POST /v1/ai/generate-campaign-strategy` | `{ campaignId }` | `200 { version, content: FullStrategy }`. Precisa de `write` na empresa da campanha (viewer `403`; campanha de empresa alheia/malformada `404 "Campanha não encontrada."`). Lê campanha+marca, 4 personas, 6 produtos, 10 aprendizados (por `score`) e os resultados de campanhas anteriores da marca (`source ≠ 'demo'`), monta o prompt do protótipo (schema `campaign_strategy`), valida `big_idea` e ≥ 1 ângulo (`502 "A IA não devolveu uma estratégia completa. Tente de novo."`), grava `campaign_strategies {status 'draft', version = max+1}` (a versão é calculada DEPOIS da geração) e a atividade `campaign.strategy_generated {campaign_id, version}`. IA não configurada/falha → `502 AI_NOT_CONFIGURED`/`AI_ERROR` |
| `POST /v1/ai/approve-campaign-strategy` | `{ strategyId }` | `200 { ok: true }`. `write`; as versões `approved` da campanha viram `superseded` e esta vira `approved` (transação). `404 "Estratégia não encontrada."` (inclui empresa alheia). Atividade `campaign.strategy_approved {campaign_id, version}` |
| `POST /v1/ai/create-ig-plan-from-strategy` | `{ campaignId }` | `200 { planId }`: cria `ig_content_plans` em rascunho (`requires_approval true`, `auto_publish false`) a partir da estratégia em vigor (aprovada mais recente, senão a última). `400 "Gere a estratégia da campanha primeiro."` / `400 "Esta versão da estratégia não tem plano do Instagram. Regere a estratégia."` |
| `POST /v1/copy-ai/generate-copy-with-ai` | `{ workspaceId, engine?: 'auto'\|'chatgpt'\|'gemini', brand{}, brief{}, seed?, campaignId?, angle? }` | `200 { content: CopyContent, engine }` com `engine` ∈ `"Sua conta OpenAI"` \| `"Sua conta Gemini"` \| `"IA do app"` \| `"IA do app (sua chave falhou)"`. Precisa de `write` (gasta crédito; o protótipo permitia qualquer membro) — não-membro `403 "Você não tem acesso a esta empresa."`. A estratégia aprovada da campanha (só dentro do workspace) entra no prompt (`big_idea`, `mensagem_principal`, ângulo/ângulos, 4 objeções, direção visual, CTA, vídeo). Briefing + marca ≤ 30 000 caracteres. Erros: `502 "A IA não devolveu a copy no formato esperado."`, `"Créditos de IA esgotados. Conecte sua própria chave em Integrações."`, `"Muitas solicitações agora. Tente em instantes."`, `"IA do app não configurada."` |

`AiService.jsonWithEngine(ws, { prompt, schema, name, engine })` (novo) serve ao Copy Engine: prompt sem o sufixo "Devolva SOMENTE JSON…", motor escolhido e rótulo de quem respondeu.

## 17. Aprovações — `/v1/workspaces/:workspaceId/{approvals,activity-logs}`, `POST /v1/approvals/*`

| rota | nível | resposta |
|---|---|---|
| `GET /v1/workspaces/:ws/approvals` | read | `approval_requests[]` por `created_at` desc, com `campaigns: { name } \| null` |
| `GET /v1/workspaces/:ws/activity-logs?limit=` | read | `activity_logs[]` por `created_at` desc (`limit` 30 por padrão, 1–200) — o "Audit log" da tela |
| `POST /v1/approvals/decide-approval` `{ approvalId, decision: 'approved'\|'rejected' }` | manage (do workspace do pedido) | `200 { ok: true }`. `404 "Pedido de aprovação não encontrado."` (inclui empresa alheia, sem vazar); `409 "Este pedido já foi decidido."` (também em corrida: o UPDATE é guardado por `status = pending`); `403 "Só o dono ou um administrador da empresa pode aprovar ou rejeitar."` (marketing/viewer). Numa transação: pedido → `decided_*`; `entity_type 'campaign'` → campanha `approved` (rejeitar = `draft`); `'creative'` → criativo recebe o status da decisão (sempre filtrado pelo workspace do pedido). Atividade `approval.<decisão> {request_id, entity_id}` com `entity_type` do pedido |

**Rotas que as telas chamam e ainda não existem** (shims criados; a API nasce nas tarefas indicadas, até lá a tela mostra o erro da API): `POST /v1/meta/meta-ads-status|meta-ads-publish|meta-ads-set-status`,
`POST /v1/meta/generate-ads-recommendations` (Task 6); `POST /v1/creative/canva-create-from-brief` (**feita na Task 4**, §20). Componentes `campaign-channels` e `campaign-ads-settings` são
**placeholders** com a assinatura final (a tarefa de Meta, 6, os substitui); `instagram/approvals` (`IgApprovalList`) é real desde a Task 5 (§22).

## 18. Biblioteca de mídia — `/v1/workspaces/:workspaceId/{media-assets,copies}` e `POST /v1/media/*`

Tela `/library` (+ `MediaPicker` do Instagram). Toda mídia entra por **um só caminho** (`AssetsService.ingest`): baixa/recebe os bytes, padroniza (imagem: corte "cover" no tamanho do formato de destino, JPEG q92 ou PNG com alfa, miniatura 400 px;
**jimp**, JS puro), valida contra o Instagram (imagem: largura ≥ 320 e proporção 0,56–1,91; vídeo: **só o cabeçalho MP4/MOV** — H.264, AAC, ≥ 720 px, 9:16 p/ Reel/Story, 3 s–15 min / ≤ 60 s, 23–60 fps, ≤ 1 GB; **sem transcodificar**),
grava em `creative-assets` (`media/<workspace>/<dia>/<uuid>.<ext>` + `_thumb.jpg`) e registra em `media_assets` (URL assinada de 5 anos). Todo filtro é por `workspace_id`; id de outro workspace nunca é tocado.

### 18.1 Leituras/escritas diretas (`@UseGuards(WorkspaceAccessGuard)`; GET = read, resto = write)

| rota | corpo / query | resposta |
|---|---|---|
| `GET /media-assets` | `search` (título/prompt, `% , ( )` viram espaço), `brand_id`, `campaign_id`, `kind` (image\|video), `target_format`, `status` (`active` = tudo menos arquivadas; draft\|approved\|rejected\|archived), `tag`, `folder`, `source`, `period` (7\|30\|90 dias), `sort` (new\|old\|title\|size; `size` com nulos por último), `limit` (1–1000, padrão 60) | `{ rows, count }`: `rows` = linhas de `media_assets` com `brands: { name } \| null` e `campaigns: { name } \| null`; `count` = total do filtro (a tela pagina com `limit = páginas × 60`) |
| `GET /media-assets/facets` | — | `[{ tags, folder }]` (até 5000; a tela tira as tags/pastas únicas) |
| `PATCH /media-assets/bulk` | `{ ids[1..500], status?, folder? }` (`folder` `null`/vazio = sem pasta) | `{ updated }` — só ids do workspace |
| `PATCH /media-assets/:id` | `{ tags[] }` (limpa, tira vazios e repetidos) | linha atualizada; `404 "Mídia não encontrada."` |
| `GET /copies` | — | aba "Textos": `copies[]` (`id, version, status, angle, created_at, content`) com `campaigns: { name, brand_id }`, `created_at` desc, até 300 |

### 18.2 Ações — `POST /v1/media/<nome-em-kebab>` (workspace no corpo)

Erros de acesso das funções de `export.functions`: não membro `403 "Você não tem acesso a esta área de trabalho."`; viewer em ação de edição `403 "Seu papel não permite esta ação."`. As de `manage.functions` usam as mensagens padrão (§1.4).

| rota | corpo | resposta / erros |
|---|---|---|
| `download-asset` (qualquer membro) | `{ workspaceId, assetId, format?: original\|png\|jpg }` | `{ url, name }` — link de **10 min** (`…?exp&sig&dl=<nome>`: o download força `Content-Disposition: attachment`). Nome `marca_formato_AAAA-MM-DD.ext`. `404 "Mídia não encontrada."` |
| `export-pdf` (membro) | `{ workspaceId, assetIds[1..100], layout: one_per_page\|contact_sheet }` | `{ url, name }` — **pdf-lib**: uma peça por página no tamanho real (px × 0,75 pt) ou folha de contato A4 2×3 com título/formato/medidas/prompt; vídeo vira caixa "VIDEO" |
| `export-zip` (membro) | `{ workspaceId, assetIds[1..100] }` | `{ url, name, count }` — **jszip** (STORE), nomes `marca_formato_data_<n>.ext`; `400 "Seleção grande demais para um ZIP (limite de 250 MB). Selecione menos itens."` |
| `upload-media` (edição) | **multipart**: `workspaceId`, `target` (padrão `other`), `brandId?`, `file` — um arquivo por chamada | `{ id, igReady, issues[] }`. `400 "<nome>: envie imagem ou vídeo."`, `400 "<nome>: arquivo maior que 100 MB."` (**limite visível ao usuário: 100 MB por arquivo** — o protótipo aceitava 500 MB; o teto é o do `@fastify/multipart` do `main.ts`). Imagem: **no máximo 50 megapixels e 20.000 px por lado**, conferido no cabeçalho ANTES de decodificar (`400 "Imagem grande demais (LxA). O limite é de 50 megapixels e 20.000 px por lado."`); só JPEG/PNG. Vídeo declarado sem cabeçalho `ftyp` → `400 "Arquivo de vídeo inválido: não é um MP4/MOV (falta o cabeçalho ftyp)."`; MP4 truncado → `400 "Arquivo de vídeo inválido ou corrompido."`, `400 "Arquivo ausente."`, `404` marca inexistente no workspace |
| `reformat-media` (edição) | `{ workspaceId, assetId, targets[1..8] }` | `{ ids[] }` — recorta (sem IA) para cada formato, como filhas (`parent_id`) do original; `400 "Vídeos não são recortados no servidor. Gere um novo vídeo neste formato."` |
| `use-media-in-instagram` (edição) | `{ workspaceId, assetIds[1..100] }` | `{ postId, format }` — cria `ig_posts` rascunho (`status 'idea'`; formato da 1ª mídia, `feed_carousel` se > 1; `media[]` até 10; `creative_brief.from_library`) e liga `media_assets.ig_post_id`. `400 "Selecione ao menos uma mídia."` |
| `use-media-in-campaign` (edição) | `{ workspaceId, assetIds[], campaignId }` | `{ count }` — cria `creatives` aprovados (`preview_url` = url da mídia) e liga a mídia; `404 "Campanha não encontrada."` |
| `attach-media-to-post` (edição) | `{ workspaceId, postId, assetIds[] }` | `{ ok: true, items }` — substitui `ig_posts.media` (até 10 no carrossel, senão 1). `400 "Post não encontrado."`; `400 "Mídia não está pronta para o Instagram: <problemas>"` |
| `revalidate-assets` (edição) | `{ workspaceId, assetIds[] }` | `{ total, ready, archived, failed, results[] }` — refaz medidas/validação/miniatura; mídia `mock`/picsum é arquivada |
| `delete-media-assets` (write) | `{ workspaceId, assetIds[1..200] }` | `{ deleted }` — apaga arquivo + miniatura do disco e o registro; versões filhas ficam soltas (`parent_id = null`) |
| `rename-media-tag` (write) | `{ workspaceId, from, to }` (`to` vazio remove a tag) | `{ updated }` |
| `rename-media-folder` (write) | `{ workspaceId, from, to }` (`to` vazio desfaz a pasta) | `{ updated }` |
| `media-ad-results` (read) | `{ workspaceId, creativeId }` | `{ spend, impressions, clicks, leads, conversions, revenue, campaigns[], days }` (soma de `performance_daily` com `source ≠ 'demo'`) |

`GET /v1/files/:bucket/*` ganhou `?dl=<nome>` (cabeçalho `Content-Disposition`; não faz parte da assinatura).

## 19. Creative Studio — `/v1/workspaces/:workspaceId/{creatives,creative-generation-jobs}` e `POST /v1/creative/*`

### 19.1 Leituras/escritas diretas (WorkspaceAccessGuard; GET = read, resto = write)

| rota | resposta |
|---|---|
| `GET /creatives` | `creatives[]` `created_at` desc, com `campaigns: { name } \| null` |
| `PATCH /creatives/:id` `{ status: draft\|ready\|approved\|rejected\|published }` | linha atualizada; atividade `creative.<status> {creative_id}` (antes gravada pelo navegador). `404 "Criativo não encontrado."` |
| `GET /creative-generation-jobs?limit=` | jobs `created_at` desc (padrão 12, máx. 100) — "Gerações recentes" |
| `GET /campaigns/:id/brief` | `{ strategies[10], copies[10] }` (`content, status, version`, versão desc) — a tela escolhe a aprovada, senão a primeira |

### 19.2 Ações (`POST /v1/creative/<nome-em-kebab>`) — a IA e o provedor só rodam no servidor

Diferente do protótipo (que só confiava no RLS), **todas exigem papel**: gerar/prévia/retry/nova versão = `write` (viewer `403`); pacote CapCut = qualquer membro. O job/criativo vem da linha (não do corpo): quem não é membro do workspace dela
recebe `404` (`"Job de geração não encontrado."` / `"Criativo não encontrado."`). `campaignId`/`brandId` de outro workspace → `404 "Campanha não encontrada."` / `"Marca não encontrada."` (antes de gastar IA).

| rota | corpo | resposta |
|---|---|---|
| `generate-creative` | `{ workspaceId, campaignId?, brandId?, title?, type?, aspectRatio?, targetFormat?, prompt?, copyText?, provider?: auto\|higgsfield\|chatgpt\|gemini, visualPrompt?(≤4000), artDirection?{}, adjust?(≤300), layout?: limpo\|titulo_topo\|preco_destaque\|cta_rodape, variations?(1–4, padrão 3), headline?(≤120), price?(≤40), cta?(≤40), angle?(≤200), useBrandImage?, coverWithLogo? }` | `{ jobId, creativeId, status: ready\|generating\|failed, assetUrl, provider, sandbox:false, error, artDirection, variations:[{assetId,url,score,winner}] }`. **Erro do provedor VOLTA em `error` (200, `status:'failed'`)**; sem gateway de IA e sem chave própria: `502 AI_NOT_CONFIGURED` (a direção de arte vem antes do job). Atividade `creative.generated {creative_id, provider}` quando `ready` |
| `preview-visual-prompt` | mesmo corpo | `{ artDirection }` — só o diretor de arte (1 chamada de LLM); se vierem `visualPrompt`+`artDirection` e não houver `adjust`, devolve o editado sem chamar a IA |
| `retry-creative-job` | `{ jobId }` | mesmo formato (sem `variations`/`artDirection`); refaz com o `final_prompt` guardado |
| `new-creative-version` | `{ creativeId }` | idem; atualiza o MESMO criativo (`version + 1`, linha em `creative_versions`) |
| `capcut-package` | `{ creativeId }` | `{ url }` — zip (vídeo/imagem, `legendas.srt`, `capa.jpg`, `LEIA-ME.txt` com o roteiro do Reels), link de **10 min** (no protótipo, 5 anos). `400 "Este criativo ainda não tem arquivo."` |
| `generate-brand-guide` | (Task 2) | as fotos de referência agora são reduzidas a ≤ 1024 px JPEG (jimp) antes de ir à IA, como no protótipo |
| `POST /v1/ai-keys/ai-keys-health` `{ workspaceId }` | membro | `{ outOfCredit:[{vendor,error}] }` — só esta ação de chaves de IA mora aqui; as demais ficam em Integrações |

**Pipeline de imagem** (`PipelineService`): diretor de arte (LLM com schema estrito: sujeito, cena, luz, câmera, paleta… `prompt_final` em inglês) → N variações em paralelo (1–4) → cada uma entra na biblioteca (`source = provedor`) e é nota­da pelo **crítico visual**
(visão: produto, fidelidade, composição, defeitos, paleta; 0–10 cada, total/50; candidata reduzida a 768 px) → se a melhor tiver < 28/50, **1 nova rodada** com o motivo do crítico → a vencedora recebe, por cima, **título/preço/chamada e logo**
(`composeCreative`: **jimp + opentype.js**, texto desenhado por varredura com antisserrilhado, zonas seguras do 9:16, faixa com contraste automático; **nunca gerado pela IA**) e vira o criativo final (filha da vencedora). A fonte padrão é a **Archivo Black vendorizada** em `api/assets/fonts/`
(o protótipo a baixava do GitHub a cada partida); fonte `.ttf/.otf` da marca vale se o opentype a entender. **Vídeo**: sem transcodificação; MP4 validado pelo cabeçalho; legendas `.vtt/.srt` (blocos de 6 palavras) e capa composta (logo/título/CTA) opcionais.

**Provedor** (`provider = auto`): chave OpenAI do workspace (estrita) → chave Gemini (estrita) → Higgsfield (MCP, se conectado) → créditos do app (gateway, ignora as chaves do workspace); qualquer erro avança para o próximo e o caminho vai em `creative_generation_jobs.provider_log`.
`chatgpt`/`gemini` escolhidos vão direto; `higgsfield` sem conexão: `400 "Higgsfield não está conectado nesta empresa. Conecte em Integrações."`.

**Vídeo assíncrono — id do job vinculado ao workspace**: o vídeo espera até 25 s na requisição (e usa a foto do produto da marca como 1º quadro, salvo `useBrandImage:false`); passou disso, o job fica `generating` com `external_job_id` (`veo:<id>` / `gveo:<operação>` / UUID do Higgsfield)
**gravado na própria linha do job (workspace_id)** e o agendador (`creative-poll-5min`, heartbeat `creative`) conclui. O poller só consulta ids que (a) têm o **formato válido** (`isValidVideoJobId`; Higgsfield só UUID) e (b) **estão gravados num job do mesmo workspace** — nunca um id/nome vindo de fora;
`AiService.videoStatus` também recusa formato inválido. Passou de 1 h: `failed` ("Tempo esgotado no provedor."). O `options` do job guarda título/ângulo/texto/formato/capa para o poller concluir como o fluxo normal.

## 20. Canva — `POST /v1/creative/canva-*` e `GET /api/public/canva/oauth/callback`

Credenciais por empresa no **cofre** (`app_credentials`, AES-256-GCM): `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` (também valem os globais), `CANVA_TOKENS` (JSON), `CANVA_OAUTH` (state + verifier PKCE, vale 20 min, uso único). Empresas com `ai_inherit_from` usam a conexão da agência.
O redirect cadastrado no app Canva é `<PUBLIC_URL>/api/public/canva/oauth/callback` (o protótipo usava o domínio do site); a volta é `302 <APP_URL>/integrations?canva=ok|error[&msg=]`.

| rota | nível | corpo → resposta |
|---|---|---|
| `canva-get-status` | read | `{ workspaceId }` → `{ appSaved, clientIdHint ("abcd••••"), connected, inherited, name, email }` |
| `canva-save-app` | manage | `{ workspaceId, clientId (trim 4–200), clientSecret? (≤500) }` → `{ ok: true }` |
| `canva-o-auth-start` | manage | `{ workspaceId }` → `{ authUrl }` (PKCE S256; `400 "Salve o Client ID e o Client secret do app Canva antes de entrar."`) |
| `canva-test` | read | → `{ name }` |
| `canva-disconnect` | manage | → `{ ok: true }` |
| `canva-send-asset` | write | `{ workspaceId, assetId }` → `{ assetId }` (id do Canva); `404 "Mídia não encontrada."` |
| `canva-create-from-brief` | write | `{ workspaceId, title (1–250), size?: square\|portrait\|story\|landscape (portrait), assetId? }` → `{ designId, editUrl }` |
| `canva-list-designs` | read | `{ workspaceId, query? (≤100) }` → `[{ id, title, thumbnail }]` |
| `canva-import-design` | write | `{ workspaceId, designId (id ou link `…/design/<id>/…`), title?, format?: png\|jpg\|mp4, brandId?, campaignId? }` → `{ id, url }` (1ª mídia; `source 'canva'`, `provider 'canva'`, `prompt 'canva_design_id:<id>'`, sem recorte) |

Erros do Canva: `400 "Canva não está conectado nesta empresa. Entre com Canva em Integrações."`; `400 "Canva: <mensagem>"`; 401 do Canva ou refresh recusado desconecta e pede novo login. O download do arquivo exportado só vai para https público (SSRF).
`GET /api/public/canva/oauth/callback?code&state` **(pública)**: o `state` guardado no cofre é a credencial; qualquer falha → `302` com `canva=error`.

## 21. Conexões MCP (Higgsfield / Meta / Canva) — `POST /v1/mcp/*`

Cliente MCP Streamable-HTTP (JSON-RPC 2.0, `protocolVersion 2025-06-18`, aceita JSON ou SSE, `Mcp-Session-Id`, sessão nova a cada chamada) + OAuth 2.1/PKCE com registro dinâmico (RFC 7591) e descoberta RFC 9728/8414.
**Só https** (`localhost`/127.x só fora de produção); nunca para a rede interna (IPs privados/link-local/única-local, IPv4 embutido em IPv6, `*.internal`, ponto final no host); **guarda de conexão** (`createGuardedFetch`): o DNS é resolvido uma vez, qualquer endereço interno recusa e a conexão é fixada no endereço verificado (sem rebinding) — vale para MCP, downloads de mídia e Canva; redirecionamentos seguidos à mão (≤ 5, cada salto revalidado; sem `Authorization` entre origens); corpo de download lido em streaming e abortado ao passar de 200 MB. `mcp-connect` com `serverUrl` diferente do guardado **não reaproveita** o token (limpa token/OAuth antigos; `serverUrl` ≤ 2048, `label` ≤ 120). `access_token`, `refresh_token`, `oauth_client_secret` e `oauth_code_verifier` ficam
**cifrados** em `mcp_connections` (`enc:v2:`, `VaultService`) — o protótipo os guardava em texto puro; a API nunca devolve essas colunas.

| rota | nível | corpo → resposta |
|---|---|---|
| `POST mcp-connect` | dono/admin (`403 "Só o dono ou um administrador conecta contas."`; não membro `403 "Você não tem acesso a este workspace."`) | `{ workspaceId, provider: higgsfield\|meta\|canva, serverUrl (≥4), accessToken?, label? }` → `{ status, tools[{name,description}], error, needsAuth }` — testa (`initialize` + `tools/list`) e faz upsert por `(workspace_id, provider)`; sem `accessToken`, reaproveita o guardado |
| `POST mcp-o-auth-start` | dono/admin | `{ workspaceId, provider, serverUrl, label? }` → `{ authUrl }` (cliente registrado de novo a cada vez; `redirect_uri = <PUBLIC_URL>/api/public/mcp/callback`); `400 "Este servidor MCP não aceita registro automático de aplicativo. Informe uma chave de acesso manualmente."` |
| `POST mcp-disconnect` | dono/admin | → `{ ok: true }` |
| `POST mcp-run` | **write** (o protótipo deixava qualquer membro; gasta crédito da conta conectada) | `{ workspaceId, provider, keywords?[], toolName?, args? }` → `{ tool, text, mediaUrl, structured }`; `400 "Nenhuma conexão MCP ativa para este provedor."` / `"O servidor MCP não expôs nenhuma ferramenta utilizável."`. Renova o token quando falta < 60 s; sem conexão própria ativa usa a da agência |
| `GET /v1/workspaces/:ws/mcp-connections` | read | `[{ id, provider, label, server_url, status, tools, last_error, connected_at, expires_at }]` (nunca tokens) |
| `GET /v1/mcp/status/:provider` | autenticado | `[{ workspace_id, provider, status }]` das empresas do usuário (cartão "Higgsfield" de Integrações) |
| `GET /api/public/mcp/callback?code&state&error` | **pública** | troca o code, testa as ferramentas e grava os tokens cifrados; devolve **HTML** (mensagem escapada; `postMessage({type:"mcp-oauth",ok})` só para a origem de `APP_URL`). O `state` é de uso único e vale 30 min |

## 22. Instagram — `/v1/workspaces/:workspaceId/{instagram-account,ig-*}`, `POST /v1/instagram/*`, cron e webhook

Orgânico (feed, carrossel, Reels, Stories): plano de conteúdo → calendário (IA) → mídia (pipeline de imagem/vídeo da §19) → aprovação → fila de publicação → métricas. Tudo que fala com a Meta passa por **um** cliente injetável
(`MetaGraphClient`, `https://graph.facebook.com/v24.0`, `access_token` + `appsecret_proof`); credenciais = cofre da empresa → cofre global → env (`META_APP_ID/SECRET`, `META_SYSTEM_USER_TOKEN`, `META_PAGE_ID`).
Os laços do navegador (`drive()` do calendário: ≤ 40 × `fill-auto-calendar`, depois ≤ 12 × `generate-next-auto-media`; "gerar criativos pendentes" um a um) **continuam no navegador**, com os mesmos limites.

### 22.1 Leituras/escritas diretas (`WorkspaceAccessGuard`: GET = read, POST/PATCH = write — viewer só lê)

| rota | resposta |
|---|---|
| `GET /instagram-account` | linha de `instagram_accounts` (sem token — ele nunca é gravado aqui) ou `{}` quando não há conta |
| `GET /ig-posts` | `ig_posts[]` por `scheduled_at` asc (sem data por último) |
| `GET /ig-posts/pending-count` | `{ count }` de `pending_approval` — selo do menu (`["ig-pending-badge", ws]`, 120 s) |
| `PATCH /ig-posts/:id` `{ caption?(≤5000), hashtags?[≤30], cta?(≤500), scheduled_at?(ISO com fuso\|null), creative_brief?{} }` | linha atualizada. **Só esses campos** (`status`/`media` não são editáveis → `400 VALIDATION_ERROR`). O `pending_job` de `creative_brief` é do servidor (id do job do provedor): o cliente não o define nem apaga. Post de outra empresa/malformado `404 "Post não encontrado."` |
| `GET /ig-post-metrics` | `ig_post_metrics[]` `collected_at` desc |
| `GET /ig-content-plans[?exclude_archived=true]` | planos `created_at` desc |
| `POST /ig-content-plans` · `PATCH /ig-content-plans/:id` | `{ name, brand_id?, objective?, tone_of_voice?, content_pillars?[string], posting_frequency?{feed_image,feed_carousel,feed,reels,stories: int}, preferred_times?[string], posting_days?[0–6], hashtag_strategy?{notes,audience}, cta_default?, requires_approval?, auto_publish?, status?: draft\|active\|paused }` → linha (`{ id }` basta à tela). `workspace_id` no corpo = `400`. `brand_id` de outra empresa `404 "Marca não encontrada."`; plano alheio `404 "Plano de conteúdo não encontrado."` |
| `GET /ig-autopilot-events[?limit=20]` | eventos `created_at` desc (máx. 100) |
| `GET /ig-auto-runs` | até 8 programações **raiz** `created_at` desc, cada uma com `weeks` (raiz + semanas recorrentes) e `counts { total, media, waiting, scheduled, published, failed }` dos posts — o que o protótipo montava com 3 consultas |
| `GET /ig-account-insights[?since=YYYY-MM-DD]` | `ig_account_insights[]` por data asc |

Leituras de marcas/campanhas/mídia da tela usam as rotas das §10, §15 e §18 (`GET /brands`, `GET /campaigns`, `GET /media-assets`).

### 22.2 Ações — `POST /v1/instagram/<nome-em-kebab>` (corpo = o `data` do protótipo; HTTP 200)

Autorização no servidor (o protótipo deixava "qualquer membro", inclusive viewer, gerar/agendar): conectar/trocar/desconectar conta, listar Páginas e programação "publica sozinho" = **manage** (dono/admin);
todo o resto que escreve ou gasta crédito = **write** (dono/admin/marketing); `preview-auto-calendar` só exige estar logado. Quem não é da empresa `403 "Você não tem acesso a esta empresa."`; viewer `403 "Seu perfil não tem permissão para esta ação."`;
post/plano/marca/programação de outra empresa `404` (mensagem do protótipo); programação → `404 "Programação não encontrada."` também para quem não é membro (não vaza).

| rota | corpo | resposta / erros |
|---|---|---|
| `connect-instagram-account` | `{ workspaceId, pageId?(≤64) }` | `{ ok:true, username, igUserId }` ou `{ ok:false, error }` (conta fica `status 'error'` + `last_error`): `"Salve as credenciais da Meta em Integrações antes de conectar o Instagram."`, `"ID da Página do Facebook não configurado."`, `"Esta Página não tem uma conta profissional do Instagram vinculada."`. Em caso de sucesso importa o histórico (sem bloquear) |
| `list-instagram-options` | `{ workspaceId }` | `{ ok, options:[{ pageId, pageName, igUserId, username, picture }] }` ou `{ ok:false, error, options:[] }` |
| `sync-instagram-history` | `{ workspaceId }` | `{ ok:true, imported, total, metrics }` — últimos 30 itens; só importa os que faltam (`source 'instagram_import'`, mídia vai para a biblioteca sem normalizar, `approved`) e coleta métricas de todos. `400 "Conecte uma conta do Instagram antes de importar o histórico."` |
| `disconnect-instagram-account` | `{ workspaceId }` | `{ ok:true }` |
| `generate-content-calendar` | `{ workspaceId, planId, weeks?(1–8, 1), engine?: auto\|chatgpt\|gemini }` | `{ created, provider: openai_own\|gemini_own\|lovable_ai }` — cria `ig_posts` `idea` com `creative_brief { prompt, slides, aspect_ratio }`; só os dias do plano. `404 "Plano de conteúdo não encontrado."`, `502 "A IA não devolveu posts."` |
| `generate-post-assets` · `regenerate-media` | `{ workspaceId, postId, provider?: auto\|higgsfield\|chatgpt\|gemini, adjust?(≤300) }` · `{ …, instructions?(≤1000) }` | `{ ok:true, items, provider, pending? }` ou `{ ok:false, error }` (post `failed` + `last_error`). Imagem única = pipeline da §19 (variações → crítico → composição); carrossel = 1 imagem por slide (gancho no 1º, CTA no último, logo em todos); Reels/Story vídeo = vídeo + capa + legendas. Provedor assíncrono grava `creative_brief.pending_job` (post fica `generating`; o job `instagram-queue` conclui, timeout 1 h) |
| `regenerate-caption` | `{ workspaceId, postId, instructions?(≤1000), engine? }` | `{ ok:true }` — atualiza `caption`, `hashtags`, `cta`, `ai_generation_log` |
| `suggest-pillars` | `{ workspaceId, brandId?, objective?, tone?, audience? (≤500) }` | `{ pillars:[≤5] }`; marca alheia `404` |
| `approve-post` | `{ workspaceId, postId }` | `{ ok:true }`. `400 "Gere a mídia antes de aprovar."`. Plano/programação no piloto agenda sozinho (`afterApproval`) |
| `reject-post` | `{ workspaceId, postId, reason(1–1000) }` | `{ ok:true }` (`cancelled` + `rejection_reason`) |
| `schedule-post` | `{ workspaceId, postId, scheduledAt (ISO com fuso) }` | `{ ok:true, sandbox }` (`sandbox` = sem conta conectada, job `mode 'mock'`). Cancela o job pendente anterior, cria `publishing_jobs { channel 'instagram_organic', status 'pending', run_at }`, post → `scheduled`. `400 "Gere a mídia antes de agendar."` / `"O post precisa estar aprovado para ser agendado."` / `"Este post exige aprovação antes de agendar."` |
| `publish-instagram-post` | `{ workspaceId, postId }` | `{ ok:true, sandbox:false, permalink }` ou `{ ok:false, sandbox:false, error }` (post `failed`). Guardrails: aprovação, 25/24 h, mídia `ig_ready` e não simulada, URL HTTPS pública, conta conectada |
| `collect-post-metrics` | `{ workspaceId, postId }` | `{ ok:true, values }` (conjunto por formato; se a Meta recusar uma métrica, cai para o essencial). `400 "Post ainda não publicado."` / `"Post antigo do modo simulado: não existe no Instagram."` |
| `collect-account-insights-now` | `{ workspaceId }` | `{ days, followers }` ou `{ skipped:"sem conta conectada" }` |
| `upload-post-media` | **multipart** `workspaceId`, `postId`, `file` | `{ ok:true }`. Imagem/vídeo ≤ 100 MB (`400 "Envie uma imagem ou um vídeo MP4."` / `"Arquivo acima de 100 MB."`); entra na biblioteca; carrossel acrescenta, os demais substituem; `idea`/`failed` → `pending_approval` |
| `create-auto-calendar` | `{ workspaceId, planId?, brandId?, campaignId?, startDate, endDate (YYYY-MM-DD), weekdays[0–6]≥1, times[≤8 "H:MM"], storyTimes[≤10], formats[≥1], focus?(≤1000), mode: publish\|approval, recurring?, asap? }` | `{ runId, planId, total, skipped }`. Horários exatos em UTC-3 (nunca pela IA); ≤ 120 posts e ≤ 92 dias; sem plano cria um a partir da marca (pilares sugeridos). `400 "Informe ao menos um horário."` / `"Escolha um plano de conteúdo ou uma marca."` / horários já passados; `404` plano/marca/campanha de outra empresa |
| `fill-auto-calendar` | `{ runId }` | `{ filled, total, done, busy }` — próximo lote de 8 da estrategista, com lock otimista de 150 s (`busy:true` = outra chamada tem o lock; falha de IA solta o lock, guarda `last_error` e responde `502`) |
| `generate-next-auto-media` | `{ runId, withinHours?(1–72, 6) }` | `{ done, ok, error?, remaining }` — gera o criativo do próximo post `idea` da programação dentro da janela e agenda (`scheduleAutomated`) |
| `cancel-auto-calendar` | `{ runId }` | `{ cancelled: n }` — programação + semanas recorrentes `cancelled`; posts não publicados `cancelled`; jobs pendentes cancelados |
| `preview-auto-calendar` | `{ startDate, endDate, weekdays, times, storyTimes, formats, asap? }` | `{ ok:true, total, skipped, first, last, slots[≤200] }` ou `{ ok:false, error }` (puro, sem IA) |

### 22.3 Fila de publicação (`publishing_jobs`, `channel = 'instagram_organic'`)

`runPublishingQueue` (a cada 5 min): destrava `running` com `locked_at` > **15 min**; pega até **4** jobs `pending` com `run_at ≤ agora` por `run_at`; **lock otimista** (`UPDATE … WHERE id AND status='pending'`, `attempts+1`); resultado: sucesso → `done` + permalink no `log`;
container ainda processando na Meta (`ContainerPending`) → volta `pending` em 2 min **sem** gastar tentativa (o container criado fica em `ig_posts.ig_creation_id` e a próxima execução só consulta e publica); `Guardrail` ou token 190 → `failed` sem repetir
(190 também marca a conta em erro, pausa os planos ativos e cancela os jobs pendentes); limite diário → repete em 1 h sem contar; demais erros → até **3** tentativas com backoff 5 min · 2^(n-1); o post espelha (`scheduled`/`failed`, `retry_count`, `last_error`).
O poller de **criativos do Studio** (`pollPendingCreatives`) que o protótipo chamava dentro desta fila **não** é chamado aqui: o job `creative-poll-5min` (§19) já o faz.

### 22.4 Cron — `POST /api/public/cron/instagram` (pública, protegida por token) e jobs do agendador

Cabeçalho `x-cron-secret` = `CRM_CRON_SECRET` (env) **ou** `cron_tokens.token` com `name = 'instagram'` (comparação em tempo constante); senão `401 "Unauthorized"`. Corpo `{ task?: queue\|publish\|media\|metrics\|weekly\|optimize\|account }` (outro valor `400`):

| task | faz | resposta |
|---|---|---|
| `queue` (= `publish`) | mídias assíncronas pendentes + fila de publicação | `{ pendingMedia, queue:[{ job, status, error? }] }` |
| `media` | calendário automático (lotes da estrategista, agendar prontos, nova tentativa de falhas, "publish" vencido < 12 h, aprovação 10 min antes, recorrentes, concluir) + piloto (até 2 mídias, regra das 2 h) | `{ autoCalendar, autopilot }` |
| `metrics` | janelas 1h/24h/7d (stories 1h/20h) + aprendizado (top 20 % → `brands.visual_style.exemplos_prompt`) | `{ metrics, learning }` |
| `weekly` | recorrentes + semana seguinte dos planos `auto_publish` (reserva `ig_autopilot_weeks`, liberada se falhar) | `{ weekly:[…] }` |
| `optimize` | melhores horários (BRT) e pesos dos pilares dos últimos 14 dias | `{ optimize:[…] }` |
| `account` | seguidores/alcance/visitas/cliques de cada conta conectada | `{ account:[…] }` |
| (sem `task`) | queue + media + metrics | tudo junto |

O heartbeat (`instagram-<task>`, `instagram-all`) é gravado **depois** (o protótipo gravava antes e não provava sucesso). Os mesmos 6 jobs rodam no agendador (`SCHEDULER_ENABLED=true`, UTC, `JOB_SCHEDULES`): `instagram-queue-5min` (heartbeat `instagram-queue`),
`instagram-media-5min` (`instagram-media`), `instagram-metrics-5min` (`instagram-metrics`), `instagram-autopilot-weekly` `0 21 * * 0` (`instagram-weekly`), `instagram-optimizer-monday` `0 12 * * 1` (`instagram-optimize`), `instagram-account-daily` `25 10 * * *` (`instagram-account`).
`revalidateBackfill` (re-validar mídias marcadas `quality_report.backfill`) **não** roda aqui: era só para os dados migrados do Lovable, e não há migração de dados.

### 22.5 Webhook — `GET|POST /api/public/webhooks/instagram/:token` (pública)

`token` = `crm_integrations.webhook_token` com `kind = 'instagram'` (outro tipo = não existe). **GET** (verificação da Meta): `hub.mode=subscribe` + `hub.verify_token` = `verify_token` da integração → devolve o `hub.challenge` (`text/plain`); senão `403 "Forbidden"`.
**POST** (corpo bruto — `rawBody` habilitado no Nest): `404 "Not found"` sem integração · `401 "Invalid signature"` se `x-hub-signature-256` (HMAC-SHA256 do corpo com o App Secret do **env** ou do cofre da empresa/global) não confere · `400 "Bad request"` JSON inválido ·
`200 "ok"` · `500 "retry later"` se algum evento falhou (a Meta reenvia). Eventos: Direct (`entry[].messaging[]`, ignora eco e a própria conta) e comentários (`changes[].field = comments`). Idempotência por `crm_webhook_events (source 'instagram', external_id = mid | comment:<id>)`:
processado/em processamento (< 10 min) não repete; `failed` ou preso > 10 min é reprocessado. Cada evento vira lead (`source instagram_dm|instagram_comment`, `instagram_id`), conversa (`phone = ig:<igsid>`, janela de 24 h), mensagem e interação;
descadastro ("sair", "parar", "descadastrar", "stop") marca `unsubscribed`; palavra-chave de comentário envia DM privada + resposta pública (`crm_integrations.config.keywords`). **Cadências, agente SDR e compreensão de áudio/imagem são da Task 8** — entram pelo ponto de extensão
`CRM_CHANNEL_HOOKS` (`startCadence`, `stopCadences`, `runSdr`, `describeMedia`); sem ele o canal grava tudo e não responde sozinho. `WebhookLedgerService` (`webhooks/`) é o mesmo ledger/assinatura que os webhooks de WhatsApp e Lead Ads usarão.

## 23. Meta Ads, gestor de tráfego, Google/TikTok Ads, Performance e Insights

Módulo `api/src/modules/ads`. Telas `/performance`, `/insights`, abas "Anúncios e regras" da campanha e (Task 9) o painel de Integrações. Todas as ações são `POST` com o `data` do protótipo no corpo, HTTP 200; `workspaceId`/`campaignId`/`id` são uuid (`400 VALIDATION_ERROR` se não). Erros dos provedores: Meta = `502 META_ERROR`, Google/TikTok = `502 ADS_PROVIDER_ERROR` (mensagem pt-BR do protótipo); falta de credencial = `400`. Todo id que entra em caminho da Graph/GAQL é só dígitos (`act_`+dígitos para a conta); fora disso nunca vira URL. A Graph usa `MetaGraphClient` (Task 5): `access_token` + `appsecret_proof` em toda chamada; `META_GRAPH_BASE_URL` (só testes, ignorada em produção) aponta para a Graph falsa.

### 23.1 Leituras diretas (`WorkspaceAccessGuard`, GET = read)

| rota | resposta |
|---|---|
| `GET /v1/workspaces/:ws/performance-daily` | `performance_daily[]` com `source ≠ 'demo'`, por `date` asc (number/`YYYY-MM-DD`) |
| `GET /v1/workspaces/:ws/campaign-costs` | `campaign_costs[]` |
| `GET /v1/workspaces/:ws/ai-recommendations` | até 200, `created_at` desc, com `campaigns: { name } \| null` |

(`/performance` ainda usa `GET …/campaigns` e `GET …/creatives`; `/insights` usa estas duas leituras.)

### 23.2 Meta — `POST /v1/meta/<kebab>`

Portões locais com as mensagens do protótipo: não-membro `403 "Você não tem acesso a esta área de trabalho."`; viewer em ação de edição `403 "Seu perfil não pode alterar campanhas."`; conexão `403 "Só o dono ou um administrador conecta a Meta."`.

| rota (`server fn`) | acesso | corpo → resposta |
|---|---|---|
| `meta-ads-save-credentials` | **owner\|admin** (o protótipo deixava marketing: corrigido) | `{ workspaceId, appId≥4, appSecret≥8, systemUserToken≥20, adAccountId (act_?dígitos), pageId (dígitos), instagramId? }` → `{ ok, configured, missing[] }`; grava no cofre (cifrado), `META_TOKEN_SOURCE=system_user`, expiração vazia |
| `meta-ads-status` | membro | `{ workspaceId }` → `{ configured, missing[], tokenExpiresAt, tokenSource }` (sem chamar a Meta) |
| `meta-ads-test` | membro | → `{ ok, missing[], user, account{id,name,status,currency,timezone}, page, instagram, error }` (`ok:false` com HTTP 200) |
| `meta-ads-list` | membro | → `{ campaigns[], adsets[], ads[] }` (limite 50) |
| `meta-ads-insights` | membro | `{ workspaceId, since, until (YYYY-MM-DD), campaignId? }` → `{ spend, impressions, clicks, ctr, cpc, leads, cpl }`; campanha sem `meta_campaign_id` (ou de outro workspace) `400 "Esta campanha ainda não foi publicada na Meta."` |
| `meta-ads-publish` | não-viewer | `{ workspaceId, campaignId }` → `{ campaignId, adsetId, adsetIds[], adIds[], adMap, leadFormId, steps[{key,label,status,detail}] }`. Tudo **PAUSADO**; UTM no destino; falha total → `publishing_jobs failed` + 502; sucesso → grava ids, `meta_delivery_status=PAUSED`, job `done\|partial` e atividade **`campaign.published {campaign_id, mode:'live'}`**. Erros: `404 "Campanha não encontrada."`, `400` "A campanha precisa ser aprovada em Aprovações antes de ir para a Meta." / "Esta campanha já foi enviada para a Meta. Use Ativar/Pausar." / "Preencha a página de destino (URL) da campanha antes de publicar." / "Aprove pelo menos um criativo desta campanha antes de publicar."; `409` se a mesma campanha já está sendo enviada (trava em memória: clique duplo) |
| `meta-ads-set-status` | não-viewer; **ACTIVE = owner\|admin** | `{ workspaceId, campaignId, status: ACTIVE\|PAUSED }` → `{ ok }`. Chama `CampaignGuardsService.assertCanSetDelivery/assertCanSetCampaignStatus` antes de qualquer chamada à Meta (`403 "Só o dono ou um administrador pode ativar a veiculação (gastar verba)."`). Ao ativar, anúncios pausados pelo otimizador (`ai_recommendations pause_ad applied`) continuam pausados; campanha ↔ `active`/`approved` |
| `meta-save-app` | owner\|admin | `{ workspaceId, appId, appSecret }` → `{ ok }` |
| `meta-login-url` | owner\|admin | `{ workspaceId, origin }` → `{ url }` (Facebook, 14 escopos). `origin` é **ignorado**: retorno = `PUBLIC_URL`; `state` aleatório de uso único (§23.5) |
| `meta-list-assets` | owner\|admin | → `{ adAccounts[{id,name,active,currency}], pages[{id,name,instagramId,instagramUsername}] }` |
| `meta-save-assets` | owner\|admin | `{ workspaceId, adAccountId, pageId, instagramId? }` → `{ ok }` |

### 23.3 Gestor de tráfego — `POST /v1/meta/<kebab>`

| rota | acesso | corpo → resposta |
|---|---|---|
| `sync-ads-insights-now` | membro | `{ workspaceId }` → `{ campaigns, rows, message? }`: 30 dias da Meta + Google/TikTok → `performance_daily` (upsert em lote por `(campaign_id, meta_ad_id, date)` / `(campaign_id, source, external_id, date)`); `creative_id` só se for criativo deste workspace; carimba `last_insights_sync_at`. **Cooldown de 60 s por empresa** (memória do processo): dentro dele devolve `{ campaigns: 0, rows: 0, message: "Sincronização feita há pouco — aguarde um minuto." }` sem chamar os provedores (falha não consome o cooldown) |
| `generate-ads-recommendations` | editores | `{ workspaceId, campaignId? }` → `{ created, errors[] }` (IA com 14 dias reais; ids da IA validados contra os dados). **Idempotente**: não cria recomendação se já há `pending`/`applying` da mesma campanha + ação + alvo |
| `decide-ads-recommendation` | owner\|admin | `{ id, decision: apply\|dismiss }` → `{ result }`. De outro workspace/inexistente `404 "Recomendação não encontrada."`; já decidida `400 "Esta recomendação já foi decidida."` (reserva atômica `pending→applying`: dois cliques executam uma vez; falha na Meta volta a `pending`; reserva em `applying` com mais de 10 min — `applying_at` — volta a `pending` ao listar/aplicar e no cron). `apply` executa pause/activate/verba (teto +30%); alvo que não é da campanha `400 "Recomendação sem alvo válido."` |
| `save-campaign-ads-settings` | editores | `{ campaignId, adsConfig{}, rules{}, privacyUrl? }` → `{ ok }`. Saneado: só chaves conhecidas, `structure`/`cta`/`placements` válidos, ids de público só dígitos, mínimo 5 / passo 5–30 %; URL só http(s) |
| `list-meta-audiences` | membro | → `[{ id, name, subtype, size }]` |
| `sync-crm-customer-audience` | owner\|admin | `{ workspaceId, onlyWon? }` → `{ id, uploaded }` (até 50 000 leads sem descadastro; e-mail/telefone com SHA-256; id guardado cifrado em `META_AUDIENCE_CRM_WON\|ALL`). `400` "Nenhuma etapa marcada como ganho no funil do CRM." / "Nenhum lead com e-mail ou telefone no CRM." |

### 23.4 Google Ads / TikTok Ads — `POST /v1/ads/<kebab>`

| rota | acesso | corpo → resposta |
|---|---|---|
| `ads-channels-status` | membro | → `{ google: string[], tiktok: string[] }` (o que falta) |
| `save-ads-channel-app` | owner\|admin | `{ workspaceId, channel, values{} }` → `{ ok }`; só as chaves do canal; ids de conta numéricos; `400 "Nada para salvar."` |
| `ads-channel-login-url` | owner\|admin | `{ workspaceId, channel, origin }` → `{ url }` (retorno = `PUBLIC_URL/api/public/ads/oauth/<canal>`; `origin` ignorado) |
| `list-ads-channel-accounts` | owner\|admin | → `[{ id, name }]` |
| `link-external-campaign` | editores | `{ campaignId, channel, externalId }` → `{ ok }` (só dígitos) |
| `create-external-campaign` | editores | `{ campaignId, channel }` → `{ campaignId, steps[] }`: Google Pesquisa PAUSADA (IA escreve títulos ≤30, descrições ≤90, palavras-chave) / TikTok em vídeo DESATIVADO; mensagens do protótipo. **Reserva atômica** por campanha/canal (`campaigns.google_creating_at`/`tiktok_creating_at`, vale entre instâncias): duplo clique/retry → `409 "Esta campanha já está sendo enviada para o Google|TikTok. Aguarde."` (nenhuma 2ª IA/campanha externa); falha libera a reserva; reserva com mais de 10 min é reassumida |
| `set-external-campaign-status` | **ativar = owner\|admin**, pausar = editores | `{ campaignId, channel, active }` → `{ ok }` |

### 23.5 OAuth (públicas) e `state`

`oauth_states` (migração `20261002120000`): `state` = 32 bytes aleatórios, guardado só como hash SHA-256, validade 15 min, **uso único** (consumo por `DELETE`), preso a canal + empresa + usuário que iniciou (no retorno ele ainda precisa ser owner|admin). Tokens vão para o cofre (cifrado).
- `GET /api/public/meta/oauth/callback?code&state` → `302 {APP_URL}/integrations?meta=conectado` ou `?meta_erro=<msg>` (`retorno_incompleto`, "Assinatura do retorno inválida.", "O login expirou. Tente de novo.", mensagem do Facebook).
- `GET /api/public/ads/oauth/:channel` (`google`: `code`; `tiktok`: `auth_code`) → `302 {APP_URL}/integrations?ads=<canal>` ou `?ads_erro=<msg>` (`canal_invalido`, `retorno_incompleto`, …). O destino sai de `APP_URL`, nunca do Host.

### 23.6 Cron — `POST /api/public/cron/ads`

`x-cron-secret` = `CRM_CRON_SECRET` ou `cron_tokens.name='ads'` (tempo constante), senão `401 "Unauthorized"`. Corpo `{ task?: sync\|rules }` (outro valor `400`). `sync` (sempre): 3 dias de cada empresa com campanha em algum canal → `{ sync:[{workspace, rows?, error?}] }`; `rules` acrescenta `{ rules:[{campaign, actions?\|error?}] }` (pausa anúncio caro/sem lead com irmão ativo; escala conjunto barato +passo% até o teto, no máx. 1×/24 h; cada ação vira `ai_recommendations` `source='rule'`). Heartbeat depois: `ads-sync` / `ads-rules`. Jobs do agendador: `ads-insights-3h` `17 */3 * * *` (`ads-sync`) e `ads-rules-daily` `40 12 * * *` (`ads-rules`), UTC.

## 24. CRM núcleo — `/v1/workspaces/:workspaceId/crm/*`, formulário público e descadastro

Módulo `api/src/modules/crm`. Todas as rotas de workspace: membro obrigatório; **GET = leitura (viewer pode), o resto = escrita (owner\|admin\|marketing)**; toda id (lead, etapa, funil, tarefa, responsável) é conferida contra o workspace da URL → outra empresa = `404` ("Lead não encontrado." / "Etapa não encontrada." / "Funil não encontrado." / "Tarefa não encontrada."); responsável precisa ser membro (`400` "Responsável inválido para este workspace."). Cada leitura garante os padrões do CRM (funil de 8 etapas, motivos, tags, `crm_settings`). Linhas em snake_case, datas ISO, `estimated_value` number.

### 24.1 Funis, etapas, usuários

| rota | corpo → resposta |
|---|---|
| `GET /crm/pipelines` | `[{ id, name, is_default }]` (por `created_at`) |
| `GET /crm/stages?pipeline_id=` | `[{ id, name, color, position, sla_hours, is_won, is_lost, pipeline_id }]` por `position` (`pipeline_id` opcional; malformado `400`) |
| `POST /crm/stages` | `{ pipeline_id, name, position?, color?, sla_hours? }` → etapa |
| `PATCH /crm/stages/:id` | `{ name?, color?, position?, sla_hours? }` → etapa |
| `DELETE /crm/stages/:id` | `204`; leads da etapa ficam sem etapa (FK `SET NULL`) |
| `GET /crm/members` | `[{ user_id, role, profiles: { id, full_name, email } \| null }]` |

### 24.2 Leads

| rota | corpo → resposta |
|---|---|
| `GET /crm/leads?pipeline_id=` | todas as colunas de `crm_leads`, `created_at` desc, sem paginação |
| `GET /crm/leads/:id` | lead (`404` se não for do workspace) |
| `POST /crm/leads` | `{ name, pipeline_id?, stage_id?, phone?, email?, city?, source? }` → lead (`400` "Informe o nome do lead.") |
| `POST /crm/leads/import` | `{ pipeline_id?, stage_id?, rows:[{ name, phone?, email?, city? }] }` → `{ imported }`, `source='import'`, um insert só. **Teto 5000 linhas**: `400` "Arquivo grande demais: importe no máximo 5000 leads por vez (o arquivo tem N)." |
| `POST /crm/leads/bulk` | `{ ids[] (≤5000), stage_id? \| owner_id? (null desatribui) \| add_tag? }` → `{ updated }`. Atômico; qualquer id de outro workspace → `404` e nada muda; sem ação `400` "Nada para aplicar.". Mover em massa grava só `stage_id`+`stage_entered_at` (sem histórico, como o protótipo); a tag é união com as do lead |
| `PATCH /crm/leads/:id` | `{ stage_id?, stage_entered_at?, owner_id?, ai_active?, last_interaction_at?, tags? }` (só estes campos; trocar a etapa por aqui **não** grava histórico — comportamento do protótipo) |
| `POST /crm/leads/:id/move` | `{ stage_id }` → `{ moved, lead, stage_name }`. **Uma transação**: lead (`stage_id`, `stage_entered_at`) + `crm_stage_history` (de → para, `moved_by`) + interação `stage_change` "Movido para {etapa}." (`author_id` = usuário). Mesma etapa → `moved:false`, nada gravado |
| `GET /crm/leads/:id/interactions` · `POST` `{ content }` | timeline (desc) · nota (`note`/`user`) + `last_interaction_at`, na mesma transação |
| `POST /crm/leads/:id/ai` | `{ active }` → lead; alterna `ai_active` e grava a nota "Atendimento assumido por humano (IA pausada)." / "Conversa devolvida para a IA." |
| `GET /crm/leads/:id/tasks` · `POST` `{ title, due_at? }` | tarefas por `due_at` · cria (vence em +24 h por padrão) |

### 24.3 Tarefas, Indicadores, configurações

| rota | corpo → resposta |
|---|---|
| `GET /crm/tasks` | `[{ id, title, due_at, status, lead_id, crm_leads: { name } \| null }]` por `due_at` (todas do workspace) |
| `PATCH /crm/tasks/:id` | `{ status: open\|done\|canceled }` |
| `GET /crm/stage-history` | `[{ lead_id, from_stage_id, to_stage_id, created_at }]` (todas, por `created_at`) |
| `GET /crm/interactions` | `[{ lead_id, kind, author_type, created_at }]` (todas) |
| `GET /crm/cadence-options` | `[{ id, name }]` por nome (seletor "Incluir em cadência…") |
| `GET /crm/cadence-metrics` | `{ cadences[{id,name,steps}], events, runs, stages[{id,name}], history, messages[{id,status}] }` (mensagens só dos 1000 primeiros ids dos eventos) |
| `GET /crm/settings` · `PUT` | `crm_settings` · `{ distribution: round_robin\|fixed, default_owner_id? }` (upsert) |
| `GET/POST /crm/loss-reasons` · `DELETE /:id` | `[{ id, name }]` por nome · `{ name }` · `204` |
| `GET/POST /crm/tags` · `DELETE /:id` | `[{ id, name, color }]` · `{ name, color? }` (`409` "Essa tag já existe.") · `204` |

### 24.4 Ação da Meta usada pelo Kanban — `POST /v1/crm-integrations/notify-meta-conversion`

`{ workspaceId, leadId, event: "Qualificado"\|"Ganho" }` → `{ sent: true }` \| `{ sent: false }` (falha da Meta) \| `{ skipped: true }` (sem integração `meta_lead_ads` conectada ou lead que não é do workspace). Acesso: **escrita** (viewer `403`). API de Conversões: `POST /{pixel_id}/events` com e-mail/telefone em SHA-256, `action_source system_generated`, valor em BRL. Vive em `modules/ads` (as demais ações `/v1/crm-integrations/*` e `/v1/crm-cadences/*` são da Task 8).

### 24.5 Rotas públicas (sem JWT; mesmo caminho via rewrite do web)

- `OPTIONS|GET|POST /api/public/forms/:token` — `token` = `crm_integrations.webhook_token` (`kind=site_form`, status ≠ `disconnected`). CORS `*` (preflight liberado só nesse prefixo). `GET`: HTML (`no-store`, embutível em iframe de outros sites). `POST` (JSON, urlencoded ou multipart): `name/nome`, `email`, `phone/telefone/whatsapp/celular`, `message`, `utm_*`, `page`, `_t`, `website`. `200 {ok:true, redirect}`; `303 Location` se não for JSON e houver `redirect_url`; `400 {error:"Dados inválidos."}` / "Informe um e-mail válido ou um telefone."; `404 {error:"Formulário não encontrado."}`; `429 "Muitos envios seguidos. Tente de novo em alguns minutos."`; `500 "Não foi possível enviar agora."`. Anti-spam: honeypot `website` preenchido → `200` sem gravar; `_t` é obrigatório só quando o corpo traz a chave `website` (formulário servido por nós) e, se presente, deve ser numérico, não futuro e ≥ 2,5 s (senão `200` sem gravar); envios externos (RD Station, Typeform, Elementor) sem `website` nem `_t` são aceitos; **5 envios / 10 min por IP** (hash `sha256(integrationId:ip)`; IP = `request.ip` do Fastify — só confia em `X-Forwarded-For` conforme `TRUST_PROXY`: produção = `1` — o rewrite do Next não anexa ao XFF, o peer é o Next, o nginx define o XFF e a porta da API não é pública). Lead novo: origem `site`, LGPD, etapa inicial + histórico + interação, cadência por origem; repetido (telefone/e-mail) só registra a interação. `redirect_url`/`privacy_url` só http(s).
- `GET /api/public/forms/embed/:token` — JavaScript (`public, max-age=300`, CORS `*`) que injeta o iframe apontando para `APP_URL`; token fora de `[A-Za-z0-9_-]{1,200}` → `404`.
- `GET /api/public/unsubscribe/:leadId?t=` — HTML pt-BR "Pronto. Você não receberá mais nossos e-mails." ou "Link inválido ou expirado.". `t` = **HMAC-SHA256 completo (64 hex)** de `unsubscribe:v1:{workspaceId}:{leadId}` com `UNSUBSCRIBE_SECRET` (obrigatória fora de dev/test), comparação em tempo constante, workspace lido do próprio lead (assinatura de outro lead/empresa não vale; lead inexistente = "inválido"). Efeito: `unsubscribed=true`, `ai_active=false`, cadências paradas (`opt_out`) e interação `ai_action` (idempotente). Link = `UnsubscribeLinkService.link(workspaceId, leadId)` (`APP_URL`); a Task 8 usa na e-mail.
