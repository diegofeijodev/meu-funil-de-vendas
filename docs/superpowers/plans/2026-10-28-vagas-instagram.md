# Stories automáticos das vagas do Freela — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cada vaga nova da vitrine pública do Freela vira, sozinha, um story no Instagram da empresa listada, com arte de IA no estilo
da arte modelo salva, conferida por leitura da imagem antes de ir ao ar.

**Architecture:** módulo novo `api/src/modules/vacancy-stories/` em duas partes, no molde de `CrmChannelsCoreModule`/`CrmChannelsModule`:
um núcleo `@Global` (leitura da vitrine + guarda de publicação, sem importar o Instagram) e o módulo da função (rotas, job de 10 min,
geração, conferência, quadro 1080×1920, horários). O story entra em `ig_posts` (`source='vacancy'`, `format='story_image'`,
`automation`/`plan_id`/`run_id` nulos) e sai pela fila de publicação que já existe; o Instagram ganha a porta `PUBLISH_ORIGIN_GUARDS`,
consultada antes de criar o container e quando a fila falha. Web: aba "Vagas" no Instagram e ajustes em Aprovações, editor e calendário.

**Tech Stack:** NestJS 11 + Prisma/PostgreSQL; jimp + opentype.js (`creative/compose.ts`); `AiService` (imagem: OpenAI `gpt-image-1`
ou Gemini; leitura: `json()` com imagem); Next 15 + TanStack Query + zod + sonner; jest com mundo em memória (`igWorld`); vitest no web.

**Spec:** `docs/superpowers/specs/2026-10-28-vagas-instagram-design.md` (design) e `docs/superpowers/specs/2026-10-28-vagas-instagram-ui.md`
(tela e textos). Quem executa lê os dois antes da primeira tarefa.

## Global Constraints

- **Máquina do dono (7,6 GB, trava fácil) — copiar este bloco no brief de cada subagente:**
  - Nunca `nest build`, `next build`, `npm run build`.
  - Todo jest, tsc, lint, smoke, migrate ou browser-check passa por `scripts/run-capped.sh <MB> …` (teto 1500 para jest/tsc/lint;
    smoke 1300; browser-check 2400 por grupo). Um processo pesado por vez. `free -m` antes. Saída 75 = sem memória agora: espere 2 min.
    Saída 137 = estourou o teto: reparta o comando, não suba o teto.
  - Jest só do arquivo que mexeu: `cd api && ../scripts/run-capped.sh 1500 npx jest <padrão>`. `typecheck` só na Task 16.
  - Mate processos pelo PID (`ss -ltnp | grep ':3015 '`), nunca `pkill -f`. Não toque em processos de outros projetos.
  - Nada de rede nos testes: fakes para `FREELA_VACANCIES_FETCH`, `AiService` e a Graph.
- **Git:** branch `feat/vagas-instagram`; `git add` sempre por caminho (nunca `-A`/`.`; `meu-funil/.claude/` nunca entra); nada de push.
  Mensagem em pt-BR no estilo do repo (`feat(vagas): …`) terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Contrato:** `docs/api-contract.md` §26 (Task 1) é a fonte das rotas. Mudou rota → muda o contrato no mesmo commit.
- Erros `{ error: { code, message } }` em pt-BR; id da URL por `ParseUuidPipe`; toda consulta filtra `workspace_id`.
- Wire snake_case; o controller devolve o objeto (o interceptor `common/http/wire.ts` converte Date/Decimal).
- IA só via `AiService`; arquivos só via `FilesService`/`AssetsService`; segredo nunca em log ou resposta.
- Fuso `America/Sao_Paulo` em todo texto de data/hora. Na arte: dia da semana + data, sem ano, **nunca "hoje"/"amanhã"**.
- Story 1080×1920; nada importante fora de y 250–1600.
- Selos do Google Play e da App Store: **arquivos oficiais das lojas** em `api/assets/badges/`, só redimensionados, nunca redesenhados.
- Fora da arte: nome com CPF/CNPJ, razão social, telefone, e-mail, URL, endereço, região, descrição, link.
- Textos de tela: exatamente os do arquivo de UI (§1, §3, §4), com os valores reais no lugar dos exemplos.
- Flag/variável nova: `common/config/env.validation.ts` + `api/.env.example` + `docker-compose.yml` (raiz). O `docker-compose.prod.yml`
  lê o `.env` do servidor (`env_file: .env`): não precisa mudar.

## Decisões de construção (fechadas aqui; o design deixou para quem constrói)

- **D1 Marca:** `brand_assets.brand_id` é NOT NULL. No envio da arte modelo: `settings.brand_id` ou, se nulo, a marca mais antiga da
  empresa (`created_at asc`). Sem marca → 400 `"Cadastre uma marca em Marcas antes de enviar a arte modelo."`
- **D2 Rótulos genéricos** (podem aparecer na arte mesmo vindo do modelo; comparação por `norm()`): `vaga`, `vaga freela`, `freela`,
  `freelancer`, `freela servicos`, `servicos`, `estabelecimento`, `funcao`, `data`, `horario`, `quando`, `onde`, `cidade`, `valor`,
  `valor para o freela`, `baixe nosso app`, `e confira esta e outras oportunidades`. Todo outro texto lido do modelo no envio é proibido
  na arte gerada, salvo se for igual (por `norm`) a um valor esperado da vaga. Proibidos sempre: rótulos `endereco`, `regiao`,
  `descricao`, `bairro`; `http`, `www`, `.com`; `google play`, `app store`.
- **D3 Conferência só da arte:** a leitura recebe o quadro final **cortado em y < 1360** (`CHECK_CROP_BOTTOM`), sem o rodapé do sistema —
  senão os selos oficiais ("Google Play", "App Store") reprovariam toda arte.
- **D4 Geometria:** arte inteira (sem corte) encaixada na caixa `ART_BOX` y 250–1350 × x 0–1080, centralizada; rodapé em y 1370–1600;
  o resto na `template_bg`. 2:3 vira 733×1100. Testar num celular real fica para o dono (aviso na entrega).
- **D5 "Não postar" com Desfazer:** o web segura a chamada por 6 s (toast com "Desfazer"); só depois chama a API. Sem estado novo no
  servidor. Os chips de motivo chamam a mesma rota de novo com `feedback` (idempotente).
- **D6 Rejeitar story de vaga:** rota própria `POST …/vacancy-stories/stories/:id/dont-post` (sem motivo obrigatório);
  `RejectPostDto` não muda.
- **D7 Aba existe?** O web consulta `GET …/vacancy-stories/settings` com `retry: false`; 404 → sem aba e `?tab=vagas` cai em "Visão
  geral". O `http.ts` não mostra toast (conferido), então o 404 é silencioso.
- **D8 Origem da mídia:** `media_assets.source` = `chatgpt` (OpenAI) ou `gemini`; reserva sem IA = `source 'other'`, `provider 'sistema'`
  (o `isMockMedia` só barra `mock`/picsum). `ingest` com `normalize: false` e `targetFormat: 'ig_story'` (1080×1920 passa na validação).
- **D9 Erro de IA:** `image()` sempre com `strict: true` (mantém o `VendorKeyError`). Qualquer exceção de `image()`/`json()`/decodificação
  = erro de IA: não conta como refação, espera 5 → 15 → 45 min (depois fica em 45), grava o motivo. `settings.ai_error`/`ai_error_at`
  guardam a última falha para o aviso vermelho; um story entregue limpa os dois.
- **D10 Guarda no núcleo, agenda no módulo:** `VacancyGuardService` (núcleo, sem `PublishingService`) implementa a porta; o
  `afterApproval` dele chama um callback que o `VacancySchedulerService` registra no `onModuleInit` (`guard.onApproved = …`). Sem ciclo.
- **D11 Refações por mudança da vaga:** `redo_count` ≤ 3 (vale para "Refazer a arte" e para "a vaga mudou"). Passou → linha `failed`
  com `"A vaga mudou muitas vezes no Freela. Crie o story de novo quando ela estiver definida."`.
- **D12 Log curto no post:** `ig_posts.ai_generation_log` recebe só um resumo por tentativa `{ at, step:'vacancy_art', attempt, ok,
  wrong:string[], fallback:boolean }` (o detalhe fica em `vacancy_stories.attempts_log`). Mantém `GET /ig-posts` leve com ~300 stories/mês.
- **D13 Smoke:** cobre rotas, envio da arte, ligar, consulta + triagem com vitrine falsa (`fake-providers.mjs`). Geração/conferência
  ficam no jest (o `fake-ai` não sabe ler arte). No smoke/browser-check a lista vale `*` (só aceito em NODE_ENV development|test).
- **D14 Calendário:** stories de vaga escondidos por padrão, com a caixa "Mostrar stories das vagas ({n})" quando existir algum.
- **D15 Prévia:** roda em segundo plano (promessa no processo; a API é uma instância só); o estado fica em `settings.preview`. Nova
  prévia com outra em andamento há < 10 min → 409 `"Já existe uma prévia sendo criada."`.
- **D16 `vacancy_template` fora do `ASSET_KINDS` do DTO:** a arte modelo só entra pela rota `POST …/vacancy-stories/template` (que
  valida tipo e tamanho no servidor). A rota genérica de arquivos de marca continua recusando esse `kind`; em Marcas ela só aparece
  com o rótulo "Arte modelo de vaga". Apagar a arte em Marcas zera `template_asset_id` (FK SET NULL) e o job desliga a função.

## Review Focus

1. **Turno que cruza a meia-noite e data em Brasília:** `startTime 2026-10-30T01:00:00Z`, `endTime 2026-10-30T06:00:00Z` →
   `"Qui, 29/10"` e `"22h às 3h"` (a data é a de Brasília, não a UTC). Teste na Task 2.
2. **Arte modelo sem texto legível ou deitada:** texto vazio salva (`template_texts = []`); deitada salva com aviso `landscape`.
   Testes na Task 7.
3. **Vaga que muda duas vezes / "Refazer a arte" repetido:** teto D11, sem laço infinito de geração. Testes nas Tasks 10 e 11.
4. **Empresa sem marca:** 400 com texto de D1, nada gravado. Teste na Task 7.
5. **Vitrine fora do ar na hora de publicar:** o post não sai, a fila não gasta tentativa e volta em 10 min; vitrine fora na consulta
   grava `last_poll_error` sem derrubar o job. Testes nas Tasks 6 e 8.

---

## Mapa de arquivos

API (`api/src/modules/vacancy-stories/`):

| Arquivo | Responsabilidade |
|---|---|
| `vacancy-types.ts` | Tipos `FreelaVacancy`, `VacancyFields`, `ExpectedValues`, `ArtCheck`, `AttemptLog`, linhas |
| `vacancy-env.ts` | `parseVacancyWorkspaces` |
| `vacancy-text.ts` | Limpeza e formatação puras (função, estabelecimento, datas, valor, assinatura, cidade) |
| `vacancy-feed.ts` | Porta `FREELA_VACANCIES_FETCH`, `VacancyFeedClient`, `FeedDownError` |
| `vacancy-triage.ts` | Triagem pura (teste, valor, cidade, antecedência) |
| `vacancy-verify.ts` | Esquemas de leitura e comparação pura `compareArt` |
| `vacancy-prompts.ts` | Prompts da arte, da foto da reserva e da leitura do modelo |
| `vacancy-art.ts` | Selos, quadro 1080×1920, corte da conferência, cor de borda, reserva |
| `vacancy-slots.ts` | Horário puro (janela, espaçamento, dia de Brasília) |
| `vacancy-display.ts` | Situação da lista + textos de motivo (puro) |
| `vacancy-gate.service.ts` | Lista de empresas (`VacancyGate`, `VacancyGateGuard`) |
| `vacancy-guard.service.ts` | Núcleo: implementa `PublishOriginGuard` |
| `vacancy-settings.service.ts` | Ajustes, arte modelo, ligar/desligar, postar sozinho, `view` |
| `vacancy-poll.service.ts` | Consulta, triagem gravada, expiração, varredura de lease |
| `vacancy-generator.service.ts` | Arte (tentativas, conferência, reserva), entrega do post |
| `vacancy-scheduler.service.ts` | Próximo horário livre, limite, agendar, aprovados, reconciliação |
| `vacancy-actions.service.ts` | Lista, detalhe, não postar, postar agora, criar mesmo assim, refazer |
| `vacancy-preview.service.ts` | Prévia em segundo plano |
| `vacancy-stories-cron.service.ts` + `vacancy-stories-cron.controller.ts` | Job `vacancy-stories-10min` + `POST /api/public/cron/vacancy-stories` |
| `vacancy-stories.controller.ts` / `.dto.ts` / `.module.ts` | Rotas, DTOs, `VacancyStoriesCoreModule` + `VacancyStoriesModule` |
| `__tests__/*.spec.ts` | Um spec por arquivo de lógica + `world.ts` (fakes) |

Outros: `api/assets/badges/` (selos + `NOTICE.md`), `instagram/origin-guards.ts` (porta), mudanças pontuais em `ig-store.service.ts`,
`publishing.service.ts`, `instagram-actions.service.ts`, `media-generation.service.ts`, `autopilot.service.ts`, `instagram.module.ts`,
`creative/compose.ts` (exportar `rect`), `scheduler/job-schedules.ts`, `app.module.ts`, Prisma, env.

