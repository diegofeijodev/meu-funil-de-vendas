# Migração dos dados do Lovable — runbook

Spec: `docs/superpowers/specs/2026-10-06-migracao-lovable-design.md`. Tudo roda no EC2: `ssh ubuntu@56.124.127.54`, `cd /opt/meu-funil`.
O Lovable nunca é escrito; o banco `meufunil` só recebe a carga se estiver vazio.

## 0. Uma vez

```bash
install -d -m 700 /opt/meu-funil/lovable-export
# imagem da API com o importador: deploy normal (docs/deploy.md §2), antes: docker tag meufunil-api:latest meufunil-api:pre-migracao
```

Atalhos usados abaixo:

```bash
DC="docker compose -f docker-compose.prod.yml"
RUN="$DC run --rm --no-deps"
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
PULL="$RUN -v /opt/meu-funil/lovable-export:/out api node scripts/lovable-export/pull.mjs --env /out/lovable.env --token-file /out/token --file-url https://<app>.lovable.app/api/export-file"
$PULL --out /out/$STAMP --check-only          # confira o tamanho contra o disco livre (df -h /)
$PULL --out /out/$STAMP                       # sai 1 se algo não bater: rode de novo (retoma os arquivos já baixados)
```

## 3. Ensaio (banco meufunil_stage)

```bash
docker exec meufunil-postgres psql -U meufunil -d postgres -c 'DROP DATABASE IF EXISTS meufunil_stage WITH (FORCE)' -c 'CREATE DATABASE meufunil_stage'
STAGE="postgresql://meufunil:$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)@meufunil-postgres:5432/meufunil_stage?schema=public"
$RUN -e DATABASE_URL="$STAGE" api npx prisma migrate deploy
IMP="$RUN -e DATABASE_URL=$STAGE api node dist/src/scripts/import-lovable/main.js --export /import/$STAMP --expect-db meufunil_stage --uploads-dir /data/uploads/.stage"
$IMP --dry-run | tee lovable-export/$STAMP/ensaio-dry-run.txt
$IMP           | tee lovable-export/$STAMP/ensaio-carga.txt
$IMP --verify  | tee lovable-export/$STAMP/ensaio-verify.txt
```

Revisar com o dono: dados não migrados, contas sem login, links mantidos, pendentes vencidos. Depois:

```bash
docker exec meufunil-postgres psql -U meufunil -d postgres -c 'DROP DATABASE meufunil_stage WITH (FORCE)'
$RUN api rm -rf /data/uploads/.stage
```

## 4. Virada

1. O dono avisa os usuários do `*.lovable.app` e congela o uso.
2. Pull novo (§2) com `STAMP` novo.
3. API parada durante a carga (ninguém se cadastra, o agendador não roda):

```bash
$DC stop api
IMP="$RUN api node dist/src/scripts/import-lovable/main.js --export /import/$STAMP --expect-db meufunil --uploads-dir /data/uploads"
$IMP --dry-run | tee lovable-export/$STAMP/virada-dry-run.txt
$IMP           | tee lovable-export/$STAMP/virada-carga.txt
$IMP --verify  | tee lovable-export/$STAMP/virada-verify.txt
$DC up -d api && curl -s http://127.0.0.1:3015/health
```

4. O dono entra em `https://www.meufunildevendas.com.br` com a senha atual e confere empresas, posts, criativos com imagem e CRM.
5. Tirar a chave do Lovable: `sed -i '/^LEGACY_CREDENTIALS_ENCRYPTION_KEY=/d' .env && $DC up -d api`.
6. Prompt de limpeza no Lovable: `$RUN api node scripts/lovable-export/render-prompts.mjs --hash "$HASH" --only limpeza`.
7. Depois da conferência final: `rm -rf lovable-export/<stamps> lovable-export/token lovable-export/lovable.env`.

## Plano de volta

```bash
$DC stop api
docker exec meufunil-postgres psql -U meufunil -d postgres -c 'DROP DATABASE meufunil WITH (FORCE)' -c 'CREATE DATABASE meufunil'
$RUN api sh -c 'rm -rf /data/uploads/creative-assets /data/uploads/ig-media'
$DC up -d api     # aplica as migrations no boot
```

E o DNS: A do apex `meufunildevendas.com.br` de volta para `185.158.133.1` (Lovable).
