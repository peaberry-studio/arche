#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
RUNTIME_WEB_DIR="$ROOT_DIR/desktop/app/runtime/web"
BUILD_PATH="$PATH"
if [[ -d "/opt/homebrew/opt/node/bin" ]]; then
  BUILD_PATH="/opt/homebrew/opt/node/bin:$BUILD_PATH"
fi

log() {
  echo "[desktop-web] $1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[desktop-web] Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd pnpm
require_cmd rsync

log "Installing web dependencies"
(
  cd "$WEB_DIR"
  PATH="$BUILD_PATH" pnpm install --frozen-lockfile
)

log "Building Next.js standalone runtime"
(
  cd "$WEB_DIR"
  PATH="$BUILD_PATH" pnpm prisma:generate
  PATH="$BUILD_PATH" DATABASE_URL="${DATABASE_URL:-postgresql://build:build@127.0.0.1:5432/build}" pnpm build
)

log "Preparing runtime directory"
rm -rf "$RUNTIME_WEB_DIR"
mkdir -p "$RUNTIME_WEB_DIR/standalone/.next" "$RUNTIME_WEB_DIR/prisma"

rsync -a --delete "$WEB_DIR/.next/standalone/" "$RUNTIME_WEB_DIR/standalone/"
rsync -a --delete "$WEB_DIR/.next/static/" "$RUNTIME_WEB_DIR/standalone/.next/static/"
rsync -a --delete "$WEB_DIR/public/" "$RUNTIME_WEB_DIR/standalone/public/"

mkdir -p "$RUNTIME_WEB_DIR/standalone/kickstart/agents" "$RUNTIME_WEB_DIR/standalone/kickstart/templates"
rsync -a --delete "$WEB_DIR/kickstart/agents/definitions/" "$RUNTIME_WEB_DIR/standalone/kickstart/agents/definitions/"
rsync -a --delete "$WEB_DIR/kickstart/templates/definitions/" "$RUNTIME_WEB_DIR/standalone/kickstart/templates/definitions/"

mkdir -p "$RUNTIME_WEB_DIR/prisma/migrations"
rsync -a --delete "$WEB_DIR/prisma/migrations/" "$RUNTIME_WEB_DIR/prisma/migrations/"
cp "$WEB_DIR/prisma/schema.prisma" "$RUNTIME_WEB_DIR/prisma/schema.prisma"

log "Web runtime prepared at $RUNTIME_WEB_DIR"