Web: `web/src/modules/vacancy-stories/infrastructure/vacancy-stories.api.ts`, `web/src/lib/vacancy-stories.ts` (+ `.test.ts`),
`web/src/components/instagram/vacancies/*`, mudanças em `InstagramPage.tsx`, `app-shell.tsx`, `approvals.tsx`, `post-editor.tsx`,
`calendar.tsx`, `BrandDetail.tsx`.

---

### Task 1: Fundação — contrato, variáveis, tabelas e mundo de teste

**Files:**
- Modify: `docs/api-contract.md` (nova §26, depois da §25)
- Modify: `api/src/common/config/env.validation.ts`, `api/.env.example`, `docker-compose.yml`
- Create: `api/src/modules/vacancy-stories/vacancy-env.ts`
- Modify: `api/prisma/schema.prisma`; Create: `api/prisma/migrations/20261028120000_vacancy_stories/migration.sql`
- Modify: `api/src/modules/instagram/__tests__/harness.ts`
- Test: `api/src/modules/vacancy-stories/__tests__/env.spec.ts`

**Interfaces:**
- Produces: `parseVacancyWorkspaces(raw: string | undefined, nodeEnv: string | undefined): '*' | Set<string>`;
  `Env.VACANCY_STORIES_WORKSPACE_IDS: string` (padrão `''`), `Env.FREELA_PUBLIC_API_URL?: string`; modelos Prisma
  `vacancy_story_settings` e `vacancy_stories` (campos abaixo); `igWorld().t` com `vacancy_story_settings`, `vacancy_stories`,
  `brand_assets`; `IgTable.createMany({ data, skipDuplicates: true })` pula linha que viola a chave única e devolve só as inseridas.

- [ ] **Step 1: Contrato §26** — escrever em `docs/api-contract.md`:

  `## 26. Stories das vagas do Freela — /v1/workspaces/:workspaceId/vacancy-stories/*` · só empresas de
  `VACANCY_STORIES_WORKSPACE_IDS` (fora da lista: 404 `NOT_FOUND` "Página não encontrada." em toda rota) · `WorkspaceAccessGuard`
  (GET = read, resto = write) · `manage` = enable/disable/auto-publish.

  | Rota | Nível | Corpo | Resposta |
  |---|---|---|---|
  | `GET settings` | read | — | `VacancySettingsView` (Task 7) |
  | `PATCH settings` | write | `{ cities?: string[]≤50, daily_cap?: 1..20, window_start?: "HH:MM", window_end?: "HH:MM", min_lead_minutes?: 60\|120\|240\|360, vendor?: "openai"\|"gemini" }` | view; 400 "O início precisa ser antes do fim." |
  | `POST enable` | manage | — | view; 400 "Envie a arte modelo para poder ligar." |
  | `POST disable` | manage | — | `{ ok: true, cancelled: number }` |
  | `POST auto-publish` | manage | `{ auto_publish: boolean }` | view |
  | `POST template` | write | multipart `file` (PNG/JPG/WEBP, ≤ 10 MB) | view + `warning: "landscape" \| null` |
  | `POST preview` | write | — | `{ ok: true }` (segundo plano); 409 se outra em andamento |
  | `GET stories?filter=all\|live\|not_posted` | read | — | `StoryView[]` (100 mais novas) |
  | `GET stories/:id` | read | — | `StoryDetail` |
  | `POST stories/:id/dont-post` | write | `{ feedback?: "texto_errado"\|"foto_estranha"\|"nao_divulgar" }` | `{ ok: true }` |
  | `POST stories/:id/post-now` | write | — | `{ ok: true }` |
  | `POST stories/:id/create-anyway` | write | — | `{ ok: true }` |
  | `POST stories/:id/redo` | write | — | `{ ok: true }` |

  Mais: `POST /api/public/cron/vacancy-stories` (`x-cron-secret` = `CRM_CRON_SECRET` ou `cron_tokens.name='vacancy-stories'`; 401 sem);
  job `vacancy-stories-10min` (`*/10 * * * *`, heartbeat `vacancy-stories`); aprovar = `POST /v1/instagram/approve-post` de sempre (o
  story é agendado na hora); fonte = `GET {FREELA_PUBLIC_API_URL}/v1/bars-restaurants/public/vacancies/recent?limit=24` e `…/:id`
  (envelope `{ data }`, vaga fechada = 404). Na §22: post de vaga (`source='vacancy'`) recusa `generate-post-assets`/`regenerate-media`
  ("Story de vaga: use Refazer a arte na aba Vagas."); "Publicar agora" num post não aprovado não grava `failed`.

