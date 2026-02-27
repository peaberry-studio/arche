#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if ! command -v podman >/dev/null 2>&1; then
  echo "podman is required" >&2
  exit 1
fi

echo "[desktop] building arche-workspace:desktop"
podman build -t arche-workspace:desktop "$REPO_ROOT/infra/workspace-image"

echo "[desktop] building arche-web:desktop"
podman build -t arche-web:desktop "$REPO_ROOT/apps/web"

echo "[desktop] done"
