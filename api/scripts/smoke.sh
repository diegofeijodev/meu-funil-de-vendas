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

echo "── Task 2: segundo usuário (viewer) ──"
EMAIL2="smoke2$SUF@meufunil.local"
S2=$(curl -s -X POST $API/v1/auth/signup -H "$J" -d "{\"email\":\"$EMAIL2\",\"password\":\"segredo1\",\"full_name\":\"Viewer\",\"company_name\":\"Empresa Viewer\"}")
HV="Authorization: Bearer $(echo "$S2" | jq -r .access_token)"
VID=$(echo "$S2" | jq -r .user.id)
PSQL() { docker exec meu-funil-postgres psql -U meufunil -d meufunil -qtA -c "$1"; }
PSQL "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ('$WID','$VID','viewer')" >/dev/null
check "viewer é membro do workspace" "viewer" "$(curl -s $API/v1/workspaces -H "$HV" | jq -r --arg w "$WID" '.[] | select(.workspace_id==$w) | .role')"

echo "── Overview ──"
OV=$(curl -s $API/v1/workspaces/$WID/overview -H "$H")
check "overview: 5 listas" "5" "$(echo "$OV" | jq 'keys | length')"
check "overview vazio" "0" "$(echo "$OV" | jq '.performance_daily | length')"
check "viewer lê o overview" "200" "$(curl -s -o /dev/null -w '%{http_code}' $API/v1/workspaces/$WID/overview -H "$HV")"
check "estranho não lê o overview" "403" "$(curl -s -o /dev/null -w '%{http_code}' $API/v1/workspaces/$WID/overview -H "$HD")"

echo "── Setup status ──"
SU=$(curl -s -X POST $API/v1/setup/status -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\"}")
check "setup: 4 grupos" "4" "$(echo "$SU" | jq '[.items[].group] | unique | length')"
check "setup: DNA da marca pendente" "pending" "$(echo "$SU" | jq -r '.items[] | select(.key=="brand") | .status')"
check "setup: etapas padrão do funil criadas pelo ensure (SDR pronto)" "ok" "$(echo "$SU" | jq -r '.items[] | select(.key=="stages") | .status')"
check "setup: viewer lê" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/setup/status -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\"}")"
check "setup: estranho → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/setup/status -H "$HD" -H "$J" -d "{\"workspaceId\":\"$WID\"}")"
check "setup: workspaceId inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/setup/status -H "$H" -H "$J" -d '{"workspaceId":"x"}')"

echo "── Marcas ──"
B=$(curl -s -X POST $API/v1/workspaces/$WID/brands -H "$H" -H "$J" -d '{"name":"Bar do Zé","segment":"Bar"}')
BID=$(echo "$B" | jq -r .id)
[ "$BID" != "null" ] && ok "cria marca" || ko "cria marca" "$B"
check "nome obrigatório" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/workspaces/$WID/brands -H "$H" -H "$J" -d '{"name":""}')"
check "viewer não cria marca" "Seu perfil não tem permissão para esta ação." "$(curl -s -X POST $API/v1/workspaces/$WID/brands -H "$HV" -H "$J" -d '{"name":"X"}' | jq -r .error.message)"
check "lista com contagens (campaigns/products)" "0,0" "$(curl -s $API/v1/workspaces/$WID/brands -H "$H" | jq -r '.[0] | "\(.campaigns[0].count),\(.products[0].count)"')"
check "viewer lista marcas" "1" "$(curl -s $API/v1/workspaces/$WID/brands -H "$HV" | jq length)"
check "marca de outro workspace → 404" "NOT_FOUND" "$(curl -s $API/v1/workspaces/$NID/brands/$BID -H "$H" | jq -r .error.code)"
check "id malformado → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' $API/v1/workspaces/$WID/brands/xxx -H "$H")"
check "patch do Brand Brain" "Boteco raiz|a,b" "$(curl -s -X PATCH $API/v1/workspaces/$WID/brands/$BID -H "$H" -H "$J" -d '{"description":"Boteco raiz","preferred_words":["a","b"],"primary_color":"#112233"}' | jq -r '"\(.description)|\(.preferred_words|join(","))"')"
check "patch: campo desconhecido → 400" "VALIDATION_ERROR" "$(curl -s -X PATCH $API/v1/workspaces/$WID/brands/$BID -H "$H" -H "$J" -d '{"workspace_id":"x"}' | jq -r .error.code)"
check "patch do guia visual (jsonb)" "quente" "$(curl -s -X PATCH $API/v1/workspaces/$WID/brands/$BID -H "$H" -H "$J" -d '{"visual_style":{"iluminacao":"quente","paleta_hex":["#fff"]}}' | jq -r .visual_style.iluminacao)"
check "viewer não edita marca" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $API/v1/workspaces/$WID/brands/$BID -H "$HV" -H "$J" -d '{"description":"x"}')"
check "estranho não edita marca" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $API/v1/workspaces/$WID/brands/$BID -H "$HD" -H "$J" -d '{"description":"x"}')"
check "atividade brand.created/updated gravada" "2" "$(PSQL "SELECT count(*) FROM activity_logs WHERE workspace_id='$WID' AND action IN ('brand.created','brand.updated')")"

echo "── Produtos, personas, aprendizados ──"
PR=$(curl -s -X POST $API/v1/workspaces/$WID/brands/$BID/products -H "$H" -H "$J" -d '{"name":"Novo produto","price":0,"margin_percent":0}')
PID=$(echo "$PR" | jq -r .id)
check "produto criado (price number)" "number" "$(echo "$PR" | jq -r '.price | type')"
check "produto salvo" "12.5" "$(curl -s -X PATCH $API/v1/workspaces/$WID/brands/$BID/products/$PID -H "$H" -H "$J" -d '{"name":"Chopp","price":12.5,"margin_percent":30}' | jq -r .price)"
check "contagem de produtos na lista" "1" "$(curl -s $API/v1/workspaces/$WID/brands -H "$H" | jq -r '.[0].products[0].count')"
check "lista de produtos" "Chopp" "$(curl -s $API/v1/workspaces/$WID/brands/$BID/products -H "$H" | jq -r '.[0].name')"
check "produto via outro workspace → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $API/v1/workspaces/$NID/brands/$BID/products/$PID -H "$H" -H "$J" -d '{"name":"x"}')"
check "viewer não cria produto" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/workspaces/$WID/brands/$BID/products -H "$HV" -H "$J" -d '{"name":"x"}')"
PE=$(curl -s -X POST $API/v1/workspaces/$WID/brands/$BID/personas -H "$H" -H "$J" -d '{"name":"Nova persona"}')
PEID=$(echo "$PE" | jq -r .id)
check "persona criada (B2C padrão)" "B2C" "$(echo "$PE" | jq -r .segment_type)"
check "persona salva" "25-34" "$(curl -s -X PATCH $API/v1/workspaces/$WID/brands/$BID/personas/$PEID -H "$H" -H "$J" -d '{"name":"Ana","age_range":"25-34","pains":"tempo"}' | jq -r .age_range)"
check "persona removida" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $API/v1/workspaces/$WID/brands/$BID/personas/$PEID -H "$H")"
check "aprendizados (somente leitura)" "0" "$(curl -s $API/v1/workspaces/$WID/brands/$BID/learnings -H "$H" | jq length)"
PSQL "INSERT INTO brand_learnings(workspace_id,brand_id,category,value,metric,score) VALUES ('$WID','$BID','c','baixo','m',1),('$WID','$BID','c','alto','m',9)" >/dev/null
check "aprendizados por score desc" "alto" "$(curl -s $API/v1/workspaces/$WID/brands/$BID/learnings -H "$H" | jq -r '.[0].value')"
check "produto removido" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $API/v1/workspaces/$WID/brands/$BID/products/$PID -H "$H")"

echo "── Arquivos da marca ──"
# PNG de verdade (1x1): a referência passa pelo jimp (reduzida a ≤1024 px) antes de ir à IA
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > /tmp/mf-ref.png
printf '\x00\x01\x00\x00fontbytes' > /tmp/mf-font.ttf
printf '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' > /tmp/mf-logo.svg
check "guia sem referência → 400" "Envie ao menos uma foto de referência (produto, ambiente ou equipe)." "$(curl -s -X POST $API/v1/creative/generate-brand-guide -H "$H" -H "$J" -d "{\"brandId\":\"$BID\"}" | jq -r .error.message)"
U1=$(curl -s -X POST "$API/v1/workspaces/$WID/files?kind=brands" -H "$H" -F "file=@/tmp/mf-ref.png;type=image/png")
K1=$(echo "$U1" | jq -r .key)
A1=$(curl -s -X POST $API/v1/workspaces/$WID/brands/$BID/assets -H "$H" -H "$J" -d "{\"kind\":\"reference\",\"name\":\"ref.png\",\"storage_path\":\"$K1\",\"tag\":\"produto\"}")
AID=$(echo "$A1" | jq -r .id)
check "arquivo registrado (url assinada, tag)" "produto" "$(echo "$A1" | jq -r .tag)"
check "url do asset baixa (200)" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$(echo "$A1" | jq -r .url)")"
check "url não vem do cliente (campo url → 400)" "VALIDATION_ERROR" "$(curl -s -X POST $API/v1/workspaces/$WID/brands/$BID/assets -H "$H" -H "$J" -d "{\"kind\":\"reference\",\"name\":\"x\",\"storage_path\":\"$K1\",\"url\":\"http://evil\"}" | jq -r .error.code)"
check "asset em marca de outro workspace → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/workspaces/$NID/brands/$BID/assets -H "$H" -H "$J" -d "{\"kind\":\"reference\",\"name\":\"x\",\"storage_path\":\"$K1\"}")"
BN=$(curl -s -X POST $API/v1/workspaces/$NID/brands -H "$H" -H "$J" -d '{"name":"Marca da 2ª empresa"}' | jq -r .id)
check "storage_path de OUTRO workspace → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/workspaces/$NID/brands/$BN/assets -H "$H" -H "$J" -d "{\"kind\":\"reference\",\"name\":\"x\",\"storage_path\":\"$K1\"}")"
check "storage_path inexistente → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/workspaces/$WID/brands/$BID/assets -H "$H" -H "$J" -d "{\"kind\":\"reference\",\"name\":\"x\",\"storage_path\":\"brands/$WID/00000000-0000-4000-8000-000000000000.png\"}")"
UF=$(curl -s -X POST "$API/v1/workspaces/$WID/files?kind=brands" -H "$H" -F "file=@/tmp/mf-font.ttf;type=application/octet-stream")
check "fonte .ttf aceita (kind=brands)" "ttf" "$(echo "$UF" | jq -r .key | sed 's/.*\.//')"
check "fonte fora de kind=brands → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/workspaces/$WID/files?kind=media" -H "$H" -F "file=@/tmp/mf-font.ttf;type=application/octet-stream")"
check "arquivo .ttf falso → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/workspaces/$WID/files?kind=brands" -H "$H" -F "file=@/tmp/mf-ref.png;filename=x.ttf;type=font/ttf")"
US=$(curl -s -X POST "$API/v1/workspaces/$WID/files?kind=brands" -H "$H" -F "file=@/tmp/mf-logo.svg;type=image/svg+xml")
check "SVG da marca é servido com CSP sandbox" "1" "$(curl -sI "$(echo "$US" | jq -r .url)" | tr -d '\r' | grep -ci "^content-security-policy: default-src 'none'.*sandbox")"
LG=$(curl -s -X POST $API/v1/workspaces/$WID/brands/$BID/assets -H "$H" -H "$J" -d "{\"kind\":\"logo\",\"name\":\"logo.svg\",\"storage_path\":\"$(echo "$US" | jq -r .key)\"}")
check "logo atualiza brands.logo_url" "$(echo "$LG" | jq -r .url)" "$(curl -s $API/v1/workspaces/$WID/brands/$BID -H "$H" | jq -r .logo_url)"
check "lista de arquivos (2)" "2" "$(curl -s $API/v1/workspaces/$WID/brands/$BID/assets -H "$H" | jq length)"
check "viewer não registra arquivo" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/workspaces/$WID/brands/$BID/assets -H "$HV" -H "$J" -d "{\"kind\":\"reference\",\"name\":\"x\",\"storage_path\":\"$K1\"}")"
check "guia com referência chega na IA (sem gateway → 502)" "502" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/creative/generate-brand-guide -H "$H" -H "$J" -d "{\"brandId\":\"$BID\"}")"
check "guia: marca de outro workspace → 404" "Marca não encontrada." "$(curl -s -X POST $API/v1/creative/generate-brand-guide -H "$HD" -H "$J" -d "{\"brandId\":\"$BID\"}" | jq -r .error.message)"
check "guia: viewer → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/creative/generate-brand-guide -H "$HV" -H "$J" -d "{\"brandId\":\"$BID\"}")"
check "remove arquivo" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $API/v1/workspaces/$WID/brands/$BID/assets/$AID -H "$H")"
check "viewer não exclui marca" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $API/v1/workspaces/$WID/brands/$BID -H "$HV")"
check "estranho não exclui marca" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $API/v1/workspaces/$WID/brands/$BID -H "$HD")"
check "exclui marca (cascade dos filhos)" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $API/v1/workspaces/$WID/brands/$BID -H "$H")"
check "marca excluída → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' $API/v1/workspaces/$WID/brands/$BID -H "$H")"
check "cascade: arquivos da marca sumiram" "0" "$(PSQL "SELECT count(*) FROM brand_assets WHERE brand_id='$BID'")"
check "atividade brand.deleted gravada" "1" "$(PSQL "SELECT count(*) FROM activity_logs WHERE workspace_id='$WID' AND action='brand.deleted' AND metadata->>'name'='Bar do Zé'")"
curl -s -X DELETE "$API/v1/workspaces/$WID/files?key=$K1" -H "$H" >/dev/null
curl -s -X DELETE "$API/v1/workspaces/$WID/files?key=$(echo "$UF" | jq -r .key)" -H "$H" >/dev/null
curl -s -X DELETE "$API/v1/workspaces/$WID/files?key=$(echo "$US" | jq -r .key)" -H "$H" >/dev/null
rm -f /tmp/mf-ref.png /tmp/mf-font.ttf /tmp/mf-logo.svg

echo "── Configurações ──"
check "dono renomeia a empresa" "Empresa Smoke 2" "$(curl -s -X PATCH $API/v1/workspaces/$WID -H "$H" -H "$J" -d '{"name":"Empresa Smoke 2"}' | jq -r .name)"
check "viewer não renomeia" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $API/v1/workspaces/$WID -H "$HV" -H "$J" -d '{"name":"x"}')"
check "atividade workspace.updated gravada" "1" "$(PSQL "SELECT count(*) FROM activity_logs WHERE workspace_id='$WID' AND action='workspace.updated'")"
check "membros + perfis (2)" "2" "$(curl -s $API/v1/workspaces/$WID/members -H "$H" | jq '.members | length')"
curl -s -X PATCH $API/v1/workspaces/$WID -H "$H" -H "$J" -d '{"name":"Empresa Smoke"}' >/dev/null

echo "── Agência ──"
AG=$(curl -s -X POST $API/v1/agency/overview -H "$H" -H "$J" -d '{}')
check "painel: 2 empresas do usuário" "2" "$(echo "$AG" | jq '.workspaces | length')"
check "painel: campos numéricos" "0,null" "$(echo "$AG" | jq -r '.workspaces[0] | "\(.spend),\(.cpl)"')"
check "painel: viewer vê só as suas (2: a dele + a compartilhada)" "2" "$(curl -s -X POST $API/v1/agency/overview -H "$HV" -H "$J" -d '{}' | jq '.workspaces | length')"
check "herança: dono das duas empresas → ok" "true" "$(curl -s -X POST $API/v1/agency/set-ai-inheritance -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"sourceId\":\"$WID\"}" | jq -r .ok)"
check "herança gravada em workspaces.ai_inherit_from" "$WID" "$(curl -s $API/v1/workspaces/$NID -H "$H" | jq -r .ai_inherit_from)"
check "painel mostra inheritFrom" "$WID" "$(curl -s -X POST $API/v1/agency/overview -H "$H" -H "$J" -d '{}' | jq -r --arg n "$NID" '.workspaces[] | select(.id==$n) | .inheritFrom')"
check "herança: origem = a própria → 400" "Escolha outra empresa como origem." "$(curl -s -X POST $API/v1/agency/set-ai-inheritance -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"sourceId\":\"$NID\"}" | jq -r .error.message)"
DWS=$(curl -s $API/v1/workspaces -H "$HD" | jq -r '.[0].workspace_id')
check "SEGURANÇA: estranho não toma emprestadas as chaves de IA da empresa alheia" "Você precisa ser dono ou administrador da empresa de origem." "$(curl -s -X POST $API/v1/agency/set-ai-inheritance -H "$HD" -H "$J" -d "{\"workspaceId\":\"$DWS\",\"sourceId\":\"$WID\"}" | jq -r .error.message)"
check "SEGURANÇA: …e nada mudou na empresa dele" "null" "$(curl -s $API/v1/workspaces/$DWS -H "$HD" | jq -r .ai_inherit_from)"
check "SEGURANÇA: viewer não define herança da empresa onde é viewer" "Só o dono ou um administrador altera esta empresa." "$(curl -s -X POST $API/v1/agency/set-ai-inheritance -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"sourceId\":null}" | jq -r .error.message)"
VWS=$(PSQL "SELECT id FROM workspaces WHERE owner_id='$VID'")
check "SEGURANÇA: viewer não usa a empresa onde é viewer como origem" "Você precisa ser dono ou administrador da empresa de origem." "$(curl -s -X POST $API/v1/agency/set-ai-inheritance -H "$HV" -H "$J" -d "{\"workspaceId\":\"$VWS\",\"sourceId\":\"$WID\"}" | jq -r .error.message)"
check "sourceId ausente → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/agency/set-ai-inheritance -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\"}")"
check "aplicar a todas: 1 atualizada" "1" "$(curl -s -X POST $API/v1/agency/apply-ai-inheritance-to-all -H "$H" -H "$J" -d "{\"sourceId\":\"$WID\"}" | jq -r .updated)"
check "aplicar a todas: origem alheia → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/agency/apply-ai-inheritance-to-all -H "$HD" -H "$J" -d "{\"sourceId\":\"$WID\"}")"
check "limpa a herança (null)" "null" "$(curl -s -X POST $API/v1/agency/set-ai-inheritance -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"sourceId\":null}" >/dev/null; curl -s $API/v1/workspaces/$NID -H "$H" | jq -r .ai_inherit_from)"

echo "── Task 3: campanhas, estrategista, copy, aprovações ──"
EMAIL3="smoke3$SUF@meufunil.local"
S3=$(curl -s -X POST $API/v1/auth/signup -H "$J" -d "{\"email\":\"$EMAIL3\",\"password\":\"segredo1\",\"full_name\":\"Marketing\",\"company_name\":\"Empresa Mkt\"}")
HM="Authorization: Bearer $(echo "$S3" | jq -r .access_token)"
MID=$(echo "$S3" | jq -r .user.id)
PSQL "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ('$WID','$MID','marketing')" >/dev/null
CB=$(curl -s -X POST $API/v1/workspaces/$WID/brands -H "$H" -H "$J" -d '{"name":"Marca Campanhas","segment":"Bar"}' | jq -r .id)
OTHERB=$(curl -s -X POST $API/v1/workspaces/$NID/brands -H "$H" -H "$J" -d '{"name":"Marca da outra empresa"}' | jq -r .id)
CAMP="$API/v1/workspaces/$WID/campaigns"
CBODY="{\"brand_id\":\"$CB\",\"name\":\"Campanha Smoke\",\"objective\":\"leads\",\"offer_product\":\"Chopp\",\"offer_price\":12.5,\"offer_promise\":\"\",\"landing_url\":\"\",\"start_date\":\"2026-10-05\",\"end_date\":null,\"audience\":{\"persona\":\"Ana\",\"idade\":\"25-45\"},\"budget_total\":1000,\"budget_daily\":50,\"goal_leads\":null,\"goal_sales\":null,\"avg_ticket\":null,\"margin_percent\":null,\"max_cac\":null,\"formats\":[\"static_image\",\"video\"]}"
check "campanhas: lista vazia" "0" "$(curl -s $CAMP -H "$H" | jq length)"
check "campanhas: viewer lê a lista" "200" "$(curl -s -o /dev/null -w '%{http_code}' $CAMP -H "$HV")"
check "campanhas: estranho não lê a lista" "403" "$(curl -s -o /dev/null -w '%{http_code}' $CAMP -H "$HD")"
check "campanhas: status NÃO é aceito no corpo (não nasce aprovada)" "VALIDATION_ERROR" "$(curl -s -X POST $CAMP -H "$H" -H "$J" -d "$(echo "$CBODY" | jq -c '. + {status:"approved"}')" | jq -r .error.code)"
check "campanhas: marca de OUTRO workspace → 404" "Marca não encontrada." "$(curl -s -X POST $CAMP -H "$H" -H "$J" -d "$(echo "$CBODY" | jq -c --arg b "$OTHERB" '.brand_id=$b')" | jq -r .error.message)"
check "campanhas: viewer não cria" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CAMP -H "$HV" -H "$J" -d "$CBODY")"
check "campanhas: nome em branco → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CAMP -H "$H" -H "$J" -d "$(echo "$CBODY" | jq -c '.name="  "')")"
C=$(curl -s -X POST $CAMP -H "$H" -H "$J" -d "$CBODY")
CID=$(echo "$C" | jq -r .id)
[ "$CID" != "null" ] && ok "campanhas: cria (wizard)" || ko "campanhas: cria" "$C"
check "campanhas: nasce em rascunho; datas só-dia; números" "draft,2026-10-05,null,number" "$(echo "$C" | jq -r '"\(.status),\(.start_date),\(.end_date),\(.budget_total|type)"')"
check "campanhas: lista com brands(name)" "1,Marca Campanhas" "$(curl -s $CAMP -H "$H" | jq -r '"\(length),\(.[0].brands.name)"')"
check "campanhas: performance (vazia, sem demo)" "0" "$(curl -s $CAMP/performance -H "$HV" | jq length)"
check "campanhas: get com brands(*)" "Bar" "$(curl -s $CAMP/$CID -H "$H" | jq -r .brands.segment)"
check "campanhas: de outro workspace → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' $API/v1/workspaces/$NID/campaigns/$CID -H "$H")"
check "campanhas: id malformado → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' $CAMP/xxx -H "$H")"
DT=$(curl -s $CAMP/$CID/detail -H "$H")
check "detalhe: 6 leituras (sem estratégia/copy ainda)" "null,null,0,0,0" "$(echo "$DT" | jq -r '"\(.strategy),\(.copy),\(.creatives|length),\(.perf|length),\(.costs|length)"')"
check "copies: v1" "1,draft" "$(curl -s -X POST $CAMP/$CID/copies -H "$HM" -H "$J" -d '{"content":{"headline":"A"}}' | jq -r '"\(.version),\(.status)"')"
check "copies: v2" "2" "$(curl -s -X POST $CAMP/$CID/copies -H "$H" -H "$J" -d '{"content":{"headline":"B"}}' | jq -r .version)"
check "copies: detalhe traz a mais nova" "2,B" "$(curl -s $CAMP/$CID/detail -H "$H" | jq -r '"\(.copy.version),\(.copy.content.headline)"')"
check "copies: viewer não grava" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CAMP/$CID/copies -H "$HV" -H "$J" -d '{"content":{}}')"
check "copies: campo extra (version) barrado" "VALIDATION_ERROR" "$(curl -s -X POST $CAMP/$CID/copies -H "$H" -H "$J" -d '{"content":{},"version":9}' | jq -r .error.code)"
check "atividade campaign.created/copy_generated gravada" "3" "$(PSQL "SELECT count(*) FROM activity_logs WHERE workspace_id='$WID' AND action IN ('campaign.created','campaign.copy_generated')")"