- [ ] **Step 2: Variáveis** — em `env.validation.ts`: `VACANCY_STORIES_WORKSPACE_IDS: z.string().default('')` e
  `FREELA_PUBLIC_API_URL: opt()` (comentário: "Só testes: vitrine falsa. Só vale em development/test; em produção é sempre
  `https://api.freelaservicosapp.com.br`"). No `superRefine`, chamar `parseVacancyWorkspaces` e virar a exceção em issue do campo.
  `.env.example`: `# VACANCY_STORIES_WORKSPACE_IDS=   # ids (uuid) das empresas com stories de vagas, separados por vírgula`.
  `docker-compose.yml`: `VACANCY_STORIES_WORKSPACE_IDS: ${VACANCY_STORIES_WORKSPACE_IDS:-}` e `FREELA_PUBLIC_API_URL: ${FREELA_PUBLIC_API_URL:-}`.

- [ ] **Step 3: Teste que falha** — `env.spec.ts`:

```ts
it('lista de uuids vira Set; vazia = nenhuma empresa', () => {
  expect(parseVacancyWorkspaces('', 'production')).toEqual(new Set());
  expect(parseVacancyWorkspaces(` ${A} , ${B} `, 'production')).toEqual(new Set([A, B]));
});
it('* só em development/test', () => {
  expect(parseVacancyWorkspaces('*', 'test')).toBe('*');
  expect(() => parseVacancyWorkspaces('*', 'production')).toThrow(/VACANCY_STORIES_WORKSPACE_IDS/);
});
it('id inválido derruba a subida', () => expect(() => parseVacancyWorkspaces('abc', 'production')).toThrow(/abc/));
it('harness: createMany com skipDuplicates respeita a chave única', async () => {
  const w = igWorld();
  const row = { workspace_id: WS_A, source: 'freela', external_id: 'x', fingerprint: 'f', snapshot: {}, starts_at: new Date() };
  expect(await w.prisma.vacancy_stories.createMany({ data: [row, row], skipDuplicates: true })).toEqual({ count: 1 });
  expect(w.t.vacancy_stories!.rows).toHaveLength(1);
});
```

- [ ] **Step 4:** rodar `cd api && ../scripts/run-capped.sh 1500 npx jest vacancy-stories/__tests__/env` → FAIL (módulo inexistente).
- [ ] **Step 5: Implementar** `parseVacancyWorkspaces` (vírgula, `trim`, `isUuid` de `common/ids/uuid`; mensagem
  `VACANCY_STORIES_WORKSPACE_IDS inválido: "<item>" não é um id de empresa.`) e o `skipDuplicates` no `IgTable.createMany` (só quando
  `this.unique` existe). Tabelas no `igWorld`: `vacancy_story_settings: new IgTable(defaults, ['workspace_id'])`, `vacancy_stories:
  new IgTable(defaults, ['workspace_id','source','external_id'])`, `brand_assets: new IgTable(() => ({ kind: 'photo' }))`, com os
  mesmos padrões do schema abaixo.
- [ ] **Step 6: Schema Prisma** (nomes de coluna = wire):

  `vacancy_story_settings`: `workspace_id` (PK, FK workspaces cascade), `brand_id?` (FK brands SetNull), `enabled` (false),
  `enabled_at?`, `enabled_by?` (uuid), `template_asset_id?` (FK brand_assets SetNull), `template_texts String[] []`,
  `template_bg String?`, `template_landscape Boolean false`, `cities String[] []`, `daily_cap Int 10`, `window_start String "08:00"`,
  `window_end String "21:00"`, `min_lead_minutes Int 120`, `vendor String "openai"`, `auto_publish Boolean false`, `last_poll_at?`,
  `last_poll_ok_at?`, `last_poll_error?`, `recent_cities Json "[]"`, `preview Json "{}"`, `ai_error?`, `ai_error_at?`, `created_at`,
  `updated_at`.

  `vacancy_stories`: `id` (uuid), `workspace_id` (FK cascade), `source String "freela"`, `external_id`, `status String "new"`,
  `skip_reason?`, `wait_reason?`, `snapshot Json`, `fingerprint`, `starts_at Timestamptz`, `template_asset_id?` (uuid, sem FK),
  `lease_until?`, `next_attempt_at?`, `not_before?`, `forced Boolean false`, `post_now Boolean false`, `mismatch_attempts Int 0`,
  `ai_error_count Int 0`, `redo_count Int 0`, `attempts_log Json "[]"`, `used_fallback Boolean false`, `feedback?`,
  `ig_post_id? @unique` (FK ig_posts SetNull), `created_at`, `updated_at`; `@@unique([workspace_id, source, external_id])`,
  `@@index([status, starts_at])`. Relações inversas em `workspaces`, `brands`, `brand_assets`, `ig_posts`.
- [ ] **Step 7: Migração** — Postgres local: `docker compose up -d postgres` (raiz). Em `api/`:
  `../scripts/run-capped.sh 1500 npx prisma migrate dev --create-only --name vacancy_stories`, renomear a pasta para
  `20261028120000_vacancy_stories` e acrescentar no SQL (comentário de cabeçalho no estilo das migrações anteriores):
  CHECKs `vacancy_story_settings_daily_cap_check (daily_cap BETWEEN 1 AND 20)`, `…_vendor_check (vendor IN ('openai','gemini'))`,
  `…_lead_check (min_lead_minutes IN (60,120,240,360))`, `…_window_check (window_start ~ '^\d{2}:\d{2}$' AND window_end ~ '^\d{2}:\d{2}$'
  AND window_start < window_end)`, `vacancy_stories_status_check (status IN ('new','skipped','waiting','generating','handed_off',
  'failed','expired','cancelled'))`; gatilhos `touch_updated_at` nas duas tabelas. Aplicar com `npx prisma migrate deploy` e
  `npx prisma generate` (ambos por `run-capped.sh 1500`). Se pendurar, `prisma migrate status` e matar pelo PID.
- [ ] **Step 8:** rodar o jest do Step 4 → PASS; e `../scripts/run-capped.sh 1500 npx jest instagram/__tests__/production` → PASS
  (o harness não quebrou).
- [ ] **Step 9: Commit** — `git add docs/api-contract.md api/src/common/config/env.validation.ts api/.env.example docker-compose.yml
  api/src/modules/vacancy-stories/vacancy-env.ts api/src/modules/vacancy-stories/__tests__/env.spec.ts api/prisma/schema.prisma
  api/prisma/migrations/20261028120000_vacancy_stories api/src/modules/instagram/__tests__/harness.ts` → `feat(vagas): contrato, variáveis e tabelas dos stories das vagas`.

---

### Task 2: Texto da vaga — limpeza e formatação (puro)

**Files:**
- Create: `api/src/modules/vacancy-stories/vacancy-types.ts`, `api/src/modules/vacancy-stories/vacancy-text.ts`
- Test: `api/src/modules/vacancy-stories/__tests__/vacancy-text.spec.ts`

**Interfaces:**
- Produces (`vacancy-types.ts`): `FreelaVacancy = { id: string; title: string | null; serviceType: string | null; city: string | null;
  date: string | null; startTime: string; endTime: string; amountInCents: number | null; contractorName: string | null;
  publishedAt: string; isUpcoming?: boolean }`; `ExpectedValues = { cents: number; day: number; month: number; startMin: number;
  endMin: number }`; `VacancyFields = { funcao: string; estabelecimento: string | null; data: string; horario: string; valor: string;
  cidade: string; expected: ExpectedValues }`.
- Produces (`vacancy-text.ts`): `norm(s: string | null | undefined): string`; `isTestText(s: string | null | undefined): boolean`;
  `cleanFunction(title: string | null, serviceType: string | null): string`; `cleanEstablishment(name: string | null): string | null`;
  `spParts(iso: string): { weekday: number; day: number; month: number; minutes: number }`; `hourLabel(minutes: number): string`;
  `formatWhen(startIso: string, endIso: string): { data: string; horario: string }`; `formatMoney(cents: number): string`;
  `fingerprint(v: FreelaVacancy): string`; `cityMatches(city: string | null, cities: string[]): boolean`;
  `leadLabel(minutes: number): string`; `vacancyFields(v: FreelaVacancy): VacancyFields`; `shortDay(iso: string): string` ("Qui 29/10").

- [ ] **Step 1: Testes que falham** (`vacancy-text.spec.ts`; valores conferidos no calendário: 29/10/2026 é quinta):

```ts
it('norm tira acento, maiúscula e pontuação', () => expect(norm('  Garçom/Bar-Man! ')).toBe('garcom bar man'));
it('teste no nome ou título', () => {
  expect(isTestText('Enzo teste fernandes ltda')).toBe(true);
  expect(isTestText('TESTES')).toBe(true);
  expect(isTestText('Contestado Bar')).toBe(false);
});
it('função: título limpo; vazio/longo cai no serviceType', () => {
  expect(cleanFunction('Garçom', 'garcom')).toBe('Garçom');
  expect(cleanFunction('Garçom (11) 99999-8888 a@b.com http://x.co', null)).toBe('Garçom');
  expect(cleanFunction('', 'lavagem-de-loucas')).toBe('Lavagem de louças');
  expect(cleanFunction('x'.repeat(41), 'auxiliar-de-cozinha')).toBe('Auxiliar de cozinha');
  expect(cleanFunction(null, 'monitor-infantil')).toBe('Monitor infantil');
});
it('estabelecimento: sai com CPF/CNPJ, razão social, teste, nulo; caixa alta vira título com siglas', () => {
  expect(cleanEstablishment('GENILSON FERREIRA DA SILVA 26385530850')).toBeNull();
  expect(cleanEstablishment('Bar 12.345.678/0001-90')).toBeNull();
  expect(cleanEstablishment('KNK ALIMENTACAO LTDA')).toBeNull();
  expect(cleanEstablishment('Padaria S/A')).toBeNull();
  expect(cleanEstablishment('Enzo teste fernandes')).toBeNull();
  expect(cleanEstablishment(null)).toBeNull();
  expect(cleanEstablishment('COCO BAMBU CAMPINAS SHOPPING')).toBe('Coco Bambu Campinas Shopping');
  expect(cleanEstablishment('BAR DO ZE BBQ')).toBe('Bar do Ze BBQ');
});
it('datas em Brasília, sem ano, horas cheias sem minutos', () => {
  expect(formatWhen('2026-10-29T14:30:00Z', '2026-10-30T00:00:00Z')).toEqual({ data: 'Qui, 29/10', horario: '11h30 às 21h' });
  expect(formatWhen('2026-10-31T21:00:00Z', '2026-11-01T02:00:00Z')).toEqual({ data: 'Sáb, 31/10', horario: '18h às 23h' });
});
it('Review Focus #1 — turno que cruza a meia-noite usa a data de Brasília', () =>
  expect(formatWhen('2026-10-30T01:00:00Z', '2026-10-30T06:00:00Z')).toEqual({ data: 'Qui, 29/10', horario: '22h às 3h' }));
it('valor', () => { expect(formatMoney(15000)).toBe('R$ 150'); expect(formatMoney(15250)).toBe('R$ 152,50'); expect(formatMoney(150000)).toBe('R$ 1.500'); });
it('assinatura muda com valor/horário e não com publishedAt', () => {
  const v = vac({ amountInCents: 10000 });
  expect(fingerprint(v)).toBe(fingerprint({ ...v, publishedAt: '2030-01-01T00:00:00Z' }));
  expect(fingerprint(v)).not.toBe(fingerprint({ ...v, amountInCents: 12000 }));
});
it('cidade sem acento/maiúscula; lista vazia = todas', () => {
  expect(cityMatches('Jundiaí', ['jundiai'])).toBe(true);
  expect(cityMatches('Campinas', [])).toBe(true);
  expect(cityMatches('Campinas', ['Jundiaí'])).toBe(false);
});
it('vacancyFields junta tudo e os valores esperados', () =>
  expect(vacancyFields(vac({ title: 'Garçom', amountInCents: 15000, startTime: '2026-10-31T21:00:00Z', endTime: '2026-11-01T02:00:00Z', city: 'Campinas', contractorName: 'COCO BAMBU' })))
    .toEqual({ funcao: 'Garçom', estabelecimento: 'Coco Bambu', data: 'Sáb, 31/10', horario: '18h às 23h', valor: 'R$ 150', cidade: 'Campinas',
      expected: { cents: 15000, day: 31, month: 10, startMin: 1080, endMin: 1380 } }));
```
  (`vac(over)` = fábrica local de `FreelaVacancy` com valores válidos.)

- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest vacancy-text` → FAIL.
- [ ] **Step 3: Implementar.** Regras: datas com `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', … })`; dias
  `['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']`; "às" entre as horas (`"18h às 23h"`). Função: tirar telefone
  (`\(?\d{2}\)?\s?\d{4,5}-?\d{4}`), e-mail, URL, espaços duplos; vazio ou > 40 → mapa curto de `serviceType` (`garcom→Garçom`,
  `lavagem-de-loucas→Lavagem de louças`, `auxiliar-de-cozinha→Auxiliar de cozinha`, `auxiliar-de-limpeza→Auxiliar de limpeza`,
  `monitor-infantil→Monitor infantil`, `hostess→Hostess`, `cozinheiro→Cozinheiro`, `barman→Barman`, `copeiro→Copeiro`,
  `maitre→Maître`, `seguranca→Segurança`), senão hífen → espaço e 1ª letra maiúscula. Estabelecimento: 11 ou 14 dígitos (com ou sem
  pontuação) → nulo; sufixo `LTDA|ME|EPP|EIRELI|S\.?A\.?|S/A` no fim → nulo; MAIÚSCULAS → Título, palavras de até 3 letras **só
  consoantes ou já siglas conhecidas** continuam maiúsculas e preposições `da|de|do|das|dos|e` ficam minúsculas (o teste fixa
  `BBQ`, `do`). Assinatura = `sha1(JSON.stringify([title ?? serviceType, startTime, endTime, amountInCents, contractorName, city]))`.
  `leadLabel`: 60→`1 h`, 120→`2 h`, 240→`4 h`, 360→`6 h`. `hourLabel(690)` = `11h30`, `hourLabel(1080)` = `18h`.
- [ ] **Step 4:** rodar o jest → PASS.
- [ ] **Step 5: Commit** — `git add api/src/modules/vacancy-stories/vacancy-types.ts api/src/modules/vacancy-stories/vacancy-text.ts
  api/src/modules/vacancy-stories/__tests__/vacancy-text.spec.ts` → `feat(vagas): limpeza e formatação dos dados da vaga`.

---

### Task 3: Vitrine do Freela e triagem

**Files:**
- Create: `api/src/modules/vacancy-stories/vacancy-feed.ts`, `api/src/modules/vacancy-stories/vacancy-triage.ts`
- Test: `api/src/modules/vacancy-stories/__tests__/feed-triage.spec.ts`

**Interfaces:**
- Consumes: `FreelaVacancy`, `isTestText`, `cityMatches`, `leadLabel`, `hourLabel`, `spParts` (Task 2).
- Produces: `FREELA_VACANCIES_FETCH = Symbol('FREELA_VACANCIES_FETCH')`, `type FreelaFetch = (url: string, init?: RequestInit) =>
  Promise<Response>`; `class FeedDownError extends Error`; `@Injectable() class VacancyFeedClient { recent(): Promise<FreelaVacancy[]>;
  byId(id: string): Promise<FreelaVacancy | null> }` (base = `overrideBase(env, env.FREELA_PUBLIC_API_URL,
  'https://api.freelaservicosapp.com.br')`; `recent` = `…/v1/bars-restaurants/public/vacancies/recent?limit=24`; timeout 15 s; envelope
  `{ data }` validado com zod — item inválido é descartado, não derruba a lista; 404 em `byId` → `null`; rede/5xx/JSON ruim →
  `FeedDownError('Não conseguimos consultar as vagas do Freela.')`).
  `SKIP = { test: 'Parece vaga de teste: o nome da empresa tem “teste”.', testTitle: 'Parece vaga de teste: o título tem “teste”.',
  noValue: 'A vaga não tem valor informado.' }`;
  `triage(v: FreelaVacancy, s: { cities: string[]; min_lead_minutes: number }, now: Date): { status: 'new' } | { status: 'skipped';
  reason: string }` (ordem: teste no nome → teste no título → valor nulo/zero → cidade `Cidade fora da sua lista: {cidade}.` →
  antecedência `Começa às {hourLabel}, em menos de {leadLabel}. Não dá tempo de divulgar.`);
  `isAfterWatermark(v: FreelaVacancy, enabledAt: Date): boolean` (`publishedAt > enabledAt`).

- [ ] **Step 1: Testes que falham** — feed com fetch falso: `recent` devolve só itens válidos (um item sem `id` some); `byId` 404 → `null`;
  `byId` 500 → `FeedDownError`; fetch que lança → `FeedDownError`; URL chamada = `https://api.freelaservicosapp.com.br/v1/bars-restaurants/public/vacancies/recent?limit=24`
  com NODE_ENV `production` mesmo com `FREELA_PUBLIC_API_URL` definido, e a do override com NODE_ENV `test`. Triagem:

```ts
expect(triage(vac({ contractorName: 'Enzo teste fernandes ltda' }), S, NOW)).toEqual({ status: 'skipped', reason: SKIP.test });
expect(triage(vac({ title: 'Vaga Teste' }), S, NOW)).toEqual({ status: 'skipped', reason: SKIP.testTitle });
expect(triage(vac({ amountInCents: null }), S, NOW)).toEqual({ status: 'skipped', reason: SKIP.noValue });
expect(triage(vac({ city: 'Jundiaí' }), { ...S, cities: ['Campinas'] }, NOW)).toEqual({ status: 'skipped', reason: 'Cidade fora da sua lista: Jundiaí.' });
// NOW = 2026-10-29T15:00:00Z (12h em Brasília); começa 2026-10-29T18:00:00Z (15h), antecedência 240
expect(triage(vac({ startTime: '2026-10-29T18:00:00Z' }), { ...S, min_lead_minutes: 240 }, NOW))
  .toEqual({ status: 'skipped', reason: 'Começa às 15h, em menos de 4 h. Não dá tempo de divulgar.' });
expect(triage(vac(), S, NOW)).toEqual({ status: 'new' });
expect(isAfterWatermark(vac({ publishedAt: '2026-10-29T10:00:00Z' }), new Date('2026-10-29T10:00:01Z'))).toBe(false);
```
- [ ] **Step 2:** rodar `npx jest feed-triage` (via run-capped) → FAIL.
- [ ] **Step 3: Implementar** os dois arquivos conforme a interface.
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** — `git add` dos 3 arquivos → `feat(vagas): leitura da vitrine do Freela e triagem`.

---

### Task 4: Conferência da arte e prompts (puro)

**Files:**
- Create: `api/src/modules/vacancy-stories/vacancy-verify.ts`, `api/src/modules/vacancy-stories/vacancy-prompts.ts`
- Modify: `api/src/modules/vacancy-stories/vacancy-types.ts` (`ArtRead`, `FieldCheck`, `ArtCheck`, `AttemptLog`)
- Test: `api/src/modules/vacancy-stories/__tests__/verify.spec.ts`

**Interfaces:**
- Consumes: `VacancyFields`, `norm` (Task 2).
- Produces: `ArtRead = { textos: string[]; funcao: string | null; estabelecimento: string | null; data: string | null;
  inicio: string | null; fim: string | null; valor: string | null; cidade: string | null }`;
  `FieldKey = 'funcao' | 'valor' | 'data' | 'inicio' | 'fim' | 'cidade' | 'estabelecimento'`;
  `FieldCheck = { key: FieldKey; label: string; ok: boolean; read: string | null; expected: string | null }`;
  `ArtCheck = { ok: boolean; fields: FieldCheck[]; forbidden: string[]; hint: string | null }`;
  `AttemptLog = { n: number; at: string; kind: 'ai' | 'fallback_photo' | 'fallback_plain'; ok: boolean; wrong: FieldKey[];
  forbidden: string[]; error?: string }`.
  `READ_SCHEMA` (json schema com as chaves de `ArtRead`), `TEMPLATE_TEXTS_SCHEMA` (`{ textos: string[] }`), `GENERIC_LABELS` (D2),
  `ALWAYS_FORBIDDEN` (D2); `parseCents(s): number | null`, `parseDayMonth(s): { day: number; month: number } | null`,
  `parseMinutes(s): number | null`; `compareArt(read: ArtRead, f: VacancyFields, templateTexts: string[], opts?: { fieldsOnly?:
  false; forbiddenOnly?: boolean }): ArtCheck` (`forbiddenOnly` = reserva: só texto proibido conta).
  `vacancy-prompts.ts`: `artPrompt(f: VacancyFields, hint: string | null): string`, `photoPrompt(funcao: string): string`,
  `readPrompt(): string`, `templateReadPrompt(): string`.

- [ ] **Step 1: Testes que falham** — com os textos do exemplo do dono (lidos da arte `7ad4d1e9…jpeg`):

```ts
const TEMPLATE = ['freeLa serviços', 'VAGA', 'AUXILIAR DE LIMPEZA', 'FREELANCER', 'Estabelecimento:', 'Frutá Frozen Outlet Premium Itupeva',
  'Função:', 'Auxiliar de Limpeza', 'Data:', '28/10/2026', 'Horário:', '10:00 às 16:00', 'Região:', 'Rio abaixo, Itupeva', 'Endereço:',
  'Estrada Joaquim Bueno Neto, 9999, Rio abaixo, Itupeva/SP, 13299600', 'Valor para o freela:', 'R$ 95,95', 'Descrição:', 'Limpeza',
  'Ver vaga:', 'https://www.freelaservicosapp.com.br//freelancer/vagas/fdfa4ef5-d856-4be4-943c-6c0988c3e106', 'Frutá', 'FROZEN',
  'Baixe nosso app', 'Google Play', 'App Store'];
const F = { funcao: 'Garçom', estabelecimento: 'Coco Bambu', data: 'Sáb, 31/10', horario: '18h às 23h', valor: 'R$ 150', cidade: 'Campinas',
  expected: { cents: 15000, day: 31, month: 10, startMin: 1080, endMin: 1380 } };
const good: ArtRead = { textos: ['VAGA FREELA', 'GARÇOM', 'Coco Bambu', 'Sáb, 31/10', '18:00 às 23:00', 'Campinas', 'Valor para o freela', 'R$ 150,00'],
  funcao: 'GARÇOM', estabelecimento: 'Coco Bambu', data: '31/10', inicio: '18:00', fim: '23h', valor: 'R$ 150,00', cidade: 'CAMPINAS' };
it('aprova por valor interpretado (18:00 = 18h, R$ 150,00 = R$ 150, caixa alta)', () => expect(compareArt(good, F, TEMPLATE).ok).toBe(true));
it('reprova horário errado e diz o campo', () => {
  const r = compareArt({ ...good, inicio: '10:00' }, F, TEMPLATE);
  expect(r.ok).toBe(false);
  expect(r.fields.find((x) => x.key === 'inicio')).toMatchObject({ ok: false, read: '10:00', expected: '18h' });
  expect(r.hint).toMatch(/horário/);
});
it('barra texto copiado do modelo (endereço, região, link, Frutá)', () => {
  for (const t of ['Estrada Joaquim Bueno Neto, 9999', 'Rio abaixo, Itupeva', 'Frutá', 'R$ 95,95'])
    expect(compareArt({ ...good, textos: [...good.textos, t] }, F, TEMPLATE).forbidden.length).toBeGreaterThan(0);
});
it('barra rótulos e selos proibidos mesmo fora do modelo', () => {
  for (const t of ['Endereço:', 'www.freela.com', 'Disponível no Google Play', 'Descrição'])
    expect(compareArt({ ...good, textos: [...good.textos, t] }, F, []).ok).toBe(false);
});
it('texto do modelo igual a um valor da vaga é permitido', () => {
  const f = { ...F, funcao: 'Auxiliar de Limpeza' };
  expect(compareArt({ ...good, funcao: 'AUXILIAR DE LIMPEZA', textos: ['AUXILIAR DE LIMPEZA', ...good.textos.slice(2)] }, f, TEMPLATE).forbidden).toEqual([]);
});
it('estabelecimento: reprova se aparece quando devia ter saído', () =>
  expect(compareArt(good, { ...F, estabelecimento: null }, TEMPLATE).fields.find((x) => x.key === 'estabelecimento')!.ok).toBe(false));
it('reserva: só texto proibido conta', () => expect(compareArt({ ...good, inicio: null, valor: null }, F, TEMPLATE, { forbiddenOnly: true }).ok).toBe(true));
it('parsers', () => {
  expect(parseCents('R$ 1.500,00')).toBe(150000); expect(parseCents('R$150')).toBe(15000); expect(parseCents('cento e cinquenta')).toBeNull();
  expect(parseMinutes('11h30')).toBe(690); expect(parseMinutes('11:30')).toBe(690); expect(parseMinutes('18h')).toBe(1080);
  expect(parseDayMonth('Sáb, 31/10/2026')).toEqual({ day: 31, month: 10 });
});
it('o prompt de leitura NÃO contém os valores esperados (leitura às cegas)', () => {
  const p = readPrompt();
  for (const v of ['Garçom', 'R$ 150', '31/10', 'Campinas']) expect(p).not.toContain(v);
});
it('o prompt da arte leva só os campos limpos e as proibições', () => {
  const p = artPrompt({ ...F, estabelecimento: null }, null);
  expect(p).toContain('GARÇOM'); expect(p).toContain('R$ 150'); expect(p).toContain('Sáb, 31/10'); expect(p).not.toContain('Coco Bambu');
  expect(p).toMatch(/sem fachada/i); expect(p).toMatch(/Endereço/); expect(p).toMatch(/faixa de baixo/i);
});
```
- [ ] **Step 2:** rodar `npx jest verify` → FAIL.
- [ ] **Step 3: Implementar.** Comparação de função/cidade/estabelecimento: `norm(read)` igual a `norm(esperado)` depois de tirar as
  palavras de `GENERIC_LABELS`. Texto proibido: para cada item de `templateTexts` cujo `norm` tenha ≥ 4 caracteres, não esteja em
  `GENERIC_LABELS` e não seja igual (`norm`) a nenhum valor esperado (`funcao`, `estabelecimento`, `cidade`, `valor`, `data`, `horario`),
  procurar `norm(item)` dentro de `norm(textos.join(' '))`; e cada `ALWAYS_FORBIDDEN` em `norm(textos)`. `hint` em pt-BR:
  `"Na tentativa anterior a arte errou: {campo} (a arte diz {lido}, o certo é {esperado}). Tire da arte: “{proibido}”."`.
  Prompts (pt-BR, curtos):
  - `artPrompt`: "Crie um story vertical seguindo o ESTILO e o LAYOUT da imagem de referência (cores, letras, faixas, cartões com
    ícones). Troque TODOS os textos pelos abaixo, escritos exatamente assim: VAGA FREELA / {FUNÇÃO EM CAIXA ALTA} / Valor para o freela:
    {valor} / Quando: {data} · {horario} / Onde: {cidade}{ / Estabelecimento: {estab}}. Não escreva nenhum outro texto. PROIBIDO:
    cartões de Endereço, Região, Bairro ou Descrição; qualquer link, site ou QR; selos do Google Play ou da App Store; nomes ou logos de
    empresas na cena. A foto mostra uma pessoa fazendo o trabalho de {função} num bar ou restaurante, sem fachada, sem nome e sem logo de
    empresa. Mantenha a logo do Freela da referência. Deixe a faixa de baixo da arte lisa, sem texto (o rodapé é colocado depois)."
    + `hint` quando houver.
  - `photoPrompt`: "Foto realista, vertical, de uma pessoa trabalhando como {função} num bar ou restaurante brasileiro. Sem nenhum texto,
    letra, número, placa, fachada, nome ou logo."
  - `readPrompt`: "Leia esta arte de story. Liste em `textos` TODOS os textos visíveis, exatamente como aparecem, um item por bloco. Depois
    preencha: `funcao` (a função/cargo da vaga), `estabelecimento`, `data`, `inicio`, `fim`, `valor` (o valor em reais), `cidade`. Use null
    quando o campo não aparecer. Não invente nem corrija nada."
  - `templateReadPrompt`: "Liste em `textos` todos os textos visíveis nesta arte, inclusive os pequenos, os da foto (placas, fachadas)
    e os do rodapé, um item por bloco, exatamente como aparecem."
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** — `git add` dos 4 arquivos → `feat(vagas): conferência da arte e prompts`.

