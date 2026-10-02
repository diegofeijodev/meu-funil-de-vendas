# Meu Funil — port do Lovable para a stack própria — design

**Data:** 2026-10-02 · **Projeto:** `/home/doutor/coding/freela/meu-funil` (repo git próprio, branch `master`, sem remote) ·
**Protótipo:** `.prototype/` (zip `ai-brand-pilot-87.zip`, gitignored, só leitura) ·
**Inventários (fonte da verdade do que existe):** `docs/inventory/{db,server,web}.md`

## 1. Pedido (Denner, 01/10 noite)

"Tal qual o gestão, faça uma versão real fora da Lovable do meu funil. Mantenha tudo 100% igual ao que é hoje, mas faça a
separação direitinho de API, banco de dados, front. Não precisa publicar nada. Só faça o projeto. Só pare quando terminar
100%. Cuidado ao rodar testes e tome as decisões que achar melhor."

## 2. Decisões (tomadas pelo agente, por delegação explícita)

1. **Stack igual aos outros ports** (praça/gestão): `api/` NestJS 11 + Fastify + Prisma 5.22 + PostgreSQL 16 (npm); `web/`
   Next.js 15 App Router + React 19 + Tailwind 4 + shadcn (yarn). Portas: **API 3015 · web 3025 · Postgres 5439**
   (contêiner `meu-funil-postgres`, subrede docker fixa `172.61.0.0/24`).
2. **"100% igual" = mesmas telas, textos, fluxos e formatos de dados.** As páginas são portadas 1:1 (mesmo JSX/UX/
   textos pt-BR). O formato JSON das linhas segue os nomes de coluna do banco (snake_case), igual ao que o Supabase devolvia.
3. **Separação:** o web só fala HTTP com a API; só a API fala com o banco.
   - Acesso direto do navegador às tabelas (149 chamadas, 46 tabelas) vira **endpoints REST por recurso**, escopados no
     workspace: `GET/POST/PATCH/DELETE /v1/workspaces/:workspaceId/<recurso>[/:id]` (+ filtros explícitos). No web, cada
     domínio tem `modules/<domínio>/infrastructure/*.api.ts`.
   - As 117 funções de servidor viram **endpoints de ação** `POST /v1/<módulo>/<nome-kebab>` com o MESMO corpo (`data`) e o
     MESMO retorno. No web, `src/lib/**/<arquivo>.functions.ts` vira um shim com os mesmos nomes exportados chamando a API,
     e `useServerFn(fn)` vira um shim que devolve a própria função — as páginas mudam o mínimo.
   - As 19 rotas públicas (`/api/public/**`: cron, webhooks, OAuth callbacks, formulários, descadastro) ficam **na API com o
     mesmo caminho**; o Next faz `rewrites` de `/api/public/:path*` para a API, então as URLs que o usuário copia (webhook,
     formulário embutido, callback OAuth montado a partir de `window.location.origin`) continuam idênticas.
4. **Auth própria** no lugar do Supabase Auth: e-mail + senha (bcrypt) com JWT HS256 próprio; mensagens de erro iguais às do
   GoTrue que a tela já mapeia ("Invalid login credentials", "User already registered", …). Login com Google (era Lovable
   Cloud Auth) via OAuth do Google **se** `GOOGLE_CLIENT_ID/SECRET` estiverem configurados; sem isso o botão aparece igual e
   mostra o erro de indisponível. O cadastro cria `profiles` + workspace inicial (o que o trigger de `auth.users` fazia).
5. **Autorização no servidor** (no lugar do RLS): toda rota de workspace exige ser membro. Papéis: `owner|admin|marketing|
   viewer`. Mantido o comportamento visível do protótipo e fechado o que era só "botão escondido": **viewer só lê**;
   aprovar decisão, aprovar/ativar campanha = **owner|admin** (eram triggers). Os bugs de vazamento entre workspaces (CRM
   send/enroll/stop/saveCadence com ids não escopados) são corrigidos — toda id é conferida contra o workspace.
6. **Arquivos**: o bucket `creative-assets` (privado) vira disco local (`UPLOADS_DIR/<bucket>/<chave>`) servido por
   `GET /v1/files/:bucket/*` com **URL assinada HMAC** (validade longa, igual às URLs de 1–5 anos que o protótipo gravava no
   banco). Upload do navegador passa pela API (multipart).
7. **Cofre de credenciais** (`app_credentials`): AES-256-GCM com chave derivada (HKDF) de `CREDENTIALS_ENCRYPTION_KEY`
   (obrigatória em produção; em dev, chave de dev). Nunca grava texto puro. Tokens de MCP também cifrados.
8. **IA**: o "Lovable AI gateway" vira um **gateway compatível com OpenAI configurável** (`AI_GATEWAY_URL`,
   `AI_GATEWAY_API_KEY`) + as chaves BYO por workspace que o protótipo já tinha (OpenAI/Gemini). Os ids de modelo do
   protótipo (`openai/gpt-6-astra` etc.) passam por um mapa configurável (`AI_MODEL_*`). Sem chave nenhuma → o mesmo erro
   amigável que a tela já mostra quando a IA falha.
9. **Agendador**: o `pg_cron + pg_net` vira `@nestjs/schedule` dentro da API, mesmos horários (em UTC), atrás de
   `SCHEDULER_ENABLED` (uma instância só). As rotas `/api/public/cron/*` continuam (protegidas por token) para paridade.
10. **Domínio fixo** `https://www.meufunildevendas.com.br` (SQL, Canva, descadastro) vira `APP_URL`.
11. **Dados reais**: não há migração de dados do Supabase nesta etapa (sem credenciais; nada publicado). Seed de dev com
    um usuário e workspace de demonstração.
12. **Logos**: os PNGs eram ponteiros da CDN do Lovable; baixar do site publicado (ou usar o asset do repo se existir).
13. **Testes respeitando a máquina** (7,6 GB, trava com paralelo): jest com `maxWorkers: 1`; um processo pesado por vez;
    nunca `nest build`/`next build`; smoke via `start:smoke` (ts-node sem watch); derrubar pelo PID.

## 3. Fora de escopo

Publicação/deploy; migração de dados do Supabase; funcionalidades novas além do protótipo (só correções de segurança/
autorização e os bugs óbvios listados nos inventários, sem mudar a experiência).
