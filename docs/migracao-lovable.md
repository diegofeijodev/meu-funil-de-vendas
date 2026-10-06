# Migração dos dados do Lovable — runbook

Spec: `docs/superpowers/specs/2026-10-06-migracao-lovable-design.md`. Tudo roda no EC2: `ssh ubuntu@56.124.127.54`, `cd /opt/meu-funil`.
O Lovable nunca é escrito; o banco `meufunil` só recebe a carga se estiver vazio.

## 0. Uma vez

```bash
install -d -m 700 /opt/meu-funil/lovable-export
# imagem da API com o importador: deploy normal (docs/deploy.md §2), antes: docker tag meufunil-api:latest meufunil-api:pre-migracao
```

Atalhos usados abaixo (num shell só; `pipefail` faz o `| tee` não esconder o código de saída):

```bash
set -o pipefail
DC="docker compose -f docker-compose.prod.yml"
RUN="$DC run --rm --no-deps"
ME="$(id -u):$(id -g)"        # o pull grava como ubuntu (a imagem roda como root): a pasta, o tee e a limpeza funcionam
STAMP=$(date +%Y%m%d-%H%M)
```

## 1. Token e prompt (uma vez)

```bash
umask 077; openssl rand -hex 32 | tr -d '\n' > lovable-export/token
HASH=$(sha256sum < lovable-export/token | cut -d' ' -f1); echo "$HASH"   # o hash não é segredo
$RUN api node scripts/lovable-export/render-prompts.mjs --hash "$HASH" --only exportacao
```

O dono cola o prompt no Lovable (cria a função `export_meufunil` e a rota `/api/export-file`, publica) e informa a URL `https://<app>.lovable.app`.
`lovable-export/lovable.env` (600): `SUPABASE_URL=` e `SUPABASE_PUBLISHABLE_KEY=` do `.env` do repositório do Lovable (valores públicos).
Credenciais: o dono acrescenta ao `.env` a linha `LEGACY_CREDENTIALS_ENCRYPTION_KEY=<a CREDENTIALS_ENCRYPTION_KEY do Lovable>` (por SSH, nunca por chat).

## 2. Pull

```bash
pull() { $RUN --user "$ME" -v /opt/meu-funil/lovable-export:/out api node scripts/lovable-export/pull.mjs --env /out/lovable.env --token-file /out/token --file-url "https://<app>.lovable.app/api/export-file" "$@"; }
pull --out /out/$STAMP --check-only   # totais de linhas e arquivos
df -h /                               # livre ≥ 3 × o tamanho dos arquivos + 2 GB (exportação + cópia do ensaio + cópia da virada)
pull --out /out/$STAMP                # sai 1 se algo não bater: rode de novo (retoma os arquivos já baixados)
```

Para ver se alguma tabela é grande demais para a memória do contêiner (1 GB): `du -h lovable-export/$STAMP/tables/* | sort -h | tail`.

## 3. Ensaio (banco meufunil_stage)

```bash
docker exec meufunil-postgres psql -U meufunil -d postgres -c 'DROP DATABASE IF EXISTS meufunil_stage WITH (FORCE)' -c 'CREATE DATABASE meufunil_stage'
STAGE="postgresql://meufunil:$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)@meufunil-postgres:5432/meufunil_stage?schema=public"
$RUN -e DATABASE_URL="$STAGE" api npx prisma migrate deploy
imp() { $RUN -e DATABASE_URL="$STAGE" api node dist/src/scripts/import-lovable/main.js --export /import/$STAMP --expect-db meufunil_stage --uploads-dir /data/uploads/.stage "$@"; }
imp --dry-run 2>&1 | tee lovable-export/$STAMP/ensaio-dry-run.txt
imp           2>&1 | tee lovable-export/$STAMP/ensaio-carga.txt
imp --verify  2>&1 | tee lovable-export/$STAMP/ensaio-verify.txt
```

Revisar com o dono: dados não migrados, contas sem login, links mantidos, duplicatas descartadas, vencidos e pendentes vencidos. Depois
(libera o disco para a virada; os relatórios do ensaio ficam guardados fora da pasta da exportação):

```bash
docker exec meufunil-postgres psql -U meufunil -d postgres -c 'DROP DATABASE meufunil_stage WITH (FORCE)'
$RUN api rm -rf /data/uploads/.stage
mkdir -p ~/relatorios-migracao && cp lovable-export/$STAMP/*.txt ~/relatorios-migracao/ && rm -rf lovable-export/$STAMP
```

## 4. Virada

1. O dono avisa os usuários do `*.lovable.app` e congela o uso.
2. Pull novo (§2) com `STAMP` novo.
3. API parada durante a carga (ninguém se cadastra, o agendador não roda):

```bash
$DC stop api
imp() { $RUN api node dist/src/scripts/import-lovable/main.js --export /import/$STAMP --expect-db meufunil --uploads-dir /data/uploads "$@"; }
imp --dry-run 2>&1 | tee lovable-export/$STAMP/virada-dry-run.txt
imp           2>&1 | tee lovable-export/$STAMP/virada-carga.txt
imp --verify  2>&1 | tee lovable-export/$STAMP/virada-verify.txt
```

**PARE aqui antes de subir a API.** Só siga com `verificação: ok` no `virada-verify.txt` e sem linha `pendente vencido` no `virada-carga.txt`
sem decisão do dono — ao subir, a API publica a fila e roda as cadências.
Se a carga gravou mas a **cópia de arquivos** falhou (ex.: disco cheio, `ERRO` depois do relatório): **não** recrie o banco; libere espaço e rode
`imp --only-files 2>&1 | tee -a lovable-export/$STAMP/virada-carga.txt`, depois `imp --verify` de novo.

```bash
$DC up -d api && curl -s http://127.0.0.1:3015/health
```

4. O dono entra em `https://www.meufunildevendas.com.br` com a senha atual e confere empresas, posts, criativos com imagem e CRM.
5. Tirar a chave do Lovable: `sed -i '/^LEGACY_CREDENTIALS_ENCRYPTION_KEY=/d' .env && $DC up -d api`.
6. Prompt de limpeza no Lovable (o hash é recalculado do arquivo do token):
   `$RUN api node scripts/lovable-export/render-prompts.mjs --hash "$(sha256sum < lovable-export/token | cut -d' ' -f1)" --only limpeza`.
7. Depois da conferência final: `rm -rf lovable-export/<stamps> lovable-export/token lovable-export/lovable.env`.

## Plano de volta

```bash
$DC stop api
docker exec meufunil-postgres psql -U meufunil -d postgres -c 'DROP DATABASE meufunil WITH (FORCE)' -c 'CREATE DATABASE meufunil'
$RUN api sh -c 'rm -rf /data/uploads/creative-assets /data/uploads/ig-media'
$DC up -d api     # aplica as migrations no boot
```

E o DNS: A do apex `meufunildevendas.com.br` de volta para `185.158.133.1` (Lovable). Se o prompt de limpeza (§4.6) já rodou, o Lovable
volta **sem** os agendamentos (`pg_cron`): peça ao Lovable para recriá-los (as migrations dele com `cron.schedule`).
