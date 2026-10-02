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
- **Autenticação**: guard JWT global (`JwtAuthGuard`); rota pública = `@Public()`. Access token HS256 (`typ: access`) + refresh stateless (`typ: refresh`, revogado por `users.token_version`).
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
- A API roda em **uma** instância: `SCHEDULER_ENABLED=true` em mais de uma duplicaria cada job. Throttle por IP exige `TRUST_PROXY=true` atrás de nginx.
- Flag/variável nova entra em `common/config/env.validation.ts`, no `.env.example` e no `docker-compose.yml`.
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
5. `npx prisma migrate dev` pode ficar pendurado depois de aplicar (a migração já está feita): confira com `prisma migrate status` e mate o processo pelo PID.

## Comandos

```bash
docker compose up -d postgres          # na raiz
# api/
npm run start:dev | start:smoke | typecheck | lint | test | seed | smoke
npm run prisma:migrate:dev | prisma:migrate:deploy | prisma:generate | prisma:studio
# web/ (yarn)  — Task 1 em diante
```

Seed de dev: `demo@meufunil.local` / `meufunil123` (owner de "Meu Funil Demo").
