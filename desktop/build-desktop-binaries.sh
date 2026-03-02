#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/desktop/app"
RUNTIME_BIN_DIR="$APP_DIR/runtime/bin"
WORKSPACE_AGENT_SRC="$ROOT_DIR/infra/workspace-image/workspace-agent"

log() {
  echo "[desktop-bin] $1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[desktop-bin] Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd go
require_cmd node

mkdir -p "$RUNTIME_BIN_DIR"

log "Compiling workspace-agent binary"
(
  cd "$WORKSPACE_AGENT_SRC"
  GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o "$RUNTIME_BIN_DIR/workspace-agent" .
)
chmod +x "$RUNTIME_BIN_DIR/workspace-agent"

log "Copying opencode binary from desktop dependencies"
node - "$APP_DIR" "$RUNTIME_BIN_DIR" <<'NODE'
const fs = require('fs')
const path = require('path')

const appDir = process.argv[2]
const runtimeBinDir = process.argv[3]
const packageJsonPath = require.resolve('opencode-ai/package.json', { paths: [appDir] })
const packageDir = path.dirname(packageJsonPath)
const source = path.join(packageDir, 'bin', '.opencode')
const target = path.join(runtimeBinDir, 'opencode')

if (!fs.existsSync(source)) {
  throw new Error(`Unable to locate opencode binary at ${source}`)
}

fs.copyFileSync(source, target)
fs.chmodSync(target, 0o755)
NODE

log "Runtime binaries ready at $RUNTIME_BIN_DIR"
