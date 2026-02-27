#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${1:-}"

if [[ -z "$RUNTIME_ROOT" ]]; then
  echo "usage: env.sh <runtime-root>" >&2
  exit 1
fi

if podman machine inspect >/dev/null 2>&1; then
  podman machine start >/dev/null 2>&1 || true
fi

if [[ -z "${PODMAN_SOCKET_PATH:-}" ]]; then
  if [[ "$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null || echo false)" == "true" ]]; then
    PODMAN_SOCKET_PATH="/run/user/$(id -u)/podman/podman.sock"
  else
    PODMAN_SOCKET_PATH="/run/podman/podman.sock"
  fi
fi

DATA_DIR="${ARCHE_DESKTOP_DATA_DIR:-$HOME/Library/Application Support/ArcheDesktop/data}"
SECRETS_FILE="$DATA_DIR/.desktop-secrets"

if [[ -f "$SECRETS_FILE" ]]; then
  set -a
  source "$SECRETS_FILE"
  set +a
fi

export PODMAN_SOCKET_PATH
export ARCHE_DESKTOP_DATA_DIR="$DATA_DIR"
