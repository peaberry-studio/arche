#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/desktop/app"
DIST_DIR="$ROOT_DIR/desktop/dist"

log() {
  echo "[desktop-build] $1"
}

fail() {
  echo "[desktop-build] $1" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

require_cmd pnpm
require_cmd shasum

mkdir -p "$DIST_DIR"

log "Preparing web runtime bundle"
"$ROOT_DIR/desktop/build-web-runtime.sh"

log "Installing desktop dependencies"
(
  cd "$APP_DIR"
  pnpm install --frozen-lockfile
)

log "Preparing runtime binaries"
"$ROOT_DIR/desktop/build-desktop-binaries.sh"

log "Building Electron DMG"
(
  cd "$APP_DIR"
  pnpm dist
)

DMG_PATH="$(ls -t "$DIST_DIR"/Arche-Desktop_*_arm64.dmg 2>/dev/null | head -n 1 || true)"
if [[ -z "$DMG_PATH" || ! -f "$DMG_PATH" ]]; then
  fail "DMG artifact not found in $DIST_DIR"
fi

SHA256="$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"
SIZE="$(du -h "$DMG_PATH" | awk '{print $1}')"

log "DMG ready"
echo "DMG_PATH=$DMG_PATH"
echo "DMG_SHA256=$SHA256"
echo "DMG_SIZE=$SIZE"