---

### Task 5: Selos oficiais, quadro 1080×1920 e arte de reserva

**Files:**
- Create: `api/assets/badges/google-play-pt-br.png`, `api/assets/badges/app-store-pt-br.png`, `api/assets/badges/NOTICE.md`
- Create: `api/src/modules/vacancy-stories/vacancy-art.ts`
- Modify: `api/src/modules/creative/compose.ts` (exportar `rect`)
- Test: `api/src/modules/vacancy-stories/__tests__/vacancy-art.spec.ts`

**Interfaces:**
- Consumes: `ImageService`, `fillPolys`, `flatten`, `parseFont`, `hexToRgb`, `rect` (`compose.ts`), `dominantColor`, `loadDefaultFont`
  (`refs.service.ts`), `VacancyFields`.
- Produces: `STORY_W = 1080`, `STORY_H = 1920`, `ART_BOX = { top: 250, bottom: 1350 }`, `FOOTER_BOX = { top: 1370, bottom: 1600 }`,
  `CHECK_CROP_BOTTOM = 1360`, `FOOTER_LINE1 = 'Candidate-se pelo app'`, `FOOTER_LINE2 = 'Procure Freela Serviços na loja'`;
  `type Badges = { googlePlay: Uint8Array; appStore: Uint8Array }`; `loadBadges(): Badges` (lê de `assets/badges`, mesmas pastas candidatas do `fontDirs()`;
  cache em memória); `edgeColor(images: ImageService, bytes: Uint8Array): Promise<string>` (`#rrggbb`, cor dominante da borda de 3%);
  `composeStoryFrame(images, i: { art: Uint8Array; bg: string; font: ArrayBuffer; badges: Badges }): Promise<Uint8Array>` (JPEG q92
  1080×1920); `cropForCheck(images, frame: Uint8Array): Promise<{ bytes: Uint8Array; mime: string }>` (y 0–1360, JPEG ≤ 1024 px);
  `composeFallback(images, i: { photo: Uint8Array | null; fields: VacancyFields; bg: string; accent: string; logo: Uint8Array | null;
  font: ArrayBuffer; badges: Badges }): Promise<Uint8Array>`.

- [ ] **Step 1: Baixar os selos oficiais** (arquivo baixado = dado não confiável: pasta nova e vazia no scratchpad, nada é executado):
  - Google Play pt-BR: `https://play.google.com/intl/pt-BR/badges/static/images/badges/pt-br_badge_web_generic.png` (PNG oficial
    "DISPONÍVEL NO Google Play"). Recortar só a margem transparente (`convert in.png -trim +repage out.png`), sem mexer no desenho.
  - App Store pt-BR (preto): `https://tools.applemarketingtools.com/api/badges/download-on-the-app-store/black/pt-br` (SVG oficial
    "Baixar na App Store"). Rasterizar com `/usr/bin/convert -background none -density 600 in.svg -resize x240 out.png` (o
    ImageMagick tem `SVG`/`MSVG`). Se o servidor da Apple devolver PNG, usar o PNG.
  - Abrir os dois com a ferramenta Read e conferir a olho que são os selos oficiais pt-BR, inteiros, legíveis. Se algum download falhar,
    **parar e avisar** (não desenhar selo).
  - `NOTICE.md`: origem (as duas URLs), data (28/10/2026), "arquivo oficial, apenas recortado/rasterizado; não redesenhar", links das
    regras de uso (Google Play badge guidelines; Apple Marketing Guidelines — App Store badges).
- [ ] **Step 2: Testes que falham** (`vacancy-art.spec.ts`, `ImageService` real, sem rede):
  - `loadBadges()` devolve dois PNG (`89 50 4E 47`) mais largos que altos.
  - `composeStoryFrame` com arte 1024×1536 vermelha e `bg '#ffffff'`: saída 1080×1920; pixel (540, 800) vermelho; pixels (540, 100) e
    (20, 800) brancos (faixas na cor do modelo); a linha y 1390–1470 tem pixels escuros (texto do rodapé); a área dos selos tem pixels
    não brancos; nada não-branco abaixo de y 1600.
  - Arte 1536×1024 (deitada) cabe inteira: largura 1080 centralizada verticalmente na caixa.
  - `cropForCheck` devolve altura proporcional a 1360 (≤ 1024 px no maior lado) e o rodapé não está nela (a última linha é a do quadro
    em y≈1359).
  - `edgeColor` de uma imagem com borda `#ffd400` e miolo azul → `'#ffd400'` (tolerância de 8 por canal).
  - `composeFallback` sem foto e sem logo: 1080×1920, fundo `bg`, pixels de texto entre y 250 e 1350, rodapé presente.
- [ ] **Step 3:** rodar `npx jest vacancy-art` → FAIL.
- [ ] **Step 4: Implementar.** Quadro: `scaleToFit` da arte em 1080×1100, centralizar na `ART_BOX`; rodapé: linha 1 com 56 px,
  linha 2 com 44 px (fonte do parâmetro), cor do texto = `#111111` se a luminância do `bg` > 140, senão `#ffffff`; selos lado a lado,
  72 px de altura, centralizados, 24 px entre eles, abaixo das linhas, tudo dentro de `FOOTER_BOX`. Reserva (UI §1): foto (cover) em
  y 250–800 com cantos arredondados; abaixo, faixa "VAGA FREELA" (36 px) + função em caixa alta (≥ 110 px, até 2 linhas, encolhe até
  caber), cartão do valor ("Valor para o freela" 40 px + `R$ 150` ≥ 130 px), cartões de "Quando" (≥ 60 px), "Onde" com um pino
  desenhado (círculo + triângulo) (≥ 60 px), "Estabelecimento" (≥ 48 px, só se não nulo); cartões em `#ffffff` sobre o `bg`, cor de
  destaque `accent` nas faixas; logo da marca (se houver) uma vez, até 220×120, no topo da área livre; rodapé igual ao do quadro.
  Sem foto: os cartões ocupam a área inteira.
- [ ] **Step 5:** rodar → PASS. Gerar um quadro e uma reserva de exemplo no scratchpad (script `ts-node --transpile-only` fora do
  repo) e olhar com Read; ajustar se algo ficou ilegível ou fora da área livre.
- [ ] **Step 6: Commit** — `git add api/assets/badges api/src/modules/vacancy-stories/vacancy-art.ts api/src/modules/creative/compose.ts
  api/src/modules/vacancy-stories/__tests__/vacancy-art.spec.ts` → `feat(vagas): quadro do story com rodapé e selos oficiais, e arte de reserva`.

---

### Task 6: Instagram — porta de guardas e correções comuns

**Files:**
- Create: `api/src/modules/instagram/origin-guards.ts`
- Modify: `api/src/modules/instagram/ig-store.service.ts`, `publishing.service.ts`, `instagram-actions.service.ts`,
  `media-generation.service.ts`, `autopilot.service.ts`, `instagram.module.ts`
- Test: `api/src/modules/instagram/__tests__/origin-guards.spec.ts`

**Interfaces:**
- Produces: `interface PublishOriginGuard { blockReason(post: PostRow, at: Date): Promise<string | null>; afterApproval?(workspaceId:
  string, postId: string): Promise<void> }` (`null` = pode publicar; texto = cancelar; lança `OriginUnavailable` = fonte fora do ar);
  `PUBLISH_ORIGIN_GUARDS = Symbol('PUBLISH_ORIGIN_GUARDS')`; em `ig-store.service.ts`: `class OriginUnavailable extends Error`,
  `class ClaimRefused extends Guardrail`; `InstagramModule.exports` ganha `PublishingService`.
