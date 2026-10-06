#!/usr/bin/env bash
# Ponta a ponta do importador do Lovable num banco LOCAL descartável (meufunil_import_e2e) — nunca em produção.
# Pré: Postgres local de pé (`docker compose up -d postgres` na raiz). Rode capado, de api/:
#   ../scripts/run-capped.sh 1500 bash scripts/import-lovable-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."
C=meu-funil-postgres; DB=meufunil_import_e2e
URL="postgresql://meufunil:meufunil@localhost:5439/$DB?schema=public"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
EXP="$TMP/export"; UP="$TMP/uploads"; SECRET=segredo-do-lovable-e2e
WS=11111111-1111-4111-8111-111111111111
OK=0; FAIL=0
check() { if [[ "$2" == "$3" ]]; then OK=$((OK+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — esperado [$2], veio [$3]"; fi; }
q() { docker exec -i $C psql -U meufunil -d $DB -Atqc "$1"; }
# imp <saída> <args…>: importador com o ambiente de teste (LEGACY= vazio desliga a chave do Lovable; EXPDIR troca a exportação)
imp() {
  local out="$1"; shift
  DATABASE_URL="$URL" PUBLIC_URL=https://api.e2e.test JWT_SECRET=e2e-jwt-secret-0123456789 FILES_SIGNING_SECRET=e2e-files-secret-0123456789 \
  CREDENTIALS_ENCRYPTION_KEY=e2e-vault-key-0123456789 LEGACY_CREDENTIALS_ENCRYPTION_KEY="${LEGACY-$SECRET}" \
    npx ts-node --transpile-only src/scripts/import-lovable/main.ts --export "${EXPDIR:-$EXP}" --uploads-dir "$UP" "$@" >"$out" 2>&1
}
docker exec $C psql -U meufunil -d postgres -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
docker exec $C psql -U meufunil -d postgres -qc "CREATE DATABASE $DB" >/dev/null
DATABASE_URL="$URL" npx prisma migrate deploy >"$TMP/prisma.log" 2>&1 || { tail -20 "$TMP/prisma.log"; exit 1; }
node scripts/lovable-export/make-fixture.mjs --out "$EXP" --legacy-secret "$SECRET" >/dev/null

echo "== travas"
imp "$TMP/o1" --expect-db outro_banco --dry-run && r=0 || r=$?
check "banco com nome errado é recusado" "1,1" "$r,$(grep -c 'não "outro_banco"' "$TMP/o1")"
LEGACY= imp "$TMP/o2" --expect-db $DB --dry-run && r=0 || r=$?
check "enc:v1 sem a chave do Lovable é recusado" "1,1" "$r,$(grep -c 'LEGACY_CREDENTIALS_ENCRYPTION_KEY' "$TMP/o2")"
cp -r "$EXP" "$TMP/export-ruim"; echo '[]' > "$TMP/export-ruim/tables/public.brands.json"
EXPDIR="$TMP/export-ruim" imp "$TMP/o3" --expect-db $DB --dry-run && r=0 || r=$?
check "exportação inconsistente (linhas ≠ manifesto) é recusada" "1,1" "$r,$(grep -c 'o manifesto diz' "$TMP/o3")"

echo "== dry-run"
imp "$TMP/o4" --expect-db $DB --dry-run && r=0 || { r=$?; cat "$TMP/o4"; }
check "dry-run termina bem e não grava nada" "0,0,0,0" "$r,$(q 'SELECT count(*) FROM users'),$(q 'SELECT count(*) FROM workspaces'),$(find "$UP" -type f 2>/dev/null | wc -l)"
check "dry-run relata contas e links" "1,1" "$(grep -c 'contas: 2 importadas' "$TMP/o4"),$(grep -c 'links do Lovable reescritos: 4;' "$TMP/o4")"

echo "== importação"
imp "$TMP/o5" --expect-db $DB && r=0 || { r=$?; cat "$TMP/o5"; }
check "importação termina bem" "0" "$r"
check "contas: 2 (a apagada fica de fora), e-mail em minúsculas, Google ligado" "2|dono@exemplo.com|109876543210987654321" \
  "$(q 'SELECT count(*) FROM users')|$(q "SELECT email FROM users WHERE id='22222222-2222-4222-8222-222222222221'")|$(q "SELECT google_sub FROM users WHERE id='22222222-2222-4222-8222-222222222222'")"
check "hash bcrypt copiado como está" "t" "$(q "SELECT password_hash LIKE '\$2a\$10\$%' FROM users WHERE id='22222222-2222-4222-8222-222222222221'")"
check "cron_tokens pulada" "0" "$(q 'SELECT count(*) FROM cron_tokens')"
check "logo da marca aponta para a API nova" "1" "$(q "SELECT count(*) FROM brands WHERE logo_url LIKE 'https://api.e2e.test/v1/files/creative-assets/brands/$WS/logo.png?exp=%&sig=%'")"
check "link dentro de JSON (extras.gallery) reescrito" "t" "$(q "SELECT (extras->'gallery'->0->>'url') LIKE 'https://api.e2e.test/v1/files/ig-media/%' FROM creatives WHERE title='Criativo com galeria'")"
check "nome com espaço e acento reescrito" "t" "$(q "SELECT preview_url LIKE 'https://api.e2e.test/v1/files/creative-assets/2026-09-30/criativo%' FROM creatives WHERE title='Criativo com galeria'")"
check "link de arquivo que não veio fica e é listado" "t,1" "$(q "SELECT preview_url LIKE '%supabase.co%' FROM creatives WHERE title='Criativo sem arquivo'"),$(grep -v '^RELATORIO_JSON' "$TMP/o5" | grep -c 'sumiu/arquivo.png')"
check "mídia do post (jsonb) reescrita" "0" "$(q "SELECT count(*) FROM ig_posts WHERE media::text LIKE '%supabase.co%'")"
check "updated_at preservado (gatilhos desligados na carga)" "2026-01-02 03:04:05" "$(q "SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') FROM brands")"
check "credenciais no formato do nosso cofre (a vazia fica vazia)" "0|1" "$(q "SELECT count(*) FROM app_credentials WHERE value <> '' AND value NOT LIKE 'enc:v2:%'")|$(q "SELECT count(*) FROM app_credentials WHERE value = ''")"
check "token de conexão cifrado" "t" "$(q "SELECT access_token LIKE 'enc:v2:%' FROM mcp_connections")"
check "publicação vencida cancelada e post com falha; futura segue" "cancelled,queued|failed:publish,scheduled" \
  "$(q "SELECT string_agg(status, ',' ORDER BY run_at) FROM publishing_jobs")|$(q "SELECT string_agg(status||coalesce(':'||failure_kind,''), ',' ORDER BY scheduled_at) FROM ig_posts")"
check "cadências: vencida há 1 dia segue; há 5 dias para" "running,stopped" "$(q "SELECT string_agg(status, ',' ORDER BY next_run_at DESC) FROM crm_cadence_runs")"
check "travas zeradas" "0,0" "$(q 'SELECT count(*) FROM ig_posts WHERE lease_until IS NOT NULL'),$(q 'SELECT count(*) FROM crm_cadence_runs WHERE lease_token IS NOT NULL')"
check "arquivos copiados (inclusive com acento)" "3,1" "$(find "$UP" -type f | wc -l),$(test -f "$UP/creative-assets/2026-09-30/criativo ação.png" && echo 1 || echo 0)"

echo "== segunda carga"
imp "$TMP/o6" --expect-db $DB && r=0 || r=$?
check "banco não vazio recusa a segunda carga" "1,1" "$r,$(grep -c 'não está vazio' "$TMP/o6")"

echo "== verificação e só-arquivos"
imp "$TMP/o7" --expect-db $DB --verify && r=0 || { r=$?; cat "$TMP/o7"; }
check "verificação limpa (o link do arquivo que não veio só avisa)" "0,1,1" "$r,$(grep -c 'verificação: ok' "$TMP/o7"),$(grep -c 'aviso: links do Lovable restantes em creatives.preview_url: 1' "$TMP/o7")"
rm -f "$UP/ig-media/posts/$WS/p1.jpg"
imp "$TMP/o8" --expect-db $DB --verify && r=0 || r=$?
check "verificação acusa arquivo ausente" "1,1" "$r,$(grep -c "ig-media/posts/$WS/p1.jpg" "$TMP/o8")"
imp "$TMP/o9" --expect-db $DB --only-files && r=0 || r=$?
check "--only-files repõe só o que falta" "0,1" "$r,$(grep -c 'arquivos: 1 copiados, 2 já estavam' "$TMP/o9")"
q "UPDATE app_credentials SET value = 'enc:v2:AAAA:BBBB:CCCC' WHERE key = 'OPENAI_API_KEY'" >/dev/null
imp "$TMP/o10" --expect-db $DB --verify && r=0 || r=$?
check "verificação acusa credencial ilegível" "1,1" "$r,$(grep -c 'credenciais ilegíveis: 1' "$TMP/o10")"

echo; echo "$OK ok, $FAIL falha(s)"
docker exec $C psql -U meufunil -d postgres -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
[[ $FAIL -eq 0 ]]
