#!/usr/bin/env bash
# Teste do pull.mjs contra um Lovable falso (fake-lovable.mjs) servindo uma exportação sintética, e dos prompts. Sem rede externa.
#   (de api/) bash scripts/lovable-export/pull-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP="$(mktemp -d)"; PID=""; trap '[[ -n "$PID" ]] && kill "$PID" 2>/dev/null; rm -rf "$TMP"' EXIT
OK=0; FAIL=0
check() { if [[ "$2" == "$3" ]]; then OK=$((OK+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — esperado [$2], veio [$3]"; fi; }
node scripts/lovable-export/make-fixture.mjs --out "$TMP/origem" --legacy-secret x >/dev/null
printf 'token-e2e-123' > "$TMP/token"
node scripts/lovable-export/fake-lovable.mjs --dir "$TMP/origem" --token token-e2e-123 --port-file "$TMP/porta" >"$TMP/fake.log" 2>&1 & PID=$!
for _ in $(seq 1 50); do [[ -s "$TMP/porta" ]] && break; sleep 0.1; done
P=$(cat "$TMP/porta")
printf 'SUPABASE_URL="http://127.0.0.1:%s"\nSUPABASE_PUBLISHABLE_KEY="anon-e2e"\n' "$P" > "$TMP/env"
pull() { node scripts/lovable-export/pull.mjs --env "$TMP/env" --token-file "$TMP/token" --file-url "http://127.0.0.1:$P/api/export-file" "$@"; }

pull --out "$TMP/so-conta" --check-only >"$TMP/o1" 2>&1 && r=0 || r=$?
check "--check-only mostra o total e não baixa nada" "0,1,0" "$r,$(grep -c 'arquivos: 3 (creative-assets: 2, ig-media: 1)' "$TMP/o1"),$(find "$TMP/so-conta" -path '*/storage/*' -type f 2>/dev/null | wc -l)"
pull --out "$TMP/destino" >"$TMP/o2" 2>&1 && r=0 || { r=$?; cat "$TMP/o2"; }
check "pull completo e conferido" "0,1" "$r,$(grep -c 'exportação completa e conferida' "$TMP/o2")"
check "arquivos idênticos à origem" "0" "$(diff -r "$TMP/origem/storage" "$TMP/destino/storage" >/dev/null && echo 0 || echo 1)"
iguais=0; for f in "$TMP"/origem/tables/*.json; do cmp -s "$f" "$TMP/destino/tables/$(basename "$f")" && iguais=$((iguais+1)); done
check "tabelas idênticas à origem" "$(ls "$TMP"/origem/tables | wc -l)" "$iguais"
check "pasta da exportação só do dono" "700" "$(stat -c %a "$TMP/destino")"
printf 'token-errado' > "$TMP/token"
pull --out "$TMP/negado" >"$TMP/o3" 2>&1 && r=0 || r=$?
check "token errado: recusado" "1" "$r"

H=$(printf 'a%.0s' $(seq 1 64))
node scripts/lovable-export/render-prompts.mjs --hash "$H" --only exportacao >"$TMP/p1"
check "prompt de exportação: SQL inteiro, hash no SQL e na rota, sem marcador" "1,1,2,0" \
  "$(grep -c 'CREATE OR REPLACE FUNCTION public.export_meufunil' "$TMP/p1"),$(grep -c '^AS \$\$$' "$TMP/p1"),$(grep -c "$H" "$TMP/p1"),$(grep -c '__' "$TMP/p1")"
node scripts/lovable-export/render-prompts.mjs --hash curto >/dev/null 2>&1 && r=0 || r=$?
check "hash inválido recusado" "1" "$r"

echo; echo "$OK ok, $FAIL falha(s)"; [[ $FAIL -eq 0 ]]
