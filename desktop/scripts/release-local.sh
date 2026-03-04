#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TAURI_DIR="$REPO_ROOT/desktop/tauri"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This release script only supports macOS." >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "This release script only supports Apple Silicon (arm64)." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required" >&2
  exit 1
fi

printf "[desktop-release] Build desktop container images\n"
"$SCRIPT_DIR/build-desktop-images.sh"

printf "[desktop-release] Export image archives for offline VM runtime\n"
"$SCRIPT_DIR/export-desktop-images.sh"

printf "[desktop-release] Bundle vfkit and gvproxy runtime binaries\n"
"$SCRIPT_DIR/prepare-runtime-binaries.sh"

printf "[desktop-release] Install Tauri dependencies\n"
pnpm install --dir "$TAURI_DIR"

printf "[desktop-release] Build DMG\n"
pnpm --dir "$TAURI_DIR" tauri build

DMG_PATH="$TAURI_DIR/src-tauri/target/release/bundle/dmg/Arche_0.1.0_aarch64.dmg"

if [[ ! -f "$DMG_PATH" ]]; then
  DMG_PATH="$(ls "$TAURI_DIR/src-tauri/target/release/bundle/dmg"/*.dmg 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$DMG_PATH" || ! -f "$DMG_PATH" ]]; then
  echo "DMG build finished but no DMG file was found." >&2
  exit 1
fi

printf "[desktop-release] DMG ready: %s\n" "$DMG_PATH"
