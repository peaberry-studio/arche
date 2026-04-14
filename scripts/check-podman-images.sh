#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCODE_VERSION_FILE="$ROOT_DIR/versions/opencode.version"

if ! command -v podman >/dev/null 2>&1; then
  printf 'Error: podman is required to validate images.\n' >&2
  exit 1
fi

if [[ ! -f "$OPENCODE_VERSION_FILE" ]]; then
  printf 'Error: missing OpenCode version file at %s\n' "$OPENCODE_VERSION_FILE" >&2
  exit 1
fi

OPENCODE_VERSION="$(tr -d '[:space:]' < "$OPENCODE_VERSION_FILE")"

if [[ -z "$OPENCODE_VERSION" ]]; then
  printf 'Error: OpenCode version is empty in %s\n' "$OPENCODE_VERSION_FILE" >&2
  exit 1
fi

printf '==> Building web image\n'
podman build \
  --build-arg GIT_SHA=podman-check \
  -t arche-web:podman-check \
  -f "$ROOT_DIR/apps/web/Containerfile" "$ROOT_DIR/apps"

printf '==> Building workspace image\n'
podman build \
  --build-arg OPENCODE_VERSION="$OPENCODE_VERSION" \
  -t arche-workspace:podman-check \
  -f "$ROOT_DIR/infra/workspace-image/Containerfile" "$ROOT_DIR/infra/workspace-image"

printf '==> Podman image validation passed\n'