- Comportamento novo:
  - `IgStore.approvalRequired(post)`: `source === 'vacancy'` → `post.creative_brief?.vacancy?.requires_approval === true` (antes das
    outras regras).
  - `PublishingService` recebe `@Optional() @Inject(PUBLISH_ORIGIN_GUARDS) guards: PublishOriginGuard | null`;
    `cancelledOrigin(post, at = new Date())` consulta `guards.blockReason(post, at)` depois das regras de hoje.
  - Fila: `OriginUnavailable` → job `pending`, `run_at` +10 min, tentativa não conta, post volta para `scheduled` com `scheduled_at` =
    novo `run_at`; `RateLimited` → `cancelledOrigin(post, agora + 1 h)` antes de remarcar; a chamada a `cancelledOrigin` no `catch`
    ganha `.catch(() => null)`.
  - `claim()` lança `ClaimRefused('Post não aprovado — publicação bloqueada.')` no lugar do `Guardrail` (a fila continua tratando como
    guardrail).
  - `InstagramActionsService.publishInstagramPost`: `ClaimRefused` → `{ ok:false, error }` sem gravar `failed`; `OriginUnavailable` →
    devolve o post ao status anterior e `{ ok:false, error: 'Não conseguimos consultar a vaga no Freela agora. Tente de novo em alguns minutos.' }`.
  - `MediaGenerationService.generatePostAssets` (e o caminho de `regenerate-media`): `post.source === 'vacancy'` →
    `{ ok:false, error: 'Story de vaga: use Refazer a arte na aba Vagas.' }` antes do lease.
  - `AutopilotService.afterApproval`: seleciona `source`; `source === 'vacancy'` → log "Post aprovado." + `guards?.afterApproval?.(ws, id)`
    e retorna.

- [ ] **Step 1: Testes que falham** (`origin-guards.spec.ts`, `igWorld` + `igServices`; guard falso injetado no `PublishingService`):
  - `approvalRequired`: post vaga com `requires_approval: true` → `true`; `false` → `false`.
  - "Publicar agora" num post `pending_approval` → `{ ok:false, error:'Post não aprovado — publicação bloqueada.' }` e o post continua
    `pending_approval` (não `failed`).
  - Guarda devolve "A vaga não está mais aberta no Freela (preenchida ou cancelada)." → a fila cancela o post e o job; nenhum `/media`
    chamado na Graph.
  - **Review Focus #5:** guarda lança `OriginUnavailable` → job `pending`, `attempts` igual ao de antes, `run_at` ≈ agora + 10 min,
    post `scheduled`; nenhum container criado.
  - `RateLimited` com guarda que cancela quando `at` passa do início → post `cancelled`, job `cancelled` (não remarca 1 h).
  - Post sem `source='vacancy'` e sem guarda: comportamento de hoje (rodar também `publishing.spec`, `actions.spec`).
  - `generatePostAssets` num post de vaga → `ok:false` com a mensagem, post intocado.
  - `approvePost` num post de vaga → `guard.afterApproval` chamado com `(ws, postId)`; post `approved`.
- [ ] **Step 2:** rodar `npx jest origin-guards` → FAIL.
- [ ] **Step 3: Implementar** conforme a interface.
- [ ] **Step 4:** rodar `npx jest origin-guards`, depois `npx jest instagram/__tests__/publishing`, `actions`, `media-generation`,
  `autopilot` (um por vez, via run-capped) → PASS.
- [ ] **Step 5: Commit** — `git add` dos arquivos listados → `feat(instagram): guarda de origem antes de publicar e correções para posts de vaga`.

---

### Task 7: Módulo, portão, ajustes e arte modelo

**Files:**
- Create: `api/src/modules/vacancy-stories/vacancy-gate.service.ts`, `vacancy-settings.service.ts`, `vacancy-stories.controller.ts`,
  `vacancy-stories.dto.ts`, `vacancy-stories.module.ts`, `vacancy-guard.service.ts` (esqueleto: `blockReason` devolve `null`;
  completo na Task 10)
- Create: `api/src/modules/vacancy-stories/__tests__/world.ts` (mundo: `igWorld` + `AiService` falso + feed falso + `ImageService` real
  + `FilesService` em memória como `media/__tests__/mem.ts`)
- Modify: `api/src/app.module.ts`
- Test: `api/src/modules/vacancy-stories/__tests__/settings.spec.ts`

**Interfaces:**
- Consumes: `parseVacancyWorkspaces` (T1), `edgeColor` (T5), `TEMPLATE_TEXTS_SCHEMA`/`templateReadPrompt` (T4), `contentMatchesMime`,
  `resolveUploadMime` (`files.service`), `ActivityService.log`, `WorkspaceAccessService`, `IgStore.liveAccount`.
- Produces:
  - `VacancyGate { allowed(ws: string): boolean; assert(ws: string): void /* notFound('Página não encontrada.') */ }`;
    `VacancyGateGuard` (CanActivate, lê `params.workspaceId`).
  - `VacancyStoriesCoreModule` (`@Global`): `FREELA_VACANCIES_FETCH` (`(u, i) => fetch(u, i)`), `VacancyFeedClient`, `VacancyGate`,
    `VacancyGuardService`, `{ provide: PUBLISH_ORIGIN_GUARDS, useExisting: VacancyGuardService }`; exporta os quatro + o token. Não
    importa `InstagramModule`.
  - `VacancyStoriesModule`: importa `InstagramModule`, `AiModule`, `MediaModule`, `CreativeModule` (para `RefsService`), `AccessModule`,
    `ActivityModule`; controllers e serviços da função. Os dois entram no `app.module.ts`.
  - `type SettingsRow = Prisma.vacancy_story_settingsGetPayload<object>`; `type StoryRow = Prisma.vacancy_storiesGetPayload<object>`
    (em `vacancy-types.ts`).
  - `VacancySettingsService`: `get(ws): Promise<SettingsRow>` (cria com os padrões na 1ª leitura); `view(ws): Promise<VacancySettingsView>`;
    `update(userId, ws, dto)`; `enable(userId, ws)`; `disable(userId, ws): Promise<{ ok: true; cancelled: number }>`;
    `setAutoPublish(userId, ws, value: boolean)`; `uploadTemplate(userId, ws, file: { bytes: Buffer; mime: string; filename: string }):
    Promise<VacancySettingsView & { warning: 'landscape' | null }>`.
  - `VacancySettingsView` (wire): `{ enabled, enabled_at, auto_publish, template: { asset_id, url, landscape, texts_count } | null,
    template_bg, cities, daily_cap, window_start, window_end, min_lead_minutes, vendor, last_poll_at, last_poll_ok_at, last_poll_error,
    recent_cities: { city: string; count: number }[], instagram: { connected: boolean; username: string | null }, today: { posted: number;
    scheduled: number; cap: number }, pending_approval: number, counts: { ready: number; to_approve: number }, ai_error, ai_error_at,
    preview, recent_outcomes: { n: number; first_try: number; redone: number; fallback: number; not_posted: number },
    week: { total: number; fallback: number } }` (`recent_outcomes` = últimos 20 stories entregues ou cancelados; `week` = 7 dias).
