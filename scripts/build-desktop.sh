#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"

echo "==> Building Arche Desktop"

# Step 1: Prepare bundled runtime binaries for the current platform
echo "==> [1/5] Preparing desktop runtime binaries..."
bash "$SCRIPT_DIR/prepare-desktop-runtime.sh"

# Step 2: Generate the SQLite Prisma client (must precede Next.js build)
echo "==> [2/5] Generating SQLite Prisma client..."
cd "$WEB_DIR"
pnpm prisma:generate:desktop

# Step 3: Build the Next.js web app in standalone mode
echo "==> [3/5] Building Next.js web app..."
cd "$WEB_DIR"
ARCHE_RUNTIME_MODE=desktop pnpm build

# Step 4: Compile the Electron TypeScript
echo "==> [4/5] Compiling Electron main process..."
cd "$DESKTOP_DIR"
pnpm build

# Step 5: Package with electron-builder
echo "==> [5/5] Packaging desktop app..."
cd "$DESKTOP_DIR"
pnpm dist

echo "==> Done! Output in $DESKTOP_DIR/release/"
