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
printf '\x89PNG\r\n\x1a\nref-bytes' > /tmp/mf-ref.png
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

echo "── Refresh e logout ──"
R=$(curl -s -X POST $API/v1/auth/refresh -H "$J" -d "{\"refresh_token\":\"$RT\"}")
check "refresh ok" "$EMAIL" "$(echo "$R" | jq -r .user.email)"
check "access token não serve de refresh" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/auth/refresh -H "$J" -d "{\"refresh_token\":\"$AT\"}")"
check "logout 204" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/v1/auth/logout -H "$H")"
check "refresh revogado após logout" "INVALID_REFRESH_TOKEN" "$(curl -s -X POST $API/v1/auth/refresh -H "$J" -d "{\"refresh_token\":\"$RT\"}" | jq -r .error.code)"

echo "── Limpeza ──"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^meu-funil-postgres$'; then
  docker exec meu-funil-postgres psql -U meufunil -d meufunil -qtc "
    DELETE FROM workspaces WHERE owner_id IN (SELECT id FROM users WHERE email IN ('$EMAIL','$EMAIL2'));
    DELETE FROM profiles WHERE email IN ('$EMAIL','$EMAIL2');
    DELETE FROM users WHERE email IN ('$EMAIL','$EMAIL2');" >/dev/null && ok "usuário de teste removido"
fi
rm -f /tmp/mf-smoke.png /tmp/mf-smoke-dl.png
echo; echo "Passaram: $PASS  Falharam: $FAIL"
[ "$FAIL" = "0" ]