- Regras: rotas com `@UseGuards(WorkspaceAccessGuard, VacancyGateGuard)`; `enable`/`disable`/`auto-publish` exigem `manage`
  (`access.require`) e gravam `ActivityService.log(ws, userId, 'vacancy_stories.enable' | '.disable' | '.auto_publish', 'vacancy_stories',
  {…})`; `enable` sem `template_asset_id` → 400 "Envie a arte modelo para poder ligar."; `enable` grava `enabled_at = agora`
  (marca d'água; religar move); `disable` cancela linhas `new|waiting|generating` (`skip_reason` "Os stories das vagas foram
  desligados.") e posts de vaga `pending_approval|approved|ready|scheduled` (+ jobs `pending` cancelados).
  Envio da arte: tipo pelo conteúdo (PNG/JPEG/WEBP; outro → 400 "Esse arquivo não serve. Envie uma imagem PNG, JPG ou WEBP."); > 10 MB →
  400 "A imagem tem {x} MB e o máximo é 10 MB. Envie uma menor." (x com 1 casa); lado menor < 600 px → 400 "A arte modelo precisa ter
  pelo menos 600 px de largura."; marca (D1); grava em `creative-assets` com `files.newUploadKey('brands', ws, ext)`, cria `brand_assets`
  `kind 'vacancy_template'`, lê os textos (`ai.json` com a imagem reduzida a 1024 px) e a cor de borda; falha da leitura → apaga a
  linha e o arquivo e repassa o erro da IA; grava `template_asset_id`, `template_texts`, `template_bg`, `template_landscape`, `brand_id`.

- [ ] **Step 1: Testes que falham** (`settings.spec.ts`):
  - **Isolamento:** lista = {A}. Em B, `GET settings` → 404 `Página não encontrada.`; o mesmo para `PATCH settings`, `POST enable`,
    `POST template`, `GET stories` (testar pelo guard + serviço).
  - `GET settings` em A cria com padrões: `enabled false`, `daily_cap 10`, `window 08:00–21:00`, `min_lead 120`, `vendor openai`,
    `auto_publish false`.
  - `PATCH` com `window_start '21:00'`, `window_end '08:00'` → 400 "O início precisa ser antes do fim."; `daily_cap 21` → 400.
  - `enable` sem arte → 400 com o texto; viewer/editor → 403; dono → `enabled true`, `enabled_at` = agora, log de atividade gravado.
  - `uploadTemplate` com PNG 1024×1536 de borda amarela: `brand_assets` com `kind 'vacancy_template'`, `template_texts` = o que a IA
    falsa leu, `template_bg '#ffd400'`, `warning null`.
  - **Review Focus #2:** IA falsa lendo `{ textos: [] }` → salva com `texts_count 0`; PNG 1536×1024 → `warning 'landscape'`,
    `template_landscape true`.
  - **Review Focus #4:** empresa sem marca → 400 "Cadastre uma marca em Marcas antes de enviar a arte modelo." e nada gravado
    (nem arquivo).
  - SVG/PDF/GIF disfarçado de `.png` → 400 "Esse arquivo não serve. Envie uma imagem PNG, JPG ou WEBP."
  - IA da leitura falha → erro repassado, nenhuma `brand_assets` nem arquivo sobra.
  - `disable` com 1 linha `new`, 1 post `pending_approval` e 1 `scheduled` (com job) → `cancelled: 3`, job cancelado, motivos gravados.
- [ ] **Step 2:** rodar `npx jest vacancy-stories/__tests__/settings` → FAIL.
- [ ] **Step 3: Implementar** os arquivos. Controller: `GET/PATCH settings`, `POST enable|disable|auto-publish|template` (multipart
  no molde de `files.controller.ts`). DTO `UpdateVacancySettingsDto` com `@IsOptional` + validadores (`@Matches(/^\d{2}:\d{2}$/)`,
  `@IsIn([60,120,240,360])`, `@IsIn(['openai','gemini'])`, `@ArrayMaxSize(50)`), sem default; `AutoPublishDto { @IsBoolean() auto_publish }`.
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** — `git add` dos arquivos → `feat(vagas): módulo, empresas liberadas, ajustes e arte modelo`.

---

### Task 8: Consulta, triagem gravada, expiração e job

**Files:**
- Create: `api/src/modules/vacancy-stories/vacancy-poll.service.ts`, `vacancy-stories-cron.service.ts`, `vacancy-stories-cron.controller.ts`
- Modify: `api/src/modules/scheduler/job-schedules.ts`, `vacancy-stories.module.ts`
- Test: `api/src/modules/vacancy-stories/__tests__/poll.spec.ts`

**Interfaces:**
- Consumes: `VacancyFeedClient`, `triage`, `isAfterWatermark`, `fingerprint`, `VacancyGate`, `SchedulerService`, `CronAuthService`.
- Produces: `VacancyPollService { pollAll(now?: Date): Promise<{ workspaces: number; inserted: number; skipped: number; error?: string }>;
  expireDue(now?: Date): Promise<number>; sweepLeases(now?: Date): Promise<number>; disableOrphans(): Promise<number> }`;
  `JOB_SCHEDULES['vacancy-stories-10min'] = { name: 'vacancy-stories-10min', cron: '*/10 * * * *', heartbeat: 'vacancy-stories' }`;
  `VacancyStoriesCronService.tick(): Promise<Record<string, unknown>>` (ordem: `pollAll` → `disableOrphans` → `expireDue` →
  `sweepLeases` → `scheduler.tick` (Task 10) → `generator.generateDue` (Task 9); cada etapa com `.catch` que vira `{ error }`).
  `POST /api/public/cron/vacancy-stories` igual ao `InstagramCronController` (token `vacancy-stories`, `runExclusive`).
- Regras: uma chamada `recent()` por rodada para todas as empresas; empresas = `settings.enabled` ∩ lista; por empresa: só vagas com
  `isAfterWatermark(v, enabled_at)`; linha nova por `createMany({ skipDuplicates: true })` com `status` da triagem, `snapshot`,
  `fingerprint`, `starts_at`; grava `last_poll_at`, `last_poll_ok_at` (sucesso), `last_poll_error` (texto do `FeedDownError`, limpo no
  sucesso) e `recent_cities` (contagem das cidades da resposta, ordem decrescente). `expireDue`: linhas `new|waiting` e `generating` com
  lease livre cujo `starts_at − agora < min_lead` → `expired` com `"Começa às {h}, em menos de {lead}. Não dá tempo de divulgar."` (ou,
  se `wait_reason` era o limite, `"Ficou esperando a vez (máximo de {cap} por dia) e a vaga começou antes."`); posts de vaga
  `pending_approval` na mesma condição → `cancelled` e a linha recebe `skip_reason` `"Ninguém aprovou a tempo: a vaga começou às {h}."`.
  `sweepLeases`: `generating` com lease vencido → `waiting` (molde `sweepStaleGenerating`). `disableOrphans`: `enabled` com
  `template_asset_id` nulo → desliga e registra atividade `vacancy_stories.disable` com `{ reason: 'arte modelo apagada' }`.

- [ ] **Step 1: Testes que falham** (`poll.spec.ts`):
  - Sem retroativo: vaga publicada antes de `enabled_at` não vira linha.
  - 3 vagas (teste, valor nulo, válida) → 2 `skipped` com os textos de `SKIP` e 1 `new`; segunda rodada com as mesmas → nada novo.
  - Duas empresas ligadas, uma consulta só à vitrine; empresa desligada ou fora da lista não ganha linha.
  - **Review Focus #5 (consulta):** feed lança `FeedDownError` → `last_poll_error` gravado, `last_poll_ok_at` intacto, sem exceção; na
    rodada seguinte com sucesso o erro é limpo.
  - `recent_cities` = `[{ city: 'Campinas', count: 2 }, { city: 'Jundiaí', count: 1 }]`.
  - `expireDue`: linha `new` começando em 90 min com antecedência 120 → `expired` com o texto; `pending_approval` → post `cancelled` +
    "Ninguém aprovou a tempo: a vaga começou às 18h.".
  - `sweepLeases` e `disableOrphans` como descrito.
  - Cron: rota sem segredo → 401; `tick()` devolve as chaves das etapas mesmo se uma falha.
- [ ] **Step 2:** rodar `npx jest vacancy-stories/__tests__/poll` → FAIL.
- [ ] **Step 3: Implementar** (por enquanto `tick` chama `scheduler.tick`/`generator.generateDue` só se existirem — as Tasks 9 e 10 os
  ligam; nada de `$queryRaw`).
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** — `feat(vagas): consulta da vitrine a cada 10 minutos, triagem e expiração`.

---

### Task 9: Geração, conferência e entrega do post

**Files:**
- Create: `api/src/modules/vacancy-stories/vacancy-generator.service.ts`
- Modify: `vacancy-stories-cron.service.ts`, `vacancy-stories.module.ts`
- Test: `api/src/modules/vacancy-stories/__tests__/generator.spec.ts`

**Interfaces:**
- Consumes: `AiService.image/json`, `compareArt`, `artPrompt`, `photoPrompt`, `readPrompt`, `READ_SCHEMA` (T4),
  `composeStoryFrame`, `composeFallback`, `cropForCheck`, `loadBadges` (T5), `RefsService.loadFont/loadLogo`, `AssetsService.ingest`,
  `FilesService.read`, `VacancyFeedClient.byId`, `IgStore.liveAccount`, `vacancyFields`, `fingerprint`.
- Produces:
  - `type ArtResult = { bytes: Uint8Array; check: ArtCheck; attempts: AttemptLog[]; usedFallback: boolean; vendorLabel: string }`.
  - `class ArtAiError extends Error` (erro de IA com a mensagem pt-BR).
  - `VacancyGeneratorService.makeArt(ws: string, s: SettingsRow, f: VacancyFields, onStep?: (step: 'art' | 'check', attempt: number) =>
    Promise<void>): Promise<ArtResult>` (lança `ArtAiError` se a IA falhar antes de existir uma arte aprovada ou de reserva; usado pela
    prévia);
  - `generateDue(now?: Date): Promise<{ started: number; handed: number; waiting: number; cancelled: number }>` (≤ 2 linhas por rodada,
    no total);
  - `handOff(row, s: SettingsRow, art: ArtResult, v: FreelaVacancy): Promise<string /* ig_post id */>`; depois da entrega chama
    `VacancySchedulerService.afterHandOff(ws, postId)` (Task 10; até lá, opcional).
- Regras:
  - Candidatas: `status IN ('new','waiting')`, `next_attempt_at` nulo ou vencido, `not_before` nulo ou vencido, lease livre, empresa
    ligada e na lista; ordem `starts_at asc`. Empresa sem `liveAccount` → linha fica `new` com `wait_reason` "O Instagram está
    desconectado. Os stories ficam prontos aqui, mas só vão ao ar depois que você reconectar." e não gera. Antes de gerar, se a empresa
    já atingiu o limite do dia (`scheduler.capacityFor`, Task 10) → `waiting` com `wait_reason 'cap'` e `not_before` = início da janela
    do próximo dia (Task 10 liga; até lá, sem checagem).
  - Pega o lease (`UPDATE … WHERE status IN ('new','waiting') AND lease livre` → `generating`, `lease_until` +15 min). `byId`: `null` →
    `cancelled` "A vaga não está mais aberta no Freela (preenchida ou cancelada)."; `FeedDownError` → volta para `waiting`,
    `next_attempt_at` +10 min; assinatura nova → atualiza `snapshot`/`fingerprint`/`starts_at` e segue com os dados novos.
  - `makeArt`: modelo = bytes de `template_asset_id` (via `FilesService.read`, chave do workspace), reduzido a 1024 px; até 3
    tentativas `image({ prompt: artPrompt(f, hint), aspectRatio: '9:16', referenceImages: [modelo], vendor, strict: true })` →
    `composeStoryFrame` (`bg` = `template_bg ?? '#ffffff'`, fonte = `refs.loadFont(ws, brand_id)`) → `json({ name: 'vacancy_art_read',
    prompt: readPrompt(), schema: READ_SCHEMA, images: [cropForCheck(frame)] })` → `compareArt`. Aprovou → fim. Reprovou → próxima com o
    `hint`. 3 reprovações → reserva: `image({ prompt: photoPrompt(f.funcao), aspectRatio: '9:16', vendor, strict: true })` →
    `composeFallback` (logo da marca, `accent` = `brand.primary_color`) → leitura → `compareArt(…, { forbiddenOnly: true })`. Foto da
    reserva com erro de IA → reserva sem foto (`photo: null`, sem leitura de IA além da conferência; se a leitura também falhar, a
    reserva sem foto é aceita: todo texto dela é do sistema). Reserva reprovada por texto proibido (foto com placa) → reserva sem foto.
    Erro de IA antes de ter qualquer arte → `ArtAiError`.
  - `ArtAiError` na rodada: linha `waiting`, `ai_error_count++`, `next_attempt_at` = agora + [5, 15, 45][min(n−1, 2)] min, `wait_reason`
    = "A IA não conseguiu criar a arte: {mensagem sem ponto final}."; `settings.ai_error`/`ai_error_at` gravados.
  - Entrega (transação, condicionada a `status='generating' AND lease_until = o nosso`): `AssetsService.ingest({ kind:'image',
    targetFormat:'ig_story', normalize:false, source, provider, bytes, title: theme, brandId })` (fora da transação, antes) → cria
    `ig_posts` `{ format:'story_image', source:'vacancy', status: auto_publish ? 'ready' : 'pending_approval', theme: 'Vaga · {função} ·
    {estabelecimento ?? cidade} · {shortDay}', caption:null, hashtags:[], creative_brief: { compose:false, vacancy: { story_id,
    external_id, fingerprint, requires_approval: !auto_publish, checked_fields: [chaves ok], attempts, used_fallback, starts_at } },
    media:[item], ai_provider, ai_generation_log: resumo D12 }` → `media_assets.ig_post_id` → linha `handed_off` com `ig_post_id`,
    `attempts_log`, `used_fallback`, `mismatch_attempts`, `lease_until null`, `template_asset_id`. Perdeu a condição (desligaram no meio)
    → apaga o post criado e devolve `'lost'`. Limpa `settings.ai_error`.

- [ ] **Step 1: Testes que falham** (`generator.spec.ts`, IA falsa programável: `image` devolve PNG gerado com jimp; `json` devolve a
  leitura que o teste quiser por tentativa):
  - Aprovada de primeira, modo "aprovar": post `pending_approval`, `source 'vacancy'`, `format 'story_image'`, `automation/plan_id/run_id`
    nulos, `theme 'Vaga · Garçom · Coco Bambu · Sáb 31/10'`, mídia 1080×1920 `ig_ready true`, `media_assets.source 'chatgpt'`,
    linha `handed_off` com `ig_post_id`; o prompt da leitura não tem os valores esperados; a imagem enviada à leitura tem altura
    proporcional a 1360.
  - Horário errado na 1ª, certa na 2ª: 2 imagens, 2 leituras, o 2º prompt contém o `hint` com "horário"; `attempts_log` com 2 itens.
  - **Texto copiado do modelo** (leitura com "Estrada Joaquim Bueno Neto, 9999" nas 3) → reserva: 4ª imagem com `photoPrompt`,
    `used_fallback true`, `creative_brief.vacancy.used_fallback true`.
  - Foto da reserva com erro de IA → reserva sem foto entregue; `media_assets.source 'other'`, `provider 'sistema'`.
  - Erro de IA na 1ª imagem (`VendorKeyError` noCredit): linha `waiting`, `ai_error_count 1`, `next_attempt_at` ≈ +5 min, nenhuma
    refação contada, `settings.ai_error` com a mensagem; 3ª falha → +45 min.
  - Vaga fechada (`byId` → null) → `cancelled` com o texto, nenhuma chamada de IA.
  - Assinatura mudou no `byId` → arte gerada com o valor novo.
  - Sem Instagram conectado → nada gerado, `wait_reason` com o texto.
  - Lote de 10 linhas → só 2 geradas na rodada, as de início mais próximo.
  - Desligaram durante a geração (linha virou `cancelled`) → nenhum post sobra.
  - Modo "postar sozinho" → post `ready` e `requires_approval false`.
- [ ] **Step 2:** rodar `npx jest vacancy-stories/__tests__/generator` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** — `feat(vagas): arte de IA conferida pela leitura, reserva e entrega do story`.

---

### Task 10: Horário livre, limite do dia, aprovação e guarda de publicação

**Files:**
- Create: `api/src/modules/vacancy-stories/vacancy-slots.ts`, `vacancy-scheduler.service.ts`
- Modify: `vacancy-guard.service.ts` (completo), `vacancy-generator.service.ts`, `vacancy-stories-cron.service.ts`, `vacancy-stories.module.ts`
- Test: `api/src/modules/vacancy-stories/__tests__/slots.spec.ts`, `scheduler-guard.spec.ts`

**Interfaces:**
- Consumes: `PublishingService.schedulePost` (exportado na Task 6), `IgStore.liveAccount`, `VacancyFeedClient.byId`, `fingerprint`.
- Produces:
  - `vacancy-slots.ts`: `spDay(d: Date): string` (`YYYY-MM-DD` de Brasília); `windowStartOn(day: string, hhmm: string): Date`;
    `nextWindowSlot(o: { now: Date; windowStart: string; windowEnd: string; after: Date | null; spacingMin: number }): Date` — o 1º
    instante ≥ max(agora + 1 min, `after` + espaçamento) dentro da janela; fora dela, o início da janela seguinte.
  - `VacancySchedulerService`: `capacityFor(ws, s, day: string): Promise<{ used: number; cap: number }>` (stories de vaga do dia de
    Brasília em `pending_approval|approved|ready|scheduled|publishing|published` pela data de `published_at ?? scheduled_at ?? created_at`);
    `igRoom(ws, now): Promise<{ room: number; freesAt: Date | null }>` (25 − 5 − publicados em 24 h − posts não-vaga agendados nas
    próximas 24 h − stories de vaga agendados; `freesAt` = publicação mais antiga das últimas 24 h + 24 h);
    `planSlot(ws, s, startsAt: Date, now: Date, o?: { force?: boolean }): Promise<{ at: Date; waitingFor: 'none' | 'window' | 'cap' |
    'ig_limit' } | { expire: string }>`; `scheduleVacancyPost(ws, postId, o?: { force?: boolean }): Promise<'scheduled' | 'cancelled' |
    'no_account'>`; `afterHandOff(ws, postId)` (modo sozinho → `scheduleVacancyPost`); `tick(now?): Promise<{ approved: number;
    reconciled: number }>` (aprovados sem job pendente + `scheduled` sem job pendente → `scheduleVacancyPost`); `onModuleInit` registra
    `guard.onApproved = (ws, id) => this.scheduleVacancyPost(ws, id)`.
  - `VacancyGuardService implements PublishOriginGuard`: `blockReason(post, at)` (só `source='vacancy'`); `afterApproval(ws, id)` →
    `onApproved?.(ws, id)`; `onApproved: ((ws: string, postId: string) => Promise<unknown>) | null`.
- Regras: espaçamento 15 min entre stories de vaga da empresa (`after` = maior `scheduled_at` de story de vaga `scheduled|publishing`
  ou `published_at` mais recente); limite do dia de `settings.daily_cap`; passou → início da janela do dia seguinte, se `at +
  min_lead ≤ starts_at`, senão `{ expire: 'Ficou esperando a vez (máximo de {cap} por dia) e a vaga começou antes.' }`; `igRoom ≤ 0` →
  `at = max(at, freesAt)`; `force` (Postar agora) ignora janela, limite e espaço: `at = agora + 1 min`. `scheduleVacancyPost` sem conta →
  `'no_account'` (post fica, `last_error` `NO_ACCOUNT_MSG`). `expire` → post `cancelled` e linha com `skip_reason`.
  `blockReason`: linha pelo `ig_post_id`; `byId` lança `FeedDownError` → `throw new OriginUnavailable(…)`; `null` → "A vaga não está mais
  aberta no Freela (preenchida ou cancelada)." (grava na linha `skip_reason`); assinatura mudou → se `redo_count < 3`, linha volta a
  `new` (`ig_post_id null`, `snapshot`/`fingerprint`/`starts_at` novos, `redo_count++`, `mismatch_attempts 0`) e devolve "A vaga mudou no
  Freela (valor ou horário). Vamos criar o story de novo."; senão linha `failed` com o texto D11; `starts_at ≤ at` → "A vaga começou antes
  de ir ao ar."; `starts_at − at < min_lead` → "Começa às {h}, em menos de {lead}. Não dá tempo de divulgar.". No `generateDue`, ligar a
  checagem `capacityFor` (Task 9) e no `tick` do cron, `scheduler.tick` antes do `generateDue`.

- [ ] **Step 1: Testes que falham** — `slots.spec.ts`:

```ts
// 2026-10-29T13:00:00Z = 10h em Brasília
expect(nextWindowSlot({ now: utc('2026-10-29T13:00:00Z'), windowStart: '08:00', windowEnd: '21:00', after: null, spacingMin: 15 })).toEqual(utc('2026-10-29T13:01:00Z'));
expect(nextWindowSlot({ now: utc('2026-10-29T13:00:00Z'), windowStart: '08:00', windowEnd: '21:00', after: utc('2026-10-29T12:55:00Z'), spacingMin: 15 })).toEqual(utc('2026-10-29T13:10:00Z'));
// 22h10 em Brasília → 8h do dia seguinte
expect(nextWindowSlot({ now: utc('2026-10-30T01:10:00Z'), windowStart: '08:00', windowEnd: '21:00', after: null, spacingMin: 15 })).toEqual(utc('2026-10-30T11:00:00Z'));
expect(spDay(utc('2026-10-30T02:00:00Z'))).toBe('2026-10-29');
```
  `scheduler-guard.spec.ts`:
  - Modo sozinho, entrega às 10h → job na fila em agora+1 min; 2º story → +15 min do 1º.
  - Limite 2 com 2 já agendados hoje → 3º agendado às 8h de amanhã; se a vaga começa antes de amanhã 8h + antecedência → post
    `cancelled` com "Ficou esperando a vez (máximo de 2 por dia) e a vaga começou antes.".
  - 20 publicados nas últimas 24 h (posts normais) → `planSlot` espera até `freesAt`.
  - Aprovar um post de vaga (`InstagramActionsService.approvePost`) → agendado na hora pelo callback; `tick` agenda aprovado sem job e
    reconcilia `scheduled` sem job.
  - "Postar agora" (`force`) às 22h10 com limite cheio → job em agora+1 min.
  - Guarda: vaga 404 → texto de fechada; `FeedDownError` → `OriginUnavailable`; assinatura mudou → linha `new` com `redo_count 1`;
    **Review Focus #3:** 4ª mudança → linha `failed` com o texto D11 e nenhuma nova geração; `at` depois do início → "A vaga começou
    antes de ir ao ar.".
  - Post não-vaga: `blockReason` → `null` sem chamar a vitrine.
- [ ] **Step 2:** rodar os dois specs → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** rodar os dois specs e de novo `generator`, `origin-guards` → PASS.
- [ ] **Step 5: Commit** — `feat(vagas): horário livre, limite por dia, agendar depois de aprovar e guarda antes de publicar`.

---

### Task 11: Lista, detalhe, ações e prévia

**Files:**
- Create: `api/src/modules/vacancy-stories/vacancy-display.ts`, `vacancy-actions.service.ts`, `vacancy-preview.service.ts`
- Modify: `vacancy-stories.controller.ts`, `vacancy-stories.dto.ts`, `vacancy-stories.module.ts`
- Test: `api/src/modules/vacancy-stories/__tests__/display.spec.ts`, `actions.spec.ts`

**Interfaces:**
- Consumes: linhas + posts, `VacancySchedulerService.scheduleVacancyPost/planSlot`, `VacancyGeneratorService.makeArt`,
  `VacancyFeedClient`, `vacancyFields`, `formatWhen`, `formatMoney`.
- Produces:
  - `type Display = 'queued' | 'generating' | 'waiting_window' | 'waiting_cap' | 'to_approve' | 'ready' | 'live' | 'was_live' |
    'skipped' | 'cancelled' | 'failed'`.
  - `displayOf(row, post | null, s: SettingsRow, now: Date): { display: Display; reason: string | null; support: string | null }` —
    textos da UI §4: `queued` "Na fila para criar a arte"; `generating` "Criando a arte" / "Tentativa {n} de 3"; `waiting_window`
    "Esperando o horário" / "Vai ao ar às {8h}"; `waiting_cap` "Esperando a vez" / "Hoje já foram {n} (o máximo por dia). Vai ao ar amanhã
    às {8h}, se a vaga ainda não tiver começado."; `to_approve` "Esperando sua aprovação" / "Aprove até {16h}. Depois disso não dá tempo
    de divulgar."; `ready` "Pronto, vai ao ar às {14h50}"; `live` "No ar até {amanhã às 14h50}"; `was_live` "Ficou 24 h no ar";
    `skipped` "Não virou story" / motivo; `cancelled` "Não foi ao ar" / motivo; `failed` "Não conseguimos criar o story" / motivo.
    Motivo de post cancelado = `row.skip_reason ?? (rejection_reason ? 'Você escolheu não postar.' : post.last_error)`; post `failed` →
    "O Instagram recusou a publicação: {last_error}".
  - `StoryView` (wire): `{ id, external_id, status, display, label, support, reason, funcao, estabelecimento, valor, quando, cidade,
    starts_at, approve_until, scheduled_at, published_at, permalink, thumb_url, media_url, attempts, used_fallback, redo_count, ig_post_id,
    is_test, freela_url /* https://www.freelaservicosapp.com.br/vagas/{external_id} */, can: { approve, dont_post, post_now,
    create_anyway, redo, retry } }`; `StoryDetail = StoryView & { checks: FieldCheck[]; attempts_log: AttemptLog[]; alt: string }`
    (`alt` = "Story: Garçom, R$ 150, Sáb 31/10, 18h às 23h, Campinas").
  - `VacancyActionsService`: `list(ws, filter: 'all' | 'live' | 'not_posted')`, `detail(ws, id)`, `dontPost(userId, ws, id, feedback?)`,
    `postNow(userId, ws, id)`, `createAnyway(userId, ws, id)`, `redo(userId, ws, id)`.
  - `VacancyPreviewService.start(userId, ws): Promise<{ ok: true }>`; o estado em `settings.preview`: `{ status: 'running' | 'done' |
    'failed', step: 'art' | 'check', attempt: number, started_at, finished_at, media_url, checks, attempts, used_fallback, sample: boolean,
    error }`.
- Regras das ações (UI §4): `dontPost` — linha antes da entrega → `cancelled` "Você escolheu não postar."; entregue e não publicado →
  post `cancelled` (+ jobs) e `rejection_reason` "Você escolheu não postar."; chamada repetida com `feedback` só grava o feedback.
  `postNow` — só em `waiting_window|waiting_cap`: post → `scheduleVacancyPost({ force: true })`; linha `waiting` (limite) → `post_now
  true`, `status 'new'`, `not_before null` (gera na próxima rodada e agenda com `force`). `createAnyway` — só `skipped|cancelled|expired`
  com a vaga aberta (`byId`) e `starts_at` no futuro → `status 'new'`, `forced true`, `ig_post_id null`; vaga fechada → 400 "A vaga não
  está mais aberta no Freela.". `redo` — entregue e não publicado → cancela o post, linha `new` com `redo_count++` (teto D11 → 400 "Esta
  vaga já foi refeita 3 vezes."); `failed` → `new` ("Tentar de novo"). Prévia: vaga mais recente da vitrine com `isUpcoming` e valor; sem
  nenhuma → vaga de exemplo `{ title: 'Garçom', amountInCents: 15000, city: 'Campinas', contractorName: null }` no próximo sábado 18h–23h
  (`sample: true`); `makeArt` com `onStep` atualizando `settings.preview`; resultado vai para a Biblioteca (`ingest`, título
  "Prévia · story de vaga"); nunca cria `ig_posts`. Também roda sem Instagram conectado.

- [ ] **Step 1: Testes que falham** — `display.spec.ts`: um caso por situação da tabela, com os textos exatos (relógio fixo
  2026-10-29T13:00:00Z; janela 8h–21h; antecedência 120). `actions.spec.ts`: não postar antes e depois da entrega (+ feedback
  idempotente); postar agora fora do horário e acima do limite; criar mesmo assim numa vaga de teste aberta (vira `new` com `forced`) e
  numa fechada (400); refazer até o teto (4ª → 400); lista com filtro `live` e `not_posted`; isolamento: id de story de outra empresa →
  404; prévia sem vaga usa o exemplo e não cria `ig_posts`; segunda prévia em andamento → 409.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar** + rotas do contrato §26 (`@Param('id', ParseUuidPipe)`; estáticas antes de `:id`).
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** — `feat(vagas): lista, detalhe, ações e prévia dos stories das vagas`.

---

### Task 12: Web — cliente da API e aba "Vagas" (situação, primeira vez, ligar/desligar)

**Files:**
- Create: `web/src/modules/vacancy-stories/infrastructure/vacancy-stories.api.ts`
- Create: `web/src/lib/vacancy-stories.ts`, `web/src/lib/vacancy-stories.test.ts`
- Create: `web/src/components/instagram/vacancies/vacancies-tab.tsx`, `status-card.tsx`, `first-run.tsx`
- Modify: `web/src/app/(app)/instagram/InstagramPage.tsx`, `web/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: contrato §26.
- Produces: no `.api.ts` (zod no limite, `passthrough`): `getVacancySettings(ws)`, `patchVacancySettings(ws, body)`, `enableVacancies(ws)`,
  `disableVacancies(ws)`, `setVacancyAutoPublish(ws, v)`, `uploadVacancyTemplate(ws, file)`, `startVacancyPreview(ws)`,
  `listVacancyStories(ws, filter)`, `getVacancyStory(ws, id)`, `vacancyDontPost(ws, id, feedback?)`, `vacancyPostNow(ws, id)`,
  `vacancyCreateAnyway(ws, id)`, `vacancyRedo(ws, id)`; hook `useVacancySettings(ws)` (`queryKey ['vacancy-settings', ws]`,
  `retry: false`, `refetchInterval` 30 s; 404 → `null`).
  `lib/vacancy-stories.ts` (puro): `settingsSummary(s): string` ("Todas as cidades · 8h às 21h · até 10/dia · OpenAI");
  `hhLabel(iso | "HH:MM"): string` ("8h", "14h40"); `pollStale(s, now): boolean` (> 30 min sem sucesso); `dayLine(s): string`
  ("Hoje: 4 postados de 10 (o máximo por dia que você definiu)").
- Tela (UI §2 e §3): aba "Vagas" em 2º lugar, com "Vagas ({n})" quando `pending_approval > 0`; só existe com settings ≠ null
  (D7); `TABS` ganha `vagas` e `tabOf` cai em `overview` sem settings. Ordem no celular: situação → "Para aprovar" → "Vagas que
  chegaram" → "Ajustes" (as três últimas nas Tasks 13 e 14; aqui só os lugares). Primeira vez (sem arte): título, frase, passos,
  botão "Enviar arte modelo" (abre o seletor; o envio é da Task 14 — aqui chama `uploadVacancyTemplate`), "PNG, JPG ou WEBP, em pé.",
  interruptor desativado com "Envie a arte modelo para poder ligar.". Situação ligada/desligada com os textos; avisos: vitrine fora > 30
  min (amarelo), Instagram desconectado (vermelho, botão "Reconectar Instagram" → `?tab=overview`), IA (vermelho, "Abrir Integrações" →
  `/integrations` — conferir a rota em `lib/app-routes.ts`), limite (amarelo). Interruptor "Postar as vagas do Freela nos stories" com
  diálogos de ligar/desligar (textos §3, `{conta}` = `@username`, `{n}`/`{m}` = `counts.ready`/`counts.to_approve`); viewer vê sem
  poder mudar; só dono/admin (`canManage` do `useWorkspace`, conferir o nome) liga. Carregando: esqueleto. Erro: "Não conseguimos
  carregar as vagas. Verifique a conexão e toque em Tentar de novo." + botão. Menu: com settings e `pending_approval > 0`, o item
  Instagram aponta para `/instagram?tab=vagas`.

- [ ] **Step 1: Teste que falha** (`vacancy-stories.test.ts`, vitest):

```ts
expect(settingsSummary({ cities: [], window_start: '08:00', window_end: '21:00', daily_cap: 10, vendor: 'openai' })).toBe('Todas as cidades · 8h às 21h · até 10/dia · OpenAI');
expect(settingsSummary({ cities: ['Campinas', 'Jundiaí'], window_start: '09:30', window_end: '20:00', daily_cap: 5, vendor: 'gemini' })).toBe('2 cidades · 9h30 às 20h · até 5/dia · Gemini');
expect(dayLine({ today: { posted: 4, scheduled: 1, cap: 10 } })).toBe('Hoje: 4 postados de 10 (o máximo por dia que você definiu)');
expect(pollStale({ last_poll_ok_at: '2026-10-29T13:00:00Z', enabled: true }, new Date('2026-10-29T13:31:00Z'))).toBe(true);
```
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn test` → FAIL.
- [ ] **Step 3: Implementar** (componentes de `components/ui/*`, `toast` do sonner, `apiErrorMessage`).
- [ ] **Step 4:** `yarn test` → PASS; `../scripts/run-capped.sh 1500 yarn lint` → 0 erros nos arquivos novos.
- [ ] **Step 5: Commit** — `feat(vagas/web): aba Vagas com situação, primeira vez e ligar/desligar`.

---

### Task 13: Web — "Para aprovar", "Vagas que chegaram", detalhe e ações

**Files:**
- Create: `web/src/components/instagram/vacancies/approve-list.tsx`, `stories-list.tsx`, `story-detail.tsx`, `use-story-actions.ts`
- Modify: `vacancies-tab.tsx`, `web/src/lib/vacancy-stories.ts` (+ teste)

**Interfaces:**
- Consumes: `listVacancyStories`, `getVacancyStory`, ações (Task 12), `approvePost` (`lib/instagram/instagram.functions.ts`).
- Produces: `useStoryActions(ws)` → `{ approve(story), dontPost(story), postNow(story), createAnyway(story), redo(story) }`;
  `dontPost` segura 6 s (D5): toast "O story da vaga {função} não vai ao ar." com ação "Desfazer"; sem desfazer → chama a API e mostra
  os chips "Texto errado · Foto estranha · Não quero divulgar esta vaga" (mesma rota com `feedback`); `lib`: `reasonChipsFeedback`
  (rótulo → valor da API).
- Tela (UI §2, §4): cartão "Para aprovar" (miniatura 9:16, "{função} · {estabelecimento}", valor, quando, cidade, "✓ Conferido: função,
  valor, data, horário, cidade", "! Aprove até {16h}", **Não postar** / **Aprovar** com `h-11` no celular e 8 px entre eles); vazio
  "Nenhum story esperando você agora.". "Vagas que chegaram" com filtros Todas · No ar · Não postadas, cada item com ícone + texto da
  situação, apoio, motivo, selos "Versão de reserva" / "Refeita {n} vez(es)" e as ações permitidas por `can`. Vazio ligado: "Nenhuma vaga
  nova desde que você ligou ({28/10 às 14h30}). Consultamos o Freela a cada 10 minutos; a última foi às {14h40}.". Detalhe em `Sheet`
  de baixo: prévia 9:16 com 280 px de largura e `alt`, "Mostrar o que o Instagram cobre" (faixas translúcidas em 14% topo/20% base),
  tabela "Confira com a vaga" (✓ confere / ✗ diferente: a arte diz {lido}), linha das tentativas ("Feita pela IA na 2ª tentativa (a 1ª
  errou o horário)"), texto da reserva quando houver (com "Tentar de novo com a IA" = `redo` e "Ver as 3 tentativas" = lista do
  `attempts_log` com o campo errado marcado), "Abrir a vaga no Freela ↗", **Não postar** / **Aprovar**, "Refazer a arte". Item "no ar"
  com "Ver no Instagram" (`permalink`, só nas 24 h).
  Diálogos: postar agora fora do horário, acima do limite, criar story numa vaga de teste (textos §4). `aria-live="polite"` em "Criando
  a arte…" e toasts; situação sempre ícone + texto; alvos ≥ 44 px.

- [ ] **Step 1: Teste que falha** (vitest): `attemptsLine({ attempts_log: [{ n:1, ok:false, wrong:['inicio'] }, { n:2, ok:true, wrong:[] }],
  used_fallback:false })` → "Feita pela IA na 2ª tentativa (a 1ª errou o horário)"; com reserva → "Versão de reserva: a IA errou o
  {valor} nas 3 tentativas, então o sistema escreveu os textos por cima de uma foto. Os textos estão certos; o visual é mais simples.";
  `fieldLabel('inicio')` → "horário".
- [ ] **Step 2:** `yarn test` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `yarn test` → PASS; `yarn lint` → 0 erros.
- [ ] **Step 5: Commit** — `feat(vagas/web): aprovar, lista das vagas, detalhe com a conferência e ações`.

---

### Task 14: Web — Ajustes, arte modelo e prévia

**Files:**
- Create: `web/src/components/instagram/vacancies/settings-panel.tsx`, `template-card.tsx`, `preview-card.tsx`
- Modify: `vacancies-tab.tsx`

**Interfaces:**
- Consumes: `patchVacancySettings`, `uploadVacancyTemplate`, `startVacancyPreview`, `setVacancyAutoPublish`, `settingsSummary`.
- Tela (UI §2 "Ajustes" e §3): seção fechada com o resumo de 1 linha; arte modelo (miniatura, "Trocar arte modelo", "Gerar prévia com
  uma vaga real"; validação no navegador só para tamanho/tipo com os mesmos textos da API; aviso de deitada); cidades = lista de
  `recent_cities` com contagem e a opção "Todas as cidades" (nunca texto livre; cidades já salvas que não estão na lista continuam
  marcadas); "Horário para postar: Das [08:00] às [21:00]" (`type="time"`, erro "O início precisa ser antes do fim."); máximo por dia
  com −/+ (`aria-label` "Diminuir"/"Aumentar", 1–20, aviso acima de 15); antecedência (1 h · 2 h · 4 h · 6 h; no modo aprovar, a frase
  extra); "Quem desenha a arte" (OpenAI recomendado / Gemini + frase da chave); "Antes de ir ao ar" (Eu aprovo cada story — recomendado
  nas primeiras semanas / Postar sozinho → diálogo "Postar sem sua aprovação?" com `recent_outcomes`; vale na hora, sem esperar o
  Salvar); **Salvar ajustes** fixo embaixo, ativo só quando algo mudou; "Ajustes salvos." / erro com "Tentar de novo" mantendo o que foi
  digitado. Prévia: frase de custo; carregando com os passos "Criando a arte (tentativa {n} de 3)" → "Conferindo os textos"
  (`aria-live`, respeita `prefers-reduced-motion`), "Pode sair desta tela, ela fica salva aqui."; resultado com o selo "PRÉVIA · não foi
  postada" e a tabela da conferência; exemplo: "Não há vaga aberta no Freela agora. Usamos uma vaga de exemplo: Garçom, R$ 150, {Sáb
  31/10}, 18h às 23h, Campinas.". Vazio com arte e sem prévia: "Arte modelo salva. Gere uma prévia antes de ligar, para ver se a IA
  segue o seu modelo.". Aviso semanal quando `week.fallback / week.total ≥ 0,3` (e `total ≥ 5`).

- [ ] **Step 1: Teste que falha** (vitest): `capWarning(16)` → "Acima de 15, os posts normais da empresa podem ficar sem espaço no dia.";
  `capWarning(15)` → `null`; `autoPublishSummary({ n: 12, first_try: 8, redone: 2, fallback: 1, not_posted: 1 })` → "Nos últimos 12
  stories: 8 saíram certos de primeira, 2 foram refeitos, 1 foram para a reserva e você não postou 1."; `weeklyFallbackWarning({ total:
  12, fallback: 5 })` → "Nos últimos 7 dias, 5 de 12 stories foram para a reserva. Uma arte modelo com menos texto costuma ajudar a IA.".
- [ ] **Step 2:** `yarn test` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `yarn test` → PASS; `yarn lint` → 0 erros.
- [ ] **Step 5: Commit** — `feat(vagas/web): ajustes, arte modelo e prévia`.

---

### Task 15: Web — Aprovações, editor de post, calendário e Marcas

**Files:**
- Modify: `web/src/components/instagram/approvals.tsx`, `post-editor.tsx`, `calendar.tsx`, `web/src/app/(app)/brands/[id]/BrandDetail.tsx`

**Interfaces:**
- Consumes: `vacancyDontPost`, `vacancyRedo` (Task 12), `creative_brief.vacancy` do post.
- Mudanças: Aprovações — post `source === 'vacancy'` mostra o `theme`, a linha "✓ Conferido: …" (dos `checked_fields`) e abre o detalhe
  da vaga (navega para `/instagram?tab=vagas` com o story aberto, ou abre o `PostEditor` se a aba não existir); "Rejeitar" vira "Não
  postar" sem `window.prompt` (rota D6, com o mesmo toast/Desfazer da Task 13); no lote "Rejeitar selecionados", os de vaga seguem a
  rota D6 e os outros o prompt de hoje. Editor — para vaga: esconde "Regenerar mídia", "Ajustar", direção de arte, legenda e hashtags;
  mostra "Refazer a arte" (rota `redo`); "Enviar minha própria" fica com o aviso "A sua arte não passa pela conferência.". Calendário —
  D14. Marcas — `vacancy_template` aparece como "Arte modelo de vaga" (sem botão de envio nessa tela).

- [ ] **Step 1:** implementar as quatro mudanças.
- [ ] **Step 2:** `../scripts/run-capped.sh 1500 yarn lint` → 0 erros; `yarn test` → PASS.
- [ ] **Step 3: Commit** — `feat(vagas/web): stories de vaga em Aprovações, editor, calendário e Marcas`.

---

### Task 16: Smoke, verificação final e documentação

**Files:**
- Modify: `api/scripts/fake-providers.mjs` (vitrine falsa em `/freela/v1/bars-restaurants/public/vacancies/recent` e `/:id`: 3 vagas —
  teste, sem valor, válida daqui a 3 dias —, `/:id` desconhecido → 404), `scripts/test-stack.sh` (`mf_api_env`:
  `FREELA_PUBLIC_API_URL=http://127.0.0.1:3097/freela`, `VACANCY_STORIES_WORKSPACE_IDS='*'`), `api/scripts/smoke.sh`
