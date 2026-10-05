#!/usr/bin/env bash
# Smoke completo da API numa tacada só: sobe os provedores falsos + a API, roda `npm run smoke`, derruba tudo pelos PIDs.
# Rode SEMPRE sob o teto de memória (de qualquer diretório):
#   scripts/run-capped.sh 1300 bash api/scripts/smoke-capped.sh
# (chamado direto, ele mesmo se reexecuta sob `run-capped.sh` — a máquina do dono trava com a pilha solta.)
set -uo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if [ "${MF_CAPPED:-}" != "1" ]; then   # `scripts/run-capped.sh` exporta MF_CAPPED=1 para o que roda dentro dele
  exec "$ROOT/scripts/run-capped.sh" 1300 bash "$0" "$@"
fi
# shellcheck source=../../scripts/test-stack.sh
source "$ROOT/scripts/test-stack.sh"
trap mf_stop_all EXIT
mf_postgres_up || { echo "Postgres não subiu"; exit 1; }
# o smoke espera a API SEM gateway de IA (testa "IA do app não configurada"); só as chaves próprias apontam para o fake-ai
export BC_NO_AI=1
# o smoke usa o fake-ai (3099) para chaves e diagnóstico; Graph e provedores do CRM
mf_start_fakes graph providers ai
mf_start_api || exit 1
cd "$ROOT/api" && npm run smoke
rc=$?
echo "pico de memória do cgroup: $(mf_peak_mb) MB"
exit $rc
