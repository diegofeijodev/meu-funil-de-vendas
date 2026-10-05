#!/usr/bin/env bash
# Biblioteca (para `source`) do smoke e do browser-check: variáveis de ambiente de teste num lugar só + subir/derrubar a pilha
# (fakes, API, web) pelos PIDs. NUNCA use `pkill -f`. Quem usa deve rodar dentro de `scripts/run-capped.sh`.
#
#   source scripts/test-stack.sh
#   trap mf_stop_all EXIT
#   mf_start_fakes [graph providers ai]   # o browser-check levanta o gateway de IA (3099) sozinho; o smoke usa o fake-ai
#   mf_start_api
#   mf_start_web                          # só o browser-check
MF_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MF_PIDS=()
MF_LOGS_OWNED=0   # 1 só se este script criou o diretório (mktemp): só então ele pode apagá-lo
if [ -z "${MF_LOGS:-}" ]; then MF_LOGS=$(mktemp -d "${TMPDIR:-/tmp}/mf-stack-XXXXXX"); MF_LOGS_OWNED=1; fi

# ── Ambiente da API em teste (todas as exigências dos scripts atuais, num lugar só) ──────────────
# Provedores falsos: Graph da Meta (3098), Z-API/Resend/Cal.com (3097), gateway de IA e listagem de modelos (3099).
mf_api_env() {
  export META_APP_SECRET=${META_APP_SECRET:-smoke-meta-secret}
  export META_GRAPH_BASE_URL=${META_GRAPH_BASE_URL:-http://127.0.0.1:3098/v24.0}
  export RESEND_API_URL=${RESEND_API_URL:-http://127.0.0.1:3097/resend}
  export CALCOM_API_URL=${CALCOM_API_URL:-http://127.0.0.1:3097/calcom}
  # "sem IA" (BC_NO_AI=1): a API sobe sem gateway; as chaves próprias de IA ainda apontam para o provedor falso.
  if [ "${BC_NO_AI:-0}" != "1" ]; then
    export AI_GATEWAY_URL=${AI_GATEWAY_URL:-http://127.0.0.1:3099/v1}
    export AI_GATEWAY_API_KEY=${AI_GATEWAY_API_KEY:-fake}
  fi
  export AI_OPENAI_BASE_URL=${AI_OPENAI_BASE_URL:-http://127.0.0.1:3099/v1}
  export AI_GEMINI_BASE_URL=${AI_GEMINI_BASE_URL:-http://127.0.0.1:3099/v1beta}
  # o browser-check/smoke assinam os links de descadastro com este segredo (mesmo padrão de desenvolvimento da API)
  export UNSUBSCRIBE_SECRET=${UNSUBSCRIBE_SECRET:-meu-funil-dev-unsubscribe-secret-not-for-production}
  export CORS_ORIGINS=${CORS_ORIGINS:-http://localhost:3025}
  export SCHEDULER_ENABLED=false   # jobs rodam só pelas rotas /api/public/cron/* (uma instância, sem agendador no teste)
}

# Aborta se a porta já está ocupada (pilha antiga esquecida de pé): o teste falaria contra o servidor errado.
mf_assert_port_free() { # porta, nome
  local busy; busy=$(ss -ltnH 2>/dev/null | grep -E ":$1\b" || true)
  if [ -n "$busy" ]; then
    echo "  [stack] porta $1 ($2) já está ocupada — há uma pilha antiga de pé? Encerre-a pelo PID (ss -ltnp | grep ':$1 ') e rode de novo:" >&2
    echo "$busy" >&2
    return 1
  fi
}

mf_wait_http() { # url, tentativas (1 s cada)
  local url=$1 n=${2:-120}
  for _ in $(seq "$n"); do curl -fs -o /dev/null --max-time 5 "$url" && return 0; sleep 1; done
  return 1
}

mf_spawn() { # nome, diretório, comando... — em grupo de processos próprio (kill pelo PGID)
  local name=$1 dir=$2; shift 2
  setsid bash -c 'cd "$0" && exec "$@"' "$dir" "$@" >"$MF_LOGS/$name.log" 2>&1 &
  MF_PIDS+=("$!")
  echo "  [stack] $name pid $! (log: $MF_LOGS/$name.log)"
}

mf_start_fakes() {
  local f
  for f in "$@"; do
    case "$f" in
      graph) mf_spawn fake-graph "$MF_ROOT" node "$MF_ROOT/api/scripts/fake-graph.mjs" ;;
      providers) mf_spawn fake-providers "$MF_ROOT" node "$MF_ROOT/api/scripts/fake-providers.mjs" ;;
      ai) mf_spawn fake-ai "$MF_ROOT" node "$MF_ROOT/api/scripts/fake-ai.mjs" ;;
    esac
  done
  sleep 1
}

mf_start_api() {
  mf_assert_port_free 3015 API || return 1
  mf_api_env
  NODE_OPTIONS=--max-old-space-size=768 mf_spawn api "$MF_ROOT/api" npm run start:smoke
  mf_wait_http http://localhost:3015/health 120 || { echo "API não subiu:"; tail -20 "$MF_LOGS/api.log"; return 1; }
}

mf_start_web() {
  mf_assert_port_free 3025 web || return 1
  NODE_OPTIONS=--max-old-space-size=1280 mf_spawn web "$MF_ROOT/web" yarn dev
  mf_wait_http http://localhost:3025/auth 180 || { echo "web não subiu:"; tail -20 "$MF_LOGS/web.log"; return 1; }
}

mf_stop_all() {
  local rc=$? pid
  for pid in "${MF_PIDS[@]:-}"; do
    [ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null
  done
  sleep 2
  for pid in "${MF_PIDS[@]:-}"; do
    [ -n "$pid" ] && kill -KILL -- "-$pid" 2>/dev/null
  done
  MF_PIDS=()
  local busy; busy=$(ss -ltnH 2>/dev/null | grep -E ':(3015|3025|3097|3098|3099)\b' || true)
  if [ -n "$busy" ]; then echo "  [stack] AVISO: portas ainda ocupadas:"; echo "$busy"; else echo "  [stack] tudo derrubado, portas livres."; fi
  # Logs: só ficam (em .cache/, fora do git) se a rodada falhou; senão o diretório temporário é removido.
  if [ -n "${MF_LOGS:-}" ] && [ -d "$MF_LOGS" ]; then
    if [ "$rc" -ne 0 ]; then
      local keep="$MF_ROOT/.cache/stack-logs-$(date +%Y%m%d-%H%M%S)"
      mkdir -p "$MF_ROOT/.cache" && cp -r "$MF_LOGS" "$keep" 2>/dev/null && echo "  [stack] falhou (rc=$rc): logs guardados em $keep"
    fi
    [ "$MF_LOGS_OWNED" = 1 ] && rm -rf "$MF_LOGS"
  fi
}

mf_peak_mb() { # pico de memória do cgroup atual (scope do run-capped), se legível
  local cg f
  cg=$(awk -F: '{print $3}' /proc/self/cgroup | head -1)
  for f in "/sys/fs/cgroup${cg}/memory.peak" "/sys/fs/cgroup${cg}/memory.max_usage_in_bytes"; do
    [ -r "$f" ] && { echo $(( $(cat "$f") / 1048576 )); return; }
  done
  echo "?"
}

mf_postgres_up() {
  if ! docker ps --format '{{.Names}}' | grep -qx meu-funil-postgres; then
    ( cd "$MF_ROOT" && docker compose up -d postgres )
    for _ in $(seq 30); do docker exec meu-funil-postgres pg_isready -U meufunil >/dev/null 2>&1 && return 0; sleep 1; done
    return 1
  fi
}
