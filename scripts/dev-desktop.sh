#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
NODE_BIN_DIR="$(cd "$(dirname "$(command -v node)")" && pwd)"
PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"

if [[ -z "$PNPM_BIN" || ! -x "$PNPM_BIN" ]]; then
  echo "ERROR: pnpm not found in PATH."
  echo "Install pnpm or activate the intended Node toolchain before running this script."
  exit 1
fi

export PATH="$NODE_BIN_DIR:$PATH"

echo "==> Using node: $(command -v node) ($(node -v))"
echo "==> Using pnpm: $PNPM_BIN ($("$PNPM_BIN" -v))"

echo "==> Installing web dependencies..."
cd "$WEB_DIR"
"$PNPM_BIN" install

echo "==> Rebuilding desktop native modules for $(node -v)..."
"$PNPM_BIN" rebuild argon2 better-sqlite3

echo "==> Generating Prisma clients..."
"$PNPM_BIN" prisma:generate
"$PNPM_BIN" prisma:generate:desktop

echo "==> Installing desktop dependencies..."
cd "$DESKTOP_DIR"
"$PNPM_BIN" install

echo "==> Starting desktop development mode..."
exec "$PNPM_BIN" dev
