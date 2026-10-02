# Meu Funil — port — Implementation Plan

> Execução: subagent-driven (uma tarefa por vez, revisão por tarefa, revisão final). Steps em checkbox.

**Goal:** Portar o protótipo Lovable "Meu Funil" (`.prototype/`) para `api/` (NestJS+Prisma+Postgres) e `web/` (Next.js 15),
telas e comportamento 1:1, com autorização no servidor.

**Spec:** `docs/superpowers/specs/2026-10-02-meu-funil-port-design.md` · **Inventários:** `docs/inventory/{db,server,web}.md`

## Global Constraints

- Repo `/home/doutor/coding/freela/meu-funil`, branch `master`, commits locais (sem remote). Commits terminam com
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Portas API **3015**, web **3025**, Postgres **5439** (`meu-funil-postgres`, subrede `172.61.0.0/24`). `api/` npm, `web/` yarn.
- Scaffolding de referência: `/home/doutor/coding/freela/praca` (mesma stack; copiar padrões de `api/src/common`, `main.ts`,
  filtros de erro, guards, `web/src/modules/shared/infrastructure/http.ts`, auth store) — NÃO copiar regras de negócio de lá.
- Telas 1:1: JSX, classes Tailwind, textos pt-BR, ícones, toasts e fluxos iguais ao `.prototype/src`. Componentes shadcn
  (`.prototype/src/components/ui`) copiados verbatim. `styles.css` do protótipo vira `web/src/app/globals.css`.
- Formato de dados = colunas do banco em snake_case (igual ao Supabase). Ações (ex-server functions) mantêm corpo e retorno.
- Erros da API `{ error: { code, message } }` com a MESMA mensagem pt-BR do protótipo; status HTTP correto
  (400/401/403/404/409/422/429/502). Funções que no protótipo DEVOLVIAM `{ok:false,error}` continuam devolvendo isso (200).
- Toda rota de workspace: membro obrigatório; viewer só lê; decisões de aprovação e aprovar/ativar campanha = owner|admin.
  Toda id recebida é conferida contra o workspace (sem vazamento entre workspaces). Id da URL passa por `isUuid()`.
- `ValidationPipe` global com `whitelist + forbidNonWhitelisted`: todo campo aceito tem decorator no DTO.
- Rotas públicas `/api/public/**` vivem na API com o mesmo caminho (Next `rewrites`).
- Contrato canônico `docs/api-contract.md` atualizado por toda tarefa que cria/muda rota.
- **Máquina do dono (7,6 GB) trava com paralelo:** jest `maxWorkers: 1`; UM processo pesado por vez (jest, tsc, API, next
  dev, browser-check); nunca `nest build`/`next build`; smoke com `npm run start:smoke` (ts-node, sem watch) e matar pelo PID
  (`ss -ltnp | grep -E ':(3015|3025) '`); nunca `pkill -f`.
- Hoje/datas de agenda em America/Sao_Paulo (UTC-3 fixo, como o protótipo).

## Tarefas

### Task 0: Fundação da API + banco (todas as tabelas)
- docker-compose (só postgres; perfil `full` para api), `api/` scaffold (copiar padrões do praça): config/env (zod), Prisma,
  filtro de erro, guard JWT global + `@Public()`, throttler, health, CORS, multipart, `isUuid`, datas SP.
- **Prisma schema com as 63 tabelas do `db.md`** (nomes de tabela/coluna idênticos via `@@map`/`@map`, tipos, defaults,
  FKs, únicos, índices; `UNIQUE NULLS NOT DISTINCT` de `app_credentials` via SQL na migração). Uma migração `init`.
- Módulos-base: `auth` (signup/login/me/logout/refresh + Google OAuth opcional; mensagens GoTrue), `workspaces`
  (create_workspace, meus workspaces + papel, membros, perfis — `settings.tsx` lê perfis dos membros), `access`
  (`WorkspaceAccessService.require(userId, wsId, 'read'|'write'|'manage')`), `files` (disco + URL assinada + upload multipart),
  `vault` (AES-256-GCM/HKDF; get/set/list mascarado por workspace e global), `ai` (cliente texto/JSON-schema/visão/imagem/vídeo:
  gateway OpenAI-compatível + chaves BYO OpenAI/Gemini do workspace + mapa de modelos), `scheduler` (registro de jobs com
  `SCHEDULER_ENABLED`), CRM defaults lazy (pipeline/etapas/motivos/tags/settings criados na 1ª leitura do workspace).
- Seed de dev: `demo@meufunil.local` / `meufunil123`, workspace demo (owner), sem dados `source='demo'` fora do que o
  protótipo semeava no cadastro (ver `db.md` §8).
- Testes jest: auth (mensagens), access (matriz de papéis), vault (cifra/decifra, chave errada), files (assinatura/expira),
  CRM defaults idempotente. `docs/api-contract.md` §1–§N (convenções + auth/workspaces/files/vault). `CLAUDE.md` + README.