echo "── Estrategista e Copy Engine ──"
AIU=$API/v1/ai
check "estratégia sem gateway de IA → AI_NOT_CONFIGURED" "AI_NOT_CONFIGURED" "$(curl -s -X POST $AIU/generate-campaign-strategy -H "$H" -H "$J" -d "{\"campaignId\":\"$CID\"}" | jq -r .error.code)"
check "estratégia: viewer → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $AIU/generate-campaign-strategy -H "$HV" -H "$J" -d "{\"campaignId\":\"$CID\"}")"
check "estratégia: estranho → 404 (não vaza)" "Campanha não encontrada." "$(curl -s -X POST $AIU/generate-campaign-strategy -H "$HD" -H "$J" -d "{\"campaignId\":\"$CID\"}" | jq -r .error.message)"
check "estratégia: id inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $AIU/generate-campaign-strategy -H "$H" -H "$J" -d '{"campaignId":"xxx"}')"
check "estratégia: campo extra → 400" "VALIDATION_ERROR" "$(curl -s -X POST $AIU/generate-campaign-strategy -H "$H" -H "$J" -d "{\"campaignId\":\"$CID\",\"x\":1}" | jq -r .error.code)"
check "plano do Instagram sem estratégia" "Gere a estratégia da campanha primeiro." "$(curl -s -X POST $AIU/create-ig-plan-from-strategy -H "$H" -H "$J" -d "{\"campaignId\":\"$CID\"}" | jq -r .error.message)"
S1=$(PSQL "INSERT INTO campaign_strategies(workspace_id,campaign_id,version,status,content) VALUES ('$WID','$CID',1,'draft','{\"big_idea\":\"x\"}') RETURNING id")
S2=$(PSQL "INSERT INTO campaign_strategies(workspace_id,campaign_id,version,status,content) VALUES ('$WID','$CID',2,'draft','{\"big_idea\":\"y\",\"objetivo_smart\":\"Meta\",\"icp\":\"Ana\",\"plano_instagram\":{\"pilares\":[{\"nome\":\"A\",\"peso\":3},{\"nome\":\"B\",\"peso\":1}],\"temas\":[\"t1\"],\"frequencia\":{\"feed\":5,\"reels\":3,\"stories\":10}}}') RETURNING id" | head -1)
check "estratégia: v2 é a mais nova no detalhe" "2,draft" "$(curl -s $CAMP/$CID/detail -H "$H" | jq -r '"\(.strategy.version),\(.strategy.status)"')"
check "aprovar estratégia: viewer → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $AIU/approve-campaign-strategy -H "$HV" -H "$J" -d "{\"strategyId\":\"$S1\"}")"
check "aprovar estratégia: estranho → 404" "Estratégia não encontrada." "$(curl -s -X POST $AIU/approve-campaign-strategy -H "$HD" -H "$J" -d "{\"strategyId\":\"$S1\"}" | jq -r .error.message)"
check "aprovar v1 (marketing pode)" "true" "$(curl -s -X POST $AIU/approve-campaign-strategy -H "$HM" -H "$J" -d "{\"strategyId\":\"$S1\"}" | jq -r .ok)"
check "aprovar v2 → v1 vira superseded" "superseded,approved" "$(curl -s -X POST $AIU/approve-campaign-strategy -H "$H" -H "$J" -d "{\"strategyId\":\"$S2\"}" >/dev/null; PSQL "SELECT string_agg(status, ',' ORDER BY version) FROM campaign_strategies WHERE campaign_id='$CID'")"
check "plano do Instagram a partir da estratégia aprovada (v2)" "Instagram · Campanha Smoke,draft,true,0.75" "$(PLAN=$(curl -s -X POST $AIU/create-ig-plan-from-strategy -H "$HM" -H "$J" -d "{\"campaignId\":\"$CID\"}" | jq -r .planId); PSQL "SELECT name||','||status||','||requires_approval||','||(pillar_weights->>'A') FROM ig_content_plans WHERE id='$PLAN'")"
check "atividade campaign.strategy_approved gravada" "2" "$(PSQL "SELECT count(*) FROM activity_logs WHERE workspace_id='$WID' AND action='campaign.strategy_approved'")"
CPY=$API/v1/copy-ai/generate-copy-with-ai
CPB="{\"workspaceId\":\"$WID\",\"engine\":\"auto\",\"brand\":{\"name\":\"M\"},\"brief\":{\"name\":\"C\"},\"seed\":0,\"campaignId\":\"$CID\",\"angle\":null}"
check "copy sem gateway de IA → IA do app não configurada" "IA do app não configurada." "$(curl -s -X POST $CPY -H "$H" -H "$J" -d "$CPB" | jq -r .error.message)"
check "copy: viewer → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CPY -H "$HV" -H "$J" -d "$CPB")"
check "copy: estranho → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CPY -H "$HD" -H "$J" -d "$CPB")"
check "copy: motor inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CPY -H "$H" -H "$J" -d "$(echo "$CPB" | jq -c '.engine="x"')")"

echo "── Aprovações ──"
check "solicitar aprovação: viewer → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CAMP/$CID/request-approval -H "$HV" -H "$J" -d "{}")"
AP=$(curl -s -X POST $CAMP/$CID/request-approval -H "$HM" -H "$J" -d "{}")
APID=$(echo "$AP" | jq -r .id)
check "solicitar aprovação (marketing)" "pending,campaign,Publicar campanha \"Campanha Smoke\" na Meta" "$(echo "$AP" | jq -r '"\(.status),\(.entity_type),\(.title)"')"
check "…o resumo traz verba, criativos e objetivo" "1" "$(echo "$AP" | jq -r .summary | grep -c 'Verba diária de R\$.*0 criativo(s), objetivo Leads\.')"
check "…a campanha vira pending_approval" "pending_approval" "$(curl -s $CAMP/$CID -H "$H" | jq -r .status)"
check "solicitar de novo → 400" "Só campanhas em rascunho podem solicitar aprovação." "$(curl -s -X POST $CAMP/$CID/request-approval -H "$H" -H "$J" -d "{}" | jq -r .error.message)"
check "aprovações: lista com campaigns(name)" "1,Campanha Smoke" "$(curl -s $API/v1/workspaces/$WID/approvals -H "$HV" | jq -r '"\(length),\(.[0].campaigns.name)"')"
check "aprovações: estranho → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' $API/v1/workspaces/$WID/approvals -H "$HD")"
check "audit log: campaign.approval_requested presente (limit 30)" "1" "$(curl -s "$API/v1/workspaces/$WID/activity-logs?limit=30" -H "$H" | jq '[.[] | select(.action=="campaign.approval_requested")] | length')"
DEC=$API/v1/approvals/decide-approval
check "decidir: marketing NÃO decide (gatilho de papel)" "Só o dono ou um administrador da empresa pode aprovar ou rejeitar." "$(curl -s -X POST $DEC -H "$HM" -H "$J" -d "{\"approvalId\":\"$APID\",\"decision\":\"approved\"}" | jq -r .error.message)"
check "decidir: viewer → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $DEC -H "$HV" -H "$J" -d "{\"approvalId\":\"$APID\",\"decision\":\"approved\"}")"
check "decidir: estranho → 404 (não vaza)" "Pedido de aprovação não encontrado." "$(curl -s -X POST $DEC -H "$HD" -H "$J" -d "{\"approvalId\":\"$APID\",\"decision\":\"approved\"}" | jq -r .error.message)"
check "decidir: decisão inválida → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $DEC -H "$H" -H "$J" -d "{\"approvalId\":\"$APID\",\"decision\":\"maybe\"}")"
check "…nada mudou: continua pendente" "pending,pending_approval" "$(PSQL "SELECT (SELECT status FROM approval_requests WHERE id='$APID')||','||(SELECT status FROM campaigns WHERE id='$CID')")"
check "decidir: dono aprova" "true" "$(curl -s -X POST $DEC -H "$H" -H "$J" -d "{\"approvalId\":\"$APID\",\"decision\":\"approved\"}" | jq -r .ok)"
check "…pedido aprovado, campanha aprovada, decisor gravado" "approved,approved,1" "$(PSQL "SELECT r.status||','||c.status||','||(r.decided_by IS NOT NULL AND r.decided_at IS NOT NULL)::int FROM approval_requests r, campaigns c WHERE r.id='$APID' AND c.id='$CID'")"
check "decidir de novo → 409" "Este pedido já foi decidido." "$(curl -s -X POST $DEC -H "$H" -H "$J" -d "{\"approvalId\":\"$APID\",\"decision\":\"rejected\"}" | jq -r .error.message)"
check "atividade approval.approved gravada" "1" "$(PSQL "SELECT count(*) FROM activity_logs WHERE workspace_id='$WID' AND action='approval.approved'")"
C2=$(curl -s -X POST $CAMP -H "$H" -H "$J" -d "$(echo "$CBODY" | jq -c '.name="Segunda"')" | jq -r .id)
AP2=$(curl -s -X POST $CAMP/$C2/request-approval -H "$H" -H "$J" -d "{}" | jq -r .id)
check "admin/dono rejeita: campanha volta para rascunho" "true,draft,rejected" "$(R=$(curl -s -X POST $DEC -H "$H" -H "$J" -d "{\"approvalId\":\"$AP2\",\"decision\":\"rejected\"}" | jq -r .ok); echo "$R,$(PSQL "SELECT (SELECT status FROM campaigns WHERE id='$C2')||','||(SELECT status FROM approval_requests WHERE id='$AP2')")")"
check "pedido de aprovação de outro workspace não atinge a campanha de cá" "0" "$(PSQL "SELECT count(*) FROM approval_requests WHERE workspace_id='$NID'")"

echo "── Task 4: biblioteca de mídia ──"
MED=$API/v1/workspaces/$WID
MEDA=$API/v1/media
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > /tmp/mf-smoke-1x1.png
printf 'isto nao e um mp4 de verdade' > /tmp/mf-smoke-notmp4.mp4
# só o cabeçalho ftyp (sem moov): entra, mas com os problemas apontados
printf '\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isomavc1' > /tmp/mf-smoke-fake.mp4
printf 'texto' > /tmp/mf-smoke.txt
UPM=$(curl -s -X POST $MEDA/upload-media -H "$HM" -F "workspaceId=$WID" -F target=other -F "brandId=$CB" -F "file=@/tmp/mf-smoke-1x1.png;type=image/png;filename=Foto do bar.png")
M1=$(echo "$UPM" | jq -r .id)
[ "$M1" != "null" ] && ok "mídia: upload multipart (marketing)" || ko "mídia: upload" "$UPM"
check "mídia: 1x1 fica fora do padrão do Instagram (relatório volta)" "false,1" "$(echo "$UPM" | jq -r '"\(.igReady),\(.issues|length)"')"
check "mídia: arquivo gravado em media/<ws>/…" "1" "$(PSQL "SELECT count(*) FROM media_assets WHERE id='$M1' AND storage_path LIKE 'media/$WID/%' AND source='upload' AND title='Foto do bar' AND brand_id='$CB'")"
UPV=$(curl -s -X POST $MEDA/upload-media -H "$H" -F "workspaceId=$WID" -F target=ig_reel -F "file=@/tmp/mf-smoke-fake.mp4;type=video/mp4")
M2=$(echo "$UPV" | jq -r .id)
check "mídia: vídeo ilegível entra com os problemas (sem transcodificar)" "false" "$(echo "$UPV" | jq -r .igReady)"
check "mídia: \"vídeo\" sem cabeçalho ftyp é recusado" "Arquivo de vídeo inválido: não é um MP4/MOV (falta o cabeçalho ftyp)." "$(curl -s -X POST $MEDA/upload-media -H "$H" -F "workspaceId=$WID" -F target=ig_reel -F "file=@/tmp/mf-smoke-notmp4.mp4;type=video/mp4" | jq -r .error.message)"
check "mídia: viewer não envia" "Seu papel não permite esta ação." "$(curl -s -X POST $MEDA/upload-media -H "$HV" -F "workspaceId=$WID" -F target=other -F "file=@/tmp/mf-smoke-1x1.png;type=image/png" | jq -r .error.message)"
check "mídia: estranho não envia" "Você não tem acesso a esta área de trabalho." "$(curl -s -X POST $MEDA/upload-media -H "$HD" -F "workspaceId=$WID" -F target=other -F "file=@/tmp/mf-smoke-1x1.png;type=image/png" | jq -r .error.message)"
check "mídia: só imagem/vídeo" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MEDA/upload-media -H "$H" -F "workspaceId=$WID" -F target=other -F "file=@/tmp/mf-smoke.txt;type=text/plain")"
check "mídia: sem arquivo" "Arquivo ausente." "$(curl -s -X POST $MEDA/upload-media -H "$H" -F "workspaceId=$WID" -F target=other | jq -r .error.message)"
check "mídia: marca de outro workspace → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MEDA/upload-media -H "$H" -F "workspaceId=$NID" -F target=other -F "brandId=$CB" -F "file=@/tmp/mf-smoke-1x1.png;type=image/png")"
check "mídia: lista com brands/campaigns embutidos e contagem" "2,Marca Campanhas" "$(curl -s "$MED/media-assets?sort=old" -H "$HV" | jq -r '"\(.count),\(.rows[0].brands.name)"')"
check "mídia: filtro por tipo" "1" "$(curl -s "$MED/media-assets?kind=video" -H "$H" | jq .count)"
check "mídia: busca por título" "1" "$(curl -s "$MED/media-assets?search=foto" -H "$H" | jq .count)"
check "mídia: busca sanitizada (% , ( ))" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$MED/media-assets?search=%25%2C(x)" -H "$H")"
check "mídia: status inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' "$MED/media-assets?status=zzz" -H "$H")"
check "mídia: estranho não lista" "403" "$(curl -s -o /dev/null -w '%{http_code}' "$MED/media-assets" -H "$HD")"
check "mídia: outro workspace não vê as mídias daqui" "0" "$(curl -s "$API/v1/workspaces/$NID/media-assets" -H "$H" | jq .count)"
check "mídia: facetas (tags/pasta)" "2" "$(curl -s $MED/media-assets/facets -H "$H" | jq length)"
check "mídia: aprovar em lote" "1" "$(curl -s -X PATCH $MED/media-assets/bulk -H "$HM" -H "$J" -d "{\"ids\":[\"$M1\"],\"status\":\"approved\"}" | jq .updated)"
check "mídia: …status gravado" "approved" "$(PSQL "SELECT status FROM media_assets WHERE id='$M1'")"
check "mídia: mover para pasta e tirar da pasta" "Verão,vazio" "$(curl -s -X PATCH $MED/media-assets/bulk -H "$H" -H "$J" -d "{\"ids\":[\"$M1\"],\"folder\":\"Verão\"}" >/dev/null; A=$(PSQL "SELECT folder FROM media_assets WHERE id='$M1'"); curl -s -X PATCH $MED/media-assets/bulk -H "$H" -H "$J" -d "{\"ids\":[\"$M1\"],\"folder\":null}" >/dev/null; echo "$A,$(PSQL "SELECT coalesce(folder,'vazio') FROM media_assets WHERE id='$M1'")")"
check "mídia: viewer não edita em lote" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $MED/media-assets/bulk -H "$HV" -H "$J" -d "{\"ids\":[\"$M1\"],\"status\":\"approved\"}")"
check "mídia: status inválido no lote → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $MED/media-assets/bulk -H "$H" -H "$J" -d "{\"ids\":[\"$M1\"],\"status\":\"x\"}")"
check "mídia: campo extra no lote → 400" "VALIDATION_ERROR" "$(curl -s -X PATCH $MED/media-assets/bulk -H "$H" -H "$J" -d "{\"ids\":[\"$M1\"],\"workspace_id\":\"$NID\"}" | jq -r .error.code)"
check "mídia: id de OUTRO workspace no lote não atinge nada" "0" "$(curl -s -X PATCH $API/v1/workspaces/$NID/media-assets/bulk -H "$H" -H "$J" -d "{\"ids\":[\"$M1\"],\"status\":\"rejected\"}" | jq .updated)"
check "mídia: tags (limpa e deduplica)" "a,b" "$(curl -s -X PATCH $MED/media-assets/$M1 -H "$H" -H "$J" -d '{"tags":[" a ","a","b",""]}' | jq -r '.tags|join(",")')"
check "mídia: tags de mídia alheia → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $API/v1/workspaces/$NID/media-assets/$M1 -H "$H" -H "$J" -d '{"tags":["x"]}')"
check "mídia: filtro por tag" "1" "$(curl -s "$MED/media-assets?tag=a" -H "$H" | jq .count)"
check "mídia: renomear tag" "1" "$(curl -s -X POST $MEDA/rename-media-tag -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"from\":\"a\",\"to\":\"promo\"}" | jq .updated)"
check "mídia: renomear pasta (nenhuma) → 0" "0" "$(curl -s -X POST $MEDA/rename-media-folder -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"from\":\"Nada\",\"to\":\"x\"}" | jq .updated)"
check "mídia: viewer não renomeia" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MEDA/rename-media-tag -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"from\":\"a\",\"to\":\"b\"}")"
DL=$(curl -s -X POST $MEDA/download-asset -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetId\":\"$M1\",\"format\":\"original\"}")
DLU=$(echo "$DL" | jq -r .url)
check "mídia: download (viewer pode) devolve nome marca_formato_data" "1" "$(echo "$DL" | jq -r .name | grep -cE '^marca-campanhas_other_[0-9]{4}-[0-9]{2}-[0-9]{2}\.(jpg|png)$')"
check "mídia: …link força o download com o nome" "1" "$(curl -sI "$DLU" | tr -d '\r' | grep -ci '^content-disposition: attachment; filename="marca-campanhas_other_')"
check "mídia: …link adulterado → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' "${DLU/sig=/sig=0}")"
check "mídia: download em PNG" "1" "$(curl -s -X POST $MEDA/download-asset -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetId\":\"$M1\",\"format\":\"png\"}" | jq -r .name | grep -c '\.png$')"
check "mídia: download de mídia alheia → 404" "Mídia não encontrada." "$(curl -s -X POST $MEDA/download-asset -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"assetId\":\"$M1\"}" | jq -r .error.message)"
check "mídia: estranho não baixa" "Você não tem acesso a esta área de trabalho." "$(curl -s -X POST $MEDA/download-asset -H "$HD" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetId\":\"$M1\"}" | jq -r .error.message)"
ZIPR=$(curl -s -X POST $MEDA/export-zip -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":[\"$M1\",\"$M2\"]}")
check "mídia: ZIP com as 2 mídias" "2" "$(echo "$ZIPR" | jq .count)"
check "mídia: …é um ZIP de verdade" "PK" "$(curl -s "$(echo "$ZIPR" | jq -r .url)" | head -c2)"
check "mídia: PDF (uma por página)" "%PDF" "$(curl -s "$(curl -s -X POST $MEDA/export-pdf -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":[\"$M1\",\"$M2\"],\"layout\":\"one_per_page\"}" | jq -r .url)" | head -c4)"
check "mídia: PDF folha de contato" "%PDF" "$(curl -s "$(curl -s -X POST $MEDA/export-pdf -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":[\"$M1\"],\"layout\":\"contact_sheet\"}" | jq -r .url)" | head -c4)"
check "mídia: PDF layout inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MEDA/export-pdf -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":[\"$M1\"],\"layout\":\"x\"}")"
check "mídia: exportar 0 ids → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MEDA/export-zip -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":[]}")"
RF=$(curl -s -X POST $MEDA/reformat-media -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetId\":\"$M1\",\"targets\":[\"ig_story\"]}")
check "mídia: reformatar para Story 1080x1920 (filha do original)" "1,1080,1920,$M1" "$(echo "$RF" | jq -r '.ids|length' | tr '\n' ','; PSQL "SELECT width||','||height||','||parent_id FROM media_assets WHERE id='$(echo "$RF" | jq -r '.ids[0]')'")"
check "mídia: vídeo não é recortado" "Vídeos não são recortados no servidor. Gere um novo vídeo neste formato." "$(curl -s -X POST $MEDA/reformat-media -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetId\":\"$M2\",\"targets\":[\"ig_story\"]}" | jq -r .error.message)"
check "mídia: reformatar formato inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MEDA/reformat-media -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetId\":\"$M1\",\"targets\":[\"xx\"]}")"
check "mídia: revalidar" "3,0" "$(curl -s -X POST $MEDA/revalidate-assets -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":[\"$M1\",\"$M2\",\"$(echo "$RF" | jq -r '.ids[0]')\"]}" | jq -r '"\(.total),\(.failed)"')"
check "mídia: usar no Instagram cria post-rascunho" "feed_carousel,idea" "$(IGP=$(curl -s -X POST $MEDA/use-media-in-instagram -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":[\"$M1\",\"$M2\"]}"); echo "$(echo "$IGP" | jq -r .format),$(PSQL "SELECT status FROM ig_posts WHERE id='$(echo "$IGP" | jq -r .postId)'")")"
IGP1=$(PSQL "SELECT id FROM ig_posts WHERE workspace_id='$WID' LIMIT 1")
check "mídia: anexar a post exige mídia pronta p/ Instagram" "1" "$(curl -s -X POST $MEDA/attach-media-to-post -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$IGP1\",\"assetIds\":[\"$M1\"]}" | jq -r .error.message | grep -c '^Mídia não está pronta para o Instagram: ')"
check "mídia: anexar a post alheio → Post não encontrado." "Post não encontrado." "$(curl -s -X POST $MEDA/attach-media-to-post -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"postId\":\"$IGP1\",\"assetIds\":[\"$M1\"]}" | jq -r .error.message)"
check "mídia: usar em campanha de outro workspace → 404" "Campanha não encontrada." "$(curl -s -X POST $MEDA/use-media-in-campaign -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"assetIds\":[\"$M1\"],\"campaignId\":\"$CID\"}" | jq -r .error.message)"
check "mídia: usar em campanha (viewer → 403)" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MEDA/use-media-in-campaign -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":[\"$M1\"],\"campaignId\":\"$CID\"}")"
check "mídia: usar em campanha cria criativo aprovado" "1,approved" "$(curl -s -X POST $MEDA/use-media-in-campaign -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":[\"$M1\"],\"campaignId\":\"$CID\"}" | jq -r .count | tr '\n' ','; PSQL "SELECT status FROM creatives WHERE campaign_id='$CID' AND title='Foto do bar'")"
check "mídia: resultados em anúncios (zerados)" "0,0" "$(curl -s -X POST $MEDA/media-ad-results -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"creativeId\":\"$(PSQL "SELECT id FROM creatives WHERE title='Foto do bar'")\"}" | jq -r '"\(.days),\(.spend)"')"
check "textos da biblioteca (copies com campaigns(name, brand_id))" "Campanha Smoke" "$(curl -s $MED/copies -H "$HV" | jq -r '.[0].campaigns.name')"

