#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"

echo "==> Building Arche Desktop"

# Step 1: Install dependencies for web and desktop builds
echo "==> [1/6] Installing dependencies..."
cd "$WEB_DIR"
pnpm install --frozen-lockfile

cd "$DESKTOP_DIR"
pnpm install --frozen-lockfile

# Step 2: Prepare bundled runtime binaries for the current platform
echo "==> [2/6] Preparing desktop runtime binaries..."
bash "$SCRIPT_DIR/prepare-desktop-runtime.sh"

# Step 3: Generate the SQLite Prisma client (must precede Next.js build)
echo "==> [3/6] Generating SQLite Prisma client..."
cd "$WEB_DIR"
pnpm prisma:generate:desktop

# Step 4: Build the Next.js web app in standalone mode
echo "==> [4/6] Building Next.js web app..."
cd "$WEB_DIR"
ARCHE_RUNTIME_MODE=desktop pnpm build

# Step 5: Compile the Electron TypeScript
echo "==> [5/6] Compiling Electron main process..."
cd "$DESKTOP_DIR"
pnpm build

# Step 6: Package with electron-builder
echo "==> [6/6] Packaging desktop app..."
cd "$DESKTOP_DIR"
pnpm dist

echo "==> Done! Output in $DESKTOP_DIR/release/"
