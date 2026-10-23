#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCODE_VERSION_FILE="$ROOT_DIR/versions/opencode.version"
OPENCODE_V1_VERSION_FILE="$ROOT_DIR/versions/opencode-v1.version"

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

if [[ ! -f "$OPENCODE_V1_VERSION_FILE" ]]; then
  printf 'Error: missing legacy OpenCode version file at %s\n' "$OPENCODE_V1_VERSION_FILE" >&2
  exit 1
fi
OPENCODE_V1_VERSION="$(tr -d '[:space:]' < "$OPENCODE_V1_VERSION_FILE")"
if [[ "$OPENCODE_V1_VERSION" != "1.18.18" ]]; then
  printf 'Error: legacy OpenCode must remain pinned to 1.18.18\n' >&2
  exit 1
fi

printf '==> Building legacy workspace image (OpenCode %s)\n' "$OPENCODE_V1_VERSION"
podman build \
  --build-arg OPENCODE_VERSION="$OPENCODE_V1_VERSION" \
  -t arche-workspace:opencode-v1 \
  -t "arche-workspace:opencode-v1-$OPENCODE_V1_VERSION" \
  -f "$ROOT_DIR/infra/workspace-image/Containerfile" "$ROOT_DIR/infra/workspace-image"

printf '==> Building v2 workspace image (OpenCode %s)\n' "$OPENCODE_VERSION"
podman build \
  --build-arg OPENCODE_VERSION="$OPENCODE_VERSION" \
  -t arche-workspace:podman-check \
  -t arche-workspace:opencode-v2 \
  -f "$ROOT_DIR/infra/workspace-image/Containerfile" "$ROOT_DIR/infra/workspace-image"

node "$ROOT_DIR/infra/workspace-image/tests/runtime-smoke.mjs"
node "$ROOT_DIR/infra/workspace-image/tests/archive-smoke.mjs"

printf '==> Building web image\n'
podman build \
  --build-arg GIT_SHA=podman-check \
  -t arche-web:podman-check \
  -f "$ROOT_DIR/apps/web/Containerfile" "$ROOT_DIR/apps"

printf '==> Podman image validation passed\n'