echo "── Task 4: Studio (criativos) ──"
CRE=$(PSQL "SELECT id FROM creatives WHERE title='Foto do bar'")
check "criativos: lista com campaigns(name)" "Foto do bar,Campanha Smoke" "$(curl -s $MED/creatives -H "$HV" | jq -r '"\(.[0].title),\(.[0].campaigns.name)"')"
check "criativos: aprovar/rejeitar (marketing)" "rejected" "$(curl -s -X PATCH $MED/creatives/$CRE -H "$HM" -H "$J" -d '{"status":"rejected"}' | jq -r .status)"
check "criativos: viewer não muda status" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $MED/creatives/$CRE -H "$HV" -H "$J" -d '{"status":"approved"}')"
check "criativos: status inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $MED/creatives/$CRE -H "$H" -H "$J" -d '{"status":"zzz"}')"
check "criativos: de outro workspace → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $API/v1/workspaces/$NID/creatives/$CRE -H "$H" -H "$J" -d '{"status":"approved"}')"
check "criativos: atividade creative.rejected gravada" "1" "$(PSQL "SELECT count(*) FROM activity_logs WHERE workspace_id='$WID' AND action='creative.rejected'")"
check "criativos: jobs recentes (vazio)" "0" "$(curl -s "$MED/creative-generation-jobs?limit=12" -H "$HV" | jq length)"
check "criativos: brief da campanha (estratégias e copies)" "2,2" "$(curl -s $MED/campaigns/$CID/brief -H "$HV" | jq -r '"\(.strategies|length),\(.copies|length)"')"
check "criativos: brief de campanha alheia → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' $API/v1/workspaces/$NID/campaigns/$CID/brief -H "$H")"
CRV=$API/v1/creative
GEN="{\"workspaceId\":\"$WID\",\"campaignId\":\"$CID\",\"title\":\"T\",\"variations\":1}"
check "gerar: viewer → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/generate-creative -H "$HV" -H "$J" -d "$GEN")"
check "gerar: estranho → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/generate-creative -H "$HD" -H "$J" -d "$GEN")"
check "gerar: campanha de outro workspace → 404" "Campanha não encontrada." "$(curl -s -X POST $CRV/generate-creative -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"campaignId\":\"$CID\"}" | jq -r .error.message)"
check "gerar: campo extra → 400" "VALIDATION_ERROR" "$(curl -s -X POST $CRV/generate-creative -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"x\":1}" | jq -r .error.code)"
check "gerar: variações fora de 1..4 → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/generate-creative -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"variations\":9}")"
check "gerar: provedor inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/generate-creative -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"provider\":\"x\"}")"
check "gerar sem gateway de IA → AI_NOT_CONFIGURED (nada é cobrado nem gravado)" "AI_NOT_CONFIGURED,0" "$(curl -s -X POST $CRV/generate-creative -H "$H" -H "$J" -d "$GEN" | jq -r .error.code | tr '\n' ','; PSQL "SELECT count(*) FROM creative_generation_jobs WHERE workspace_id='$WID'")"
check "prévia do prompt: viewer → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/preview-visual-prompt -H "$HV" -H "$J" -d "$GEN")"
check "retry: job inexistente → 404" "Job de geração não encontrado." "$(curl -s -X POST $CRV/retry-creative-job -H "$H" -H "$J" -d '{"jobId":"00000000-0000-4000-8000-000000000000"}' | jq -r .error.message)"
check "nova versão: criativo de estranho → 404" "Criativo não encontrado." "$(curl -s -X POST $CRV/new-creative-version -H "$HD" -H "$J" -d "{\"creativeId\":\"$CRE\"}" | jq -r .error.message)"
check "nova versão: viewer → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/new-creative-version -H "$HV" -H "$J" -d "{\"creativeId\":\"$CRE\"}")"
NV=$(curl -s -X POST $CRV/new-creative-version -H "$HM" -H "$J" -d "{\"creativeId\":\"$CRE\"}")
check "nova versão sem gateway: o erro VOLTA em `error` (200), job failed" "failed,IA do app não configurada.,failed" "$(echo "$NV" | jq -r '"\(.status),\(.error)"' | tr '\n' ','; PSQL "SELECT status FROM creative_generation_jobs WHERE id='$(echo "$NV" | jq -r .jobId)'")"
check "retry do job falho (mesma falha, mesmo job)" "failed" "$(curl -s -X POST $CRV/retry-creative-job -H "$HM" -H "$J" -d "{\"jobId\":\"$(echo "$NV" | jq -r .jobId)\"}" | jq -r .status)"
PKG=$(curl -s -X POST $CRV/capcut-package -H "$HV" -H "$J" -d "{\"creativeId\":\"$CRE\"}")
check "pacote CapCut: zip com imagem + LEIA-ME" "PK,1" "$(curl -s "$(echo "$PKG" | jq -r .url)" -o /tmp/mf-smoke-capcut.zip; head -c2 /tmp/mf-smoke-capcut.zip; echo -n ","; unzip -l /tmp/mf-smoke-capcut.zip 2>/dev/null | grep -c 'LEIA-ME.txt')"
check "pacote CapCut: estranho → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/capcut-package -H "$HD" -H "$J" -d "{\"creativeId\":\"$CRE\"}")"
check "chaves de IA: aviso de crédito (nenhuma chave → vazio)" "0" "$(curl -s -X POST $API/v1/ai-keys/ai-keys-health -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq '.outOfCredit|length')"
check "chaves de IA: estranho → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/ai-keys/ai-keys-health -H "$HD" -H "$J" -d "{\"workspaceId\":\"$WID\"}")"

echo "── Task 4: Canva ──"
check "canva: status sem app" "false,false" "$(curl -s -X POST $CRV/canva-get-status -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r '"\(.appSaved),\(.connected)"')"
check "canva: marketing não salva o app" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/canva-save-app -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\",\"clientId\":\"abcd1234\",\"clientSecret\":\"s\"}")"
check "canva: client id curto → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/canva-save-app -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"clientId\":\"ab\"}")"
check "canva: login exige o app salvo" "Salve o Client ID e o Client secret do app Canva antes de entrar." "$(curl -s -X POST $CRV/canva-o-auth-start -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r .error.message)"
check "canva: dono salva o app (cifrado no cofre)" "true,1,0" "$(curl -s -X POST $CRV/canva-save-app -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"clientId\":\"abcd1234\",\"clientSecret\":\"segredo-canva-smoke\"}" | jq -r .ok | tr '\n' ','; PSQL "SELECT count(*) FROM app_credentials WHERE workspace_id='$WID' AND key='CANVA_CLIENT_SECRET' AND value LIKE 'enc:v2:%'" | tr '\n' ','; PSQL "SELECT count(*) FROM app_credentials WHERE value LIKE '%segredo-canva-smoke%'")"
check "canva: status mostra a dica do id" "true,abcd••••" "$(curl -s -X POST $CRV/canva-get-status -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r '"\(.appSaved),\(.clientIdHint)"')"
check "canva: login devolve a URL de autorização (PKCE S256)" "1,1" "$(AU=$(curl -s -X POST $CRV/canva-o-auth-start -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r .authUrl); echo "$AU" | grep -c '^https://www.canva.com/api/oauth/authorize?' | tr '\n' ','; echo "$AU" | grep -c 'code_challenge_method=S256')"
check "canva: marketing não inicia login" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/canva-o-auth-start -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\"}")"
check "canva: testar sem conexão" "Canva não está conectado nesta empresa. Entre com Canva em Integrações." "$(curl -s -X POST $CRV/canva-test -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r .error.message)"
check "canva: criar design sem conexão (marketing)" "Canva não está conectado nesta empresa. Entre com Canva em Integrações." "$(curl -s -X POST $CRV/canva-create-from-brief -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\",\"title\":\"T\"}" | jq -r .error.message)"
check "canva: criar design (viewer → 403)" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/canva-create-from-brief -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"title\":\"T\"}")"
check "canva: tamanho inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/canva-create-from-brief -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"title\":\"T\",\"size\":\"x\"}")"
check "canva: enviar mídia alheia → 404" "Mídia não encontrada." "$(curl -s -X POST $CRV/canva-send-asset -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"assetId\":\"$M1\"}" | jq -r .error.message)"
check "canva: importar com id inválido" "Endereço ou id do design inválido." "$(curl -s -X POST $CRV/canva-import-design -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"designId\":\"###\"}" | jq -r .error.message)"
check "canva: listar designs sem conexão" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/canva-list-designs -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\"}")"
CBK=$API/api/public/canva/oauth/callback
check "canva callback (pública): erro do Canva → 302 p/ /integrations?canva=error" "302,1" "$(curl -s -o /dev/null -w '%{http_code},' "$CBK?error=access_denied"; curl -sI "$CBK?error=access_denied" | tr -d '\r' | grep -ci '^location: .*/integrations?canva=error')"
check "canva callback: sem code/state → erro" "1" "$(curl -sI "$CBK" | tr -d '\r' | grep -ci '^location: .*canva=error')"
check "canva callback: state forjado → erro, nada gravado" "1,0" "$(curl -sI "$CBK?code=x&state=$WID.forjado" | tr -d '\r' | grep -ci 'canva=error' | tr '\n' ','; PSQL "SELECT count(*) FROM app_credentials WHERE workspace_id='$WID' AND key='CANVA_TOKENS'")"
check "canva: marketing não desconecta" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRV/canva-disconnect -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\"}")"
check "canva: desconectar" "true" "$(curl -s -X POST $CRV/canva-disconnect -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r .ok)"

echo "── Task 4: MCP ──"
MCP=$API/v1/mcp
check "mcp: marketing não conecta" "Só o dono ou um administrador conecta contas." "$(curl -s -X POST $MCP/mcp-connect -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\",\"provider\":\"higgsfield\",\"serverUrl\":\"https://mcp.higgsfield.ai/mcp\"}" | jq -r .error.message)"
check "mcp: estranho não é membro" "Você não tem acesso a este workspace." "$(curl -s -X POST $MCP/mcp-connect -H "$HD" -H "$J" -d "{\"workspaceId\":\"$WID\",\"provider\":\"higgsfield\",\"serverUrl\":\"https://mcp.higgsfield.ai/mcp\"}" | jq -r .error.message)"
check "mcp: provedor inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MCP/mcp-connect -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"provider\":\"x\",\"serverUrl\":\"https://a.b/mcp\"}")"
check "mcp: endereço http é recusado (status error, vira linha)" "error,Use um endereço https:// para o servidor MCP." "$(curl -s -X POST $MCP/mcp-connect -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"provider\":\"higgsfield\",\"serverUrl\":\"http://exemplo.invalid/mcp\",\"accessToken\":\"token-mcp-smoke-123\"}" | jq -r '"\(.status),\(.error)"')"
check "mcp: o token fica CIFRADO no banco (nunca em texto puro)" "1,0" "$(PSQL "SELECT count(*) FROM mcp_connections WHERE workspace_id='$WID' AND access_token LIKE 'enc:v2:%'" | tr '\n' ','; PSQL "SELECT count(*) FROM mcp_connections WHERE access_token LIKE '%token-mcp-smoke-123%'")"
check "mcp: a lista nunca devolve colunas de token" "error,false" "$(curl -s $API/v1/workspaces/$WID/mcp-connections -H "$HV" | jq -r '.[0] | "\(.status),\(has("access_token") or has("refresh_token") or has("oauth_client_secret") or has("oauth_code_verifier"))"')"
check "mcp: estranho não lê as conexões" "403" "$(curl -s -o /dev/null -w '%{http_code}' $API/v1/workspaces/$WID/mcp-connections -H "$HD")"
check "mcp: status do provedor nas minhas empresas" "1" "$(curl -s $MCP/status/higgsfield -H "$H" | jq length)"
check "mcp: status de provedor inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' $MCP/status/xx -H "$H")"
check "mcp: OAuth em servidor inalcançável → mensagem" "Não foi possível descobrir o servidor de autenticação (OAuth) deste MCP." "$(curl -s -X POST $MCP/mcp-o-auth-start -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"provider\":\"meta\",\"serverUrl\":\"https://nao-existe.invalid/mcp\"}" | jq -r .error.message)"
check "mcp: executar sem conexão ativa" "Nenhuma conexão MCP ativa para este provedor." "$(curl -s -X POST $MCP/mcp-run -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\",\"provider\":\"canva\"}" | jq -r .error.message)"
check "mcp: viewer não executa" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MCP/mcp-run -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"provider\":\"canva\"}")"
MCB=$API/api/public/mcp/callback
check "mcp callback (pública): erro do provedor → página de falha" "1" "$(curl -s "$MCB?error=access_denied" | grep -c 'Não foi possível conectar')"
check "mcp callback: state desconhecido → expirada" "1" "$(curl -s "$MCB?code=x&state=nada" | grep -c 'Sessão de conexão não encontrada ou expirada.')"
check "mcp callback: sem parâmetros" "1" "$(curl -s "$MCB" | grep -c 'Retorno de autenticação incompleto.')"
check "mcp: marketing não desconecta" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MCP/mcp-disconnect -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\",\"provider\":\"higgsfield\"}")"
check "mcp: dono desconecta (a linha e o token somem)" "true,0" "$(curl -s -X POST $MCP/mcp-disconnect -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"provider\":\"higgsfield\"}" | jq -r .ok | tr '\n' ','; PSQL "SELECT count(*) FROM mcp_connections WHERE workspace_id='$WID'")"

echo "── Task 4: exclusão e limpeza da mídia ──"
check "mídia: viewer não exclui" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $MEDA/delete-media-assets -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":[\"$M1\"]}")"
check "mídia: id de outro workspace não é excluído" "0" "$(curl -s -X POST $MEDA/delete-media-assets -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"assetIds\":[\"$M1\"]}" | jq .deleted)"
ALLM=$(PSQL "SELECT json_agg(id) FROM media_assets WHERE workspace_id='$WID'")
MPATH=$(PSQL "SELECT storage_path FROM media_assets WHERE id='$M1'")
check "mídia: dono exclui tudo (arquivo + registro)" "true" "$(curl -s -X POST $MEDA/delete-media-assets -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"assetIds\":$ALLM}" | jq '.deleted >= 3')"
check "mídia: …o arquivo sumiu do disco (link antigo → 404)" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$DLU")"
check "mídia: …e não sobrou linha" "0" "$(PSQL "SELECT count(*) FROM media_assets WHERE workspace_id='$WID'")"
rm -rf "$(dirname "$0")/../uploads/creative-assets/exports/$WID" "$(dirname "$0")/../uploads/creative-assets/media/$WID" /tmp/mf-smoke-1x1.png /tmp/mf-smoke-fake.mp4 /tmp/mf-smoke-notmp4.mp4 /tmp/mf-smoke.txt /tmp/mf-smoke-capcut.zip

echo "── Task 5: Instagram (recursos, ações, autorização) ──"
# Pré-requisito da parte do webhook: a API foi iniciada com META_APP_SECRET=smoke-meta-secret (o do ambiente assina o corpo).
IGW=$API/v1/workspaces/$WID
IGA=$API/v1/instagram
META_SECRET=${META_APP_SECRET:-smoke-meta-secret}
T0=$(PSQL "SELECT now()")
check "ig: conta inexistente devolve {} (sem id)" "false" "$(curl -s $IGW/instagram-account -H "$H" | jq 'has("id")')"
check "ig: estranho não lê a conta" "403" "$(curl -s -o /dev/null -w '%{http_code}' $IGW/instagram-account -H "$HD")"
N0=$(curl -s $IGW/ig-posts -H "$HV" | jq length)
check "ig: lista de posts (viewer lê)" "true" "$(curl -s $IGW/ig-posts -H "$HV" | jq 'type=="array"')"

NBRAND=$(curl -s -X POST $API/v1/workspaces/$NID/brands -H "$H" -H "$J" -d '{"name":"Marca Alheia IG","segment":"Bar"}' | jq -r .id)
IBR=$(curl -s -X POST $IGW/brands -H "$H" -H "$J" -d '{"name":"Marca IG Smoke","segment":"Bar"}' | jq -r .id)
PN0=$(curl -s $IGW/ig-content-plans -H "$HV" | jq length)
PLAN_BODY='{"name":"Plano IG Smoke","brand_id":"'$IBR'","objective":"Vender","tone_of_voice":"leve","content_pillars":["Bastidores","Promoções"],"posting_frequency":{"feed_image":2,"feed_carousel":1,"feed":3,"reels":2,"stories":5,"lixo":9},"preferred_times":["09:00","19:00"],"posting_days":[1,3,5],"hashtag_strategy":{"notes":"#a","audience":"b","x":"y"},"cta_default":"Peça já","requires_approval":true,"auto_publish":false,"status":"active"}'
PL=$(curl -s -X POST $IGW/ig-content-plans -H "$H" -H "$J" -d "$PLAN_BODY")
PLID=$(echo "$PL" | jq -r .id)
[ "$PLID" != "null" ] && ok "ig: criar plano (dono)" || ko "ig: criar plano" "$PL"
check "ig: plano limpa chaves desconhecidas da frequência" "feed,feed_carousel,feed_image,reels,stories" "$(echo "$PL" | jq -r '.posting_frequency | keys | join(",")')"
check "ig: plano — hashtag_strategy só notes/audience" "audience,notes" "$(echo "$PL" | jq -r '.hashtag_strategy | keys | join(",")')"
check "ig: viewer não cria plano" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGW/ig-content-plans -H "$HV" -H "$J" -d "$PLAN_BODY")"
check "ig: plano com workspace_id no corpo → 400" "VALIDATION_ERROR" "$(curl -s -X POST $IGW/ig-content-plans -H "$H" -H "$J" -d '{"name":"x","workspace_id":"'$NID'"}' | jq -r .error.code)"
check "ig: status fora do CHECK → 400" "VALIDATION_ERROR" "$(curl -s -X POST $IGW/ig-content-plans -H "$H" -H "$J" -d '{"name":"x","status":"archived"}' | jq -r .error.code)"
check "ig: marca de outro workspace → 404" "Marca não encontrada." "$(curl -s -X POST $IGW/ig-content-plans -H "$H" -H "$J" -d '{"name":"x","brand_id":"'$NBRAND'"}' | jq -r .error.message)"
check "ig: editar plano (marketing)" "paused" "$(curl -s -X PATCH $IGW/ig-content-plans/$PLID -H "$HM" -H "$J" -d '{"status":"paused"}' | jq -r .status)"
check "ig: plano de outro workspace não é editado" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $API/v1/workspaces/$NID/ig-content-plans/$PLID -H "$H" -H "$J" -d '{"status":"active"}')"
check "ig: id malformado → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $IGW/ig-content-plans/xxx -H "$H" -H "$J" -d '{}')"
check "ig: listar planos (+ filtro de arquivados)" "$((PN0+1)),$((PN0+1)),$PLID" "$(curl -s $IGW/ig-content-plans -H "$HV" | jq length | tr '\n' ','; curl -s "$IGW/ig-content-plans?exclude_archived=true" -H "$HV" | jq length | tr '\n' ','; curl -s $IGW/ig-content-plans -H "$HV" | jq -r '[.[] | select(.name=="Plano IG Smoke")][0].id')"
check "ig: o outro workspace não vê o plano" "0" "$(curl -s $API/v1/workspaces/$NID/ig-content-plans -H "$H" | jq length)"

