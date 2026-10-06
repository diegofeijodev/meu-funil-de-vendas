# CLAUDE.md — Meu Funil

Projeto independente dentro do workspace Freela (repo git próprio, branch `master`, sem remote). Port do app Lovable "Meu Funil"
(`ai-brand-pilot`) para a stack do Freela: `api/` NestJS + Prisma + PostgreSQL, `web/` Next.js.
Especificação: `docs/superpowers/specs/2026-10-02-meu-funil-port-design.md`; plano: `docs/superpowers/plans/2026-10-02-meu-funil-port.md`;
inventários do protótipo (fonte da verdade): `docs/inventory/{db,server,web}.md`.

## Regras rápidas

- `api/` usa **npm**; `web/` usa **yarn**. Não misturar.
- Portas: API **3015**, web **3025**, Postgres **5439** (`docker compose up -d postgres` na raiz; contêiner `meu-funil-postgres`,
  user/senha/banco `meufunil`, subrede `172.61.0.0/24`). 3000/5432 são do Freela, 3010/3020/5438 do gestao-de-time, 3011/3021/5434 do
  plano-estrategico, 3012/3022/5435 do pedidos-online, 3013/3023/5436 do meu-par, 3014/3024/5437 da praça.
- **Contrato canônico da API: `docs/api-contract.md`.** Mudou endpoint? Atualize o contrato primeiro.
- Wire **snake_case** espelhando o banco (os modelos do Prisma têm exatamente os nomes de tabela/coluna do Supabase).
  `numeric`/`bigint` → number, `date` → `"YYYY-MM-DD"`: o interceptor global `common/http/wire.ts` cuida disso — controllers devolvem o resultado do Prisma.
  Data "só dia" é Brasília (`todaySp()`), nunca `toISOString()`.
- Erros sempre `{ error: { code, message } }` (`HttpExceptionFilter` global), com a MESMA mensagem pt-BR do protótipo (no auth, a string do GoTrue).
  Lance `new XException({ code, message })`. No web, ler com um helper que não achate para `error.message`.
- Funções que no protótipo devolviam `{ ok:false, error }` continuam devolvendo isso (HTTP 200).
- **Autenticação**: guard JWT global (`JwtAuthGuard`); rota pública = `@Public()`. Access token HS256 (`typ: access`) + refresh stateless (`typ: refresh`); ambos levam `ver` e morrem quando `users.token_version` muda (logout).
  `users.id` é o MESMO id de `profiles.id` e de todo `user_id`/`owner_id`/`created_by` (colunas uuid sem FK, como no protótipo).
- **Autorização**: toda rota de workspace exige membro — `WorkspaceAccessService.require(userId, workspaceId, 'read'|'write'|'manage')` ou
  `@UseGuards(WorkspaceAccessGuard)`. Viewer só lê; aprovar decisão e aprovar/ativar campanha = `manage` (owner|admin). Toda id recebida
  (corpo ou URL) é conferida contra o workspace — nada de buscar por id sem `workspace_id`.
- Id vindo da URL passa por `ParseUuidPipe`/`isUuid()` antes do Prisma (id malformado = 404, não 500).
- `ValidationPipe` global com `whitelist + forbidNonWhitelisted`: todo campo aceito tem decorator no DTO; campo opcional que muda invariante
  NÃO leva default no DTO. Rotas estáticas **antes** das `:id`.
