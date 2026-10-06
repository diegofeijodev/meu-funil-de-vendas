# Migração dos dados do Lovable para a stack própria — design

Data: 06/10/2026. Pedido do Denner: "preparar a mesma solução que fizemos para migrar os dados da Lovable no gestao de time para o funil".

## Contexto

- O Meu Funil roda em produção na stack própria desde 06/10: web na Vercel (`www.meufunildevendas.com.br`, `meu-funil-nine.vercel.app`),
  API + Postgres no EC2 do Freela (`/opt/meu-funil`, contêineres `meufunil-api` e `meufunil-postgres`, banco `meufunil` **vazio**).
- O domínio já aponta para o sistema novo (decisão do dono: manter assim durante a preparação; quem precisar usa o endereço `*.lovable.app`).
- O protótipo continua no Lovable Cloud (Supabase gerenciado): 62 tabelas em `public`, contas em `auth.users`/`auth.identities`,
  arquivos nos buckets `creative-assets` e `ig-media`. As 62 tabelas existem com o mesmo nome no nosso schema (que espelha o do Supabase
  coluna a coluna, com colunas novas que têm default); só `users` e `oauth_states` são nossas.
- O gestao-de-time foi migrado com: função SQL só-leitura com token + rota de arquivos no app Lovable → `pull.mjs` → réplica local →
  dump para produção. Aqui a exportação é a mesma; o resto muda (abaixo) porque os segredos de produção só existem no EC2.

## Decisões (com o dono)

1. **Abordagem "tudo no EC2"**: pull, ensaio e virada rodam no EC2; um importador novo lê o JSON exportado direto (sem réplica do Supabase).
2. **Credenciais migradas** com a `CREDENTIALS_ENCRYPTION_KEY` do Lovable, colocada pelo dono no `.env` do EC2 como
   `LEGACY_CREDENTIALS_ENCRYPTION_KEY` (nunca passa pela sessão), e apagada depois da virada.
3. **Posts com horário vencido** durante a mudança não publicam sozinhos; **cadências do CRM** vencidas seguem a partir da importação,
   exceto as vencidas há mais de 3 dias, que param.
4. O domínio fica no sistema novo durante a preparação (sem novas trocas de DNS).

## Fluxo

1. **Exportação no Lovable** (o dono cola um prompt pronto no Lovable):
   - função `public.export_meufunil(p_token, p_action, p_schema, p_table, p_limit, p_offset)` — `SECURITY DEFINER`, `STABLE`, só leitura;
     recusa se `sha256(p_token)` ≠ hash embutido; ações `manifest` (contagem de toda tabela `public`, `auth.users`, `auth.identities`,
     buckets e lista de objetos com tamanho) e `table` (linhas em páginas de até 2000, só tabelas `public` existentes + `auth.users`/`auth.identities`);
   - rota `GET /api/export-file?bucket=&name=` no app (TanStack Start), header `x-export-token` conferido pelo mesmo hash, lendo o
     Storage com a service key do servidor; só os buckets `creative-assets` e `ig-media`.
   - O token é gerado no EC2 (`openssl rand -hex 32`, arquivo `600`); o prompt leva só o hash.
2. **Pull no EC2**: `pull.mjs` (adaptado do gestao) roda num contêiner `node:22-alpine` temporário e grava em
   `/opt/meu-funil/lovable-export/<AAAAMMDD-HHMM>/` `manifest.json`, `tables/<schema>.<tabela>.json` e `storage/<bucket>/<caminho>`.
   Mostra o tamanho total do Storage antes de baixar (disco livre hoje: 12 GB) e confere no fim contagens e tamanhos; sai 1 se algo não bater.
   A pasta é `700` do `ubuntu` e é apagada depois da conferência final.
3. **Ensaio**: banco `meufunil_stage` criado vazio no `meufunil-postgres` + `prisma migrate deploy`; importador dentro do `meufunil-api` com
   `DATABASE_URL` do stage e uploads em `/data/uploads/.stage` → `--dry-run` → carga → `--verify`; o relatório é revisado com o dono.
   Depois: `DROP DATABASE meufunil_stage` e apagar `/data/uploads/.stage`.