# Posts criados direto no banco (a geração com IA/provedor é coberta pelos testes jest e pelo browser-check).
P1=$(PSQL "INSERT INTO ig_posts(workspace_id,plan_id,format,status,theme,caption,hashtags,creative_brief) VALUES ('$WID','$PLID','feed_image','idea','Tema 1','Legenda 1','{a,b}','{\"prompt\":\"copo\",\"pending_job\":{\"jobId\":\"veo:real\"}}') RETURNING id" | head -1)
P2=$(PSQL "INSERT INTO ig_posts(workspace_id,format,status,theme,media,scheduled_at) VALUES ('$WID','reel','pending_approval','Tema 2','[{\"url\":\"http://exemplo.invalid/a.mp4\",\"type\":\"video\",\"order\":0}]', now() + interval '2 days') RETURNING id" | head -1)
P3=$(PSQL "INSERT INTO ig_posts(workspace_id,format,status,theme,media) VALUES ('$WID','feed_image','pending_approval','Tema 3','[{\"url\":\"http://exemplo.invalid/b.jpg\",\"type\":\"image\",\"order\":0}]') RETURNING id" | head -1)
check "ig: posts listados (os 3 novos; os sem data ficam por último)" "$((N0+3)),Tema 2" "$(curl -s $IGW/ig-posts -H "$HV" | jq -r '[length, ([.[] | select(.theme=="Tema 2" or .theme=="Tema 1" or .theme=="Tema 3")] | .[0].theme)] | join(",")')"
check "ig: selo do menu = posts aguardando aprovação" "2" "$(curl -s $IGW/ig-posts/pending-count -H "$HV" | jq .count)"
check "ig: selo é por workspace" "0" "$(curl -s $API/v1/workspaces/$NID/ig-posts/pending-count -H "$H" | jq .count)"
check "ig: editar post (marketing)" "Nova legenda" "$(curl -s -X PATCH $IGW/ig-posts/$P1 -H "$HM" -H "$J" -d '{"caption":"Nova legenda","hashtags":["x","y"],"cta":"Fale","scheduled_at":"2030-05-05T12:00:00-03:00"}' | jq -r .caption)"
check "ig: …horário gravado em UTC" "2030-05-05T15:00:00" "$(PSQL "SELECT to_char(scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS') FROM ig_posts WHERE id='$P1'")"
check "ig: viewer não edita post" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $IGW/ig-posts/$P1 -H "$HV" -H "$J" -d '{"caption":"x"}')"
check "ig: estranho não edita post" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $IGW/ig-posts/$P1 -H "$HD" -H "$J" -d '{"caption":"x"}')"
check "ig: post de outro workspace → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $API/v1/workspaces/$NID/ig-posts/$P1 -H "$H" -H "$J" -d '{"caption":"x"}')"
check "ig: status/media não são editáveis (whitelist)" "VALIDATION_ERROR" "$(curl -s -X PATCH $IGW/ig-posts/$P1 -H "$H" -H "$J" -d '{"status":"published"}' | jq -r .error.code)"
curl -s -X PATCH $IGW/ig-posts/$P1 -H "$H" -H "$J" -d '{"creative_brief":{"prompt":"novo","layout":"titulo_topo","pending_job":{"jobId":"veo:forjado"}}}' >/dev/null
check "ig: creative_brief — o pending_job do servidor não é sobrescrito" "novo,veo:real" "$(PSQL "SELECT creative_brief->>'prompt' || ',' || (creative_brief->'pending_job'->>'jobId') FROM ig_posts WHERE id='$P1'")"

check "ig: aprovar sem mídia" "Gere a mídia antes de aprovar." "$(curl -s -X POST $IGA/approve-post -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P1\"}" | jq -r .error.message)"
check "ig: viewer não aprova" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/approve-post -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P2\"}")"
check "ig: post de outro workspace (id na empresa errada) → 404" "Post não encontrado." "$(curl -s -X POST $IGA/approve-post -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"postId\":\"$P2\"}" | jq -r .error.message)"
check "ig: estranho não aprova" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/approve-post -H "$HD" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P2\"}")"
check "ig: agendar post não aprovado" "O post precisa estar aprovado para ser agendado." "$(curl -s -X POST $IGA/schedule-post -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P2\",\"scheduledAt\":\"2030-01-01T10:00:00-03:00\"}" | jq -r .error.message)"
check "ig: aprovar (marketing)" "true,approved" "$(curl -s -X POST $IGA/approve-post -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P2\"}" | jq -r .ok | tr '\n' ','; PSQL "SELECT status FROM ig_posts WHERE id='$P2'")"
check "ig: scheduledAt sem fuso → 400" "VALIDATION_ERROR" "$(curl -s -X POST $IGA/schedule-post -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P2\",\"scheduledAt\":\"2030-01-01T10:00:00\"}" | jq -r .error.code)"
check "ig: agendar (sem conta conectada = sandbox)" "true,true" "$(curl -s -X POST $IGA/schedule-post -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P2\",\"scheduledAt\":\"2030-01-01T10:00:00-03:00\"}" | jq -r '[.ok,.sandbox]|join(",")')"
curl -s -X POST $IGA/schedule-post -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P2\",\"scheduledAt\":\"2030-01-02T10:00:00-03:00\"}" >/dev/null
check "ig: reagendar cancela o job anterior (fila instagram_organic)" "cancelled:1,pending:1,scheduled" "$(PSQL "SELECT string_agg(status||':'||c, ',' ORDER BY status) FROM (SELECT status, count(*) c FROM publishing_jobs WHERE ig_post_id='$P2' AND channel='instagram_organic' GROUP BY status) t" | tr -d '\n'),$(PSQL "SELECT status FROM ig_posts WHERE id='$P2'")"
check "ig: viewer não rejeita" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/reject-post -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P3\",\"reason\":\"x\"}")"
check "ig: rejeitar exige motivo → 400" "VALIDATION_ERROR" "$(curl -s -X POST $IGA/reject-post -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P3\",\"reason\":\"\"}" | jq -r .error.code)"
check "ig: rejeitar (dono) cancela e guarda o motivo" "cancelled,Texto errado" "$(curl -s -X POST $IGA/reject-post -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P3\",\"reason\":\"Texto errado\"}" >/dev/null; PSQL "SELECT status||','||rejection_reason FROM ig_posts WHERE id='$P3'")"
P4=$(PSQL "INSERT INTO ig_posts(workspace_id,format,status,approved_at,media) VALUES ('$WID','feed_image','approved',now(),'[{\"url\":\"http://exemplo.invalid/c.jpg\",\"type\":\"image\",\"order\":0}]') RETURNING id" | head -1)
PUB=$(curl -s -X POST $IGA/publish-instagram-post -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P4\"}")
check "ig: publicar com mídia sem HTTPS → { ok:false } (200) e post failed" "false,Mídia sem URL pública válida (HTTPS).,failed" "$(echo "$PUB" | jq -r '[.ok,.error]|join(",")'),$(PSQL "SELECT status FROM ig_posts WHERE id='$P4'")"
check "ig: viewer não publica" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/publish-instagram-post -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P4\"}")"
check "ig: métricas de post não publicado" "Post ainda não publicado." "$(curl -s -X POST $IGA/collect-post-metrics -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P1\"}" | jq -r .error.message)"
check "ig: insights da conta sem conta conectada" "sem conta conectada" "$(curl -s -X POST $IGA/collect-account-insights-now -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r .skipped)"
check "ig: conectar conta (marketing → 403)" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/connect-instagram-account -H "$HM" -H "$J" -d "{\"workspaceId\":\"$WID\"}")"
check "ig: conectar sem credenciais da Meta → { ok:false } (200)" "false,Salve as credenciais da Meta em Integrações antes de conectar o Instagram." "$(curl -s -X POST $IGA/connect-instagram-account -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r '[.ok,.error]|join(",")')"
check "ig: …a conta fica com status error" "error" "$(curl -s $IGW/instagram-account -H "$HV" | jq -r .status)"
check "ig: listar Páginas sem credenciais" "false,0" "$(curl -s -X POST $IGA/list-instagram-options -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r '[.ok,(.options|length)]|join(",")')"
check "ig: importar histórico sem conta conectada" "Conecte uma conta do Instagram antes de importar o histórico." "$(curl -s -X POST $IGA/sync-instagram-history -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r .error.message)"
check "ig: desconectar (dono)" "true,0" "$(curl -s -X POST $IGA/disconnect-instagram-account -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\"}" | jq -r .ok | tr '\n' ','; PSQL "SELECT count(*) FROM instagram_accounts WHERE workspace_id='$WID'")"
check "ig: gerar calendário — semanas fora do limite → 400" "VALIDATION_ERROR" "$(curl -s -X POST $IGA/generate-content-calendar -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"planId\":\"$PLID\",\"weeks\":9}" | jq -r .error.code)"
check "ig: gerar calendário — plano de outra empresa → 404" "Plano de conteúdo não encontrado." "$(curl -s -X POST $IGA/generate-content-calendar -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"planId\":\"$PLID\"}" | jq -r .error.message)"
check "ig: gerar calendário sem IA configurada → 502" "502" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/generate-content-calendar -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"planId\":\"$PLID\"}")"
check "ig: viewer não gera calendário" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/generate-content-calendar -H "$HV" -H "$J" -d "{\"workspaceId\":\"$WID\",\"planId\":\"$PLID\"}")"
check "ig: sugerir pilares com marca de outra empresa → 404" "Marca não encontrada." "$(curl -s -X POST $IGA/suggest-pillars -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"brandId\":\"$NBRAND\"}" | jq -r .error.message)"
check "ig: legenda de post alheio → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/regenerate-caption -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"postId\":\"$P1\"}")"
check "ig: mídia de post alheio → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/generate-post-assets -H "$H" -H "$J" -d "{\"workspaceId\":\"$NID\",\"postId\":\"$P1\"}")"
check "ig: provedor de mídia inválido → 400" "VALIDATION_ERROR" "$(curl -s -X POST $IGA/generate-post-assets -H "$H" -H "$J" -d "{\"workspaceId\":\"$WID\",\"postId\":\"$P1\",\"provider\":\"midjourney\"}" | jq -r .error.code)"
printf 'x' > /tmp/mf-smoke-ig.txt
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > /tmp/mf-smoke-ig.png
check "ig: enviar mídia — tipo inválido → 400" "Envie uma imagem ou um vídeo MP4." "$(curl -s -X POST $IGA/upload-post-media -H "$H" -F "workspaceId=$WID" -F "postId=$P1" -F "file=@/tmp/mf-smoke-ig.txt;type=text/plain" | jq -r .error.message)"
check "ig: enviar mídia — viewer 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/upload-post-media -H "$HV" -F "workspaceId=$WID" -F "postId=$P1" -F "file=@/tmp/mf-smoke-ig.png;type=image/png")"
check "ig: enviar imagem → ok, entra na biblioteca e no post (aguardando aprovação)" "true,pending_approval,1,1" "$(curl -s -X POST $IGA/upload-post-media -H "$HM" -F "workspaceId=$WID" -F "postId=$P1" -F "file=@/tmp/mf-smoke-ig.png;type=image/png" | jq -r .ok | tr '\n' ','; PSQL "SELECT status||','||jsonb_array_length(media) FROM ig_posts WHERE id='$P1'" | tr '\n' ','; PSQL "SELECT count(*) FROM media_assets WHERE ig_post_id='$P1'")"
rm -f /tmp/mf-smoke-ig.txt /tmp/mf-smoke-ig.png
rm -rf "$(dirname "$0")/../uploads/creative-assets/media/$WID"

echo "── Task 5: calendário automático ──"
PREV=$(curl -s -X POST $IGA/preview-auto-calendar -H "$H" -H "$J" -d '{"startDate":"2099-01-01","endDate":"2099-01-03","weekdays":[0,1,2,3,4,5,6],"times":["09:00","18:00"],"storyTimes":["12:00"],"formats":["feed_image","reel"]}')
check "auto: prévia dos horários" "true,9,0,2099-01-01T12:00:00.000Z" "$(echo "$PREV" | jq -r '[.ok,.total,.skipped,.first]|join(",")')"
check "auto: prévia com período invertido → ok:false" "false,A data final precisa ser igual ou depois da inicial (e não pode estar no passado)." "$(curl -s -X POST $IGA/preview-auto-calendar -H "$H" -H "$J" -d '{"startDate":"2099-01-05","endDate":"2099-01-01","weekdays":[1],"times":["09:00"],"storyTimes":[],"formats":["feed_image"]}' | jq -r '[.ok,.error]|join(",")')"
check "auto: prévia exige login" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/preview-auto-calendar -H "$J" -d '{}')"
AUTO='{"workspaceId":"'$WID'","planId":"'$PLID'","startDate":"2099-01-01","endDate":"2099-01-03","weekdays":[0,1,2,3,4,5,6],"times":["09:00","18:00"],"storyTimes":[],"formats":["feed_image"],"mode":"approval"}'
check "auto: viewer não cria" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/create-auto-calendar -H "$HV" -H "$J" -d "$AUTO")"
check "auto: marketing não cria 'publica sozinho'" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/create-auto-calendar -H "$HM" -H "$J" -d "${AUTO/approval/publish}")"
check "auto: sem horário → 400" "Informe ao menos um horário." "$(curl -s -X POST $IGA/create-auto-calendar -H "$H" -H "$J" -d '{"workspaceId":"'$WID'","planId":"'$PLID'","startDate":"2099-01-01","endDate":"2099-01-03","weekdays":[1],"times":[],"storyTimes":[],"formats":["feed_image"],"mode":"approval"}' | jq -r .error.message)"
check "auto: dia da semana inválido → 400" "VALIDATION_ERROR" "$(curl -s -X POST $IGA/create-auto-calendar -H "$H" -H "$J" -d "$(echo "$AUTO" | jq -c '.weekdays=[9]')" | jq -r .error.code)"
check "auto: plano de outra empresa → 404" "Plano de conteúdo não encontrado." "$(curl -s -X POST $IGA/create-auto-calendar -H "$H" -H "$J" -d "${AUTO/$WID/$NID}" | jq -r .error.message)"
check "auto: campanha inexistente → 404" "Campanha não encontrada." "$(curl -s -X POST $IGA/create-auto-calendar -H "$H" -H "$J" -d "$(echo "$AUTO" | jq -c '.campaignId="00000000-0000-4000-8000-000000000000"')" | jq -r .error.message)"
CR=$(curl -s -X POST $IGA/create-auto-calendar -H "$HM" -H "$J" -d "$AUTO")
RUN=$(echo "$CR" | jq -r .runId)
check "auto: marketing cria com aprovação (6 horários)" "6,0" "$(echo "$CR" | jq -r '[.total,.skipped]|join(",")')"
check "auto: …run gravada (planning, 6 slots, created_by)" "planning,6,0" "$(PSQL "SELECT status||','||jsonb_array_length(slots)||','||filled FROM ig_auto_runs WHERE id='$RUN'")"
check "auto: resumo das programações" "1,1,0" "$(curl -s $IGW/ig-auto-runs -H "$HV" | jq -r '[length, .[0].weeks, .[0].counts.total]|join(",")')"
check "auto: resumo é por workspace" "0" "$(curl -s $API/v1/workspaces/$NID/ig-auto-runs -H "$H" | jq length)"
check "auto: preencher — estranho → 404 (sem vazar)" "Programação não encontrada." "$(curl -s -X POST $IGA/fill-auto-calendar -H "$HD" -H "$J" -d "{\"runId\":\"$RUN\"}" | jq -r .error.message)"
check "auto: preencher — viewer → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/fill-auto-calendar -H "$HV" -H "$J" -d "{\"runId\":\"$RUN\"}")"
check "auto: preencher sem IA → 502; lock solto e erro guardado" "502,,IA" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $IGA/fill-auto-calendar -H "$H" -H "$J" -d "{\"runId\":\"$RUN\"}"),$(PSQL "SELECT coalesce(locked_until::text,'') FROM ig_auto_runs WHERE id='$RUN'"),$(PSQL "SELECT left(last_error,2) FROM ig_auto_runs WHERE id='$RUN'")"
check "auto: próximo criativo sem posts na janela" "true,true,0" "$(curl -s -X POST $IGA/generate-next-auto-media -H "$H" -H "$J" -d "{\"runId\":\"$RUN\",\"withinHours\":6}" | jq -r '[.done,.ok,.remaining]|join(",")')"
check "auto: janela fora do limite → 400" "VALIDATION_ERROR" "$(curl -s -X POST $IGA/generate-next-auto-media -H "$H" -H "$J" -d "{\"runId\":\"$RUN\",\"withinHours\":100}" | jq -r .error.code)"
AP=$(PSQL "INSERT INTO ig_posts(workspace_id,plan_id,run_id,automation,format,status,scheduled_at) VALUES ('$WID','$PLID','$RUN','approval','feed_image','idea', now() + interval '3 days') RETURNING id" | head -1)
check "auto: cancelar — estranho → 404" "Programação não encontrada." "$(curl -s -X POST $IGA/cancel-auto-calendar -H "$HD" -H "$J" -d "{\"runId\":\"$RUN\"}" | jq -r .error.message)"
check "auto: cancelar (marketing) retira os posts da fila" "1,cancelled,cancelled" "$(curl -s -X POST $IGA/cancel-auto-calendar -H "$HM" -H "$J" -d "{\"runId\":\"$RUN\"}" | jq -r .cancelled),$(PSQL "SELECT status FROM ig_posts WHERE id='$AP'"),$(PSQL "SELECT status FROM ig_auto_runs WHERE id='$RUN'")"

echo "── Task 5: cron do Instagram, fila de publicação e piloto ──"
CRON=$API/api/public/cron/instagram
CTOK="smoke-cron-$SUF"
check "cron: sem segredo → 401" "401,Unauthorized" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRON -H "$J" -d '{}'),$(curl -s -X POST $CRON -H "$J" -d '{}' | jq -r .error.message)"
check "cron: segredo errado → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRON -H "x-cron-secret: errado" -H "$J" -d '{}')"
PSQL "INSERT INTO cron_tokens(name,token) VALUES ('instagram','$CTOK') ON CONFLICT (name) DO UPDATE SET token=EXCLUDED.token" >/dev/null
check "cron: token do banco com tarefa inválida → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"rm"}')"
# Fila: post agendado cuja mídia não é HTTPS → Guardrail (não repete) ; job com trava vencida é retomado
Q1=$(PSQL "INSERT INTO ig_posts(workspace_id,format,status,approved_at,media,scheduled_at) VALUES ('$WID','feed_image','scheduled',now(),'[{\"url\":\"http://exemplo.invalid/q1.jpg\",\"type\":\"image\",\"order\":0}]', now()) RETURNING id" | head -1)
Q2=$(PSQL "INSERT INTO ig_posts(workspace_id,format,status,approved_at,media,scheduled_at) VALUES ('$WID','feed_image','scheduled',now(),'[{\"url\":\"http://exemplo.invalid/q2.jpg\",\"type\":\"image\",\"order\":0}]', now()) RETURNING id" | head -1)
Q3=$(PSQL "INSERT INTO ig_posts(workspace_id,format,status,approved_at,media,scheduled_at) VALUES ('$WID','feed_image','scheduled',now(),'[{\"url\":\"http://exemplo.invalid/q3.jpg\",\"type\":\"image\",\"order\":0}]', now() + interval '1 day') RETURNING id" | head -1)
J1=$(PSQL "INSERT INTO publishing_jobs(workspace_id,channel,ig_post_id,target,status,mode,run_at) VALUES ('$WID','instagram_organic','$Q1','instagram','pending','live', now() - interval '1 minute') RETURNING id" | head -1)
J2=$(PSQL "INSERT INTO publishing_jobs(workspace_id,channel,ig_post_id,target,status,mode,run_at,attempts,locked_at) VALUES ('$WID','instagram_organic','$Q2','instagram','running','live', now() - interval '1 hour', 1, now() - interval '20 minutes') RETURNING id" | head -1)
J3=$(PSQL "INSERT INTO publishing_jobs(workspace_id,channel,ig_post_id,target,status,mode,run_at) VALUES ('$WID','instagram_organic','$Q3','instagram','pending','live', now() + interval '1 day') RETURNING id" | head -1)
J4=$(PSQL "INSERT INTO publishing_jobs(workspace_id,channel,ig_post_id,target,status,mode,run_at) VALUES ('$WID','meta_ads','$Q3','meta','pending','mock', now() - interval '1 hour') RETURNING id" | head -1)
QR=$(curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"queue"}')
check "cron queue: devolve pendingMedia e queue" "pendingMedia,queue" "$(echo "$QR" | jq -r 'keys | join(",")')"
check "cron queue: job vencido → failed (Guardrail não repete), tentativas e log" "failed,1,1" "$(PSQL "SELECT status||','||attempts||','||(log LIKE '%Mídia sem URL pública válida (HTTPS).%')::int FROM publishing_jobs WHERE id='$J1'")"
check "cron queue: trava vencida (>15 min) foi liberada e o job processado" "failed,2" "$(PSQL "SELECT status||','||attempts FROM publishing_jobs WHERE id='$J2'")"
check "cron queue: job futuro e job de meta_ads não são tocados" "pending,pending" "$(PSQL "SELECT string_agg(status, ',' ORDER BY id) FROM publishing_jobs WHERE id IN ('$J3','$J4')")"
check "cron queue: os posts espelham o job (failed + last_error)" "failed,failed,scheduled" "$(PSQL "SELECT status FROM ig_posts WHERE id='$Q1'"),$(PSQL "SELECT status FROM ig_posts WHERE id='$Q2'"),$(PSQL "SELECT status FROM ig_posts WHERE id='$Q3'")"
check "cron queue: evento 'guardrail' no piloto, visível na API" "guardrail" "$(curl -s "$IGW/ig-autopilot-events?limit=5" -H "$HV" | jq -r '[.[] | select(.post_id=="'$Q1'")][0].kind')"
check "cron: heartbeat da fila gravado" "instagram-queue,ok" "$(PSQL "SELECT name||','||last_status FROM cron_heartbeats WHERE name='instagram-queue'")"
check "cron publish = alias do queue" "pendingMedia,queue" "$(curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"publish"}' | jq -r 'keys | join(",")')"
check "cron media (calendário automático + piloto) sem erro" "autoCalendar,autopilot,false" "$(curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"media"}' | jq -r '[(keys|join(",")), ([.. | objects | select(has("error"))] | length > 0)] | join(",")')"
check "cron metrics sem erro" "learning,metrics,false" "$(curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"metrics"}' | jq -r '[(keys|join(",")), ([.. | objects | select(has("error"))] | length > 0)] | join(",")')"
check "cron account / optimize devolvem lista" "array,array" "$(curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"account"}' | jq -r '.account|type'),$(curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"optimize"}' | jq -r '.optimize|type')"
PSQL "UPDATE ig_content_plans SET status='active', auto_publish=true WHERE id='$PLID'" >/dev/null
WK=$(curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"weekly"}')
check "cron weekly: sem IA o plano falha, a semana é liberada e o evento 'failure' fica" "true,0,failure" "$(echo "$WK" | jq -r '[.weekly[] | select(.plan=="'$PLID'" and has("error"))] | length > 0' | tr '\n' ','; PSQL "SELECT count(*) FROM ig_autopilot_weeks WHERE plan_id='$PLID'" | tr '\n' ','; PSQL "SELECT kind FROM ig_autopilot_events WHERE plan_id='$PLID' AND message LIKE 'Falha ao gerar o calendário%' LIMIT 1")"
PSQL "UPDATE ig_content_plans SET auto_publish=false WHERE id='$PLID'" >/dev/null

