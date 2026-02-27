#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BIN_DIR="$REPO_ROOT/desktop/runtime/artifacts/bin"

mkdir -p "$BIN_DIR"

SOURCE_VFKIT="${ARCHE_DESKTOP_SOURCE_VFKIT:-/opt/podman/bin/vfkit}"
SOURCE_GVPROXY="${ARCHE_DESKTOP_SOURCE_GVPROXY:-/opt/podman/bin/gvproxy}"

if [[ ! -x "$SOURCE_VFKIT" ]]; then
  echo "vfkit not found at $SOURCE_VFKIT" >&2
  exit 1
fi

if [[ ! -x "$SOURCE_GVPROXY" ]]; then
  echo "gvproxy not found at $SOURCE_GVPROXY" >&2
  exit 1
fi

cp "$SOURCE_VFKIT" "$BIN_DIR/vfkit"
cp "$SOURCE_GVPROXY" "$BIN_DIR/gvproxy"
chmod +x "$BIN_DIR/vfkit" "$BIN_DIR/gvproxy"

echo "runtime binaries copied to $BIN_DIR"
