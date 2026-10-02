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

