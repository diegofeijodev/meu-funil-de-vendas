#!/usr/bin/env bash
# Browser-check completo, por GRUPOS de seções (o passeio inteiro não cabe num processo sob o teto de memória: chegou a ~1,6 GB).
# Cada grupo sobe pilha NOVA (fakes + API + `next dev` limpo, que só compila as rotas do grupo) + o browser-check com `BC_ONLY`,
# sempre via `scripts/run-capped.sh 2400`, e derruba tudo pelos PIDs (trap EXIT). Os grupos rodam em sequência e os totais são somados.
#
#   bash web/scripts/browser-check-sections.sh            # todos os grupos (de qualquer diretório)
#   bash web/scripts/browser-check-sections.sh 1 4        # só os grupos 1 e 4
#   BC_NO_AI=1 bash web/scripts/browser-check-sections.sh 2   # API sem gateway de IA (caminho "IA não configurada")
#
# Se um grupo morrer com 137 (estourou o teto), NÃO aumente o teto: reparta o grupo (GRUPOS abaixo).
# Requer o Postgres do projeto (`docker compose up -d postgres`; o runner sobe se faltar). Banco local DESCARTÁVEL apenas.
set -uo pipefail
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")
ROOT=$(cd "$(dirname "$SELF")/../.." && pwd)

# Grupos (1–5 seções (instagram e meta ficam sozinhos: juntos o Chrome morria por OOM dentro do cgroup), só as rotas que elas visitam são compiladas pelo `next dev`): número → seções
GRUPOS=(
  "shell,overview,marcas,config,agencia"
  "campanhas,estudio"
  "instagram"
  "meta"
  "crm"
  "canais,integracoes"
  "navegacao,refresh,sessao"
)

if [ "${1:-}" = "--inner" ]; then
  # ── dentro do cgroup: pilha nova + browser-check das seções de $2 ──
  secoes=$2
  # shellcheck source=../../scripts/test-stack.sh
  source "$ROOT/scripts/test-stack.sh"
  trap mf_stop_all EXIT
  mf_postgres_up || { echo "Postgres não subiu"; exit 1; }
  # o browser-check levanta o gateway de IA falso (3099) sozinho; Graph (3098) e provedores do CRM (3097) vêm daqui
  mf_start_fakes graph providers
  mf_start_api || exit 1
  mf_start_web || exit 1
  cd "$ROOT/web" || exit 1
  UNSUBSCRIBE_SECRET=${UNSUBSCRIBE_SECRET:-meu-funil-dev-unsubscribe-secret-not-for-production} BC_ONLY=$secoes node scripts/browser-check.mjs
  rc=$?
  echo "pico de memória do cgroup (grupo '$secoes'): $(mf_peak_mb) MB"
  exit $rc
fi

# ── externo: um grupo por vez, cada um num scope com teto de 2400 MB ──
quais=("$@")
if [ ${#quais[@]} -eq 0 ]; then for i in "${!GRUPOS[@]}"; do quais+=("$((i + 1))"); done; fi
mkdir -p "$ROOT/.cache"
tot_ok=0; tot_fail=0; rc_all=0
for g in "${quais[@]}"; do
  secoes=${GRUPOS[$((g - 1))]:-}
  [ -z "$secoes" ] && { echo "grupo $g não existe (1..${#GRUPOS[@]})"; exit 2; }
  echo "════ grupo $g/${#GRUPOS[@]}: $secoes ════"
  log="$ROOT/.cache/bc-grupo-$g.log"
  for tentativa in 1 2 3; do
    "$ROOT/scripts/run-capped.sh" 2400 bash "$SELF" --inner "$secoes" 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
    [ "$rc" -ne 75 ] && break
    echo "sem memória livre agora (tentativa $tentativa/3); aguardando 2 min..."; sleep 120
  done
  if [ "$rc" -eq 137 ]; then echo "GRUPO $g MORTO PELO TETO (137): reparta as seções, não aumente o teto."; fi
  linha=$(grep -E '^[0-9]+ ok, [0-9]+ falha' "$log" | tail -1)
  o=$(echo "$linha" | sed -E 's/^([0-9]+) ok.*/\1/'); f=$(echo "$linha" | sed -E 's/^[0-9]+ ok, ([0-9]+) falha.*/\1/')
  [[ "$o" =~ ^[0-9]+$ ]] || { o=0; f=1; }   # sem linha de totais = o grupo não terminou: conta como falha
  tot_ok=$((tot_ok + o)); tot_fail=$((tot_fail + f))
  [ "$rc" -ne 0 ] && rc_all=1
done
echo "════ TOTAL: $tot_ok ok, $tot_fail falha(s) em ${#quais[@]} grupo(s) ════"
exit $rc_all