echo "── Task 5: webhook do Instagram ──"
WHI=$(PSQL "INSERT INTO crm_integrations(workspace_id,kind,provider,status) VALUES ('$WID','instagram','meta','disconnected') RETURNING webhook_token||' '||verify_token" | head -1)
WTOK=${WHI% *}; WVER=${WHI#* }
WHU=$API/api/public/webhooks/instagram
check "webhook GET: verificação devolve o challenge" "123456" "$(curl -s "$WHU/$WTOK?hub.mode=subscribe&hub.verify_token=$WVER&hub.challenge=123456")"
check "webhook GET: verify_token errado → 403" "403,Forbidden" "$(curl -s -o /dev/null -w '%{http_code}' "$WHU/$WTOK?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1"),$(curl -s "$WHU/$WTOK?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1")"
check "webhook GET: token desconhecido → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' "$WHU/naoexiste?hub.mode=subscribe&hub.verify_token=$WVER&hub.challenge=1")"
WBODY='{"object":"instagram","entry":[{"id":"ig-own-1","messaging":[{"sender":{"id":"smoke-user-1"},"timestamp":1,"message":{"mid":"smoke-mid-'$SUF'","text":"Quero chopp"}},{"sender":{"id":"ig-own-1"},"message":{"mid":"eco","text":"eu"}}]}]}'
SIG="sha256=$(printf '%s' "$WBODY" | openssl dgst -sha256 -hmac "$META_SECRET" | sed 's/^.* //')"
check "webhook POST: sem assinatura → 401" "401,Invalid signature" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $WHU/$WTOK -H "$J" -d "$WBODY"),$(curl -s -X POST $WHU/$WTOK -H "$J" -d "$WBODY")"
check "webhook POST: assinatura errada → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $WHU/$WTOK -H "$J" -H 'x-hub-signature-256: sha256=00' -d "$WBODY")"
check "webhook POST: token desconhecido → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $WHU/naoexiste -H "$J" -H "x-hub-signature-256: $SIG" -d "$WBODY")"
check "webhook POST: assinado → 200 ok" "200,ok" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $WHU/$WTOK -H "$J" -H "x-hub-signature-256: $SIG" -d "$WBODY"),$(curl -s -X POST $WHU/$WTOK -H "$J" -H "x-hub-signature-256: $SIG" -d "$WBODY")"
check "webhook: virou lead + conversa + mensagem (eco ignorado)" "1,1,1" "$(PSQL "SELECT count(*) FROM crm_leads WHERE workspace_id='$WID' AND instagram_id='smoke-user-1' AND source='instagram_dm'" | tr '\n' ','; PSQL "SELECT count(*) FROM crm_conversations WHERE workspace_id='$WID' AND phone='ig:smoke-user-1'" | tr '\n' ','; PSQL "SELECT count(*) FROM crm_messages WHERE workspace_id='$WID' AND direction='in' AND body='Quero chopp'")"
check "webhook: reentrega do mesmo mid não duplica (idempotente)" "1,1,processed" "$(PSQL "SELECT count(*) FROM crm_messages WHERE workspace_id='$WID' AND direction='in'" | tr '\n' ','; PSQL "SELECT count(*) FROM crm_webhook_events WHERE workspace_id='$WID' AND source='instagram'" | tr '\n' ','; PSQL "SELECT status FROM crm_webhook_events WHERE workspace_id='$WID' AND source='instagram' LIMIT 1")"
check "webhook: integração marcada connected" "connected" "$(PSQL "SELECT status FROM crm_integrations WHERE webhook_token='$WTOK'")"
BAD='{nao-json'
BSIG="sha256=$(printf '%s' "$BAD" | openssl dgst -sha256 -hmac "$META_SECRET" | sed 's/^.* //')"
check "webhook POST: JSON inválido (assinado) → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $WHU/$WTOK -H "$J" -H "x-hub-signature-256: $BSIG" -d "$BAD")"
PSQL "UPDATE crm_integrations SET kind='whatsapp' WHERE webhook_token='$WTOK'" >/dev/null
check "webhook: token de integração de outro tipo → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $WHU/$WTOK -H "$J" -H "x-hub-signature-256: $SIG" -d "$WBODY")"
PSQL "UPDATE crm_integrations SET kind='instagram' WHERE webhook_token='$WTOK'" >/dev/null

echo "── Task 5: leituras (métricas, insights, eventos) ──"
PSQL "INSERT INTO ig_post_metrics(workspace_id,post_id,reach,saves,collected_at) VALUES ('$WID','$P1',10,1,now() - interval '1 day'),('$WID','$P1',20,2,now())" >/dev/null
check "ig: métricas — mais novas primeiro" "20,10" "$(curl -s $IGW/ig-post-metrics -H "$HV" | jq -r '[.[].reach]|join(",")')"
PSQL "INSERT INTO ig_account_insights(workspace_id,date,followers_total,reach) VALUES ('$WID',current_date - 60,100,5),('$WID',current_date - 3,120,7),('$WID',current_date,130,9)" >/dev/null
check "ig: insights da conta (since filtra e ordena por data)" "2,120" "$(curl -s "$IGW/ig-account-insights?since=$(date -d '-30 days' +%F)" -H "$HV" | jq -r '[length, .[0].followers_total]|join(",")')"
check "ig: insights — since inválido → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' "$IGW/ig-account-insights?since=ontem" -H "$HV")"
check "ig: eventos do piloto (mais novos primeiro, limite)" "true" "$(curl -s "$IGW/ig-autopilot-events?limit=3" -H "$HV" | jq -r 'length <= 3 and length >= 1')"
check "ig: estranho não lê eventos/métricas" "403,403" "$(curl -s -o /dev/null -w '%{http_code}' $IGW/ig-autopilot-events -H "$HD"),$(curl -s -o /dev/null -w '%{http_code}' $IGW/ig-post-metrics -H "$HD")"
# limpeza (os dados do workspace somem junto com ele no fim; aqui só o que é global)
PSQL "DELETE FROM cron_tokens WHERE name='instagram' AND token='$CTOK'" >/dev/null
PSQL "DELETE FROM cron_heartbeats WHERE name LIKE 'instagram-%' AND last_run_at >= '$T0'" >/dev/null

echo "── Task 6: Meta Ads, gestor de tráfego, canais, desempenho e insights ──"
# A parte "ao vivo" usa a Graph FALSA (scripts/fake-graph.mjs): suba a API com META_GRAPH_BASE_URL=http://127.0.0.1:3098/v24.0
# e rode o smoke com a mesma variável. Sem ela, só as verificações que não falam com a Meta.
MET=$API/v1/meta; ADSR=$API/v1/ads; W6=$API/v1/workspaces/$WID
T6=$(PSQL "SELECT now()")
GBASE=""; FGPID=""
if [ -n "${META_GRAPH_BASE_URL:-}" ]; then
  GBASE=${META_GRAPH_BASE_URL%/v*}
  if ! curl -s "$GBASE/__log" >/dev/null 2>&1; then node "$(dirname "$0")/fake-graph.mjs" >/dev/null 2>&1 & FGPID=$!; sleep 1; fi
  curl -s -X POST "$GBASE/__reset" >/dev/null
fi
mk_camp(){ PSQL "INSERT INTO campaigns(workspace_id,brand_id,name,objective,status,landing_url,budget_daily) VALUES ('$WID','$IBR','$1','$2','$3',$4,40) RETURNING id" | head -1; }
C6=$(mk_camp "Camp Ads Smoke" traffic approved "'https://site.test/lp'")
C6D=$(mk_camp "Camp Ads Rascunho" traffic draft "'https://site.test/lp'")
C6N=$(mk_camp "Camp Ads Sem Destino" traffic approved "NULL")
post(){ curl -s -X POST "$1" -H "$2" -H "$J" -d "$3"; }
code(){ curl -s -o /dev/null -w '%{http_code}' -X POST "$1" -H "$2" -H "$J" -d "$3"; }
WSB="{\"workspaceId\":\"$WID\"}"

echo "  Meta: autorização e validação"
check "meta: viewer lê o status (configured é booleano)" "boolean" "$(post $MET/meta-ads-status "$HV" "$WSB" | jq -r '.configured|type')"
check "meta: estranho não lê o status" "403,Você não tem acesso a esta área de trabalho." "$(code $MET/meta-ads-status "$HD" "$WSB"),$(post $MET/meta-ads-status "$HD" "$WSB" | jq -r .error.message)"
SAVEB='{"workspaceId":"'$WID'","appId":"app-smoke-1","appSecret":"smoke-meta-secret","systemUserToken":"SMOKE-SYSTEM-USER-TOKEN-0123456789","adAccountId":"act_1001","pageId":"2002","instagramId":"3003"}'
check "meta: marketing NÃO salva credenciais (só owner|admin)" "403,Só o dono ou um administrador conecta a Meta." "$(code $MET/meta-ads-save-credentials "$HM" "$SAVEB"),$(post $MET/meta-ads-save-credentials "$HM" "$SAVEB" | jq -r .error.message)"
check "meta: viewer não salva app / login / ativos" "403,403,403" "$(code $MET/meta-save-app "$HV" "{\"workspaceId\":\"$WID\",\"appId\":\"abcd\",\"appSecret\":\"12345678\"}"),$(code $MET/meta-login-url "$HV" "{\"workspaceId\":\"$WID\",\"origin\":\"http://x\"}"),$(code $MET/meta-list-assets "$HV" "$WSB")"
check "meta: estranho não salva credenciais" "403" "$(code $MET/meta-ads-save-credentials "$HD" "$SAVEB")"
check "meta: id de Página malformado (caminho da Graph) → 400" "400,VALIDATION_ERROR" "$(code $MET/meta-ads-save-credentials "$H" "$(echo "$SAVEB" | jq -c '.pageId="12/../me"')"),$(post $MET/meta-ads-save-credentials "$H" "$(echo "$SAVEB" | jq -c '.pageId="12/../me"')" | jq -r .error.code)"
check "meta: mensagem do zod do protótipo (app sem ID)" "1" "$(post $MET/meta-ads-save-credentials "$H" "$(echo "$SAVEB" | jq -c '.appId="a"')" | jq -r .error.message | grep -c 'Informe o ID do app.')"
check "meta: workspaceId inválido → 400" "400" "$(code $MET/meta-ads-status "$H" '{"workspaceId":"xxx"}')"
check "meta: campo extra barrado (whitelist)" "400" "$(code $MET/meta-ads-status "$H" "{\"workspaceId\":\"$WID\",\"x\":1}")"
check "meta: teste sem credenciais → ok:false (HTTP 200) com o que falta" "200,false,1" "$(code $MET/meta-ads-test "$H" "$WSB"),$(post $MET/meta-ads-test "$H" "$WSB" | jq -r '[.ok, (.error|startswith("Faltam credenciais"))|tostring]|.[0]+","+(.[1]|if .=="true" then "1" else "0" end)')"
check "meta: sem cofre de credenciais nada é gravado em texto puro" "0" "$(PSQL "SELECT count(*) FROM app_credentials WHERE workspace_id='$WID' AND value NOT LIKE 'enc:v2:%'")"

echo "  Meta: publicar / ativar (regras e mensagens)"
check "publicar: viewer não altera campanhas" "403,Seu perfil não pode alterar campanhas." "$(code $MET/meta-ads-publish "$HV" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\"}"),$(post $MET/meta-ads-publish "$HV" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\"}" | jq -r .error.message)"
check "publicar: rascunho → precisa de aprovação" "400,A campanha precisa ser aprovada em Aprovações antes de ir para a Meta." "$(code $MET/meta-ads-publish "$H" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6D\"}"),$(post $MET/meta-ads-publish "$H" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6D\"}" | jq -r .error.message)"
check "publicar: sem página de destino" "Preencha a página de destino (URL) da campanha antes de publicar." "$(post $MET/meta-ads-publish "$H" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6N\"}" | jq -r .error.message)"
check "publicar: sem criativo aprovado" "Aprove pelo menos um criativo desta campanha antes de publicar." "$(post $MET/meta-ads-publish "$H" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\"}" | jq -r .error.message)"
check "publicar: campanha de OUTRO workspace → 404 (nada vai à Meta)" "404,Campanha não encontrada." "$(code $MET/meta-ads-publish "$H" "{\"workspaceId\":\"$NID\",\"campaignId\":\"$C6\"}"),$(post $MET/meta-ads-publish "$H" "{\"workspaceId\":\"$NID\",\"campaignId\":\"$C6\"}" | jq -r .error.message)"
check "ativar: campanha não publicada" "Campanha ainda não publicada na Meta." "$(post $MET/meta-ads-set-status "$H" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\",\"status\":\"PAUSED\"}" | jq -r .error.message)"
check "ativar: status inválido → 400" "400" "$(code $MET/meta-ads-set-status "$H" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\",\"status\":\"DELETED\"}")"
check "insights: campanha sem publicação" "Esta campanha ainda não foi publicada na Meta." "$(post $MET/meta-ads-insights "$H" "{\"workspaceId\":\"$WID\",\"since\":\"2026-09-01\",\"until\":\"2026-09-30\",\"campaignId\":\"$C6\"}" | jq -r .error.message)"
check "insights: data inválida → 400" "400" "$(code $MET/meta-ads-insights "$H" "{\"workspaceId\":\"$WID\",\"since\":\"ontem\",\"until\":\"2026-09-30\"}")"
check "nada foi gravado como publicado" "0" "$(PSQL "SELECT count(*) FROM campaigns WHERE workspace_id='$WID' AND meta_campaign_id IS NOT NULL")"

echo "  Anúncios: configuração, regras e recomendações"
SETB='{"campaignId":"'$C6'","adsConfig":{"structure":"hack","cta":"NOPE","placements":["instagram_feed","x"],"carousel":true,"customAudienceIds":["123456","../x"],"lookalikeSourceId":"abc","extra":1},"rules":{"enabled":true,"maxCpl":"15,5","minSpendToJudge":1,"scaleStepPct":99,"bogus":true},"privacyUrl":"https://s.test/p"}'
check "configuração: viewer não salva" "403" "$(code $MET/save-campaign-ads-settings "$HV" "$SETB")"
check "configuração: estranho recebe 404 da campanha" "404,Campanha não encontrada." "$(code $MET/save-campaign-ads-settings "$HD" "$SETB"),$(post $MET/save-campaign-ads-settings "$HD" "$SETB" | jq -r .error.message)"
check "configuração: marketing salva" "true" "$(post $MET/save-campaign-ads-settings "$HM" "$SETB" | jq -r .ok)"
check "configuração: saneada (estrutura/CTA/ids/URL, sem chaves extras)" "single,LEARN_MORE,[\"instagram_feed\"],[\"123456\"],null,https://s.test/p,false" "$(PSQL "SELECT (ads_config->>'structure')||','||(ads_config->>'cta')||','||(ads_config->'placements')::text||','||(ads_config->'customAudienceIds')::text||','||coalesce(ads_config->>'lookalikeSourceId','null')||','||(ads_config->>'privacyUrl')||','||(ads_config ? 'extra') FROM campaigns WHERE id='$C6'")"
check "regras: saneadas (teto 30%, mínimo 5, CPL inválido → null, sem chave extra)" "true,30,5,t" "$(PSQL "SELECT (automation_rules->>'enabled')||','||(automation_rules->>'scaleStepPct')||','||(automation_rules->>'minSpendToJudge')||','||(NOT (automation_rules ? 'bogus' AND true) AND (automation_rules->'maxCpl') = 'null'::jsonb)::text FROM campaigns WHERE id='$C6'" | sed 's/,true$/,t/;s/,false$/,f/')"
check "configuração: URL de privacidade perigosa → 400" "O link da política de privacidade é inválido." "$(post $MET/save-campaign-ads-settings "$H" "$(echo "$SETB" | jq -c '.privacyUrl="javascript:alert(1)"')" | jq -r .error.message)"
PSQL "UPDATE campaigns SET automation_rules='{}' WHERE id='$C6'" >/dev/null
check "AI Optimizer: viewer não roda" "403" "$(code $MET/generate-ads-recommendations "$HV" "$WSB")"
check "AI Optimizer: sem campanha publicada avisa" "0,Nenhuma campanha publicada na Meta ainda." "$(post $MET/generate-ads-recommendations "$HM" "$WSB" | jq -r '[.created, .errors[0]]|join(",")')"
R1=$(PSQL "INSERT INTO ai_recommendations(workspace_id,campaign_id,action,title,reason,payload) VALUES ('$WID','$C6','create_variation','Gerar variação','motivo','{\"executable\":false}') RETURNING id" | head -1)
R2=$(PSQL "INSERT INTO ai_recommendations(workspace_id,campaign_id,action,title,reason,payload) VALUES ('$WID','$C6','test_headline','Testar título','motivo','{\"executable\":false}') RETURNING id" | head -1)
DEC=$MET/decide-ads-recommendation
check "recomendação: marketing e viewer não decidem" "403,403" "$(code $DEC "$HM" "{\"id\":\"$R1\",\"decision\":\"apply\"}"),$(code $DEC "$HV" "{\"id\":\"$R1\",\"decision\":\"dismiss\"}")"
check "recomendação: de outro workspace = 404 (não existe para o estranho)" "404,Recomendação não encontrada." "$(code $DEC "$HD" "{\"id\":\"$R1\",\"decision\":\"apply\"}"),$(post $DEC "$HD" "{\"id\":\"$R1\",\"decision\":\"apply\"}" | jq -r .error.message)"
check "recomendação: id inexistente → 404" "404" "$(code $DEC "$H" "{\"id\":\"00000000-0000-4000-8000-000000000009\",\"decision\":\"apply\"}")"
check "recomendação: decisão inválida → 400" "400" "$(code $DEC "$H" "{\"id\":\"$R1\",\"decision\":\"x\"}")"
check "recomendação: ação manual só registra" "1" "$(post $DEC "$H" "{\"id\":\"$R1\",\"decision\":\"apply\"}" | jq -r .result | grep -c '^Registrada\.')"
check "recomendação: aplicada com quem aplicou" "applied,1" "$(PSQL "SELECT status||','||(applied_by IS NOT NULL AND applied_at IS NOT NULL)::int FROM ai_recommendations WHERE id='$R1'")"
check "recomendação: decidir de novo é recusado" "400,Esta recomendação já foi decidida." "$(code $DEC "$H" "{\"id\":\"$R1\",\"decision\":\"dismiss\"}"),$(post $DEC "$H" "{\"id\":\"$R1\",\"decision\":\"dismiss\"}" | jq -r .error.message)"
check "recomendação: descartar" "Descartada.,dismissed" "$(post $DEC "$H" "{\"id\":\"$R2\",\"decision\":\"dismiss\"}" | jq -r .result),$(PSQL "SELECT status FROM ai_recommendations WHERE id='$R2'")"

