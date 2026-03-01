#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/desktop/runtime/artifacts/images"

mkdir -p "$ARTIFACT_DIR"

if ! command -v podman >/dev/null 2>&1; then
  echo "podman is required" >&2
  exit 1
fi

ensure_image() {
  local image="$1"
  if podman image exists "$image"; then
    return
  fi
  echo "pulling $image"
  podman pull "$image"
}

ensure_image "arche-web:desktop"
ensure_image "arche-workspace:desktop"
ensure_image "postgres:16"
ensure_image "docker.io/alpine/socat:1.8.0.3"

podman save -o "$ARTIFACT_DIR/arche-web-desktop.tar" "arche-web:desktop"
podman save -o "$ARTIFACT_DIR/arche-workspace-desktop.tar" "arche-workspace:desktop"
podman save -o "$ARTIFACT_DIR/postgres-16.tar" "postgres:16"
podman save -o "$ARTIFACT_DIR/alpine-socat-1.8.0.3.tar" "docker.io/alpine/socat:1.8.0.3"

echo "exported image archives to $ARTIFACT_DIR"