### Task 1: Fundação do web
- `web/` Next 15 (copiar setup do praça: providers react-query, sonner, http axios com token + refresh, auth store em
  `modules/auth/infrastructure/auth.storage.ts` único dono do localStorage), `globals.css` = `styles.css` do protótipo,
  fontes, `components/ui/*` verbatim, `hooks/use-mobile`.
- Shims: `src/lib/router.tsx` (Link/useNavigate/useSearch/useParams/redirect sobre next/navigation com a mesma API usada
  pelas páginas), `src/lib/server-fn.ts` (`useServerFn`), padrão de shim de `*.functions.ts`.
- `/auth` (UI idêntica; e-mail/senha; botão Google), guarda de sessão em `app/(app)/layout.tsx`, `AppShell` (sidebar/nav
  com os mesmos itens/ícones/gates), `WorkspaceProvider` (`lib/workspace.tsx` ligado à API), `/` → redirect igual,
  404/erro, logos (`docs/inventory/web.md` §3–§4, §8). `next.config` com `rewrites` de `/api/public/:path*`.
- Libs cliente copiadas verbatim: `format.ts`, `labels.ts`, `metrics.ts`, `crm.ts`, `guides.ts`, `utils.ts`, `visual-style.ts`.
- Script `web/scripts/browser-check.mjs` (Playwright de `/home/doutor/coding/freela/freela-web-v2/node_modules`) com login
  e checagem do shell; cresce a cada tarefa.

### Task 2: Marca, visão geral, configurações, agência
Páginas `/overview`, `/brands`, `/brands/$id`, `/settings`, `/agency` (web.md §2.1, §2.2, §2.4, §2.5, §2.15) + ações
`setup.functions`, `agency.functions` (server.md §1.1, §1.6) + recursos de tabela que essas páginas tocam (web.md §10).

### Task 3: Campanhas, estrategista, copy, aprovações
`/campaigns`, `/campaigns/new`, `/campaigns/$id`, `/approvals` (web.md §2.3, §2.6–§2.8) + `ai/strategist.functions`,
`copy-ai.functions`, `approvals.functions` (server.md §1.4, §1.5, §1.7) + triggers de papel (db.md §4).

### Task 4: Estúdio criativo, biblioteca de mídia, Canva, MCP
`/studio`, `/library` (web.md §2.9, §2.10) + `creative.functions`, `media/export.functions`, `media/manage.functions`,
`creative/canva.functions`, `mcp.functions` (server.md §1.9–§1.14) + pipeline de imagem (jimp/opentype, fonte vendorizada)
+ provedores de imagem/vídeo + rotas públicas `canva/oauth/callback` e `mcp/callback`.

### Task 5: Instagram orgânico, piloto automático, calendário automático
`/instagram` (+ components/instagram), `/calendar` (redirect) (web.md §2.11) + `instagram/*.functions` (server.md §1.15–§1.17)
+ cron `instagram` (tarefas media/weekly/optimize/publish, fila `publishing_jobs` com lock) + webhook instagram.

### Task 6: Meta Ads, gestor de tráfego, Google/TikTok, desempenho, insights
`/performance`, `/insights` (web.md §2.12, §2.13) + `meta-ads.functions`, `meta/ads-ops.functions`, `ads/channels.functions`,
`ai-diagnostics` se usado aqui (server.md §1.2, §1.8, §1.18–§1.20) + rotas `meta/oauth/callback`, `ads/oauth/$channel`,
cron `ads`.

### Task 7: CRM núcleo
Layout `/crm`, funil (kanban), `/crm/leads`, `/crm/leads/$id`, `/crm/tasks`, `/crm/dashboard`, `/crm/settings` (sem o painel
SDR) (web.md §2.16–§2.19, §2.22, §2.23, §2.26) + formulários públicos (`forms/$token`, `forms/embed.$token`) + descadastro.

### Task 8: CRM canais, inbox, cadências, SDR
`/crm/inbox`, `WhatsAppChat`, `/crm/integrations`, `/crm/cadences`, painel SDR (web.md §2.20, §2.21, §2.24–§2.26) +
`crm-integrations`, `crm-cadences`, `crm-sdr` (server.md §1.21–§1.24) + webhooks whatsapp/meta leadgen + crons
`crm-cadences` (com lock) e `crm-daily`.

### Task 9: Integrações, agendador completo, verificação ponta a ponta
`/integrations` (web.md §2.14) + `ai-keys.functions`, `ai-diagnostics.functions` (server.md §1.2, §1.3) + todos os jobs do
agendador com os horários do `db.md` §6 + `api/scripts/smoke.sh` completo + browser-check completo + README/CLAUDE.md/contrato.
