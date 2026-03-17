#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE_DIR="$ROOT_DIR/infra/workspace-image/workspace-agent"
OUTPUT_DIR="${1:-$ROOT_DIR/apps/desktop/bin}"

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    darwin) os="darwin" ;;
    linux) os="linux" ;;
    mingw*|msys*|cygwin*) os="windows" ;;
    *) echo "Unsupported OS: $os" >&2; exit 1 ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported arch: $arch" >&2; exit 1 ;;
  esac

  echo "$os $arch"
}

read -r GOOS GOARCH <<EOF
$(detect_platform)
EOF

mkdir -p "$OUTPUT_DIR"

OUTPUT_NAME="workspace-agent"
if [ "$GOOS" = "windows" ]; then
  OUTPUT_NAME="workspace-agent.exe"
fi

echo "==> Building workspace-agent for $GOOS/$GOARCH"
(
  cd "$SOURCE_DIR"
  CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build -o "$OUTPUT_DIR/$OUTPUT_NAME" .
)

if [ "$GOOS" != "windows" ]; then
  chmod +x "$OUTPUT_DIR/$OUTPUT_NAME"
fi

echo "==> workspace-agent installed to $OUTPUT_DIR/$OUTPUT_NAME"
