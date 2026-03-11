#!/usr/bin/env bash
set -euo pipefail

# Downloads the OpenCode binary for the target platform.
# Usage: ./scripts/download-opencode.sh [version] [output-dir]
#
# Defaults:
#   version:    1.2.24
#   output-dir: apps/desktop/bin

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION="${1:-1.2.24}"
OUTPUT_DIR="${2:-$ROOT_DIR/apps/desktop/bin}"

REPO="anomalyco/opencode"
BASE_URL="https://github.com/$REPO/releases/download/v$VERSION"

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    darwin) os="darwin" ;;
    linux)  os="linux" ;;
    mingw*|msys*|cygwin*) os="windows" ;;
    *) echo "Unsupported OS: $os" >&2; exit 1 ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported arch: $arch" >&2; exit 1 ;;
  esac

  echo "${os}-${arch}"
}

PLATFORM="${OPENCODE_PLATFORM:-$(detect_platform)}"

case "$PLATFORM" in
  darwin-arm64)  ASSET="opencode-darwin-arm64.zip" ;;
  darwin-x64)    ASSET="opencode-darwin-x64.zip" ;;
  linux-x64)     ASSET="opencode-linux-x64.tar.gz" ;;
  linux-arm64)   ASSET="opencode-linux-arm64.tar.gz" ;;
  windows-x64)   ASSET="opencode-windows-x64.zip" ;;
  *) echo "No binary available for platform: $PLATFORM" >&2; exit 1 ;;
esac

URL="$BASE_URL/$ASSET"

mkdir -p "$OUTPUT_DIR"

echo "==> Downloading OpenCode v$VERSION for $PLATFORM"
echo "    URL: $URL"

TMPDIR_DL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_DL"' EXIT

ARCHIVE="$TMPDIR_DL/$ASSET"
curl -fSL -o "$ARCHIVE" "$URL"

echo "==> Extracting..."

case "$ASSET" in
  *.tar.gz)
    tar -xzf "$ARCHIVE" -C "$TMPDIR_DL"
    ;;
  *.zip)
    unzip -qo "$ARCHIVE" -d "$TMPDIR_DL"
    ;;
esac

# Find the binary — it's either 'opencode' or 'opencode.exe'
BINARY=""
for candidate in "$TMPDIR_DL/opencode" "$TMPDIR_DL/opencode.exe"; do
  if [ -f "$candidate" ]; then
    BINARY="$candidate"
    break
  fi
done

if [ -z "$BINARY" ]; then
  echo "Error: opencode binary not found in archive" >&2
  ls -la "$TMPDIR_DL" >&2
  exit 1
fi

cp "$BINARY" "$OUTPUT_DIR/"
chmod +x "$OUTPUT_DIR/$(basename "$BINARY")"

echo "==> OpenCode v$VERSION installed to $OUTPUT_DIR/$(basename "$BINARY")"
echo "    Size: $(du -h "$OUTPUT_DIR/$(basename "$BINARY")" | cut -f1)"
