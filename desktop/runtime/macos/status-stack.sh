#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${1:-}"

if [[ -z "$RUNTIME_ROOT" ]]; then
  echo "usage: status-stack.sh <runtime-root>" >&2
  exit 1
fi

if ! command -v podman >/dev/null 2>&1; then
  echo '{"running":false,"reason":"podman_not_found"}'
  exit 0
fi

COMPOSE_FILE="$RUNTIME_ROOT/compose.desktop.yml"

source "$RUNTIME_ROOT/macos/env.sh" "$RUNTIME_ROOT"

if ! ps_json="$(podman compose -f "$COMPOSE_FILE" -p arche-desktop ps --format json 2>/dev/null)"; then
  echo '{"running":false,"reason":"compose_not_started"}'
  exit 0
fi

if [[ -z "${ps_json//[[:space:]]/}" || "$ps_json" == "[]" ]]; then
  echo '{"running":false,"reason":"compose_not_started"}'
  exit 0
fi

if curl -fsS "http://127.0.0.1:4510/api/health" >/dev/null 2>&1; then
  echo '{"running":true,"ready":true,"url":"http://127.0.0.1:4510"}'
else
  echo '{"running":true,"ready":false,"url":"http://127.0.0.1:4510"}'
fi
