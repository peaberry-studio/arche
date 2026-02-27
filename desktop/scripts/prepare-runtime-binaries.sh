#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BIN_DIR="$REPO_ROOT/desktop/runtime/artifacts/bin"
LIB_DIR="$REPO_ROOT/desktop/runtime/artifacts/lib"

mkdir -p "$BIN_DIR"
mkdir -p "$LIB_DIR"

SOURCE_VFKIT="${ARCHE_DESKTOP_SOURCE_VFKIT:-/opt/podman/bin/vfkit}"
SOURCE_GVPROXY="${ARCHE_DESKTOP_SOURCE_GVPROXY:-/opt/podman/bin/gvproxy}"
SOURCE_ZSTD="${ARCHE_DESKTOP_SOURCE_ZSTD:-}"

if [[ -z "$SOURCE_ZSTD" ]]; then
  SOURCE_ZSTD="$(command -v zstd || true)"
fi

if [[ ! -x "$SOURCE_VFKIT" ]]; then
  echo "vfkit not found at $SOURCE_VFKIT" >&2
  exit 1
fi

if [[ ! -x "$SOURCE_GVPROXY" ]]; then
  echo "gvproxy not found at $SOURCE_GVPROXY" >&2
  exit 1
fi

if [[ -z "$SOURCE_ZSTD" || ! -x "$SOURCE_ZSTD" ]]; then
  echo "zstd not found; install it or set ARCHE_DESKTOP_SOURCE_ZSTD" >&2
  exit 1
fi

cp "$SOURCE_VFKIT" "$BIN_DIR/vfkit"
cp "$SOURCE_GVPROXY" "$BIN_DIR/gvproxy"
cp "$SOURCE_ZSTD" "$BIN_DIR/zstd"
chmod +x "$BIN_DIR/vfkit" "$BIN_DIR/gvproxy" "$BIN_DIR/zstd"

ZSTD_DYLIB_PATH="$(otool -L "$SOURCE_ZSTD" | awk '/libzstd\..*dylib/{print $1; exit}')"

if [[ -z "$ZSTD_DYLIB_PATH" || ! -f "$ZSTD_DYLIB_PATH" ]]; then
  echo "could not locate libzstd dylib for $SOURCE_ZSTD" >&2
  exit 1
fi

cp "$ZSTD_DYLIB_PATH" "$LIB_DIR/$(basename "$ZSTD_DYLIB_PATH")"

echo "runtime binaries copied to $BIN_DIR"
