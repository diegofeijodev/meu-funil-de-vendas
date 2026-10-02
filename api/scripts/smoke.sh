#!/usr/bin/env bash
# Smoke da API do Meu Funil (Task 0). Não sobe nada: conversa com a API viva.
#   npm run start:smoke   (em outro terminal)   →   npm run smoke
# Cria um usuário novo por rodada (sufixo único) e remove no fim via psql, se o container existir.
API=${API:-http://localhost:3015}
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
ko(){ FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s — %s\n' "$1" "$2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else ko "$1" "esperado '$2', veio '$3'"; fi }
J='Content-Type: application/json'
SUF=${SUF:-$(date +%s%N)}
EMAIL="smoke$SUF@meufunil.local"

echo "── Saúde ──"
check "health" "ok" "$(curl -s $API/health | jq -r .status)"
check "sem token → UNAUTHORIZED" "UNAUTHORIZED" "$(curl -s $API/v1/workspaces | jq -r .error.code)"
check "mensagem sem header" "Unauthorized: No authorization header provided" "$(curl -s $API/v1/workspaces | jq -r .error.message)"
check "token lixo" "Unauthorized: Invalid token" "$(curl -s $API/v1/workspaces -H 'Authorization: Bearer lixo' | jq -r .error.message)"

echo "── Cadastro e login ──"
check "senha curta" "Password should be at least 6 characters." "$(curl -s -X POST $API/v1/auth/signup -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"123\"}" | jq -r .error.message)"
check "senha fraca" "WEAK_PASSWORD" "$(curl -s -X POST $API/v1/auth/signup -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"123456\"}" | jq -r .error.code)"
check "e-mail inválido" "Unable to validate email address: invalid format" "$(curl -s -X POST $API/v1/auth/signup -H "$J" -d '{"email":"x","password":"segredo1"}' | jq -r .error.message)"
S=$(curl -s -X POST $API/v1/auth/signup -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"segredo1\",\"full_name\":\"Smoke\",\"company_name\":\"Empresa Smoke\"}")
AT=$(echo "$S" | jq -r .access_token); RT=$(echo "$S" | jq -r .refresh_token); H="Authorization: Bearer $AT"
[ "$AT" != "null" ] && [ -n "$AT" ] && ok "signup devolve sessão" || ko "signup" "$S"
check "e-mail repetido" "User already registered" "$(curl -s -X POST $API/v1/auth/signup -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"segredo1\"}" | jq -r .error.message)"
check "senha errada" "Invalid login credentials" "$(curl -s -X POST $API/v1/auth/login -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"errada\"}" | jq -r .error.message)"
L=$(curl -s -X POST $API/v1/auth/login -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"segredo1\"}")
check "login ok" "$EMAIL" "$(echo "$L" | jq -r .user.email)"
check "me" "$EMAIL" "$(curl -s $API/v1/auth/me -H "$H" | jq -r .user.email)"
check "me.profile.full_name" "Smoke" "$(curl -s $API/v1/auth/me -H "$H" | jq -r .profile.full_name)"

echo "── Workspaces ──"
WS=$(curl -s $API/v1/workspaces -H "$H")
check "1 workspace (owner)" "owner" "$(echo "$WS" | jq -r '.[0].role')"
check "nome do workspace do cadastro" "Empresa Smoke" "$(echo "$WS" | jq -r '.[0].workspaces.name')"
WID=$(echo "$WS" | jq -r '.[0].workspace_id')
check "slug ws-<10 hex>" "1" "$(echo "$WS" | jq -r '.[0].workspaces.slug' | grep -cE '^ws-[0-9a-f]{10}$')"
check "workspace por id" "$WID" "$(curl -s $API/v1/workspaces/$WID -H "$H" | jq -r .id)"
NEW=$(curl -s -X POST $API/v1/workspaces -H "$H" -H "$J" -d '{"name":"  Segunda Empresa  "}')
NID=$(echo "$NEW" | jq -r .id)
[ "$NID" != "null" ] && ok "create_workspace" || ko "create_workspace" "$NEW"
check "nome obrigatório" "nome obrigatório" "$(curl -s -X POST $API/v1/workspaces -H "$H" -H "$J" -d '{"name":"   "}' | jq -r .error.message)"
check "2 workspaces" "2" "$(curl -s $API/v1/workspaces -H "$H" | jq length)"
check "members + profiles" "1" "$(curl -s $API/v1/workspaces/$WID/members -H "$H" | jq '.profiles | length')"
check "id malformado → 404" "NOT_FOUND" "$(curl -s $API/v1/workspaces/xxx -H "$H" | jq -r .error.code)"
check "profile me" "Smoke" "$(curl -s $API/v1/profiles/me -H "$H" | jq -r .full_name)"
check "patch profile" "Smoke 2" "$(curl -s -X PATCH $API/v1/profiles/me -H "$H" -H "$J" -d '{"full_name":"Smoke 2"}' | jq -r .full_name)"
check "campo extra barrado (whitelist)" "VALIDATION_ERROR" "$(curl -s -X PATCH $API/v1/profiles/me -H "$H" -H "$J" -d '{"xx":1}' | jq -r .error.code)"

