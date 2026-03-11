#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"

echo "==> Building Arche Desktop"

# Step 1: Build the Next.js web app in standalone mode
echo "==> [1/4] Building Next.js web app..."
cd "$WEB_DIR"
ARCHE_RUNTIME_MODE=desktop pnpm build

# Step 2: Generate the SQLite Prisma client
echo "==> [2/4] Generating SQLite Prisma client..."
cd "$WEB_DIR"
pnpm prisma:generate:desktop

# Step 3: Compile the Electron TypeScript
echo "==> [3/4] Compiling Electron main process..."
cd "$DESKTOP_DIR"
pnpm build

# Step 4: Package with electron-builder
echo "==> [4/4] Packaging desktop app..."
cd "$DESKTOP_DIR"
pnpm dist

echo "==> Done! Output in $DESKTOP_DIR/release/"