4. **Virada**: o dono avisa os usuários do `*.lovable.app` e congela o uso → pull novo → importador no banco `meufunil` (vazio) →
   `--verify` → login do dono em `www.meufunildevendas.com.br` → apagar `LEGACY_CREDENTIALS_ENCRYPTION_KEY` do `.env` e o export.
5. **Limpeza no Lovable** (segundo prompt): `DROP FUNCTION public.export_meufunil(...)`, remover a rota `/api/export-file` e desagendar os
   jobs do `pg_cron` (apontam para o domínio, que agora é o sistema novo).

**Plano de volta**: o Lovable nunca é escrito. Volta = A do apex para `185.158.133.1`; o banco novo é recriado vazio
(`DROP/CREATE DATABASE meufunil` + reinício da API, que aplica as migrations) e os uploads importados são apagados.

## O importador (`api/src/scripts/import-lovable/`)

Script avulso (não sobe o app Nest — o agendador não pode rodar durante a carga), compilado na imagem da API:

```
node dist/src/scripts/import-lovable/main.js --export <pasta> --expect-db <banco> --uploads-dir <pasta>
     [--dry-run | --verify | --only-files] [--skip-credentials]
```

A pasta de exportação chega ao contêiner por um bind mount só-leitura (`./lovable-export:/import:ro` no `docker-compose.prod.yml`).

**Travas**
- O banco conectado precisa se chamar exatamente `--expect-db` e estar vazio (`users` = 0 e `workspaces` = 0); senão aborta antes de gravar.
- Tudo numa única transação; erro em qualquer etapa = nada gravado. `--dry-run` executa tudo e faz `ROLLBACK` no fim (arquivos não são copiados).
- Durante a carga: `SET LOCAL session_replication_role = replica` (sem FKs nem gatilhos, como no gestao; `updated_at` preservado).
- Nomes de tabela/coluna vêm da exportação, então só entram em SQL depois de conferidos contra o `information_schema` do destino
  (lista de permissão) e sempre entre aspas; valores só como parâmetro (`jsonb_populate_recordset($1::jsonb)`, lotes de 500).

**Carga**
- Toda tabela `public` exportada que existe no destino, mantendo os ids. Colunas = interseção (chaves do JSON ∩ colunas não geradas do destino).
  Coluna só da origem → "dado não migrado" no relatório; coluna obrigatória só do destino e sem default → o `--dry-run` falha nomeando-a.
- Tabela exportada que não existe no destino → aborta (nunca descarta tabela em silêncio).
- **Pulada de propósito**: `cron_tokens` (os agendamentos do Lovable não podem acionar `/api/public/cron/*` do sistema novo).
- **Logins** — `auth.users` (+ `auth.identities`) → `users`: `id` igual (= `profiles.id`), `email` em minúsculas, `password_hash` =
  `encrypted_password` quando é bcrypt (`$2a$`/`$2b$`/`$2y$`; outro formato → nulo e entra no relatório), `google_sub` = `provider_id` da
  identidade `google`, `token_version` 0, `created_at` igual. Contas com `deleted_at` ou `banned_until` no futuro ficam de fora (as linhas
  delas viram órfãs apontadas pelo `--verify`). E-mail repetido (sem diferenciar maiúsculas) aborta com a lista. O relatório lista as contas
  sem senha nem Google (não conseguem entrar até haver login Google configurado).

**Pós-carga (mesma transação do banco, dentro do contêiner, com os segredos de produção)**
- **Arquivos** (depois do `COMMIT`, porque disco não entra na transação): cada `storage/<bucket>/<caminho>` exportado é copiado para
  `<uploads-dir>/<bucket>/<caminho>` com a mesma validação de contenção do `FilesService` (caminho fora da pasta = aborta). Cópia
  idempotente (pula arquivo idêntico); se falhar no meio, `--only-files` refaz só esta etapa.
- **Links**: em toda coluna `text`/`varchar`/`jsonb` das tabelas carregadas (inclusive dentro de JSON), toda URL do Storage do Lovable
  `https://<ref>.supabase.co/storage/v1/object/(sign|public)/<bucket>/<caminho>[?…]` vira `FilesService.signedUrl(bucket, caminho)`
  (5 anos, `PUBLIC_URL` e segredo do ambiente). Caminho sem arquivo exportado → link mantido e listado no relatório.
