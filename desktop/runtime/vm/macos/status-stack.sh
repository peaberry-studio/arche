#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${1:-}"

if [[ -z "$RUNTIME_ROOT" ]]; then
  echo "usage: status-stack.sh <runtime-root>" >&2
  exit 1
fi

source "$RUNTIME_ROOT/vm/macos/common.sh"

if ! pid_running "$VFKIT_PID"; then
  echo '{"running":false,"reason":"vm_not_running"}'
  exit 0
fi

if curl -fsS "http://127.0.0.1:$WEB_PORT/api/health" >/dev/null 2>&1; then
  echo "{\"running\":true,\"ready\":true,\"url\":\"http://127.0.0.1:$WEB_PORT\"}"
else
  echo "{\"running\":true,\"ready\":false,\"url\":\"http://127.0.0.1:$WEB_PORT\"}"
fi