- Rotas públicas `/api/public/**` do protótipo vivem **na API com o mesmo caminho** (o web faz `rewrites`).
- Prototipo Lovable de referência fica em `.prototype/` (gitignored, **só leitura**; nunca modificar). Telas portadas 1:1 (mesmo JSX/UX/textos pt-BR).
- Segredos só pelo cofre (`VaultService`, AES-256-GCM): nunca texto puro no banco, nunca no log, nunca na resposta (use `listMasked`).
- IA só via `AiService` (porta `AI_FETCH` injetável): **nenhum teste faz rede** — injete um fake. Modelo do protótipo → modelo real pelo mapa `AI_MODEL_*`.
- Arquivos só via `FilesService` (disco + URL assinada + contenção de caminho). Upload do navegador passa pela API (multipart).
- Leituras de CRM chamam `CrmDefaultsService.ensure(workspaceId)` primeiro (funil/etapas/motivos/tags/settings são criados na 1ª leitura).
- A API roda em **uma** instância: `SCHEDULER_ENABLED=true` em mais de uma duplicaria cada job. Throttle e limite do formulário por IP exigem `TRUST_PROXY=1` em produção (cliente → nginx → rewrite do Next → API: o rewrite do Next 15 NÃO acrescenta ao `X-Forwarded-For`, o peer da API é o Next = 1 salto e o cabeçalho vem do nginx; o nginx deve defini-lo, de preferência sobrescrevendo com `proxy_set_header X-Forwarded-For $remote_addr;`, e a porta da API não pode ser pública). `TRUST_PROXY=true` é inseguro (o cliente forja o IP); aceita também lista de IPs/CIDRs.
- Flag/variável nova entra em `common/config/env.validation.ts`, no `.env.example` e no `docker-compose.yml`.
- **Instagram (`api/src/modules/instagram`)**: o cliente da Graph API é UM só (`MetaGraphClient`, porta `META_FETCH` injetável; credenciais = cofre da empresa → global → env). Fila `publishing_jobs` (`instagram_organic`) com lock otimista, trava vencida em 15 min e 3 tentativas;
  cron `POST /api/public/cron/instagram` (+ 6 jobs do agendador em `InstagramCronService`) e webhook `/api/public/webhooks/instagram/:token` (corpo bruto: `rawBody: true` no `main.ts`; ledger em `modules/webhooks`). O `pollPendingCreatives` NÃO roda no cron do Instagram (já é o job `creative-poll-5min`). Produção automática (05/10/2026): o job `instagram-media-5min` roda `autoCalendarTick` (estratégia automática, reescrita dos reprovados do modo `publish`, agendar prontos) → `ProductionService.productionTick` (criativos das programações entre 48 h e 24 h antes — sem Instagram conectado só nas 24 h —, 1 post por empresa por rodada, pulados > 12 h) → `autopilotTick` (só posts de plano, `automation = null`). ffmpeg só pela porta `FFMPEG_RUNNER`/`FfmpegService` (temporários em `UPLOADS_DIR/.ffmpeg-tmp`; runner falso no jest, binário real só no smoke/browser-check).
  Cadências/SDR do canal Instagram entram pelo ponto de extensão `CRM_CHANNEL_HOOKS` (Task 8). Smoke do webhook: subir a API com `META_APP_SECRET=smoke-meta-secret`.
- Prisma: o schema é gerado de `api/prisma/tools/{spec,gen}.js` só na criação; a partir daqui edite `schema.prisma` à mão. O que o Prisma não expressa
  (CHECKs, índices parciais, `NULLS NOT DISTINCT`, gatilhos `touch_updated_at`) fica em SQL dentro da migração. Índices parciais exigem o predicado em `ON CONFLICT`.
  Nada de `$queryRawUnsafe` com entrada do usuário.

## Regras de baixo consumo (máquina do dono)

A máquina do dono tem 7,6 GB de RAM e outros containers/projetos rodando — ela **trava** sob build/teste em paralelo. Em `api/`:

1. **Nunca rode `npm run build` / `nest build` nem `next build`** durante uma tarefa comum.
2. `jest.config.js` tem `maxWorkers: 1` — não reverta.
3. Só UM de {jest, tsc, API, `next dev`, browser-check} de pé por vez. Para smoke: `npm run start:smoke` (ts-node `--transpile-only`, sem watch) em
   background, espere `curl -s localhost:3015/health`, rode `npm run smoke`, e **mate pelo PID** (`ss -ltnp | grep ':3015 '`) — nunca `pkill -f`.
4. `npm run typecheck` (`tsc --noEmit`) roda **uma vez, sozinho**, no fim da tarefa. Antes disso rode só o jest focado no que mexeu.
5. **Todo comando pesado (jest, tsc, lint, smoke, browser-check, migrate) vai por `scripts/run-capped.sh <teto-MB> <comando>`** (cgroup com `MemoryMax` + lock
   `.cache/heavy.lock` fora do git): estourar o teto mata só o comando (137) em vez de travar a máquina; 75 = sem memória livre agora (espere 2 min).
   Tetos: jest/typecheck/lint 1500; smoke (`api/scripts/smoke-capped.sh`) 1300; browser-check 2400 **por grupo** (`web/scripts/browser-check-sections.sh`,
   seções via `BC_ONLY`). Se um grupo morrer com 137, reparta o grupo — não suba o teto. A pilha de teste (fakes + API + web) vive em `scripts/test-stack.sh`.
6. `npx prisma migrate dev` pode ficar pendurado depois de aplicar (a migração já está feita): confira com `prisma migrate status` e mate o processo pelo PID.

## Comandos