echo "── Isolamento entre workspaces ──"
DEMO=$(curl -s -X POST $API/v1/auth/login -H "$J" -d '{"email":"demo@meufunil.local","password":"meufunil123"}')
HD="Authorization: Bearer $(echo "$DEMO" | jq -r .access_token)"
check "demo logou (seed)" "demo@meufunil.local" "$(echo "$DEMO" | jq -r .user.email)"
check "estranho não lê workspace alheio" "Você não tem acesso a esta empresa." "$(curl -s $API/v1/workspaces/$WID -H "$HD" | jq -r .error.message)"
check "estranho não vê membros" "FORBIDDEN" "$(curl -s $API/v1/workspaces/$WID/members -H "$HD" | jq -r .error.code)"

echo "── Arquivos ──"
printf '\x89PNG\r\n\x1a\nfake-png-bytes' > /tmp/mf-smoke.png
UP=$(curl -s -X POST "$API/v1/workspaces/$WID/files?kind=brands" -H "$H" -F "file=@/tmp/mf-smoke.png;type=image/png")
URL=$(echo "$UP" | jq -r .url); KEY=$(echo "$UP" | jq -r .key)
[ "$URL" != "null" ] && ok "upload multipart" || ko "upload" "$UP"
check "key escopada no workspace" "1" "$(echo "$KEY" | grep -c "^brands/$WID/")"
check "download por URL assinada" "200" "$(curl -s -o /tmp/mf-smoke-dl.png -w '%{http_code}' "$URL")"
check "bytes idênticos" "0" "$(cmp /tmp/mf-smoke.png /tmp/mf-smoke-dl.png; echo $?)"
check "content-type" "image/png" "$(curl -sI "$URL" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
check "sem assinatura → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/files/creative-assets/$KEY")"
check "assinatura adulterada → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' "${URL%?}0")"
check "traversal → não vaza" "1" "$(curl -s --path-as-is "$API/v1/files/creative-assets/../../../etc/passwd?exp=9999999999&sig=00" | jq -r .error.code | grep -cE 'FORBIDDEN|NOT_FOUND|BAD_REQUEST')"
check "tipo não suportado" "Tipo de arquivo não suportado." "$(printf 'x' | curl -s -X POST "$API/v1/workspaces/$WID/files" -H "$H" -F "file=@-;filename=a.exe;type=application/x-msdownload" | jq -r .error.message)"
check "estranho não envia arquivo" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/workspaces/$WID/files" -H "$HD" -F "file=@/tmp/mf-smoke.png;type=image/png")"
check "delete só no próprio workspace" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/v1/workspaces/$NID/files?key=$KEY" -H "$H")"
check "delete ok" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/v1/workspaces/$WID/files?key=$KEY" -H "$H")"
check "depois do delete: 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$URL")"

echo "── Google (não configurado) ──"
check "google start → 503" "GOOGLE_NOT_CONFIGURED" "$(curl -s $API/v1/auth/google | jq -r .error.code)"

echo "── Refresh e logout ──"
R=$(curl -s -X POST $API/v1/auth/refresh -H "$J" -d "{\"refresh_token\":\"$RT\"}")
check "refresh ok" "$EMAIL" "$(echo "$R" | jq -r .user.email)"
check "access token não serve de refresh" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/auth/refresh -H "$J" -d "{\"refresh_token\":\"$AT\"}")"
check "logout 204" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/auth/logout -H "$H")"
check "refresh revogado após logout" "INVALID_REFRESH_TOKEN" "$(curl -s -X POST $API/v1/auth/refresh -H "$J" -d "{\"refresh_token\":\"$RT\"}" | jq -r .error.code)"

echo "── Limpeza ──"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^meu-funil-postgres$'; then
  docker exec meu-funil-postgres psql -U meufunil -d meufunil -qtc "
    DELETE FROM workspaces WHERE owner_id IN (SELECT id FROM users WHERE email='$EMAIL');
    DELETE FROM profiles WHERE email='$EMAIL';
    DELETE FROM users WHERE email='$EMAIL';" >/dev/null && ok "usuário de teste removido"
fi
rm -f /tmp/mf-smoke.png /tmp/mf-smoke-dl.png
echo; echo "Passaram: $PASS  Falharam: $FAIL"
[ "$FAIL" = "0" ]
