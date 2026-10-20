#!/usr/bin/env bash
set -euo pipefail

# Downloads the OpenCode binary for the target platform.
# Usage: ./scripts/download-opencode.sh [version] [output-dir]
#
# Defaults:
#   version:    versions/opencode.version
#   output-dir: apps/desktop/bin

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCODE_VERSION_FILE="$ROOT_DIR/versions/opencode.version"

if [[ $# -ge 1 && -n "$1" ]]; then
  VERSION="$1"
else
  if [[ ! -f "$OPENCODE_VERSION_FILE" ]]; then
    echo "Error: Missing OpenCode version file at $OPENCODE_VERSION_FILE" >&2
    exit 1
  fi
  VERSION="$(tr -d '[:space:]' < "$OPENCODE_VERSION_FILE")"
fi

OUTPUT_DIR="${2:-$ROOT_DIR/apps/desktop/bin}"

if [[ -z "$VERSION" ]]; then
  echo "Error: OpenCode version is empty" >&2
  exit 1
fi

case "$VERSION" in
  1.*) BASE_URL="https://github.com/anomalyco/opencode/releases/download/v$VERSION" ;;
  2.*) BASE_URL="https://registry.npmjs.org/@opencode" ;;
  *) echo "Unsupported OpenCode version: $VERSION" >&2; exit 1 ;;
esac

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
if [[ "$VERSION" == 2.* ]]; then
  ASSET="cli-$PLATFORM-$VERSION.tgz"
  URL="$BASE_URL/cli-$PLATFORM/-/$ASSET"
fi

mkdir -p "$OUTPUT_DIR"

OUTPUT_NAME="opencode"
if [[ "$PLATFORM" == windows-* ]]; then
  OUTPUT_NAME="opencode.exe"
fi

VERSION_STAMP="$OUTPUT_DIR/$OUTPUT_NAME.version"
if [[ -f "$OUTPUT_DIR/$OUTPUT_NAME" && -f "$VERSION_STAMP" && "${FORCE_DOWNLOAD:-0}" != "1" ]] && [[ "$(cat "$VERSION_STAMP")" == "$VERSION" ]]; then
  echo "==> OpenCode v$VERSION already present at $OUTPUT_DIR/$OUTPUT_NAME"
  exit 0
fi

echo "==> Downloading OpenCode v$VERSION for $PLATFORM"
echo "    URL: $URL"

TMPDIR_DL="$(mktemp -d "$OUTPUT_DIR/.opencode-download.XXXXXX")"
trap 'rm -rf "$TMPDIR_DL"' EXIT

ARCHIVE="$TMPDIR_DL/$ASSET"
curl -fSL -o "$ARCHIVE" "$URL"

# V2 publishes native binaries as npm tarballs, not GitHub release assets.
if [[ "$VERSION" == 2.* ]]; then
  METADATA="$TMPDIR_DL/metadata.json"
  curl -fSL -o "$METADATA" "$BASE_URL/cli-$PLATFORM/$VERSION"
  node - "$METADATA" "$ARCHIVE" "$VERSION" <<'NODE'
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const [metadataPath, archivePath, version] = process.argv.slice(2)
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
const actual = `sha512-${createHash('sha512').update(readFileSync(archivePath)).digest('base64')}`
if (metadata.version !== version || metadata.dist?.integrity !== actual) {
  console.error('Error: OpenCode package version or SHA512 integrity mismatch')
  process.exit(1)
}
NODE
else
  # Verify SHA256 checksum if a .sha256 asset is published alongside the binary
  CHECKSUM_URL="$BASE_URL/$ASSET.sha256"
  echo "==> Verifying checksum..."
  CHECKSUM_FILE="$TMPDIR_DL/$ASSET.sha256"
  if curl -fSL -o "$CHECKSUM_FILE" "$CHECKSUM_URL" 2>/dev/null; then
    EXPECTED_HASH="$(awk '{print $1}' "$CHECKSUM_FILE")"
    ACTUAL_HASH="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
    if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
      echo "Error: checksum mismatch for $ASSET" >&2
      echo "  expected: $EXPECTED_HASH" >&2
      echo "  actual:   $ACTUAL_HASH" >&2
      exit 1
    fi
    echo "    Checksum OK: $ACTUAL_HASH"
  else
    echo "    Warning: no .sha256 asset found; skipping checksum verification" >&2
  fi
fi

echo "==> Extracting..."

case "$ASSET" in
  *.tar.gz|*.tgz)
    tar -xzf "$ARCHIVE" -C "$TMPDIR_DL"
    ;;
  *.zip)
    unzip -qo "$ARCHIVE" -d "$TMPDIR_DL"
    ;;
esac

# Find the binary — it's either 'opencode' or 'opencode.exe'
BINARY=""
for candidate in "$TMPDIR_DL/opencode" "$TMPDIR_DL/opencode.exe" "$TMPDIR_DL/package/bin/$OUTPUT_NAME"; do
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

cp "$BINARY" "$OUTPUT_DIR/$OUTPUT_NAME"
if [[ "$OUTPUT_NAME" != *.exe ]]; then
  chmod +x "$OUTPUT_DIR/$OUTPUT_NAME"
fi
printf '%s\n' "$VERSION" > "$VERSION_STAMP"

echo "==> OpenCode v$VERSION installed to $OUTPUT_DIR/$OUTPUT_NAME"
echo "    Size: $(du -h "$OUTPUT_DIR/$OUTPUT_NAME" | cut -f1)"