- **Credenciais**: `app_credentials.value` `enc:v1:<iv>:<dados>` (AES-GCM, chave = SHA-256 do segredo do Lovable) → decifra com
  `LEGACY_CREDENTIALS_ENCRYPTION_KEY` → `VaultService.encryptValue` (`enc:v2`); texto puro → cifra. Em `mcp_connections`, cifra
  `access_token`, `refresh_token`, `oauth_client_secret`, `oauth_code_verifier` que estejam em texto. Só o que o nosso código decifra na
  leitura é cifrado (`crm_integrations.config` e os tokens de webhook ficam como estão). Existe `enc:v1` e a chave não foi definida → aborta,
  salvo `--skip-credentials` (as credenciais `enc:v1` não são importadas e o relatório conta quantas). Falha ao decifrar → aborta.
- **Travas zeradas**: `ig_posts.lease_until`, `publishing_jobs.locked_at`, `ig_auto_runs.locked_until` = nulo.
- **Vencidos** (relativos ao momento da importação):
  - `publishing_jobs` `queued`/`processing` com `run_at` no passado → `cancelled`; o `ig_post` ligado → `failed`, `failure_kind` `publish`,
    `last_error` "O horário passou durante a mudança de sistema. Reagende pela tela." Futuros seguem normalmente.
  - `crm_cadence_runs` `running`: `next_run_at` vencido há até 3 dias segue (sai nos próximos ciclos); há mais de 3 dias → `stopped`.
  - Qualquer outra tabela com `status` pendente e horário vencido que o ensaio revelar entra no relatório para decisão antes da virada.

**`--verify`** (sem gravar): contagem por tabela no destino = manifesto − puladas − contas filtradas; linhas órfãs (colunas `*_id`/`user_id`/
`owner_id`/`created_by` que apontam para conta/empresa inexistente); arquivos exportados ausentes em disco; links do Storage do Lovable restantes;
credenciais que não decifram com a chave atual. Sai 1 se houver diferença de contagem, órfão, arquivo ausente ou credencial ilegível;
links do Lovable restantes só são avisados (já listados pela carga como arquivo que não veio).

**Relatório** (saída do comando e `<export>/relatorio-<modo>.json`): só contagens, ids, nomes de tabela/coluna e caminhos de arquivo — nunca
valores de credenciais, tokens, senhas ou e-mails completos.

## Arquivos

- `api/src/scripts/import-lovable/` — `main.ts` (CLI e travas), e módulos puros: `auth-map.ts` (users), `storage-links.ts` (reescrita de links
  em texto e JSON), `legacy-crypto.ts` (decifra `enc:v1`), `columns.ts` (interseção e validação de identificadores), `overdue.ts` (vencidos),
  `verify.ts`, `report.ts`.
- `api/scripts/lovable-export/` — `export_meufunil.sql` (com marcador do hash), `pull.mjs`, `prompt-exportacao.md`, `prompt-limpeza.md`.
- `docker-compose.prod.yml` — bind mount `./lovable-export:/import:ro` na API.
- `docs/migracao-lovable.md` — runbook: token → prompt → pull → ensaio → virada → limpeza → plano de volta.

## Testes

- jest (sem rede, sem dados reais), dados sintéticos no formato da exportação: mapeamento de logins (bcrypt, Google, apagada, banida,
  e-mail repetido, sem senha), reescrita de links (sign/public, query string, dentro de JSON aninhado, caminho com espaço/acentos, arquivo
  ausente), `enc:v1` (vetor gerado com WebCrypto como o protótipo; chave errada falha), interseção de colunas e validação de nomes,
  vencidos (limites de 3 dias e "agora"), contenção de caminho.
- Ponta a ponta numa base local descartável (via `scripts/run-capped.sh`): exportação sintética pequena → `--dry-run` (nada gravado) →
  carga → `--verify` limpo; segunda carga recusada (destino não vazio); banco com nome errado recusado.

## Critério de sucesso

`--verify` no `meufunil` sem pendências não aceitas; o dono entra com a senha atual em `www.meufunildevendas.com.br` e vê as empresas,
posts, criativos com imagem e o CRM; nenhum link para `supabase.co` além dos listados no relatório; credenciais das integrações legíveis.
