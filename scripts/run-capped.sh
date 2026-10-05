#!/usr/bin/env bash
# Roda um comando pesado num cgroup com teto de memória (systemd user scope), serializado por um lock compartilhado.
# Se o comando passar do teto, o kernel mata SÓ este scope (exit 137) em vez de travar a máquina do dono.
#
# uso: scripts/run-capped.sh <teto-MB> <comando> [args...]
#   scripts/run-capped.sh 1500 npm test                       (em api/)
#   scripts/run-capped.sh 1500 npm run typecheck              (em api/)
#   scripts/run-capped.sh 1500 yarn typecheck                 (em web/)
#   scripts/run-capped.sh 1300 bash api/scripts/smoke-capped.sh
#   scripts/run-capped.sh 2400 bash web/scripts/browser-check-sections.sh --inner <seções>   (o runner de grupos já faz isso)
#
# Lock: `$ROOT/.cache/heavy.lock` (fora do git); `HEAVY_LOCK=<arquivo>` troca (ex.: para serializar com outro checkout).
# O teto baixa sozinho para (MemAvailable - 800 MB) se a máquina estiver curta, e o comando é recusado (exit 75) se sobrar
# menos que min(teto, 900 MB): espere 2 min e tente de novo.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LOCK=${HEAVY_LOCK:-$ROOT/.cache/heavy.lock}
mkdir -p "$(dirname "$LOCK")"
want=${1:?teto em MB}; shift

exec 9>"$LOCK"
flock -w 5400 9

avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
cap=$want
if [ $((avail - 800)) -lt "$cap" ]; then cap=$((avail - 800)); fi
floor=900; if [ "$want" -lt "$floor" ]; then floor=$want; fi
if [ "$cap" -lt "$floor" ]; then
  echo "run-capped: só ${avail} MB disponíveis — recusando (espere e tente de novo)" >&2
  exit 75
fi
# O Node dimensiona o heap pela metade do limite do cgroup; dê quase tudo ao heap, salvo se o chamador escolheu.
case "${NODE_OPTIONS:-}" in *max-old-space-size*) ;; *) export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=$((cap - 300))";; esac
export MF_CAPPED=1   # os runners (smoke/browser-check) conferem isto para não rodar fora do teto
echo "run-capped: teto ${cap} MB (disponível ${avail} MB): $*" >&2
systemd-run --user --scope -q -p MemoryMax="${cap}M" -p MemorySwapMax=0 -p CPUQuota=600% \
  nice -n 10 "$@"
