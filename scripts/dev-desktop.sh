#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"

echo "==> Installing web dependencies..."
cd "$WEB_DIR"
pnpm install

echo "==> Generating Prisma clients..."
pnpm prisma:generate
pnpm prisma:generate:desktop

echo "==> Installing desktop dependencies..."
cd "$DESKTOP_DIR"
pnpm install

echo "==> Starting desktop development mode..."
exec pnpm dev