```bash
docker compose up -d postgres          # na raiz
# api/
npm run start:dev | start:smoke | typecheck | lint | test | seed | smoke
npm run prisma:migrate:dev | prisma:migrate:deploy | prisma:generate | prisma:studio
# web/ (yarn)
yarn dev | typecheck | lint | browser-check
```

Seed de dev: `demo@meufunil.local` / `meufunil123` (owner de "Meu Funil Demo").

## Web (`web/`) — Next 15 App Router, yarn, porta 3025

- `dev` = `next dev -p 3025` (webpack; turbopack tem 500 conhecido com `next/font`). `NEXT_PUBLIC_API_URL` (padrão `http://localhost:3015`); a API precisa de `CORS_ORIGINS=http://localhost:3025`.
  `next.config.ts`: `rewrites` de `/api/public/:path*` para a API; `/calendar` -> `/instagram?tab=calendar`. Nunca `next build`.
- Telas 1:1 com `.prototype/src`: `components/ui/*` (46, verbatim), `app/globals.css` = `styles.css` (só `@source` e as fontes mudaram), `lib/{format,labels,metrics,crm,guides,utils}.ts` e `lib/creative/visual-style.ts` verbatim
  (só imports; `components/how-to.tsx` veio junto porque `guides.ts` importa o tipo). Logos reais em `public/meu-funil-{logo,symbol}.png`; `lib/assets.ts` mantém o `.url` do protótipo.
- **Shims de compat** (portar página = trocar só imports): `lib/router.tsx` (`Link`/`useNavigate`/`useSearch`/`useParams`/`useLocation`/`useRouterState`/`useRouter`/`redirect` com `to` + `params` (`/x/$id`) + `search`);
  `lib/server-fn.ts` (`useServerFn` = identidade; `serverFnPost` fabrica os shims `*.functions.ts`). Padrão dos shims em `src/lib/README.md`. **Não** existe `createFileRoute`/`Route`: o `page.tsx` é a rota
  (`Route.useSearch()` -> `useSearch()`, `Route.useParams()` -> `useParams()`, `head()` -> `export const metadata` num `page.tsx` de servidor).
- Auth: `modules/auth/**` (axios + zustand). `auth.storage.ts` é o ÚNICO dono do `localStorage` (sessão em `authUser`, empresa atual em `aimos.workspace`; ESLint barra o resto).
  `modules/shared/infrastructure/http.ts`: bearer, **refresh uma vez no 401** (chamadas paralelas dividem um refresh), `apiErrorMessage()` lê `{error:{message}}` — nunca achate para `error.message`.
  Google: `GET /v1/auth/google` (503 sem credenciais -> toast "Não foi possível entrar com o Google."); a sessão volta no fragmento `#access_token=…` para `/auth`.
- Guarda de sessão em `app/(app)/layout.tsx` (valida com `GET /v1/auth/me`; nenhuma página monta sem sessão). As 24 páginas do protótipo têm `page.tsx` real em `(app)/<rota>/` e a 25ª rota, `/calendar`, é só um redirect no `next.config` (não há catch-all);
  `lib/app-routes.ts` lista as rotas conhecidas e o `middleware.ts` responde 404 (root, sem shell) às demais; `lib/app-routes.test.ts` (`yarn test`, vitest) garante que páginas e lista não se separem.
- `lib/workspace.tsx` (`WorkspaceProvider`/`useWorkspace`): `GET /v1/workspaces`; `logActivity` virou no-op (a API registra a atividade). `lib/ig-pending.ts` é o selo do Instagram no menu (`GET /v1/workspaces/:id/ig-posts/pending-count`).
- ⚠️ `scripts/smoke.sh` e `scripts/browser-check.mjs` só rodam contra o banco local descartável: a limpeza apaga linhas que casam com padrões de teste (ex.: `Browser[0-9]+`).
- `scripts/browser-check.mjs` (Playwright do freela-web-v2): login pelo formulário, shell, menu, 404, refresh de token, Sair; falha em console/pageerror/rede/HTTP>=400. Cresce a cada tarefa.

- `NODE_ENV` não tem default: chave de dev do cofre e Swagger só com `NODE_ENV=development` (test p/ a chave). Sem NODE_ENV explícito e sem `CREDENTIALS_ENCRYPTION_KEY` a API não sobe. Fora de development/test `PUBLIC_URL` e `APP_URL` também são obrigatórias e não podem apontar para localhost (a API não sobe). Os overrides de provedor falso e as URLs locais/internas (fetch guardado) só valem com NODE_ENV=development|test (lista de permissão em `common/config/test-overrides.ts`).