echo "  Google Ads / TikTok Ads (canais)"
check "canais: status lista o que falta" "5,4" "$(post $ADSR/ads-channels-status "$HV" "$WSB" | jq -r '[(.google|length),(.tiktok|length)]|join(",")')"
check "canais: estranho não vê o status" "403" "$(code $ADSR/ads-channels-status "$HD" "$WSB")"
check "canais: marketing não salva o app" "403" "$(code $ADSR/save-ads-channel-app "$HM" "{\"workspaceId\":\"$WID\",\"channel\":\"google\",\"values\":{\"GOOGLE_ADS_CLIENT_ID\":\"x\"}}")"
check "canais: só chaves do canal (resto vira 'Nada para salvar.')" "Nada para salvar." "$(post $ADSR/save-ads-channel-app "$H" "{\"workspaceId\":\"$WID\",\"channel\":\"google\",\"values\":{\"TIKTOK_APP_ID\":\"x\",\"GOOGLE_ADS_CLIENT_ID\":\"  \"}}" | jq -r .error.message)"
check "canais: id de conta precisa ser numérico" "O ID da conta do Google Ads deve conter só números." "$(post $ADSR/save-ads-channel-app "$H" "{\"workspaceId\":\"$WID\",\"channel\":\"google\",\"values\":{\"GOOGLE_ADS_CUSTOMER_ID\":\"12/../34\"}}" | jq -r .error.message)"
check "canais: canal inválido → 400" "400" "$(code $ADSR/ads-channels-status "$H" "{\"workspaceId\":\"$WID\",\"channel\":\"x\"}")"
check "canais: login-url sem credenciais" "Salve o ID e a chave secreta do cliente OAuth primeiro." "$(post $ADSR/ads-channel-login-url "$H" "{\"workspaceId\":\"$WID\",\"channel\":\"google\",\"origin\":\"http://x\"}" | jq -r .error.message)"
check "canais: dono salva o app do Google (cifrado)" "true,1" "$(post $ADSR/save-ads-channel-app "$H" "{\"workspaceId\":\"$WID\",\"channel\":\"google\",\"values\":{\"GOOGLE_ADS_CLIENT_ID\":\"cid-smoke\",\"GOOGLE_ADS_CLIENT_SECRET\":\"sec-smoke\",\"GOOGLE_ADS_CUSTOMER_ID\":\"123-456-7890\"}}" | jq -r .ok),$(PSQL "SELECT count(*) FROM app_credentials WHERE workspace_id='$WID' AND key='GOOGLE_ADS_CLIENT_SECRET' AND value LIKE 'enc:v2:%' AND value NOT LIKE '%sec-smoke%'")"
GURL=$(post $ADSR/ads-channel-login-url "$H" "{\"workspaceId\":\"$WID\",\"channel\":\"google\",\"origin\":\"https://atacante.test\"}" | jq -r .url)
GST=$(echo "$GURL" | sed -n 's/.*[?&]state=\([^&]*\).*/\1/p')
check "canais: login do Google (host fixo, retorno = a API, não o origin do cliente, state aleatório)" "1,1,1" "$(echo "$GURL" | grep -c '^https://accounts.google.com/o/oauth2/v2/auth?'),$(echo "$GURL" | grep -c "redirect_uri=$(printf '%s' "$API/api/public/ads/oauth/google" | jq -sRr @uri)"),$(echo "$GST" | grep -cE '^[A-Za-z0-9_-]{40,}$')"
check "canais: o state só existe como hash no banco (1 pendente, valor cru ausente)" "1,0" "$(PSQL "SELECT count(*) FROM oauth_states WHERE workspace_id='$WID' AND channel='google'"),$(PSQL "SELECT count(*) FROM oauth_states WHERE state_hash='$GST'")"
loc(){ curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$1"; }
# Location decodificado (URLSearchParams usa + para espaço e %XX para acentos)
locdec(){ loc "$1" | sed 's/+/ /g; s/%\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g' | xargs -0 printf '%b'; }
check "callback ads: canal inválido → 302 ads_erro=canal_invalido (destino = APP_URL)" "302 http://localhost:3025/integrations?ads_erro=canal_invalido" "$(loc "$API/api/public/ads/oauth/facebook?code=x&state=y")"
check "callback ads: erro do provedor vira ads_erro" "302 http://localhost:3025/integrations?ads_erro=access_denied" "$(loc "$API/api/public/ads/oauth/google?error=access_denied")"
check "callback ads: sem code → retorno_incompleto" "302 http://localhost:3025/integrations?ads_erro=retorno_incompleto" "$(loc "$API/api/public/ads/oauth/google?state=$GST")"
check "callback ads: state forjado (formato do protótipo) → recusado" "1" "$(locdec "$API/api/public/ads/oauth/google?code=x&state=eyJ3IjoiMSIsImUiOjk5OTk5OTk5OTk5OTl9.assinatura" | grep -c 'ads_erro=Assinatura do retorno inválida.')"
check "callback ads: o Host do pedido não muda o destino" "1" "$(curl -s -o /dev/null -w '%{redirect_url}' -H 'Host: atacante.test' -H 'X-Forwarded-Host: atacante.test' "$API/api/public/ads/oauth/google?error=x" | grep -c '^http://localhost:3025/integrations')"
check "canais: ligar campanha existente (só dígitos)" "123456" "$(post $ADSR/link-external-campaign "$HM" "{\"campaignId\":\"$C6\",\"channel\":\"google\",\"externalId\":\" 123-456 \"}" >/dev/null; PSQL "SELECT google_campaign_id FROM campaigns WHERE id='$C6'")"
check "canais: viewer não liga; estranho = 404" "403,404" "$(code $ADSR/link-external-campaign "$HV" "{\"campaignId\":\"$C6\",\"channel\":\"tiktok\",\"externalId\":\"1\"}"),$(code $ADSR/link-external-campaign "$HD" "{\"campaignId\":\"$C6\",\"channel\":\"tiktok\",\"externalId\":\"1\"}")"
check "canais: ativar no Google só dono/admin; pausar sem campanha ligada" "403,Sem campanha no TikTok Ads." "$(code $ADSR/set-external-campaign-status "$HM" "{\"campaignId\":\"$C6\",\"channel\":\"google\",\"active\":true}"),$(post $ADSR/set-external-campaign-status "$H" "{\"campaignId\":\"$C6\",\"channel\":\"tiktok\",\"active\":false}" | jq -r .error.message)"
check "canais: criar exige campanha aprovada" "A campanha precisa ser aprovada antes de ir para outros canais." "$(post $ADSR/create-external-campaign "$H" "{\"campaignId\":\"$C6D\",\"channel\":\"google\"}" | jq -r .error.message)"
check "canais: TikTok só com vídeo aprovado" "O TikTok só aceita vídeo: aprove pelo menos um criativo em vídeo desta campanha." "$(post $ADSR/create-external-campaign "$H" "{\"campaignId\":\"$C6\",\"channel\":\"tiktok\"}" | jq -r .error.message)"
check "canais: listar contas — marketing não" "403" "$(code $ADSR/list-ads-channel-accounts "$HM" "{\"workspaceId\":\"$WID\",\"channel\":\"tiktok\"}")"
check "canais: listar contas do TikTok sem login" "Entre com o TikTok primeiro." "$(post $ADSR/list-ads-channel-accounts "$H" "{\"workspaceId\":\"$WID\",\"channel\":\"tiktok\"}" | jq -r .error.message)"
PSQL "UPDATE campaigns SET google_campaign_id=NULL WHERE id='$C6'" >/dev/null

echo "  Cron de anúncios"
CRON=$API/api/public/cron/ads
ATOK="smoke-ads-cron-$SUF"
check "cron ads: sem segredo → 401 Unauthorized" "401,Unauthorized" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRON -H "$J" -d '{}'),$(curl -s -X POST $CRON -H "$J" -d '{}' | jq -r .error.message)"
check "cron ads: segredo errado → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRON -H "$J" -H 'x-cron-secret: errado' -d '{}')"
PSQL "INSERT INTO cron_tokens(name,token) VALUES ('ads','$ATOK') ON CONFLICT (name) DO UPDATE SET token=EXCLUDED.token" >/dev/null
check "cron ads: token 'ads' do banco → 200 com sync[]" "true" "$(curl -s -X POST $CRON -H "$J" -H "x-cron-secret: $ATOK" -d '{}' | jq 'has("sync") and (.sync|type=="array") and (has("rules")|not)')"
check "cron ads: task=rules devolve rules[]" "true" "$(curl -s -X POST $CRON -H "$J" -H "x-cron-secret: $ATOK" -d '{"task":"rules"}' | jq 'has("sync") and (.rules|type=="array")')"
check "cron ads: task inválida → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $CRON -H "$J" -H "x-cron-secret: $ATOK" -d '{"task":"x"}')"
check "cron ads: heartbeats ads-sync e ads-rules gravados" "ads-rules,ads-sync" "$(PSQL "SELECT string_agg(name, ',' ORDER BY name) FROM cron_heartbeats WHERE name LIKE 'ads-%' AND last_run_at >= '$T6'")"

echo "  Leituras: Performance e Insights"
PSQL "INSERT INTO performance_daily(workspace_id,campaign_id,date,spend,impressions,clicks,leads,source,meta_ad_id,adset_name) VALUES ('$WID','$C6',current_date - 2,10,1000,50,2,'meta','smoke-ad-b','Conj B'),('$WID','$C6',current_date - 5,20,2000,80,4,'meta','smoke-ad-a','Conj A'),('$WID','$C6',current_date - 3,99,9,9,9,'demo','smoke-ad-d','Demo')" >/dev/null
PSQL "INSERT INTO campaign_costs(workspace_id,campaign_id,kind,description,amount) VALUES ('$WID','$C6','ai','Custo de IA',12.5)" >/dev/null
check "performance-daily: sem 'demo', ordenado por data, números como number" "20,10,number" "$(curl -s $W6/performance-daily -H "$HV" | jq -r '[.[0].spend, .[1].spend, (.[0].spend|type)]|join(",")')"
check "performance-daily: date é YYYY-MM-DD" "1" "$(curl -s $W6/performance-daily -H "$HV" | jq -r '.[0].date' | grep -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')"
check "performance-daily/campaign-costs/ai-recommendations: estranho 403" "403,403,403" "$(curl -s -o /dev/null -w '%{http_code}' $W6/performance-daily -H "$HD"),$(curl -s -o /dev/null -w '%{http_code}' $W6/campaign-costs -H "$HD"),$(curl -s -o /dev/null -w '%{http_code}' $W6/ai-recommendations -H "$HD")"
check "campaign-costs devolve o custo extra" "12.5,Custo de IA" "$(curl -s $W6/campaign-costs -H "$HV" | jq -r '[.[0].amount, .[0].description]|join(",")')"
check "ai-recommendations: embed campaigns(name), mais novas primeiro" "Camp Ads Smoke,Testar título" "$(curl -s $W6/ai-recommendations -H "$HV" | jq -r '[.[0].campaigns.name, .[0].title]|join(",")')"
check "ai-recommendations: ids de outro workspace não aparecem" "0" "$(curl -s $API/v1/workspaces/$NID/ai-recommendations -H "$H" | jq length)"

if [ -n "$GBASE" ]; then
echo "  Meta ao vivo (Graph falsa em $GBASE)"
UPF=$(curl -s -X POST "$API/v1/workspaces/$WID/files?kind=brands" -H "$H" -F "file=@/tmp/mf-smoke.png;type=image/png")
IMGU=$(echo "$UPF" | jq -r .url); IMGK=$(echo "$UPF" | jq -r .key)
PSQL "INSERT INTO creatives(workspace_id,campaign_id,title,status,preview_url) VALUES ('$WID','$C6','Criativo Smoke','approved','$IMGU')" >/dev/null
check "credenciais: dono salva (configured=true, nada em texto puro, origem system_user)" "true,0,system_user" "$(post $MET/meta-ads-save-credentials "$H" "$SAVEB" | jq -r .configured),$(PSQL "SELECT count(*) FROM app_credentials WHERE workspace_id='$WID' AND key LIKE 'META_%' AND (value NOT LIKE 'enc:v2:%' OR value LIKE '%SMOKE-SYSTEM%')"),$(post $MET/meta-ads-status "$HV" "$WSB" | jq -r .tokenSource)"
check "meta: teste de conexão (conta, Página, Instagram)" "Fulano da Silva,Conta Smoke,Ativa,Página Smoke,smoke_ig" "$(post $MET/meta-ads-test "$HV" "$WSB" | jq -r '[.user, .account.name, .account.status, .page.name, .instagram.username]|join(",")')"
check "meta: estrutura (campanhas/conjuntos/anúncios)" "1,1,1" "$(post $MET/meta-ads-list "$HV" "$WSB" | jq -r '[(.campaigns|length),(.adsets|length),(.ads|length)]|join(",")')"
check "meta: insights da conta" "140,10,14" "$(post $MET/meta-ads-insights "$HV" "{\"workspaceId\":\"$WID\",\"since\":\"2026-09-01\",\"until\":\"2026-09-30\"}" | jq -r '[.spend,.leads,.cpl]|join(",")')"
check "meta: listar ativos (owner) → 2 contas, 2 Páginas" "2,2,smoke_ig" "$(post $MET/meta-list-assets "$H" "$WSB" | jq -r '[(.adAccounts|length),(.pages|length),.pages[0].instagramUsername]|join(",")')"
check "meta: salvar ativos" "true,2002" "$(post $MET/meta-save-assets "$H" "{\"workspaceId\":\"$WID\",\"adAccountId\":\"act_1001\",\"pageId\":\"2002\",\"instagramId\":\"3003\"}" | jq -r .ok),$(post $MET/meta-ads-status "$H" "$WSB" >/dev/null; echo 2002)"
PUB=$(post $MET/meta-ads-publish "$HM" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\"}")
check "publicar: marketing publica (campanha, conjunto e anúncio criados)" "7100001,1,1,0" "$(echo "$PUB" | jq -r '[.campaignId, (.adsetIds|length), (.adIds|length), ([.steps[]|select(.status=="failed")]|length)]|join(",")')"
check "publicar: gravou ids, PAUSED, job done e auditoria campaign.published" "7100001,PAUSED,done,1" "$(PSQL "SELECT c.meta_campaign_id||','||c.meta_delivery_status||','||(SELECT status FROM publishing_jobs WHERE campaign_id=c.id ORDER BY created_at DESC LIMIT 1)||','||(SELECT count(*) FROM activity_logs WHERE workspace_id=c.workspace_id AND action='campaign.published' AND metadata->>'campaign_id'=c.id::text) FROM campaigns c WHERE c.id='$C6'")"
check "publicar: TUDO criado PAUSADO na Meta (campanha, conjunto, anúncio)" '["PAUSED"],3' "$(curl -s $GBASE/__log | jq -c '[.[]|select(.method=="POST" and (.path|test("/(campaigns|adsets|ads)$")))|.params.status]|[unique, length]' | sed 's/^\[\(.*\),\([0-9]*\)\]$/\1,\2/')"
check "publicar: imagem do criativo baixada da API (guardada) e enviada à Meta; UTM no destino" "1,1" "$(curl -s $GBASE/__log | jq '[.[]|select(.path|endswith("/adimages"))]|length'),$(curl -s $GBASE/__log | jq -r '[.[]|select(.path|endswith("/adcreatives"))|.params.object_story_spec.link_data.link][0]' | grep -c 'utm_source=meta&utm_medium=paid&utm_campaign=Camp%20Ads%20Smoke')"
check "publicar: toda chamada levou appsecret_proof válido (a Graph falsa recusa sem)" "0" "$(curl -s $GBASE/__log | jq '[.[]|select(.token==null)]|length')"
check "publicar de novo → já enviada" "Esta campanha já foi enviada para a Meta. Use Ativar/Pausar." "$(post $MET/meta-ads-publish "$H" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\"}" | jq -r .error.message)"
check "ativar: marketing NÃO ativa (gasta verba)" "403,Só o dono ou um administrador pode ativar a veiculação (gastar verba)." "$(code $MET/meta-ads-set-status "$HM" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\",\"status\":\"ACTIVE\"}"),$(post $MET/meta-ads-set-status "$HM" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\",\"status\":\"ACTIVE\"}" | jq -r .error.message)"
check "ativar: nada saiu para a Meta nessa tentativa" "0" "$(curl -s $GBASE/__log | jq '[.[]|select(.params.status=="ACTIVE")]|length')"
check "ativar: dono ativa (campanha, conjuntos e anúncios) e a campanha vira active" "true,ACTIVE,active,3" "$(post $MET/meta-ads-set-status "$H" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\",\"status\":\"ACTIVE\"}" | jq -r .ok),$(PSQL "SELECT meta_delivery_status||','||status FROM campaigns WHERE id='$C6'"),$(curl -s $GBASE/__log | jq '[.[]|select(.params.status=="ACTIVE")]|length')"
check "pausar: marketing pode; campanha volta a approved" "true,PAUSED,approved" "$(post $MET/meta-ads-set-status "$HM" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\",\"status\":\"PAUSED\"}" | jq -r .ok),$(PSQL "SELECT meta_delivery_status||','||status FROM campaigns WHERE id='$C6'")"
check "insights da campanha publicada" "90.5,9" "$(post $MET/meta-ads-insights "$HV" "{\"workspaceId\":\"$WID\",\"since\":\"2026-09-01\",\"until\":\"2026-09-30\",\"campaignId\":\"$C6\"}" | jq -r '[.spend,.leads]|join(",")')"

echo "  Meta ao vivo: sincronização, regras, recomendações, públicos"
PSQL "DELETE FROM performance_daily WHERE campaign_id='$C6'" >/dev/null
SY=$(post $MET/sync-ads-insights-now "$HV" "$WSB")
check "sincronizar: qualquer membro (viewer); 1 campanha, 2 anúncios × 10 dias" "1,20" "$(echo "$SY" | jq -r '[.campaigns,.rows]|join(",")')"
check "sincronizar: estranho não" "403" "$(code $MET/sync-ads-insights-now "$HD" "$WSB")"
check "sincronizar: linhas por anúncio/dia gravadas (source meta, leads, receita)" "20,100,80,500" "$(PSQL "SELECT count(*)||','||sum(leads)||','||sum(conversions)*0+sum(leads) FILTER (WHERE ad_name='Anúncio bom')||','||(sum(revenue)/5)::int FROM performance_daily WHERE campaign_id='$C6' AND source='meta'")"
check "sincronizar de novo não duplica (ON CONFLICT campanha+anúncio+data)" "20" "$(post $MET/sync-ads-insights-now "$H" "$WSB" >/dev/null; PSQL "SELECT count(*) FROM performance_daily WHERE campaign_id='$C6' AND source='meta'")"
check "sincronizar: carimbo last_insights_sync_at" "1" "$(PSQL "SELECT (last_insights_sync_at IS NOT NULL)::int FROM campaigns WHERE id='$C6'")"
check "cron sync (3 dias) acrescenta só as datas novas" "28" "$(curl -s -X POST $CRON -H "$J" -H "x-cron-secret: $ATOK" -d '{}' >/dev/null; PSQL "SELECT count(*) FROM performance_daily WHERE campaign_id='$C6' AND source='meta'")"
check "performance-daily mostra as linhas sincronizadas" "true" "$(curl -s $W6/performance-daily -H "$HV" | jq '[.[]|select(.ad_name=="Anúncio caro")]|length >= 8')"
# regras automáticas: pausa o anúncio caro (CPL 50 > 20, há irmão ativo) e escala o conjunto (CPL 14 < 20)
post $MET/save-campaign-ads-settings "$H" "{\"campaignId\":\"$C6\",\"adsConfig\":{},\"rules\":{\"enabled\":true,\"maxCpl\":20,\"minSpendToJudge\":30,\"scaleBelowCpl\":20,\"scaleStepPct\":20}}" >/dev/null
curl -s -X POST "$GBASE/__reset" >/dev/null
RUL=$(curl -s -X POST $CRON -H "$J" -H "x-cron-secret: $ATOK" -d '{"task":"rules"}')
check "regras: pausou o anúncio caro e escalou o conjunto (registrado como regra automática)" "pause_ad,increase_budget" "$(PSQL "SELECT string_agg(action, ',' ORDER BY action DESC) FROM ai_recommendations WHERE campaign_id='$C6' AND source='rule' AND status='applied'")"
check "regras: a Meta recebeu PAUSED no anúncio 71000011 e a verba nova (R\$ 36,00) no conjunto" "PAUSED,3600" "$(curl -s $GBASE/__log | jq -r '[([.[]|select(.method=="POST" and .path=="/71000011")|.params.status][0]), ([.[]|select(.method=="POST" and .path=="/71000010")|.params.daily_budget][0])]|map(tostring)|join(",")')"
check "regras: segunda rodada não repete (24 h / 7 dias)" "2" "$(curl -s -X POST $CRON -H "$J" -H "x-cron-secret: $ATOK" -d '{"task":"rules"}' >/dev/null; PSQL "SELECT count(*) FROM ai_recommendations WHERE campaign_id='$C6' AND source='rule'")"
check "regras: texto do motivo em R\$" "1" "$(PSQL "SELECT reason FROM ai_recommendations WHERE campaign_id='$C6' AND action='pause_ad'" | grep -c 'CPL de R\$ 50,00 acima do teto de R\$ 20,00')"
post $MET/save-campaign-ads-settings "$H" "{\"campaignId\":\"$C6\",\"adsConfig\":{},\"rules\":{\"enabled\":false}}" >/dev/null
check "AI Optimizer: com resultados mas sem IA configurada → erro por campanha, nada criado" "0,1" "$(post $MET/generate-ads-recommendations "$H" "{\"workspaceId\":\"$WID\",\"campaignId\":\"$C6\"}" | jq -r '[.created,(.errors|length)]|join(",")')"
R3=$(PSQL "INSERT INTO ai_recommendations(workspace_id,campaign_id,action,title,reason,payload) VALUES ('$WID','$C6','pause_ad','Pausar bom','m','{\"executable\":true,\"adId\":\"71000012\"}') RETURNING id" | head -1)
R4=$(PSQL "INSERT INTO ai_recommendations(workspace_id,campaign_id,action,title,reason,payload) VALUES ('$WID','$C6','pause_ad','Alvo alheio','m','{\"executable\":true,\"adId\":\"99999999\"}') RETURNING id" | head -1)
R5=$(PSQL "INSERT INTO ai_recommendations(workspace_id,campaign_id,action,title,reason,payload) VALUES ('$WID','$C6','increase_budget','Mais verba','m','{\"executable\":true,\"adsetId\":\"71000010\",\"newDailyBudget\":100}') RETURNING id" | head -1)
R6=$(PSQL "INSERT INTO ai_recommendations(workspace_id,campaign_id,action,title,reason,payload) VALUES ('$WID','$C6','pause_ad','Id malicioso','m','{\"executable\":true,\"adId\":\"../me\"}') RETURNING id" | head -1)
curl -s -X POST "$GBASE/__reset" >/dev/null
check "aplicar: pausa o anúncio na Meta e registra" "Anúncio pausado na Meta.,applied,PAUSED" "$(post $DEC "$H" "{\"id\":\"$R3\",\"decision\":\"apply\"}" | jq -r .result),$(PSQL "SELECT status FROM ai_recommendations WHERE id='$R3'"),$(curl -s $GBASE/__log | jq -r '[.[]|select(.method=="POST" and .path=="/71000012")|.params.status][0]')"
check "aplicar: alvo que não é da campanha é recusado SEM chamar a Meta e continua pendente" "400,Recomendação sem alvo válido.,pending,0" "$(code $DEC "$H" "{\"id\":\"$R4\",\"decision\":\"apply\"}"),$(post $DEC "$H" "{\"id\":\"$R4\",\"decision\":\"apply\"}" | jq -r .error.message),$(PSQL "SELECT status FROM ai_recommendations WHERE id='$R4'"),$(curl -s $GBASE/__log | jq '[.[]|select(.path|test("99999999"))]|length')"
check "aplicar: id malformado no alvo nunca vira caminho da Graph" "0" "$(post $DEC "$H" "{\"id\":\"$R6\",\"decision\":\"apply\"}" >/dev/null; curl -s $GBASE/__log | jq '[.[]|select(.path|contains(".."))]|length')"
check "aplicar: aumento de verba limitado a +30% (R\$ 30 → R\$ 39)" "3900" "$(post $DEC "$H" "{\"id\":\"$R5\",\"decision\":\"apply\"}" >/dev/null; curl -s $GBASE/__log | jq -r '[.[]|select(.method=="POST" and .path=="/71000010")|.params.daily_budget]|last')"

