#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${1:-}"

if [[ -z "$RUNTIME_ROOT" ]]; then
  echo "usage: logs-stack.sh <runtime-root>" >&2
  exit 1
fi

if ! command -v podman >/dev/null 2>&1; then
  echo "podman not found"
  exit 0
fi

COMPOSE_FILE="$RUNTIME_ROOT/compose.desktop.yml"

source "$RUNTIME_ROOT/macos/env.sh" "$RUNTIME_ROOT"

podman compose -f "$COMPOSE_FILE" -p arche-desktop logs --tail 200
