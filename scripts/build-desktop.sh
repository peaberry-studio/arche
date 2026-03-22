#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"

detect_desktop_platform() {
  local os
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"

  case "$os" in
    darwin) echo "darwin" ;;
    linux) echo "linux" ;;
    mingw*|msys*|cygwin*) echo "win32" ;;
    *)
      echo "Unsupported OS for desktop build: $os" >&2
      exit 1
      ;;
  esac
}

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

# Step 3: Generate Prisma clients (must precede Next.js build)
echo "==> [3/6] Generating Prisma clients..."
cd "$WEB_DIR"
pnpm prisma:generate
pnpm prisma:generate:desktop

# Step 4: Build the Next.js web app in standalone mode
echo "==> [4/6] Building Next.js web app..."
cd "$WEB_DIR"
ARCHE_RUNTIME_MODE=desktop \
ARCHE_DESKTOP_PLATFORM="${ARCHE_DESKTOP_PLATFORM:-$(detect_desktop_platform)}" \
ARCHE_DESKTOP_WEB_HOST="${ARCHE_DESKTOP_WEB_HOST:-127.0.0.1}" \
pnpm build

# Step 5: Compile the Electron TypeScript
echo "==> [5/6] Compiling Electron main process..."
cd "$DESKTOP_DIR"
pnpm build

# Step 6: Package with electron-builder
echo "==> [6/6] Packaging desktop app..."
cd "$DESKTOP_DIR"
pnpm dist

echo "==> Done! Output in $DESKTOP_DIR/release/"