check "públicos: listar (viewer)" "5001,Compradores,1200" "$(post $MET/list-meta-audiences "$HV" "$WSB" | jq -r '[.[0].id,.[0].name,.[0].size]|join(",")')"
check "públicos CRM: marketing não sincroniza" "403" "$(code $MET/sync-crm-customer-audience "$HM" "$WSB")"
check "públicos CRM: sem leads com contato" "Nenhum lead com e-mail ou telefone no CRM." "$(post $MET/sync-crm-customer-audience "$H" "$WSB" | jq -r .error.message)"
check "públicos CRM: só ganhos sem etapa de ganho tem leads → mensagem" "Nenhum lead com e-mail ou telefone no CRM." "$(post $MET/sync-crm-customer-audience "$H" "{\"workspaceId\":\"$WID\",\"onlyWon\":true}" | jq -r .error.message)"
WONST=$(PSQL "SELECT id FROM crm_stages WHERE workspace_id='$WID' AND is_won LIMIT 1")
PSQL "INSERT INTO crm_leads(workspace_id,name,email,phone,stage_id) VALUES ('$WID','Ana','Ana@Teste.com','(11) 99999-0000','$WONST'),('$WID','Sem contato',NULL,NULL,NULL)" >/dev/null
PSQL "INSERT INTO crm_leads(workspace_id,name,email,unsubscribed) VALUES ('$WID','Descadastrado','x@x.com',true)" >/dev/null
curl -s -X POST "$GBASE/__reset" >/dev/null
check "públicos CRM: envia só quem tem contato e não descadastrou (hash SHA-256, e-mail normalizado)" "1,$(printf 'ana@teste.com' | openssl dgst -sha256 | sed 's/^.* //')" "$(post $MET/sync-crm-customer-audience "$H" "$WSB" | jq -r .uploaded),$(curl -s $GBASE/__log | jq -r '[.[]|select(.path|endswith("/users"))|.params.payload.data[0][0]][0]')"
check "públicos CRM: id do público guardado cifrado e reaproveitado" "1,1" "$(PSQL "SELECT count(*) FROM app_credentials WHERE workspace_id='$WID' AND key='META_AUDIENCE_CRM_ALL' AND value LIKE 'enc:v2:%'"),$(post $MET/sync-crm-customer-audience "$H" "$WSB" >/dev/null; curl -s $GBASE/__log | jq '[.[]|select(.method=="POST" and (.path|endswith("/customaudiences")))]|length')"
check "públicos CRM: só clientes ganhos" "1" "$(post $MET/sync-crm-customer-audience "$H" "{\"workspaceId\":\"$WID\",\"onlyWon\":true}" | jq -r .uploaded)"

echo "  Meta ao vivo: Entrar com Facebook (state de uso único)"
check "login: marketing não gera o link" "403" "$(code $MET/meta-login-url "$HM" "{\"workspaceId\":\"$WID\",\"origin\":\"https://atacante.test\"}")"
MURL=$(post $MET/meta-login-url "$H" "{\"workspaceId\":\"$WID\",\"origin\":\"https://atacante.test\"}" | jq -r .url)
MST=$(echo "$MURL" | sed -n 's/.*[?&]state=\([^&]*\).*/\1/p')
check "login: URL do Facebook, 14 escopos, retorno = a API e state aleatório (sem ponto, só hash no banco)" "1,14,1,0,1" "$(echo "$MURL" | grep -c '^https://www.facebook.com/v24.0/dialog/oauth?'),$(echo "$MURL" | sed -n 's/.*scope=\([^&]*\).*/\1/p' | sed 's/%2C/\n/g' | wc -l),$(echo "$MURL" | grep -c "redirect_uri=$(printf '%s' "$API/api/public/meta/oauth/callback" | jq -sRr @uri)"),$(PSQL "SELECT count(*) FROM oauth_states WHERE state_hash='$MST'"),$(echo "$MST" | grep -cE '^[A-Za-z0-9_-]{40,}$')"
MCB=$API/api/public/meta/oauth/callback
check "callback: state forjado (formato do protótipo) → meta_erro e nenhuma troca de token" "1,0" "$(locdec "$MCB?code=ok-code&state=eyJ3IjoiMSJ9.assinatura" | grep -c 'meta_erro=Assinatura do retorno inválida.'),$(curl -s $GBASE/__log | jq '[.[]|select(.path=="/oauth/access_token" and .params.code=="ok-code")]|length')"
check "callback: sucesso → 302 ?meta=conectado (destino = APP_URL)" "302 http://localhost:3025/integrations?meta=conectado" "$(loc "$MCB?code=ok-code&state=$MST")"
check "callback: token longo guardado cifrado, origem facebook_login, validade ~60 dias" "facebook_login,1,1" "$(post $MET/meta-ads-status "$H" "$WSB" | jq -r '[.tokenSource, (.tokenExpiresAt != null), ((.tokenExpiresAt|sub("\\.[0-9]+Z";"Z")|fromdateiso8601) > (now + 59*86400))]|map(tostring)|.[0]+","+(if .[1]=="true" then "1" else "0" end)+","+(if .[2]=="true" then "1" else "0" end)')"
check "callback: o token do Facebook NÃO ficou em texto puro" "0" "$(PSQL "SELECT count(*) FROM app_credentials WHERE workspace_id='$WID' AND value LIKE '%FAKE-LONG-LIVED%'")"
check "callback: o mesmo state NÃO vale duas vezes" "1" "$(locdec "$MCB?code=ok-code&state=$MST" | grep -c 'meta_erro=Assinatura do retorno inválida.')"
MST2=$(post $MET/meta-login-url "$H" "{\"workspaceId\":\"$WID\",\"origin\":\"http://x\"}" | jq -r .url | sed -n 's/.*[?&]state=\([^&]*\).*/\1/p')
check "callback: o Facebook recusa o código → mensagem dele em meta_erro" "1" "$(locdec "$MCB?code=codigo-ruim&state=$MST2" | grep -c 'meta_erro=Código inválido ou expirado')"
check "callback: sem code → retorno_incompleto; erro do Facebook repassado" "1,1" "$(loc "$MCB?state=x" | grep -c 'meta_erro=retorno_incompleto'),$(locdec "$MCB?error=access_denied&error_description=Usuario%20negou" | grep -c 'meta_erro=Usuario negou')"
curl -s -X DELETE "$API/v1/workspaces/$WID/files?key=$IMGK" -H "$H" >/dev/null
fi

echo "── Task 7: CRM núcleo (funil, leads, tarefas, indicadores, configurações) ──"
CRM=$API/v1/workspaces/$WID/crm
CRMB=$API/v1/workspaces/$NID/crm
cg(){ curl -s "$1" -H "$2"; }
cs(){ curl -s -X "$1" "$2" -H "$3" -H "$J" -d "$4"; }
cc(){ curl -s -o /dev/null -w '%{http_code}' -X "$1" "$2" -H "$3" -H "$J" -d "$4"; }
OWNERID=$(echo "$S" | jq -r .user.id)
DEMOID=$(echo "$DEMO" | jq -r .user.id)

echo "  funil e etapas"
PLS=$(cg $CRM/pipelines "$H")
check "pipelines: funil padrão criado na 1ª leitura" "1,Funil Padrão" "$(echo "$PLS" | jq -r 'length,.[0].name' | paste -sd,)"
PIPE=$(echo "$PLS" | jq -r '.[0].id')
STG=$(cg "$CRM/stages?pipeline_id=$PIPE" "$H")
check "stages: 8 etapas por posição, a 1ª é Novo Lead" "8,Novo Lead,Perdido" "$(echo "$STG" | jq -r 'length,.[0].name,.[7].name' | paste -sd,)"
ST_NEW=$(echo "$STG" | jq -r '.[0].id'); ST_Q=$(echo "$STG" | jq -r '.[2].id'); ST_WON=$(echo "$STG" | jq -r '.[6].id')
check "stages: pipeline_id malformado → 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' "$CRM/stages?pipeline_id=xxx" -H "$H")"
check "viewer lê o funil" "200" "$(curl -s -o /dev/null -w '%{http_code}' $CRM/pipelines -H "$HV")"
check "estranho não lê o CRM" "403" "$(curl -s -o /dev/null -w '%{http_code}' $CRM/pipelines -H "$HD")"
check "viewer não cria lead" "Seu perfil não tem permissão para esta ação." "$(cs POST $CRM/leads "$HV" '{"name":"X"}' | jq -r .error.message)"
check "viewer não move nem altera etapas" "403,403" "$(cc POST $CRM/leads/00000000-0000-4000-8000-000000000001/move "$HV" "{\"stage_id\":\"$ST_Q\"}"),$(cc DELETE $CRM/stages/$ST_Q "$HV" '{}')"

echo "  leads: criar, ler, mover (transação), editar"
LD=$(cs POST $CRM/leads "$H" "{\"name\":\"Lead Smoke\",\"phone\":\"+5511900000001\",\"email\":\"smoke7@x.co\",\"city\":\"SP\",\"source\":\"manual\",\"pipeline_id\":\"$PIPE\",\"stage_id\":\"$ST_NEW\"}")
LID=$(echo "$LD" | jq -r .id)
check "cria lead (estimated_value number, ai_active true)" "Lead Smoke,number,true" "$(echo "$LD" | jq -r '[.name,(.estimated_value|type),.ai_active]|join(",")')"
check "nome obrigatório" "400" "$(cc POST $CRM/leads "$H" '{"name":"  "}')"
check "campo desconhecido barrado (whitelist)" "VALIDATION_ERROR" "$(cs POST $CRM/leads "$H" '{"name":"x","workspace_id":"y"}' | jq -r .error.code)"
check "etapa de outro workspace → 404" "404" "$(cc POST $CRM/leads "$H" "{\"name\":\"x\",\"stage_id\":\"$(cg $CRMB/stages "$H" | jq -r '.[0].id')\"}")"
check "lista de leads traz o criado" "1" "$(cg "$CRM/leads?pipeline_id=$PIPE" "$H" | jq '[.[]|select(.name=="Lead Smoke")]|length')"
check "lead por id" "Lead Smoke" "$(cg $CRM/leads/$LID "$H" | jq -r .name)"
check "lead de OUTRO workspace → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' $CRMB/leads/$LID -H "$H")"
check "move: moved=true e etapa nova" "true,$ST_Q" "$(cs POST $CRM/leads/$LID/move "$H" "{\"stage_id\":\"$ST_Q\"}" | jq -r '[.moved,.lead.stage_id]|join(",")')"
check "move: histórico (de→para) + interação 'Movido para Qualificado.'" "1,$ST_NEW,$ST_Q,Movido para Qualificado." "$(PSQL "SELECT count(*)||','||from_stage_id||','||to_stage_id FROM crm_stage_history WHERE lead_id='$LID' GROUP BY from_stage_id,to_stage_id"),$(PSQL "SELECT content FROM crm_interactions WHERE lead_id='$LID' AND kind='stage_change'")"
check "move para a mesma etapa: nada gravado" "false,1" "$(cs POST $CRM/leads/$LID/move "$H" "{\"stage_id\":\"$ST_Q\"}" | jq -r .moved),$(PSQL "SELECT count(*) FROM crm_stage_history WHERE lead_id='$LID'")"
check "move: etapa de outro workspace → 404 e nada muda" "404,$ST_Q" "$(cc POST $CRM/leads/$LID/move "$H" "{\"stage_id\":\"$(cg $CRMB/stages "$H" | jq -r '.[2].id')\"}"),$(cg $CRM/leads/$LID "$H" | jq -r .stage_id)"
check "patch: responsável + etapa pela ficha (sem histórico — quirk do protótipo)" "$OWNERID,1" "$(cs PATCH $CRM/leads/$LID "$H" "{\"owner_id\":\"$OWNERID\"}" | jq -r .owner_id),$(PSQL "SELECT count(*) FROM crm_stage_history WHERE lead_id='$LID'")"
check "patch: responsável que não é do workspace → 400" "400" "$(cc PATCH $CRM/leads/$LID "$H" "{\"owner_id\":\"$DEMOID\"}")"
check "patch: coluna fora da lista → 400 (whitelist)" "VALIDATION_ERROR" "$(cs PATCH $CRM/leads/$LID "$H" '{"workspace_id":"x"}' | jq -r .error.code)"
check "viewer não edita lead" "403" "$(cc PATCH $CRM/leads/$LID "$HV" '{"ai_active":false}')"
check "nota: grava e atualiza last_interaction_at" "note,nota smoke,t" "$(cs POST $CRM/leads/$LID/interactions "$H" '{"content":"  nota smoke "}' | jq -r '[.kind,.content]|join(",")'),$(PSQL "SELECT (last_interaction_at IS NOT NULL) FROM crm_leads WHERE id='$LID'")"
check "timeline: mais recente primeiro" "nota smoke" "$(cg $CRM/leads/$LID/interactions "$H" | jq -r '.[0].content')"
check "Assumir conversa: ai_active=false + nota do protótipo" "false,Atendimento assumido por humano (IA pausada)." "$(cs POST $CRM/leads/$LID/ai "$H" '{"active":false}' | jq -r .ai_active),$(PSQL "SELECT content FROM crm_interactions WHERE lead_id='$LID' AND kind='note' ORDER BY created_at DESC LIMIT 1")"
check "Devolver para IA" "true,Conversa devolvida para a IA." "$(cs POST $CRM/leads/$LID/ai "$H" '{"active":true}' | jq -r .ai_active),$(PSQL "SELECT content FROM crm_interactions WHERE lead_id='$LID' AND kind='note' ORDER BY created_at DESC LIMIT 1")"

echo "  tarefas"
TK=$(cs POST $CRM/leads/$LID/tasks "$H" '{"title":"Ligar amanhã"}')
TID=$(echo "$TK" | jq -r .id)
check "tarefa criada (aberta, vence em ~24 h)" "open,1" "$(echo "$TK" | jq -r '[.status, ((.due_at|sub("\\.[0-9]+Z";"Z")|fromdateiso8601) > (now + 23*3600))]|map(tostring)|.[0]+","+(if .[1]=="true" then "1" else "0" end)')"
check "lista de tarefas traz o nome do lead (crm_leads)" "Lead Smoke" "$(cg $CRM/tasks "$H" | jq -r --arg t "$TID" '.[]|select(.id==$t)|.crm_leads.name')"
check "tarefas do lead" "1" "$(cg $CRM/leads/$LID/tasks "$H" | jq length)"
check "concluir / reabrir" "done,open" "$(cs PATCH $CRM/tasks/$TID "$H" '{"status":"done"}' | jq -r .status),$(cs PATCH $CRM/tasks/$TID "$H" '{"status":"open"}' | jq -r .status)"
check "status inválido → 400" "400" "$(cc PATCH $CRM/tasks/$TID "$H" '{"status":"qualquer"}')"
check "viewer não conclui tarefa" "403" "$(cc PATCH $CRM/tasks/$TID "$HV" '{"status":"done"}')"
check "tarefa de outro workspace → 404" "404" "$(cc PATCH $CRMB/tasks/$TID "$H" '{"status":"done"}')"

echo "  ações em massa e importação de CSV"
L2=$(cs POST $CRM/leads "$H" "{\"name\":\"Lead Smoke 2\",\"pipeline_id\":\"$PIPE\",\"stage_id\":\"$ST_NEW\"}" | jq -r .id)
LX=$(PSQL "INSERT INTO crm_leads(workspace_id,name) VALUES ('$NID','Alheio Smoke') RETURNING id" | head -1)
check "bulk: mover 2 leads (sem histórico, quirk) " "2,$ST_WON,$ST_WON" "$(cs POST $CRM/leads/bulk "$H" "{\"ids\":[\"$LID\",\"$L2\"],\"stage_id\":\"$ST_WON\"}" | jq -r .updated),$(cg $CRM/leads/$LID "$H" | jq -r .stage_id),$(cg $CRM/leads/$L2 "$H" | jq -r .stage_id)"
check "bulk: atribuir responsável" "$OWNERID,$OWNERID" "$(cs POST $CRM/leads/bulk "$H" "{\"ids\":[\"$LID\",\"$L2\"],\"owner_id\":\"$OWNERID\"}" >/dev/null; cg $CRM/leads/$LID "$H" | jq -r .owner_id),$(cg $CRM/leads/$L2 "$H" | jq -r .owner_id)"
check "bulk: aplicar tag (união, sem duplicar)" "VIP,VIP" "$(cs POST $CRM/leads/bulk "$H" "{\"ids\":[\"$LID\",\"$L2\"],\"add_tag\":\"VIP\"}" >/dev/null; cs POST $CRM/leads/bulk "$H" "{\"ids\":[\"$LID\"],\"add_tag\":\"VIP\"}" >/dev/null; cg $CRM/leads/$LID "$H" | jq -r '.tags|join("+")'),$(cg $CRM/leads/$L2 "$H" | jq -r '.tags|join("+")')"
check "bulk: id de outro workspace derruba tudo (404) e nada muda" "404,$ST_WON" "$(cc POST $CRM/leads/bulk "$H" "{\"ids\":[\"$LID\",\"$LX\"],\"stage_id\":\"$ST_NEW\"}"),$(cg $CRM/leads/$LID "$H" | jq -r .stage_id)"
check "bulk: sem ação → 400" "400" "$(cc POST $CRM/leads/bulk "$H" "{\"ids\":[\"$LID\"]}")"
check "viewer não faz ação em massa" "403" "$(cc POST $CRM/leads/bulk "$HV" "{\"ids\":[\"$LID\"],\"add_tag\":\"x\"}")"
check "import CSV: 3 linhas → source import" "3,3" "$(cs POST $CRM/leads/import "$H" "{\"pipeline_id\":\"$PIPE\",\"stage_id\":\"$ST_NEW\",\"rows\":[{\"name\":\"Imp A\",\"phone\":\"+5511911110001\"},{\"name\":\"Imp B\",\"email\":\"b@imp.co\"},{\"name\":\"Imp C\",\"city\":\"Rio\"}]}" | jq -r .imported),$(PSQL "SELECT count(*) FROM crm_leads WHERE workspace_id='$WID' AND source='import' AND name LIKE 'Imp %'")"
BEFORE=$(PSQL "SELECT count(*) FROM crm_leads WHERE workspace_id='$WID'")
BIG=$(jq -n '{rows:[range(0;5001)|{name:"x\(.)"}]}' | curl -s -X POST $CRM/leads/import -H "$H" -H "$J" --data-binary @-)
check "import CSV: teto de 5000 linhas (mensagem pt-BR) e nada gravado" "Arquivo grande demais: importe no máximo 5000 leads por vez (o arquivo tem 5001).,$BEFORE" "$(echo "$BIG" | jq -r .error.message),$(PSQL "SELECT count(*) FROM crm_leads WHERE workspace_id='$WID'")"
check "import CSV: etapa de outro workspace → 404" "404" "$(cc POST $CRM/leads/import "$H" "{\"stage_id\":\"$(cg $CRMB/stages "$H" | jq -r '.[0].id')\",\"rows\":[{\"name\":\"z\"}]}")"

