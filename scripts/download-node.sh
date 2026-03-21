#!/usr/bin/env bash
set -euo pipefail

# Downloads a standalone Node.js runtime for desktop packaging.
# Usage: ./scripts/download-node.sh [version] [output-dir]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION="${1:-24.12.0}"
OUTPUT_DIR="${2:-$ROOT_DIR/apps/desktop/bin}"

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    darwin) os="darwin" ;;
    linux) os="linux" ;;
    mingw*|msys*|cygwin*) os="win" ;;
    *) echo "Unsupported OS: $os" >&2; exit 1 ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported arch: $arch" >&2; exit 1 ;;
  esac

  echo "${os}-${arch}"
}

PLATFORM="${NODE_RUNTIME_PLATFORM:-$(detect_platform)}"

case "$PLATFORM" in
  darwin-arm64) ASSET="node-v$VERSION-darwin-arm64.tar.gz" ;;
  darwin-x64) ASSET="node-v$VERSION-darwin-x64.tar.gz" ;;
  linux-x64) ASSET="node-v$VERSION-linux-x64.tar.gz" ;;
  linux-arm64) ASSET="node-v$VERSION-linux-arm64.tar.gz" ;;
  win-x64) ASSET="node-v$VERSION-win-x64.zip" ;;
  *) echo "No Node.js runtime available for platform: $PLATFORM" >&2; exit 1 ;;
esac

mkdir -p "$OUTPUT_DIR"

OUTPUT_NAME="node"
if [[ "$PLATFORM" == win-* ]]; then
  OUTPUT_NAME="node.exe"
fi

if [ -f "$OUTPUT_DIR/$OUTPUT_NAME" ] && [ "${FORCE_DOWNLOAD:-0}" != "1" ]; then
  echo "==> Node.js runtime already present at $OUTPUT_DIR/$OUTPUT_NAME"
  exit 0
fi

URL="https://nodejs.org/dist/v$VERSION/$ASSET"

echo "==> Downloading Node.js v$VERSION for $PLATFORM"
echo "    URL: $URL"

TMPDIR_DL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_DL"' EXIT

ARCHIVE="$TMPDIR_DL/$ASSET"
curl -fSL -o "$ARCHIVE" "$URL"

# Verify SHA256 checksum against official Node.js SHASUMS
SHASUMS_URL="https://nodejs.org/dist/v$VERSION/SHASUMS256.txt"
echo "==> Verifying checksum..."
SHASUMS_FILE="$TMPDIR_DL/SHASUMS256.txt"
curl -fSL -o "$SHASUMS_FILE" "$SHASUMS_URL"

EXPECTED_HASH="$(grep "  $ASSET\$" "$SHASUMS_FILE" | awk '{print $1}')"
if [ -z "$EXPECTED_HASH" ]; then
  echo "Error: checksum not found for $ASSET in SHASUMS256.txt" >&2
  exit 1
fi

ACTUAL_HASH="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
  echo "Error: checksum mismatch for $ASSET" >&2
  echo "  expected: $EXPECTED_HASH" >&2
  echo "  actual:   $ACTUAL_HASH" >&2
  exit 1
fi
echo "    Checksum OK: $ACTUAL_HASH"

case "$ASSET" in
  *.tar.gz)
    tar -xzf "$ARCHIVE" -C "$TMPDIR_DL"
    ;;
  *.zip)
    unzip -qo "$ARCHIVE" -d "$TMPDIR_DL"
    ;;
esac

BINARY=""
for candidate in "$TMPDIR_DL"/*/bin/node "$TMPDIR_DL"/*/node.exe; do
  if [ -f "$candidate" ]; then
    BINARY="$candidate"
    break
  fi
done

if [ -z "$BINARY" ]; then
  echo "Error: node binary not found in archive" >&2
  exit 1
fi

cp "$BINARY" "$OUTPUT_DIR/$OUTPUT_NAME"
if [[ "$OUTPUT_NAME" != *.exe ]]; then
  chmod +x "$OUTPUT_DIR/$OUTPUT_NAME"
fi

echo "==> Node.js runtime installed to $OUTPUT_DIR/$OUTPUT_NAME"