- Modify: `web/scripts/browser-check.mjs` (seção `vagas` no grupo do Instagram)
- Modify: `CLAUDE.md` (linha da função em "Regras rápidas"), `README.md` (seção "Estado")

- [ ] **Step 1: Smoke** — acrescentar ao `smoke.sh` (no estilo dele): `GET settings` 200 com `enabled false`; `POST enable` sem arte → 400
  com o texto; `POST template` com PNG 600×900 → 200; `POST enable` → 200; `POST /api/public/cron/vacancy-stories` sem segredo → 401, com
  segredo → 200; `GET stories?filter=not_posted` → 2 itens com os motivos de teste e sem valor; `POST disable` → 200.
- [ ] **Step 2: Browser-check** — seção `vagas`: abre `/instagram?tab=vagas`, vê "Vagas do Freela nos stories", envia a arte, vê
  "Arte modelo salva…", abre Ajustes, muda o máximo por dia, salva ("Ajustes salvos."), sem erro de console/rede.
- [ ] **Step 3: Verificação, um por vez, com `free -m` antes de cada:** em `api/`: `../scripts/run-capped.sh 1500 npm run typecheck`;
  `../scripts/run-capped.sh 1500 npm run lint`; `../scripts/run-capped.sh 1500 npx jest` (suíte inteira; se der 137, rodar por pastas).
  Em `web/`: `../scripts/run-capped.sh 1500 yarn typecheck` (lembrar: a main do web pode ter quebras antigas — comparar com
  `git stash`/master antes de culpar a tarefa), `yarn lint`, `yarn test`. Smoke: `scripts/run-capped.sh 1300 bash api/scripts/smoke-capped.sh`.
  Browser-check: `bash web/scripts/browser-check-sections.sh 4` (pode ser recusado com 75 nesta máquina — registrar e seguir).