echo "  Indicadores e configurações"
check "stage-history: traz a movimentação do lead" "1" "$(cg $CRM/stage-history "$H" | jq --arg l "$LID" '[.[]|select(.lead_id==$l)]|length')"
check "interactions (todas): kind/author_type" "1" "$(cg $CRM/interactions "$H" | jq '[.[]|select(.kind=="stage_change" and .author_type=="user")]|length|if .>=1 then 1 else 0 end')"
check "cadence-options e cadence-metrics (6 listas)" "0,cadences;events;history;messages;runs;stages" "$(cg $CRM/cadence-options "$H" | jq length),$(cg $CRM/cadence-metrics "$H" | jq -r 'keys|join(";")')"
CAD=$(PSQL "INSERT INTO crm_cadences(workspace_id,name,steps) VALUES ('$WID','Cadência Smoke','[{\"channel\":\"wa_text\",\"delay_minutes\":0}]') RETURNING id" | head -1)
PSQL "INSERT INTO crm_cadence_events(workspace_id,cadence_id,step_index,channel,event,lead_id) VALUES ('$WID','$CAD',0,'wa_text','sent','$LID')" >/dev/null
check "cadence-metrics: lê cadência, eventos e etapas do workspace" "Cadência Smoke,1,8" "$(cg $CRM/cadence-metrics "$H" | jq -r '[.cadences[0].name,(.events|length),(.stages|length)]|join(",")')"
check "cadence-options lista a cadência" "Cadência Smoke" "$(cg $CRM/cadence-options "$H" | jq -r '.[0].name')"
check "membros: owner + viewer + marketing, com perfil" "3,Smoke 2" "$(cg $CRM/members "$H" | jq -r '[length, (.[]|select(.role=="owner")|.profiles.full_name)]|join(",")')"
ET=$(cs POST $CRM/stages "$H" "{\"pipeline_id\":\"$PIPE\",\"name\":\"Etapa Smoke\",\"position\":9}")
ETID=$(echo "$ET" | jq -r .id)
check "etapa: criar" "Etapa Smoke,9" "$(echo "$ET" | jq -r '[.name,.position]|join(",")')"
check "etapa: editar nome/cor/SLA/posição" "Etapa Smoke 2,#ff0000,5,10" "$(cs PATCH $CRM/stages/$ETID "$H" '{"name":"Etapa Smoke 2","color":"#ff0000","sla_hours":5,"position":10}' | jq -r '[.name,.color,.sla_hours,.position]|join(",")')"
check "etapa: funil de outro workspace → 404" "404" "$(cc POST $CRM/stages "$H" "{\"pipeline_id\":\"$(cg $CRMB/pipelines "$H" | jq -r '.[0].id')\",\"name\":\"x\"}")"
check "etapa: de outro workspace não edita nem apaga" "404,404" "$(cc PATCH $CRMB/stages/$ETID "$H" '{"name":"x"}'),$(cc DELETE $CRMB/stages/$ETID "$H" '{}')"
cs PATCH $CRM/leads/$L2 "$H" "{\"stage_id\":\"$ETID\"}" >/dev/null
check "etapa: apagar (204) e o lead que estava nela fica sem etapa" "204,null" "$(cc DELETE $CRM/stages/$ETID "$H" '{}'),$(cg $CRM/leads/$L2 "$H" | jq -r .stage_id)"
SET0=$(cg $CRM/settings "$H")
check "distribuição padrão: round_robin" "round_robin" "$(echo "$SET0" | jq -r .distribution)"
check "distribuição: responsável fixo" "fixed,$OWNERID" "$(cs PUT $CRM/settings "$H" "{\"distribution\":\"fixed\",\"default_owner_id\":\"$OWNERID\"}" | jq -r '[.distribution,.default_owner_id]|join(",")')"
check "distribuição: responsável de fora → 400; modo inválido → 400; viewer → 403" "400,400,403" "$(cc PUT $CRM/settings "$H" "{\"distribution\":\"fixed\",\"default_owner_id\":\"$DEMOID\"}"),$(cc PUT $CRM/settings "$H" '{"distribution":"x"}'),$(cc PUT $CRM/settings "$HV" '{"distribution":"fixed"}')"
cs PUT $CRM/settings "$H" '{"distribution":"round_robin"}' >/dev/null
check "tags padrão (4) e criar/duplicar/apagar" "4,Tag Smoke,409,204" "$(cg $CRM/tags "$H" | jq length),$(cs POST $CRM/tags "$H" '{"name":"Tag Smoke"}' | jq -r .name),$(cc POST $CRM/tags "$H" '{"name":"Tag Smoke"}'),$(cc DELETE $CRM/tags/$(cg $CRM/tags "$H" | jq -r '.[]|select(.name=="Tag Smoke")|.id') "$H" '{}')"
RS=$(cs POST $CRM/loss-reasons "$H" '{"name":"Motivo Smoke"}' | jq -r .id)
check "motivos de perda: 5 padrão + criar/apagar (outro workspace não apaga)" "6,404,204,5" "$(cg $CRM/loss-reasons "$H" | jq length),$(cc DELETE $CRMB/loss-reasons/$RS "$H" '{}'),$(cc DELETE $CRM/loss-reasons/$RS "$H" '{}'),$(cg $CRM/loss-reasons "$H" | jq length)"

echo "  ação da Meta usada pelo Kanban (notifyMetaConversion)"
NMC=$API/v1/crm-integrations/notify-meta-conversion
check "sem integração conectada → { skipped: true }" "true" "$(cs POST $NMC "$H" "{\"workspaceId\":\"$WID\",\"leadId\":\"$LID\",\"event\":\"Ganho\"}" | jq -r '.skipped // .sent')"
check "viewer → 403; evento inválido → 400; lead de outro workspace → skipped" "403,400,true" "$(cc POST $NMC "$HV" "{\"workspaceId\":\"$WID\",\"leadId\":\"$LID\",\"event\":\"Ganho\"}"),$(cc POST $NMC "$H" "{\"workspaceId\":\"$WID\",\"leadId\":\"$LID\",\"event\":\"Outro\"}"),$(cs POST $NMC "$H" "{\"workspaceId\":\"$WID\",\"leadId\":\"$LX\",\"event\":\"Ganho\"}" | jq -r '.skipped // .sent')"
if [ -n "$GBASE" ]; then
  PSQL "INSERT INTO crm_integrations(workspace_id,kind,provider,status,config) VALUES ('$WID','meta_lead_ads','meta','connected','{\"pixel_id\":\"123456789\"}') ON CONFLICT (workspace_id,kind) DO UPDATE SET status='connected', config='{\"pixel_id\":\"123456789\"}'" >/dev/null
  curl -s -X POST "$GBASE/__reset" >/dev/null
  check "Ganho: POST /{pixel}/events com e-mail em SHA-256 e valor em BRL" "true,$(printf 'smoke7@x.co' | openssl dgst -sha256 | sed 's/^.* //'),system_generated" "$(cs POST $NMC "$H" "{\"workspaceId\":\"$WID\",\"leadId\":\"$LID\",\"event\":\"Ganho\"}" | jq -r .sent),$(curl -s $GBASE/__log | jq -r '[.[]|select(.method=="POST" and .path=="/123456789/events")|.params.data[0].user_data.em[0]][0]'),$(curl -s $GBASE/__log | jq -r '[.[]|select(.path=="/123456789/events")|.params.data[0].action_source][0]')"
fi

echo "  formulário público do site (/api/public/forms)"
FORM=$API/api/public/forms
TOK=$(PSQL "INSERT INTO crm_integrations(workspace_id,kind,provider,status,config) VALUES ('$NID','site_form','site','connected','{\"title\":\"Form Smoke\",\"redirect_url\":\"https://obrigado.example/ok\",\"ask_message\":true}') RETURNING webhook_token" | head -1)
check "GET: HTML do formulário (no-store, embutível em iframe, sem X-Frame-Options)" "200,text/html; charset=utf-8,no-store,1,0" "$(curl -s -o /tmp/mf-form.html -w '%{http_code}' $FORM/$TOK),$(curl -sI $FORM/$TOK | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}'),$(curl -sI $FORM/$TOK | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}'),$(curl -sI $FORM/$TOK | tr -d '\r' | grep -ic 'frame-ancestors \*'),$(curl -sI $FORM/$TOK | tr -d '\r' | grep -ic '^x-frame-options')"
check "GET: título, isca e mensagem no HTML" "2,1,1" "$(grep -c 'Form Smoke' /tmp/mf-form.html),$(grep -c 'name=\"website\"' /tmp/mf-form.html),$(grep -c 'name=\"message\"' /tmp/mf-form.html)"
check "GET: token desconhecido → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' $FORM/naoexiste)"
check "embed: JavaScript com cache 300 s e CORS *, iframe apontando para APP_URL" "200,1,1,1" "$(curl -s -o /tmp/mf-embed.js -w '%{http_code}' $FORM/embed/$TOK),$(grep -c "api/public/forms/$TOK" /tmp/mf-embed.js),$(curl -sI $FORM/embed/$TOK | tr -d '\r' | grep -ic 'cache-control: public, max-age=300'),$(curl -sI $FORM/embed/$TOK | tr -d '\r' | grep -ic 'access-control-allow-origin: \*')"
check "OPTIONS (preflight de outra origem) → 204 com CORS *" "204,1" "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS $FORM/$TOK -H 'Origin: https://outro.test' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'),$(curl -sI -X OPTIONS $FORM/$TOK -H 'Origin: https://outro.test' -H 'Access-Control-Request-Method: POST' | tr -d '\r' | grep -ic 'access-control-allow-origin: \*')"
check "OPTIONS do formulário: Allow-Methods GET, POST, OPTIONS e Allow-Origin * (resposta completa)" "GET, POST, OPTIONS,*" "$(curl -sI -X OPTIONS $FORM/$TOK -H 'Origin: https://outro.test' -H 'Access-Control-Request-Method: POST' | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-methods"{m=$2} tolower($1)=="access-control-allow-origin"{o=$2} END{print m","o}')"
check "rota que NÃO é do formulário não recebe CORS * (preflight e GET com Origin de fora)" "0,0" "$(curl -sI -X OPTIONS $API/v1/auth/login -H 'Origin: https://outro.test' -H 'Access-Control-Request-Method: POST' | tr -d '\r' | grep -ic 'access-control-allow-origin: \*'),$(curl -sI $API/health -H 'Origin: https://outro.test' | tr -d '\r' | grep -ic 'access-control-allow-origin: \*')"
fcount(){ PSQL "SELECT count(*) FROM crm_leads WHERE workspace_id='$NID' AND source='site'"; }
OLDT=$(( $(date +%s) * 1000 - 60000 ))
check "POST isca preenchida: 200 e nada gravado" "200,0" "$(cc POST $FORM/$TOK "$J" '{"name":"Robô","email":"r@x.co","website":"http://spam","_t":'$OLDT'}'),$(fcount)"
check "POST em menos de 2,5 s: 200 e nada gravado" "200,0" "$(cc POST $FORM/$TOK "$J" '{"name":"Rápido","email":"r@x.co","_t":'$(( $(date +%s) * 1000 ))'}'),$(fcount)"
check "POST sem _t, com _t=0 ou no futuro: 200 (igual à isca) e nada gravado" "200,200,200,0" "$(cc POST $FORM/$TOK "$J" '{"name":"SemT","email":"r@x.co"}'),$(cc POST $FORM/$TOK "$J" '{"name":"ZeroT","email":"r@x.co","_t":0}'),$(cc POST $FORM/$TOK "$J" '{"name":"FuturoT","email":"r@x.co","_t":'$(( $(date +%s) * 1000 + 600000 ))'}'),$(fcount)"
check "GET: o HTML leva o _t do servidor num campo oculto (envio sem JS)" "1" "$(grep -c '<input type=\"hidden\" name=\"_t\" value=\"[0-9]*\">' /tmp/mf-form.html)"
check "POST sem e-mail/telefone válidos → 400" "Informe um e-mail válido ou um telefone." "$(cs POST $FORM/$TOK "$J" '{"name":"Sem","email":"x","_t":'$OLDT'}' | jq -r .error)"
FR=$(cs POST $FORM/$TOK "$J" '{"name":"Ana Site","email":"ANA@site.co","phone":"(11) 98888-7777","message":"quero","page":"https://s.test/","utm_source":"google","_t":'$OLDT'}')
check "POST válido: { ok, redirect }, lead de origem site com LGPD e etapa inicial" "true,https://obrigado.example/ok,site,true,Novo Lead,+5511988887777" "$(echo "$FR" | jq -r '[.ok,.redirect]|join(",")'),$(PSQL "SELECT l.source||','||l.lgpd_consent||','||s.name||','||l.phone FROM crm_leads l JOIN crm_stages s ON s.id=l.stage_id WHERE l.workspace_id='$NID' AND l.email='ana@site.co'")"
check "POST válido: histórico, interação e integração 'connected'" "1,1,connected" "$(PSQL "SELECT count(*) FROM crm_stage_history h JOIN crm_leads l ON l.id=h.lead_id WHERE l.email='ana@site.co'"),$(PSQL "SELECT count(*) FROM crm_interactions i JOIN crm_leads l ON l.id=i.lead_id WHERE l.email='ana@site.co' AND i.content LIKE 'Lead do formulário do site: \"quero\"%'"),$(PSQL "SELECT status FROM crm_integrations WHERE webhook_token='$TOK'")"
check "o mesmo contato de novo: não duplica o lead" "1" "$(cc POST $FORM/$TOK "$J" '{"name":"Ana Site","email":"ana@site.co","_t":'$OLDT'}' >/dev/null; PSQL "SELECT count(*) FROM crm_leads WHERE workspace_id='$NID' AND email='ana@site.co'")"
check "POST de formulário comum (urlencoded) com redirect_url → 303 + Location" "303,https://obrigado.example/ok" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -X POST $FORM/$TOK -d "name=Bia&email=bia@site.co&_t=$OLDT" | tr ' ' ',')"
check "IP guardado só como hash de 32 hex (nunca o IP)" "0,1" "$(PSQL "SELECT count(*) FROM crm_webhook_events WHERE source='site_form' AND payload->>'ip' !~ '^[0-9a-f]{32}\$'"),$(PSQL "SELECT (count(*) > 0)::int FROM crm_webhook_events WHERE source='site_form'")"
for i in 1 2; do cc POST $FORM/$TOK "$J" "{\"name\":\"Rate $i\",\"email\":\"rate$i@site.co\",\"_t\":$OLDT}" >/dev/null; done
check "limite de 5 envios/10 min por IP: o 6º é 429 e não grava" "429,Muitos envios seguidos. Tente de novo em alguns minutos." "$(cc POST $FORM/$TOK "$J" "{\"name\":\"Rate 9\",\"email\":\"rate9@site.co\",\"_t\":$OLDT}"),$(cs POST $FORM/$TOK "$J" "{\"name\":\"Rate 9\",\"email\":\"rate9@site.co\",\"_t\":$OLDT}" | jq -r .error)"
check "x-forwarded-for forjado NÃO escapa do limite" "429" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $FORM/$TOK -H "$J" -H 'X-Forwarded-For: 9.9.9.9' -H 'CF-Connecting-IP: 8.8.8.8' -d "{\"name\":\"Rate 9\",\"email\":\"rate9@site.co\",\"_t\":$OLDT}")"
check "integração desconectada → 404 (GET e POST)" "404,404" "$(PSQL "UPDATE crm_integrations SET status='disconnected' WHERE webhook_token='$TOK'" >/dev/null; curl -s -o /dev/null -w '%{http_code}' $FORM/$TOK),$(cc POST $FORM/$TOK "$J" '{"name":"x","email":"x@y.co"}')"
check "o formulário não vaza para outro workspace: 0 leads 'site' em $WID" "0" "$(PSQL "SELECT count(*) FROM crm_leads WHERE workspace_id='$WID' AND source='site'")"
rm -f /tmp/mf-form.html /tmp/mf-embed.js

echo "  descadastro (/api/public/unsubscribe) — HMAC completo, preso ao lead + empresa"
UNS=$API/api/public/unsubscribe
USEC=${UNSUBSCRIBE_SECRET:-meu-funil-dev-unsubscribe-secret-not-for-production}
usig(){ printf '%s' "unsubscribe:v1:$1:$2" | openssl dgst -sha256 -hmac "$USEC" | sed 's/^.* //'; }
GOODSIG=$(usig $WID $LID)
PSQL "INSERT INTO crm_cadence_runs(workspace_id,cadence_id,lead_id,status) VALUES ('$WID','$CAD','$LID','running')" >/dev/null
check "assinatura adulterada / truncada (32 hex) / vazia → 'Link inválido ou expirado.'" "1,1,1,1" "$(curl -s "$UNS/$LID?t=${GOODSIG:0:63}$([ "${GOODSIG: -1}" = 0 ] && echo 1 || echo 0)" | grep -c 'Link inválido ou expirado.'),$(curl -s "$UNS/$LID?t=${GOODSIG:0:32}" | grep -c 'Link inválido ou expirado.'),$(curl -s "$UNS/$LID?t=" | grep -c 'Link inválido ou expirado.'),$(curl -s "$UNS/$LID" | grep -c 'Link inválido ou expirado.')"
check "assinatura de OUTRO lead / de outro workspace / id inexistente ou malformado → inválido" "1,1,1,1" "$(curl -s "$UNS/$LID?t=$(usig $WID $L2)" | grep -c 'Link inválido'),$(curl -s "$UNS/$LID?t=$(usig $NID $LID)" | grep -c 'Link inválido'),$(curl -s "$UNS/00000000-0000-4000-8000-0000000000aa?t=$(usig $WID 00000000-0000-4000-8000-0000000000aa)" | grep -c 'Link inválido'),$(curl -s "$UNS/xxx?t=$GOODSIG" | grep -c 'Link inválido')"
check "nada mudou com os links inválidos" "f,t,running" "$(PSQL "SELECT unsubscribed||','||ai_active FROM crm_leads WHERE id='$LID'" | sed 's/true/t/g;s/false/f/g'),$(PSQL "SELECT status FROM crm_cadence_runs WHERE lead_id='$LID' LIMIT 1")"
check "link válido: 'Pronto.', lead descadastrado, IA off, cadência parada (opt_out), 1 interação" "1,t,f,stopped,opt_out,1" "$(curl -s "$UNS/$LID?t=$GOODSIG" | grep -c 'Pronto. Você não receberá mais nossos e-mails.'),$(PSQL "SELECT unsubscribed FROM crm_leads WHERE id='$LID'"),$(PSQL "SELECT ai_active FROM crm_leads WHERE id='$LID'"),$(PSQL "SELECT status FROM crm_cadence_runs WHERE lead_id='$LID' LIMIT 1"),$(PSQL "SELECT stop_reason FROM crm_cadence_runs WHERE lead_id='$LID' LIMIT 1"),$(PSQL "SELECT count(*) FROM crm_interactions WHERE lead_id='$LID' AND kind='ai_action'")"
check "clicar de novo é idempotente (continua 1 interação)" "1,1" "$(curl -s "$UNS/$LID?t=$GOODSIG" | grep -c 'Pronto.'),$(PSQL "SELECT count(*) FROM crm_interactions WHERE lead_id='$LID' AND kind='ai_action'")"
check "o outro lead do mesmo workspace NÃO foi descadastrado" "f" "$(PSQL "SELECT unsubscribed FROM crm_leads WHERE id='$L2'" | sed 's/false/f/')"

# limpeza do que é global (o resto some com o workspace)
PSQL "DELETE FROM cron_tokens WHERE name='ads' AND token='$ATOK'" >/dev/null
PSQL "DELETE FROM cron_heartbeats WHERE name LIKE 'ads-%' AND last_run_at >= '$T6'" >/dev/null
PSQL "DELETE FROM oauth_states WHERE workspace_id IN ('$WID','$NID')" >/dev/null
[ -n "$FGPID" ] && kill "$FGPID" 2>/dev/null
check "limpeza Task 6: sem tokens de cron, heartbeats nem states pendentes" "0,0,0" "$(PSQL "SELECT count(*) FROM cron_tokens WHERE name='ads'"),$(PSQL "SELECT count(*) FROM cron_heartbeats WHERE name LIKE 'ads-%' AND last_run_at >= '$T6'"),$(PSQL "SELECT count(*) FROM oauth_states WHERE workspace_id IN ('$WID','$NID')")"

echo "── Refresh e logout ──"
R=$(curl -s -X POST $API/v1/auth/refresh -H "$J" -d "{\"refresh_token\":\"$RT\"}")
check "refresh ok" "$EMAIL" "$(echo "$R" | jq -r .user.email)"
check "access token não serve de refresh" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/auth/refresh -H "$J" -d "{\"refresh_token\":\"$AT\"}")"
check "logout 204" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/auth/logout -H "$H")"
check "refresh revogado após logout" "INVALID_REFRESH_TOKEN" "$(curl -s -X POST $API/v1/auth/refresh -H "$J" -d "{\"refresh_token\":\"$RT\"}" | jq -r .error.code)"

echo "── Limpeza ──"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^meu-funil-postgres$'; then
  docker exec meu-funil-postgres psql -U meufunil -d meufunil -qtc "
    DELETE FROM workspaces WHERE owner_id IN (SELECT id FROM users WHERE email IN ('$EMAIL','$EMAIL2','$EMAIL3'));
    DELETE FROM profiles WHERE email IN ('$EMAIL','$EMAIL2','$EMAIL3');
    DELETE FROM users WHERE email IN ('$EMAIL','$EMAIL2','$EMAIL3');" >/dev/null && ok "usuário de teste removido"
fi
rm -f /tmp/mf-smoke.png /tmp/mf-smoke-dl.png
echo; echo "Passaram: $PASS  Falharam: $FAIL"
[ "$FAIL" = "0" ]