- [ ] **Step 4: Documentação** — `CLAUDE.md`: um item "**Stories das vagas (`api/src/modules/vacancy-stories`)**" com: lista
  `VACANCY_STORIES_WORKSPACE_IDS` (fora dela 404), fonte = vitrine pública do Freela (porta `FREELA_VACANCIES_FETCH`), job
  `vacancy-stories-10min`, guarda `PUBLISH_ORIGIN_GUARDS` no Instagram, selos oficiais em `api/assets/badges` (nunca redesenhar), leitura
  da arte às cegas cortada em y < 1360. README "Estado": uma linha.
- [ ] **Step 5: Desligar o Postgres local** (`docker compose stop postgres` na raiz) e conferir que não sobrou processo da pilha
  (`ss -ltnp | grep -E ':(3015|3025|3097|3098|3099) '` vazio).
- [ ] **Step 6: Commit** — `git add` dos arquivos → `test(vagas): smoke, browser-check e documentação`.

---

## Depois do plano (fora das tarefas)

1. `software-architect` e `ux-designer` revisam o branch inteiro; corrigir o que acharem (um subagente por vez), rodar de novo só os
   testes tocados e, no fim, o `typecheck` da API e do web.
2. Avisar o dono com: o que foi feito, testes, o que não rodou e por quê, comandos de push/deploy para ele rodar com `!`, e como achar o
   id da empresa Freela App sem ler o banco: logado no Meu Funil com a Freela App escolhida, DevTools → Application → Local Storage →
   chave `aimos.workspace` (é o id da empresa selecionada); ou DevTools → Network → `GET /v1/workspaces` → campo `id` da linha com o nome
   da empresa.
